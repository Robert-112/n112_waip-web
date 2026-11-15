// Standby-Widgets: Wetter, amtliche Unwetterwarnungen (DWD über ein selbst gehostetes Bright Sky),
// Termine und Ticker-Meldungen aus iCal-Kalendern (über den Kalender-Dienst, eigener Docker).
// Die Daten holt ausschließlich der Server, die Alarmmonitore bekommen nur fertig aufbereitete Werte
// per Socket.IO (Event "io.widgets").
//
// Verteilung:
// - Wetter + Kalender: jeder Monitor hat einen eigenen Takt (WIDGET_WEATHER_INTERVAL), dessen Startzeitpunkt
//   zufällig verteilt ist, damit nicht alle Monitore gleichzeitig neue Daten bekommen.
// - Unwetterwarnungen: werden zentral alle WIDGET_ALERT_INTERVAL Minuten geprüft, Änderungen gehen sofort
//   an alle betroffenen Monitore (sicherheitsrelevant).
// - Ticker: zentral jede Minute beim Kalender-Dienst nachfragen (der hält alles im Zwischenspeicher),
//   Änderungen gehen sofort an die betroffenen Monitore.
//
// Datenschutz: Kalender-Adressen (enthalten Zugangstoken) und Inhalte werden nicht geloggt.

const crypto = require("crypto");

module.exports = (io, sql, app_cfg, logger) => {
  const cfg = app_cfg.widgets;
  const MINUTE = 60 * 1000;
  const HTTP_TIMEOUT = 10 * 1000;
  const USER_AGENT = `Wachalarm-IP-Web/${app_cfg.public.version || "dev"}`;

  // Ablaufzeiten der Zwischenspeicher
  const TTL_AKTUELL = 10 * MINUTE; // aktuelles Wetter
  const TTL_VORHERSAGE = 60 * MINUTE; // Tageswerte heute/morgen/übermorgen
  const TTL_KALENDER = 5 * MINUTE; // der Kalender-Dienst erneuert selbst alle ABRUF_INTERVALL Minuten
  const TTL_TICKER = 50 * 1000;
  const TICKER_TAKT = 60 * 1000;
  const UNGENUTZT_LOESCHEN = 3 * 60 * MINUTE; // Cache-Einträge ohne Abruf entfernen

  const wetter_aktiv = Boolean(cfg.brightsky_url);

  /* ############################ */
  /* ##### Hilfsfunktionen ###### */
  /* ############################ */

  // Datum (YYYY-MM-DD) in der eingestellten Zeitzone
  const datum_fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: cfg.zeitzone, year: "numeric", month: "2-digit", day: "2-digit" });
  const lokales_datum = (date) => datum_fmt.format(date);

  // Abstand der Zeitzone zu UTC (ms) für einen Zeitpunkt
  const teile_fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.zeitzone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const zonen_offset = (date) => {
    const p = Object.fromEntries(teile_fmt.formatToParts(date).map((t) => [t.type, t.value]));
    const als_utc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return als_utc - (date.getTime() - date.getMilliseconds());
  };

  // Tagesbeginn (00:00 Ortszeit) von heute + tage als Date
  const tages_beginn = (tage = 0) => {
    const [y, m, d] = lokales_datum(new Date()).split("-").map(Number);
    const utc_mitternacht = Date.UTC(y, m - 1, d + tage);
    return new Date(utc_mitternacht - zonen_offset(new Date(utc_mitternacht)));
  };

  const datum_plus = (tage) => lokales_datum(new Date(tages_beginn(tage).getTime() + 12 * 60 * MINUTE));

  const hash = (obj) => crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex");

  const runden = (wert) => (typeof wert === "number" && isFinite(wert) ? Math.round(wert) : null);

  const kuerzen = (text, max) => {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  };

  // Fehlerzustand je Dienst merken, damit nur Wechsel (gestört/wieder erreichbar) geloggt werden
  const dienst_status = new Map();
  const status_melden = (dienst, ok, fehler, felder = {}) => {
    const vorher = dienst_status.get(dienst);
    dienst_status.set(dienst, ok);
    if (ok && vorher === false) {
      logger.event(`Standby-Widgets: ${dienst} wieder erreichbar.`, {
        action: "widget-dienst",
        category: "network",
        type: "info",
        outcome: "success",
        wachalarm: { widget_dienst: dienst, ...felder },
      });
    } else if (!ok && vorher !== false) {
      logger.event(`Standby-Widgets: ${dienst} nicht erreichbar: ${fehler && fehler.message ? fehler.message : fehler}`, {
        level: "warn",
        action: "widget-dienst",
        category: "network",
        type: "error",
        outcome: "failure",
        error: fehler,
        wachalarm: { widget_dienst: dienst, ...felder },
      });
    }
  };

  /* ############################ */
  /* ##### Wetter (Bright Sky) ## */
  /* ############################ */

  // Bright Sky läuft intern (Docker), daher direkter Abruf ohne Proxy
  const brightsky_get = async (pfad, params) => {
    const url = new URL(cfg.brightsky_url + pfad);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    url.searchParams.set("tz", cfg.zeitzone);
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT), headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      const err = new Error(`Bright Sky ${pfad} antwortete mit HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };

  // Schlüssel für einen Standort (auf ca. 100 m gerundet, damit nahe Wachen sich einen Abruf teilen)
  const ort_schluessel = (ort) => `${Number(ort.lat).toFixed(3)},${Number(ort.lon).toFixed(3)}`;
  const warn_schluessel = (ort) => (ort.warncell_id ? `zelle:${ort.warncell_id}` : `ort:${ort_schluessel(ort)}`);

  // Cache mit Doppelabruf-Schutz: gleichzeitige Anfragen teilen sich ein Promise
  const erstelle_cache = () => new Map();
  const cache_holen = async (cache, schluessel, ttl, laden) => {
    let eintrag = cache.get(schluessel);
    const jetzt = Date.now();
    if (!eintrag) {
      eintrag = { daten: null, zeit: 0, laufend: null, genutzt: jetzt };
      cache.set(schluessel, eintrag);
    }
    eintrag.genutzt = jetzt;
    if (eintrag.daten && jetzt - eintrag.zeit < ttl) return eintrag.daten;
    if (!eintrag.laufend) {
      eintrag.laufend = laden()
        .then((daten) => {
          eintrag.daten = daten;
          eintrag.zeit = Date.now();
          return daten;
        })
        .finally(() => {
          eintrag.laufend = null;
        });
    }
    try {
      return await eintrag.laufend;
    } catch (error) {
      // bei Fehler den letzten Stand weiter verwenden (der Monitor blendet ihn nach WIDGET_MAX_AGE aus)
      if (eintrag.daten) return eintrag.daten;
      throw error;
    }
  };
  const cache_aufraeumen = (cache) => {
    const grenze = Date.now() - UNGENUTZT_LOESCHEN;
    for (const [k, v] of cache) {
      if (v.genutzt < grenze && !v.laufend) cache.delete(k);
    }
  };

  const cache_aktuell = erstelle_cache();
  const cache_vorhersage = erstelle_cache();
  const cache_warnungen = erstelle_cache();
  const cache_kalender = erstelle_cache();

  // Symbol eines Tages: häufigstes Symbol zwischen 7 und 20 Uhr, Niederschlag/Gewitter gehen vor,
  // wenn sie mindestens 3 Stunden auftreten
  const VORRANG = ["thunderstorm", "hail", "snow", "sleet", "rain", "wind", "fog"];
  const tages_symbol = (stunden) => {
    const zaehler = new Map();
    for (const s of stunden) {
      const h = Number(String(s.timestamp).slice(11, 13));
      if (h < 7 || h > 20 || !s.icon) continue;
      const icon = String(s.icon).replace("-night", "-day");
      zaehler.set(icon, (zaehler.get(icon) || 0) + 1);
    }
    for (const icon of VORRANG) {
      if ((zaehler.get(icon) || 0) >= 3) return icon;
    }
    let bestes = null;
    for (const [icon, anzahl] of zaehler) {
      if (!bestes || anzahl > bestes[1]) bestes = [icon, anzahl];
    }
    return bestes ? bestes[0] : null;
  };

  const tageswerte = (stunden) => {
    const temps = stunden.map((s) => s.temperature).filter((t) => typeof t === "number");
    const regen = stunden.map((s) => s.precipitation_probability).filter((p) => typeof p === "number");
    return {
      min: temps.length ? runden(Math.min(...temps)) : null,
      max: temps.length ? runden(Math.max(...temps)) : null,
      regen: regen.length ? runden(Math.max(...regen)) : null,
      icon: tages_symbol(stunden),
    };
  };

  const lade_aktuell = async (ort) => {
    const antwort = await brightsky_get("/current_weather", { lat: ort.lat, lon: ort.lon });
    const w = antwort.weather || {};
    return {
      stand: w.timestamp || null,
      temperatur: runden(w.temperature),
      icon: w.icon || null,
      wind: runden(w.wind_speed_30 ?? w.wind_speed_10 ?? w.wind_speed_60),
      boeen: runden(w.wind_gust_speed_30 ?? w.wind_gust_speed_10 ?? w.wind_gust_speed_60),
    };
  };

  const lade_vorhersage = async (ort) => {
    const heute = datum_plus(0);
    const antwort = await brightsky_get("/weather", { lat: ort.lat, lon: ort.lon, date: heute, last_date: datum_plus(3) });
    const nach_tag = new Map();
    for (const s of antwort.weather || []) {
      const tag = String(s.timestamp).slice(0, 10);
      if (!nach_tag.has(tag)) nach_tag.set(tag, []);
      nach_tag.get(tag).push(s);
    }
    const jetzt = Date.now();
    const heute_stunden = nach_tag.get(heute) || [];
    // Regenrisiko für den Rest des Tages
    const rest = heute_stunden.filter((s) => new Date(s.timestamp).getTime() >= jetzt - 60 * MINUTE);
    const heute_werte = tageswerte(heute_stunden);
    const rest_regen = rest.map((s) => s.precipitation_probability).filter((p) => typeof p === "number");
    heute_werte.regen = rest_regen.length ? runden(Math.max(...rest_regen)) : heute_werte.regen;
    // Stundenwert der aktuellen Stunde als Ersatz, falls /current_weather für den Ort keine Station findet
    const stunde = (antwort.weather || [])
      .filter((s) => new Date(s.timestamp).getTime() <= jetzt)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    const jetzt_wert = stunde
      ? {
          stand: stunde.timestamp,
          temperatur: runden(stunde.temperature),
          icon: stunde.icon || null,
          wind: runden(stunde.wind_speed),
          boeen: runden(stunde.wind_gust_speed),
        }
      : null;
    return {
      heute: heute_werte,
      jetzt: jetzt_wert,
      tage: [1, 2].map((plus) => ({ datum: datum_plus(plus), ...tageswerte(nach_tag.get(datum_plus(plus)) || []) })),
    };
  };

  const SCHWERE = { minor: 1, moderate: 2, severe: 3, extreme: 4 };
  const lade_warnungen = async (ort) => {
    const params = ort.warncell_id ? { warn_cell_id: ort.warncell_id } : { lat: ort.lat, lon: ort.lon };
    const antwort = await brightsky_get("/alerts", params);
    const jetzt = Date.now();
    const liste = (antwort.alerts || [])
      .filter((a) => a.status === "actual" && (!a.expires || new Date(a.expires).getTime() > jetzt))
      .map((a) => ({
        stufe: SCHWERE[a.severity] || 1,
        ereignis: kuerzen(a.event_de, 80),
        titel: kuerzen(a.headline_de || a.event_de, 120),
        beginn: a.onset || null,
        ende: a.expires || null,
      }))
      .sort((a, b) => b.stufe - a.stufe || String(a.beginn).localeCompare(String(b.beginn)))
      .slice(0, 5);
    return { liste: liste, gebiet: antwort.location ? kuerzen(antwort.location.name, 80) : null };
  };

  // Abruf bei Bright Sky mit Statusmeldung (Ausfall/Wiederherstellung je Dienst einmal ins Log), auch wenn
  // der Monitor währenddessen noch den letzten Stand aus dem Zwischenspeicher bekommt
  const mit_status = (dienst, laden, felder = { brightsky_url: cfg.brightsky_url }) => () =>
    laden().then(
      (daten) => {
        status_melden(dienst, true);
        return daten;
      },
      (error) => {
        // 4xx (z.B. "No sources match your criteria") heißt: Dienst erreichbar, nur keine Daten für den Ort
        const erreichbar = error.status >= 400 && error.status < 500;
        status_melden(dienst, erreichbar, error, felder);
        throw error;
      }
    );

  // Wetter für einen Standort zusammenstellen (Teilergebnisse bleiben bei Fehlern erhalten)
  const wetter_fuer_ort = async (ort) => {
    const schluessel = ort_schluessel(ort);
    const [aktuell, vorhersage] = await Promise.allSettled([
      cache_holen(cache_aktuell, schluessel, TTL_AKTUELL, mit_status("Bright Sky (aktuell)", () => lade_aktuell(ort))),
      cache_holen(cache_vorhersage, schluessel, TTL_VORHERSAGE, mit_status("Bright Sky (Vorhersage)", () => lade_vorhersage(ort))),
    ]);
    if (aktuell.status === "rejected" && vorhersage.status === "rejected") return null;
    // Zeitpunkt des jüngsten erfolgreichen Abrufs (der Monitor blendet ältere Daten nach WIDGET_MAX_AGE aus)
    const zeiten = [cache_aktuell.get(schluessel), cache_vorhersage.get(schluessel)].map((e) => (e && e.daten ? e.zeit : 0));
    const abgerufen = Math.max(...zeiten);
    // aktuelles Wetter: Messwert der nächsten Station, sonst Stundenwert aus der Vorhersage
    let aktuell_wert = aktuell.status === "fulfilled" ? aktuell.value : null;
    if ((!aktuell_wert || aktuell_wert.temperatur === null) && vorhersage.status === "fulfilled") aktuell_wert = vorhersage.value.jetzt;
    return {
      ort: ort.name || null,
      abgerufen: abgerufen ? new Date(abgerufen).toISOString() : null,
      aktuell: aktuell_wert,
      heute: vorhersage.status === "fulfilled" ? vorhersage.value.heute : null,
      tage: vorhersage.status === "fulfilled" ? vorhersage.value.tage : [],
    };
  };

  const warnungen_fuer_ort = async (ort) => {
    try {
      const daten = await cache_holen(cache_warnungen, warn_schluessel(ort), (cfg.alert_interval * MINUTE) / 2, mit_status("Bright Sky (Warnungen)", () => lade_warnungen(ort)));
      const eintrag = cache_warnungen.get(warn_schluessel(ort));
      return { ...daten, abgerufen: eintrag && eintrag.zeit ? new Date(eintrag.zeit).toISOString() : null };
    } catch (error) {
      return null;
    }
  };

  /* ################################################ */
  /* ##### Kalender-Dienst (Termine und Ticker) ###### */
  /* ################################################ */

  // Der Kalender-Dienst (eigener Docker) prüft die Adressen gegen seine Liste freigegebener Server, lädt die
  // Kalender (ggf. über Proxy), wertet sie aus und hält sie im Zwischenspeicher. Der Wachalarm fragt nur intern ab.
  const kalender_aktiv = Boolean(cfg.kalender_url);

  class KalenderFehler extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const kalender_dienst = async (pfad, body) => {
    if (!kalender_aktiv) throw new KalenderFehler("aus", "Kalender und Ticker sind auf diesem Server nicht eingerichtet.");
    const headers = { "User-Agent": USER_AGENT };
    if (body) headers["Content-Type"] = "application/json";
    if (cfg.kalender_token) headers.Authorization = `Bearer ${cfg.kalender_token}`;
    let res;
    try {
      // beim ersten Abruf einer Adresse wartet der Dienst selbst auf den Kalender-Server (bis zu ca. 10 s)
      res = await fetch(cfg.kalender_url + pfad, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25 * 1000),
      });
    } catch (error) {
      const err = new KalenderFehler("dienst", "Der Kalender-Dienst ist nicht erreichbar.");
      status_melden("Kalender-Dienst", false, error, { kalender_url: cfg.kalender_url });
      throw err;
    }
    let daten = null;
    try {
      daten = await res.json();
    } catch (e) {
      // keine JSON-Antwort
    }
    // 400/404/502 = Dienst arbeitet, nur die Adresse bzw. der Kalender-Server hat ein Problem
    const dienst_ok = res.ok || [400, 404, 502].includes(res.status);
    status_melden("Kalender-Dienst", dienst_ok, `HTTP ${res.status}`, { kalender_url: cfg.kalender_url });
    if (!res.ok || !daten || daten.ok === false) {
      if (res.status === 401) throw new KalenderFehler("token", "Der Kalender-Dienst lehnt den Zugriff ab (WIDGET_KALENDER_TOKEN prüfen).");
      throw new KalenderFehler((daten && daten.code) || "dienst", (daten && daten.meldung) || `Kalender-Dienst antwortete mit HTTP ${res.status}.`);
    }
    return daten;
  };

  // Status des Dienstes (erlaubte Server für die Einstellungsseite), kurz zwischengespeichert
  const cache_status = erstelle_cache();
  const kalender_dienst_status = async () => {
    if (!kalender_aktiv) return { aktiv: false };
    const start = Date.now();
    try {
      const daten = await cache_holen(cache_status, "status", 60 * 1000, () => kalender_dienst("/status"));
      return { aktiv: true, ok: true, dauer_ms: Date.now() - start, version: daten.version, domains: daten.domains || [], intervall_min: daten.intervall_min };
    } catch (error) {
      return { aktiv: true, ok: false, fehler: error.message, domains: [] };
    }
  };
  const erlaubte_kalender = async () => (await kalender_dienst_status()).domains || [];

  // Adresse prüfen und probeweise laden; liefert die vereinheitlichte Adresse (webcal → https, Freigabelinks usw.)
  const kalender_url_pruefen = async (eingabe) => {
    const daten = await kalender_dienst("/pruefen", { url: eingabe, abrufen: true });
    return { url: daten.url, domain: daten.domain };
  };

  // Termine einer Adresse (zwischengespeichert, damit viele Monitore mit demselben Kalender nur einmal fragen)
  const kalender_laden = (url_text) =>
    cache_holen(cache_kalender, url_text, TTL_KALENDER, async () => {
      const daten = await kalender_dienst("/termine", { url: url_text });
      return { termine: daten.termine || [], abgerufen: daten.abgerufen || null };
    });

  // Ticker eines Monitors: Leitstelle und Kreis der aufgerufenen Nummer plus eigener Ticker des Benutzers
  // Nur für angemeldete Monitore: die Meldungen sind intern (Monitore ohne Anmeldung zeigen keinen Ticker)
  const ticker_quellen_fuer = (socket, einstellungen) => {
    if (!socket.data.user || !socket.data.user.id) return [];
    const quellen = sql.db_ticker_quellen_fuer_nr(socket.data.wachen_nr).map((q) => ({ url: q.url, name: q.name }));
    if (einstellungen.ticker_url) quellen.push({ url: einstellungen.ticker_url, name: "" });
    return quellen;
  };
  const ticker_schluessel = (quellen) => hash(quellen.map((q) => q.url));

  const cache_ticker = erstelle_cache();
  const ticker_laden = (quellen) =>
    cache_holen(cache_ticker, ticker_schluessel(quellen), TTL_TICKER, async () => {
      const daten = await kalender_dienst("/ticker", { quellen: quellen.map((q, i) => ({ url: q.url, ebene: String(i) })) });
      const meldungen = (daten.meldungen || []).map((m) => {
        const quelle = quellen[Number(m.ebene)];
        return { text: m.text, stufe: m.stufe, start: m.start, ende: m.ende, quelle: cfg.ticker_quelle && quelle ? quelle.name : "" };
      });
      return { meldungen, erstellt: daten.erstellt || new Date().toISOString() };
    });

  // Status je Ticker-Kalender für die Admin-Seite: laufende und bald beginnende Meldungen, Stand, Fehlercode.
  // Je Kalender eine Anfrage (exakte Zahlen ohne Zusammenführen); ist der Dienst selbst weg, Fehler werfen.
  const ticker_quellen_status = async (liste) => {
    const jetzt = Date.now();
    const ergebnisse = await Promise.allSettled(liste.map((q) => kalender_dienst("/ticker", { quellen: [{ url: q.url, ebene: "0" }] })));
    const dienst_weg = ergebnisse.length > 0 && ergebnisse.every((r) => r.status === "rejected" && ["dienst", "token", "aus"].includes(r.reason.code));
    if (dienst_weg) throw ergebnisse[0].reason;
    const status = {};
    ergebnisse.forEach((r, i) => {
      if (r.status === "rejected") {
        status[liste[i].nr] = { ok: false, code: r.reason.code || "abruf" };
        return;
      }
      const q = (r.value.quellen || [])[0] || {};
      const meldungen = r.value.meldungen || [];
      status[liste[i].nr] = q.ok
        ? {
            ok: true,
            laufend: meldungen.filter((m) => new Date(m.start).getTime() <= jetzt && new Date(m.ende).getTime() > jetzt).length,
            demnaechst: meldungen.filter((m) => new Date(m.start).getTime() > jetzt).length,
            abgerufen: q.abgerufen || null,
            veraltet: Boolean(q.veraltet),
          }
        : { ok: false, code: q.code || "abruf" };
    });
    return status;
  };

  // Test für die Admin-Seite: aktuelle Meldungen eines Ticker-Kalenders (ohne Zwischenspeicher)
  const ticker_testen = async (url) => {
    const start = Date.now();
    const daten = await kalender_dienst("/ticker", { quellen: [{ url, ebene: "0" }] });
    const q = (daten.quellen || [])[0] || {};
    if (q.ok === false) throw new KalenderFehler(q.code || "abruf", `Kalender konnte nicht geladen werden (${q.code || "Fehler"}).`);
    return { meldungen: daten.meldungen || [], abgerufen: q.abgerufen || null, veraltet: Boolean(q.veraltet), dauer_ms: Date.now() - start };
  };

  /* ######################################################## */
  /* ##### Waldbrandgefahrenstufe (eigener Waldbrand-Dienst) ## */
  /* ######################################################## */

  // Der Waldbrand-Dienst (Docker, neben Bright Sky) lädt die Stufen des Landes und liefert
  // {"datum": "YYYY-MM-DD", "kreise": {"52": {"stufe": 1, "gebiet": "…"}, …}}
  const waldbrand_aktiv = Boolean(cfg.waldbrand_url);
  const TTL_WALDBRAND = 10 * MINUTE;
  const cache_waldbrand = erstelle_cache();
  const WALDBRAND_TEXT = { 1: "Sehr geringe Gefahr", 2: "Geringe Gefahr", 3: "Mittlere Gefahr", 4: "Hohe Gefahr", 5: "Sehr hohe Gefahr" };

  const lade_waldbrand = async () => {
    const res = await fetch(cfg.waldbrand_url, { signal: AbortSignal.timeout(HTTP_TIMEOUT), headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      const err = new Error(`Waldbrand-Dienst antwortete mit HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const daten = await res.json();
    if (!daten || typeof daten.kreise !== "object" || daten.kreise === null) throw new Error('Antwort des Waldbrand-Dienstes ohne "kreise".');
    return { datum: daten.datum || null, kreise: daten.kreise };
  };

  // Waldbrandgefahrenstufe für eine Monitor-Nummer (Leitstelle: höchste Stufe ihrer Kreise)
  const waldbrand_fuer_nr = async (wachen_nr) => {
    if (!waldbrand_aktiv) return null;
    const kreise = sql.db_kreise_fuer_nr(wachen_nr);
    if (kreise.length === 0) return null;
    const daten = await cache_holen(cache_waldbrand, "dienst", TTL_WALDBRAND, mit_status("Waldbrand-Dienst", lade_waldbrand, { waldbrand_url: cfg.waldbrand_url }));
    // die Stufen gelten tageweise: älter als gestern wird nicht mehr angezeigt
    if (daten.datum && daten.datum < datum_plus(-1)) return null;
    let hoechste = null;
    for (const k of kreise) {
      const eintrag = daten.kreise[String(k.nr_kreis)];
      const stufe = eintrag ? Number(eintrag.stufe) : NaN;
      if (Number.isInteger(stufe) && stufe >= 1 && stufe <= 5 && (!hoechste || stufe > hoechste.stufe)) {
        hoechste = { stufe: stufe, gebiet: kuerzen(eintrag.gebiet || "", 80) };
      }
    }
    if (!hoechste) return null;
    const cache_eintrag = cache_waldbrand.get("dienst");
    return {
      ...hoechste,
      text: WALDBRAND_TEXT[hoechste.stufe] || "",
      datum: daten.datum,
      abgerufen: cache_eintrag && cache_eintrag.zeit ? new Date(cache_eintrag.zeit).toISOString() : null,
    };
  };

  /* ############################ */
  /* ##### Verteilung ########### */
  /* ############################ */

  // Einstellungen und Standort eines Monitors ermitteln
  const monitor_konfiguration = (socket) => {
    const user = socket.data.user;
    const einstellungen = user && user.id ? sql.db_user_get_config_standby(user.id) : { wetter: false, kalender: false, ical_url: "", ticker_url: "" };
    // Wetter: Benutzereinstellung, Monitor-Parameter ?wetter=on oder WIDGET_WETTER_STANDARD schalten ein,
    // ?wetter=off schaltet für diesen Monitor in jedem Fall aus
    const parameter = socket.data.widgets_parameter || {};
    if (parameter.wetter === "off") einstellungen.wetter = false;
    else if (parameter.wetter === "on" || cfg.wetter_standard) einstellungen.wetter = true;
    let ort = null;
    if (einstellungen.wetter && wetter_aktiv) {
      ort = sql.db_wetter_ort_ermitteln(socket.data.wachen_nr);
    }
    const ticker_quellen = kalender_aktiv ? ticker_quellen_fuer(socket, einstellungen) : [];
    return {
      wetter: Boolean(einstellungen.wetter && wetter_aktiv && ort),
      // Waldbrandgefahr gehört zum Schalter "Wetter und amtliche Unwetterwarnungen"
      waldbrand: Boolean(einstellungen.wetter && waldbrand_aktiv),
      kalender: Boolean(kalender_aktiv && einstellungen.kalender && einstellungen.ical_url),
      ical_url: einstellungen.ical_url,
      // Ticker: Leitstelle/Kreis (Admin-Seite "Ticker-Quellen") und eigener Ticker-Kalender des Benutzers
      ticker: ticker_quellen.length > 0,
      ticker_quellen: ticker_quellen,
      ort: ort,
    };
  };

  // Kopf jedes io.widgets-Pakets: was ist eingeschaltet, Höchstalter, Anzeigeschwelle Waldbrand
  const kopf_von = (k) => ({
    aktiv: { wetter: k.wetter, kalender: k.kalender, waldbrand: k.waldbrand, ticker: k.ticker },
    max_age: cfg.max_age,
    waldbrand_ab: cfg.waldbrand_ab_stufe,
  });

  // Ein Termin gilt als vorbei, wenn sein Ende erreicht ist (Termine ohne Dauer: 1 Stunde nach Beginn)
  const termin_laeuft_noch = (t, jetzt) => Math.max(new Date(t.ende).getTime(), new Date(t.start).getTime() + 60 * MINUTE) > jetzt;

  // Kalender für einen Monitor: abgelaufene Termine weglassen, höchstens ical_max Einträge
  const kalender_fuer_monitor = (daten) => {
    const jetzt = Date.now();
    const termine = (daten.termine || []).filter((t) => termin_laeuft_noch(t, jetzt)).slice(0, cfg.ical_max);
    return { termine: termine, abgerufen: daten.abgerufen };
  };

  // verbundene Alarmmonitore (echte Socket-Objekte; fetchSockets() liefert nur Hüllen ohne "connected")
  const monitore = new Map();

  // Daten zusammenstellen und an einen Monitor senden
  const senden = async (socket, teile = { wetter: true, warnungen: true, kalender: true, ticker: true }) => {
    if (!socket.connected) return;
    const k = socket.data.widgets;
    if (!k) return;
    const payload = kopf_von(k);
    const aufgaben = [];
    if (k.wetter && teile.wetter) {
      aufgaben.push(wetter_fuer_ort(k.ort).then((w) => (payload.wetter = w), () => (payload.wetter = null)));
    }
    if (k.wetter && teile.warnungen) {
      aufgaben.push(
        warnungen_fuer_ort(k.ort).then((w) => {
          payload.warnungen = w;
          if (w) socket.data.widgets_warn_hash = hash(w.liste);
        })
      );
    }
    if (k.waldbrand && teile.warnungen) {
      aufgaben.push(
        waldbrand_fuer_nr(socket.data.wachen_nr).then(
          (wb) => {
            payload.waldbrand = wb;
            if (wb) socket.data.widgets_wb_hash = hash([wb.stufe, wb.datum]);
          },
          () => (payload.waldbrand = null)
        )
      );
    }
    if (k.kalender && teile.kalender) {
      aufgaben.push(
        kalender_laden(k.ical_url).then(
          (d) => (payload.kalender = kalender_fuer_monitor(d)),
          () => (payload.kalender = null)
        )
      );
    }
    if (k.ticker && teile.ticker) {
      aufgaben.push(
        ticker_laden(k.ticker_quellen).then(
          (t) => {
            payload.ticker = t;
            socket.data.widgets_ticker_hash = hash(t.meldungen);
          },
          // Dienst gestört: nichts senden, der Monitor behält die bisherigen Meldungen (mit ihrem Ende)
          () => {}
        )
      );
    }
    await Promise.all(aufgaben);
    if (socket.connected) socket.emit("io.widgets", payload);
  };

  // Monitor anmelden (nach dem WAIP-Aufruf) bzw. nach geänderten Einstellungen neu konfigurieren
  const monitor_starten = (socket) => {
    try {
      monitor_stoppen(socket);
      monitore.set(socket.id, socket);
      socket.data.widgets = monitor_konfiguration(socket);
      const k = socket.data.widgets;
      // auch ohne Widgets senden, damit der Monitor ausgeschaltete Widgets ausblendet
      senden(socket).catch((error) => logger.log("error", `Standby-Widgets: Senden an ${socket.id} fehlgeschlagen: ${error.message}`));
      if (!k.wetter && !k.kalender) return; // Ticker kommt über ticker_pruefen (zentral)
      // eigener Takt je Monitor mit zufälligem Startzeitpunkt, damit die Monitore verteilt aktualisieren
      const intervall = cfg.weather_interval * MINUTE;
      socket.data.widgets_start = setTimeout(() => {
        senden(socket, { wetter: true, kalender: true }).catch(() => {});
        socket.data.widgets_takt = setInterval(() => senden(socket, { wetter: true, kalender: true }).catch(() => {}), intervall);
      }, Math.floor(Math.random() * intervall));
    } catch (error) {
      logger.log("error", `Standby-Widgets: Monitor ${socket.id} konnte nicht eingerichtet werden: ${error.message}`);
    }
  };

  const monitor_stoppen = (socket) => {
    clearTimeout(socket.data.widgets_start);
    clearInterval(socket.data.widgets_takt);
    socket.data.widgets_start = null;
    socket.data.widgets_takt = null;
  };

  // Monitor getrennt: Takt beenden und aus der Liste entfernen
  const monitor_trennen = (socket) => {
    monitor_stoppen(socket);
    monitore.delete(socket.id);
  };

  // Nach geänderten Einstellungen eines Benutzers alle seine Monitore neu einrichten
  const benutzer_aktualisiert = (user_id) => {
    for (const s of monitore.values()) {
      if (s.data.user && s.data.user.id === user_id) monitor_starten(s);
    }
  };

  // Unwetterwarnungen zentral prüfen und Änderungen sofort verteilen
  const warnungen_pruefen = async () => {
    try {
      const gruppen = new Map();
      for (const s of monitore.values()) {
        if (!s.connected) {
          monitor_trennen(s);
          continue;
        }
        const k = s.data.widgets;
        if (!k || !k.wetter || !k.ort) continue;
        const schluessel = warn_schluessel(k.ort);
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { ort: k.ort, sockets: [] });
        gruppen.get(schluessel).sockets.push(s);
      }
      for (const { ort, sockets: gruppe } of gruppen.values()) {
        const warnungen = await warnungen_fuer_ort(ort);
        if (!warnungen) continue;
        const neu = hash(warnungen.liste);
        for (const s of gruppe) {
          if (s.data.widgets_warn_hash !== neu && s.connected) {
            s.data.widgets_warn_hash = neu;
            s.emit("io.widgets", { ...kopf_von(s.data.widgets), warnungen: warnungen });
          }
        }
      }
      // Waldbrandgefahrenstufe: Änderungen ebenfalls sofort verteilen
      for (const s of monitore.values()) {
        const k = s.data.widgets;
        if (!k || !k.waldbrand || !s.connected) continue;
        const wb = await waldbrand_fuer_nr(s.data.wachen_nr).catch(() => null);
        if (!wb) continue;
        const neu = hash([wb.stufe, wb.datum]);
        if (s.data.widgets_wb_hash !== neu) {
          s.data.widgets_wb_hash = neu;
          s.emit("io.widgets", { ...kopf_von(k), waldbrand: wb });
        }
      }
      for (const cache of [cache_aktuell, cache_vorhersage, cache_warnungen, cache_kalender, cache_waldbrand, cache_ticker]) cache_aufraeumen(cache);
    } catch (error) {
      logger.log("error", `Standby-Widgets: Prüfung der Unwetterwarnungen fehlgeschlagen: ${error.message}`);
    }
  };
  if (wetter_aktiv || waldbrand_aktiv || kalender_aktiv) {
    setInterval(warnungen_pruefen, cfg.alert_interval * MINUTE);
  }

  // Ticker zentral prüfen: Monitore mit denselben Quellen teilen sich eine Anfrage, Änderungen gehen sofort raus
  const ticker_pruefen = async () => {
    try {
      const gruppen = new Map();
      for (const s of monitore.values()) {
        const k = s.data.widgets;
        if (!s.connected || !k || !k.ticker) continue;
        const schluessel = ticker_schluessel(k.ticker_quellen);
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { quellen: k.ticker_quellen, sockets: [] });
        gruppen.get(schluessel).sockets.push(s);
      }
      for (const { quellen, sockets: gruppe } of gruppen.values()) {
        const ticker = await ticker_laden(quellen).catch(() => null);
        if (!ticker) continue;
        const neu = hash(ticker.meldungen);
        for (const s of gruppe) {
          if (s.data.widgets_ticker_hash !== neu && s.connected) {
            s.data.widgets_ticker_hash = neu;
            s.emit("io.widgets", { ...kopf_von(s.data.widgets), ticker: ticker });
          }
        }
      }
    } catch (error) {
      logger.log("error", `Standby-Widgets: Prüfung des Tickers fehlgeschlagen: ${error.message}`);
    }
  };
  if (kalender_aktiv) {
    setInterval(ticker_pruefen, TICKER_TAKT);
  }

  // Ticker-Quellen auf der Admin-Seite geändert: alle Monitore neu einrichten (Quellen hängen an der Nummer)
  const ticker_quellen_geaendert = () => {
    cache_ticker.clear();
    for (const s of monitore.values()) {
      if (s.connected) monitor_starten(s);
    }
  };

  // Erreichbarkeit von Bright Sky (Mittelpunkt Deutschlands) und Waldbrand-Dienst prüfen (Admin-Seite)
  const dienste_pruefen = async () => {
    const pruefen = async (aktiv, abruf) => {
      if (!aktiv) return { aktiv: false };
      const start = Date.now();
      try {
        const daten = await abruf();
        return { aktiv: true, ok: true, dauer_ms: Date.now() - start, datum: daten && daten.datum ? daten.datum : undefined };
      } catch (error) {
        return { aktiv: true, ok: false, fehler: error.message };
      }
    };
    const [brightsky, waldbrand] = await Promise.all([
      pruefen(wetter_aktiv, () => brightsky_get("/alerts", { lat: 51.16, lon: 10.45 })),
      pruefen(waldbrand_aktiv, lade_waldbrand),
    ]);
    return { brightsky, waldbrand };
  };

  // Wetter-Test für die Admin-Seite (ohne Cache)
  const wetter_testen = async (ort, wachen_nr) => {
    if (!wetter_aktiv && !waldbrand_aktiv) throw new Error("Weder WIDGET_BRIGHTSKY_URL noch WIDGET_WALDBRAND_URL ist gesetzt.");
    let waldbrand = null;
    if (waldbrand_aktiv && wachen_nr) {
      waldbrand = await waldbrand_fuer_nr(wachen_nr).catch((error) => ({ fehler: error.message }));
    }
    const ab_stufe = cfg.waldbrand_ab_stufe;
    if (!wetter_aktiv) return { aktuell: null, aktuell_quelle: "Bright Sky nicht eingerichtet", warnungen: null, waldbrand, waldbrand_ab: ab_stufe };
    const [aktuell, vorhersage, warnungen] = await Promise.allSettled([lade_aktuell(ort), lade_vorhersage(ort), lade_warnungen(ort)]);
    if (warnungen.status === "rejected" && vorhersage.status === "rejected") throw warnungen.reason;
    return {
      aktuell: aktuell.status === "fulfilled" ? aktuell.value : vorhersage.status === "fulfilled" ? vorhersage.value.jetzt : null,
      aktuell_quelle: aktuell.status === "fulfilled" ? "Station" : "Vorhersage (keine Station mit aktuellen Werten)",
      warnungen: warnungen.status === "fulfilled" ? warnungen.value : null,
      waldbrand,
      waldbrand_ab: ab_stufe,
    };
  };

  logger.log(
    "log",
    `Standby-Widgets: Wetter ${wetter_aktiv ? "über " + cfg.brightsky_url : "aus (WIDGET_BRIGHTSKY_URL leer)"}, ` +
      `Kalender und Ticker: ${kalender_aktiv ? "über " + cfg.kalender_url : "aus (WIDGET_KALENDER_URL leer)"}, ` +
      `Waldbrandgefahr: ${waldbrand_aktiv ? cfg.waldbrand_url + " (ab Stufe " + cfg.waldbrand_ab_stufe + ")" : "aus"}.`
  );

  return {
    monitor_starten,
    monitor_trennen,
    benutzer_aktualisiert,
    kalender_url_pruefen,
    kalender_dienst_status,
    ticker_testen,
    ticker_quellen_status,
    ticker_quellen_geaendert,
    wetter_testen,
    dienste_pruefen,
    wetter_aktiv,
    waldbrand_aktiv,
    kalender_aktiv,
    wetter_standard: cfg.wetter_standard,
    erlaubte_kalender,
    KalenderFehler,
  };
};
