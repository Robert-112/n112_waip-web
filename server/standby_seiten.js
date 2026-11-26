// Webseiten im Standby
//
// Admins legen Webseiten an (Adresse, Anmeldung, Intervall) und stellen sie für Leitstellen, Kreise, Träger
// oder Wachen bereit. Benutzer wählen in ihren Einstellungen eine der für sie bereitgestellten Seiten; ihre
// Alarmmonitore (Wachendisplays) zeigen dann im Standby statt der Uhr ein Bild der Seite.
//
// Die Seite selbst lädt nur der Render-Dienst (eigener Docker, headless Chromium). Dieses Modul plant die
// Aufnahmen (nur für Seiten, die gerade ein Monitor zeigt), legt die Bilder auf der Platte ab und meldet
// neue Bilder an die Monitore. Die Monitore laden das Bild über /standby_seite/<id>.png (mit Rechteprüfung).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MINUTE = 60 * 1000;
const ANMELDEARTEN = ["keine", "token", "basic", "formular"];
const ZOOM_STUFEN = [75, 80, 100, 120, 125, 150, 200];
const INTERVALLE = Array.from({ length: 24 }, (_, i) => (i + 1) * 5); // 5–120 Minuten
const WARTEN_STUFEN = [0, 5, 15, 30];
const FEHLER_BIS_ANZEIGE = 3; // so viele Fehlversuche in Folge, bis der Monitor die Uhr mit Hinweis zeigt
const WIEDERHOLEN_NACH = 5 * MINUTE;
const PUFFER = 5 * MINUTE; // Bild gilt bis 2 × Intervall + Puffer
const TAKT = MINUTE;
const AUFRAEUMEN_TAKT = 60 * MINUTE;
const MAX_BILD = 20 * 1024 * 1024;
const DIENST_ZEITLIMIT = 3 * MINUTE;
const WACHEN_CACHE_MS = 5 * MINUTE;
const PNG_KOPF = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATEI_MUSTER = /^(\d+)_(\d+)\.png$/;

class EingabeFehler extends Error {}

module.exports = (io, sql, app_cfg, logger) => {
  const cfg = app_cfg.standby_seiten;
  const fehlt = [];
  if (!cfg.url) fehlt.push("STANDBY_SEITEN_URL");
  if (!cfg.token) fehlt.push("STANDBY_SEITEN_TOKEN");
  if (String(cfg.schluessel).length < 32) fehlt.push("STANDBY_SEITEN_SCHLUESSEL (mind. 32 Zeichen)");
  const aktiv = fehlt.length === 0;
  const ordner = path.resolve(process.cwd(), cfg.pfad);

  /* ##### Verschlüsselung der Zugangsdaten ##### */

  const schluessel = aktiv ? crypto.createHash("sha256").update(String(cfg.schluessel)).digest() : null;

  const verschluesseln = (text) => {
    if (!text) return null;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", schluessel, iv);
    const daten = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
    return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), daten.toString("base64")].join(":");
  };

  // null = kein Geheimnis gespeichert, undefined = nicht lesbar (anderer Schlüssel)
  const entschluesseln = (wert) => {
    if (!wert) return null;
    try {
      const [version, iv, tag, daten] = String(wert).split(":");
      if (version !== "v1") return undefined;
      const d = crypto.createDecipheriv("aes-256-gcm", schluessel, Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(daten, "base64")), d.final()]).toString("utf8");
    } catch (error) {
      return undefined;
    }
  };

  /* ##### Nummern und Rechte ##### */

  // Eingabe "5, 52 520301" → "5,52,520301"; erlaubt sind Leitstelle (1), Kreis (2), Träger (4), Wache (6)
  const nummern_normalisieren = (text) => {
    const teile = String(text || "")
      .split(/[\s,;]+/)
      .filter(Boolean);
    const falsch = teile.filter((t) => !/^\d+$/.test(t) || ![1, 2, 4, 6].includes(t.length) || /^0+$/.test(t));
    if (falsch.length) throw new EingabeFehler(`Ungültige Nummer(n) bei „Bereitgestellt für“: ${falsch.join(", ")} (Leitstelle 1-, Kreis 2-, Träger 4-, Wache 6-stellig).`);
    return [...new Set(teile)].join(",");
  };

  let wachen_cache = { zeit: 0, liste: [] };
  const wachen_alle = () => {
    if (Date.now() - wachen_cache.zeit > WACHEN_CACHE_MS) {
      wachen_cache = { zeit: Date.now(), liste: sql.db_wachen_nummern_aktiv() };
    }
    return wachen_cache.liste;
  };

  // Nummernliste → Menge der 6-stelligen Wachen (1-stellig über die Leitstelle, sonst Präfix)
  const wachen_von = (nummern) => {
    const ergebnis = new Set();
    const liste = (Array.isArray(nummern) ? nummern : String(nummern || "").split(",")).map((n) => String(n).trim()).filter((n) => /^\d+$/.test(n));
    if (liste.length === 0) return ergebnis;
    for (const w of wachen_alle()) {
      if (liste.some((n) => (n.length === 1 ? w.leitstelle === n : w.wache.startsWith(n)))) ergebnis.add(w.wache);
    }
    return ergebnis;
  };

  const ueberschneiden = (a, b) => {
    for (const x of a) if (b.has(x)) return true;
    return false;
  };

  const ist_admin = (user) => Boolean(user && user.permissions === "admin");

  // Darf der Benutzer die Seite wählen? (bereitgestellt für mindestens eine seiner Wachen; Admins: alle)
  const waehlbar = (user, seite) => {
    if (!user || !user.id || !seite || !seite.aktiv) return false;
    if (ist_admin(user)) return true;
    if (user.permissions === "api") return false;
    return ueberschneiden(wachen_von(seite.bereitgestellt), wachen_von(user.permissions));
  };

  // Wachendisplay: Leitstelle, Kreis, Träger oder Wache (nicht /waip/0)
  const ist_wachendisplay = (nr) => /^\d+$/.test(String(nr)) && [1, 2, 4, 6].includes(String(nr).length) && !/^0+$/.test(String(nr));

  /* ##### Seiten und Zustand ##### */

  let seiten = new Map(); // id → Zeile aus der Datenbank
  const seiten_laden = () => {
    seiten = new Map(sql.db_standby_seiten_liste().map((s) => [s.id, s]));
  };

  // Zustand je Seite (nur im Speicher): aktuelles/vorheriges Bild, letzte Aufnahme, Fehler, nächster Termin
  const zustand = new Map();
  const zustand_von = (id) => {
    if (!zustand.has(id)) zustand.set(id, { datei: null, zeit: null, vorher: null, dauer_ms: null, blockiert: [], hinweise: [], fehler: null, laeuft: false, naechster: 0 });
    return zustand.get(id);
  };

  const gueltig_bis = (seite, z) => (z.zeit ? z.zeit + 2 * seite.intervall * MINUTE + PUFFER : null);

  // Status für den Monitor: ok (Bild anzeigen), fehler (Uhr + Hinweis), wartet (Uhr, noch kein Bild)
  const status_von = (seite, z) => {
    const bild_gueltig = z.datei && Date.now() < gueltig_bis(seite, z);
    if (z.fehler && z.fehler.anzahl >= FEHLER_BIS_ANZEIGE && !bild_gueltig) return "fehler";
    if (bild_gueltig) return "ok";
    if (z.datei || (z.fehler && z.fehler.anzahl >= FEHLER_BIS_ANZEIGE)) return "fehler";
    return "wartet";
  };

  /* ##### Bilder auf der Platte ##### */

  const ordner_anlegen = () => {
    try {
      fs.mkdirSync(ordner, { recursive: true, mode: 0o750 });
      return true;
    } catch (error) {
      logger.log("error", `Standby-Webseiten: Ordner ${ordner} kann nicht angelegt werden: ${error.message}`);
      return false;
    }
  };

  // nach einem Neustart vorhandene Bilder übernehmen (Monitore zeigen sofort wieder ein Bild)
  const bilder_einlesen = () => {
    let dateien = [];
    try {
      dateien = fs.readdirSync(ordner);
    } catch (error) {
      return;
    }
    const je_seite = new Map();
    for (const datei of dateien) {
      const m = DATEI_MUSTER.exec(datei);
      if (!m) continue;
      const id = Number(m[1]);
      const zeit = Number(m[2]);
      if (!je_seite.has(id)) je_seite.set(id, []);
      je_seite.get(id).push({ datei, zeit });
    }
    for (const [id, liste] of je_seite) {
      if (!seiten.has(id)) continue;
      liste.sort((a, b) => b.zeit - a.zeit);
      const z = zustand_von(id);
      z.datei = liste[0].datei;
      z.zeit = liste[0].zeit;
      z.vorher = liste[1] ? liste[1].datei : null;
      // nicht alle Seiten gleichzeitig neu aufnehmen
      z.naechster = Math.max(z.zeit + seiten.get(id).intervall * MINUTE, Date.now() + Math.floor(Math.random() * 2 * MINUTE));
    }
  };

  // alles löschen, was nicht aktuelles oder vorheriges Bild einer bestehenden Seite ist (auch Reste von .tmp)
  const aufraeumen = () => {
    let dateien = [];
    try {
      dateien = fs.readdirSync(ordner);
    } catch (error) {
      return;
    }
    const behalten = new Set();
    for (const [id, z] of zustand) {
      if (!seiten.has(id)) continue;
      if (z.datei) behalten.add(z.datei);
      if (z.vorher) behalten.add(z.vorher);
    }
    let geloescht = 0;
    for (const datei of dateien) {
      if (behalten.has(datei)) continue;
      if (!DATEI_MUSTER.test(datei) && !/^\d+_\d+\.png\.tmp$/.test(datei)) continue; // fremde Dateien nicht anfassen
      // laufende Aufnahmen schreiben gerade ihre .tmp-Datei
      if (datei.endsWith(".tmp")) {
        const id = Number(datei.split("_")[0]);
        if (zustand.has(id) && zustand.get(id).laeuft) continue;
      }
      try {
        fs.unlinkSync(path.join(ordner, datei));
        geloescht += 1;
      } catch (error) {
        logger.log("warn", `Standby-Webseiten: ${datei} konnte nicht gelöscht werden: ${error.message}`);
      }
    }
    if (geloescht > 0) logger.log("debug", `Standby-Webseiten: ${geloescht} alte Bilddatei(en) gelöscht.`);
  };

  /* ##### Render-Dienst ##### */

  const dienst_anfrage = (pfad, optionen = {}) =>
    fetch(cfg.url + pfad, {
      ...optionen,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(optionen.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(optionen.zeitlimit || 5000),
    });

  let dienst_cache = { zeit: 0, daten: null };
  const dienst_status = async (frisch = false) => {
    if (!aktiv) return { ok: false, meldung: `Nicht eingerichtet (fehlt: ${fehlt.join(", ")}).` };
    if (!frisch && dienst_cache.daten && Date.now() - dienst_cache.zeit < MINUTE) return dienst_cache.daten;
    let daten;
    try {
      const antwort = await dienst_anfrage("/status");
      daten = antwort.ok ? await antwort.json() : { ok: false, meldung: antwort.status === 401 ? "Token passt nicht (STANDBY_SEITEN_TOKEN)." : `HTTP ${antwort.status}` };
    } catch (error) {
      daten = { ok: false, meldung: "nicht erreichbar" };
    }
    dienst_cache = { zeit: Date.now(), daten };
    return daten;
  };

  // gleiche Regeln wie im Render-Dienst (src/regeln.js): Host, *.Unterdomain, :Port
  const server_freigegeben = (liste, adresse) => {
    const u = new URL(adresse);
    const host = u.hostname.toLowerCase();
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return (liste || []).some((eintrag) => {
      const [h, p] = String(eintrag).toLowerCase().split(":");
      const host_ok = h.startsWith("*.") ? host.endsWith(h.slice(1)) && host.length > h.length - 1 : host === h;
      return host_ok && (p ? port === Number(p) : port === 80 || port === 443);
    });
  };

  /* ##### Aufnahmen ##### */

  const warteschlange = [];
  const wartend = new Map(); // id → { promise, resolve }
  let arbeitet = false;

  // Aufnahme einplanen; liefert ein Promise, das nach der Aufnahme mit dem Zustand erfüllt wird
  const einreihen = (id) => {
    if (wartend.has(id)) return wartend.get(id).promise;
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    wartend.set(id, { promise, resolve });
    warteschlange.push(id);
    abarbeiten();
    return promise;
  };

  const abarbeiten = async () => {
    if (arbeitet) return;
    arbeitet = true;
    try {
      while (warteschlange.length) {
        const id = warteschlange.shift();
        const eintrag = wartend.get(id);
        try {
          await aufnehmen(id);
        } catch (error) {
          logger.log("error", `Standby-Webseiten: Aufnahme ${id} abgebrochen: ${error.message}`);
        }
        wartend.delete(id);
        if (eintrag) eintrag.resolve(zustand.get(id) || null);
      }
    } finally {
      arbeitet = false;
    }
  };

  const fehler_setzen = (seite, z, code, meldung, blockiert = []) => {
    const vorher_status = status_von(seite, z);
    const anzahl = z.fehler ? z.fehler.anzahl + 1 : 1;
    z.fehler = { code, meldung, seit: z.fehler ? z.fehler.seit : Date.now(), anzahl, zeit: Date.now() };
    z.blockiert = blockiert;
    z.naechster = Date.now() + Math.min(WIEDERHOLEN_NACH, seite.intervall * MINUTE);
    if (anzahl === FEHLER_BIS_ANZEIGE) {
      logger.event(`Standby-Webseite „${seite.name}“ (${host_von(seite.url)}): Aufnahme ${anzahl}× fehlgeschlagen (${code}: ${meldung}).`, {
        level: "warn",
        action: "standby-seite-aufnahme",
        category: "network",
        type: "error",
        outcome: "failure",
        reason: code,
        wachalarm: { standby_seite: seite.id, host: host_von(seite.url) },
      });
    } else {
      logger.log("debug", `Standby-Webseite ${seite.id}: Aufnahme fehlgeschlagen (${code}: ${meldung}).`);
    }
    if (status_von(seite, z) !== vorher_status) verteilen(seite.id);
  };

  const host_von = (url) => {
    try {
      return new URL(url).host;
    } catch (error) {
      return "?";
    }
  };

  const aufnehmen = async (id) => {
    const seite = seiten.get(id);
    if (!seite || !aktiv) return;
    const z = zustand_von(id);
    z.laeuft = true;
    try {
      const geheimnis = entschluesseln(seite.geheimnis);
      if (geheimnis === undefined) {
        return fehler_setzen(seite, z, "zugangsdaten", "Gespeichertes Passwort/Token ist nicht lesbar (Schlüssel geändert?) – bitte neu eingeben.");
      }
      const auftrag = {
        url: seite.url,
        anmeldung: { art: seite.anmeldung, benutzer: seite.benutzer || "", geheimnis: geheimnis || "" },
        proxy: Boolean(seite.proxy),
        warten: seite.warten,
        zoom: seite.zoom,
        ausschnitt: seite.ausschnitt || "",
      };
      let antwort;
      try {
        antwort = await dienst_anfrage("/aufnahme", { method: "POST", body: JSON.stringify(auftrag), zeitlimit: DIENST_ZEITLIMIT });
      } catch (error) {
        return fehler_setzen(seite, z, "dienst", "Render-Dienst nicht erreichbar.");
      }
      const typ = antwort.headers.get("content-type") || "";
      if (!antwort.ok || !typ.startsWith("image/png")) {
        let daten = {};
        try {
          daten = await antwort.json();
        } catch (error) {}
        const blockiert = Array.isArray(daten.blockiert) ? daten.blockiert.slice(0, 20).map(String) : [];
        return fehler_setzen(seite, z, String(daten.code || `http-${antwort.status}`), String(daten.meldung || `Render-Dienst antwortet mit HTTP ${antwort.status}.`).slice(0, 300), blockiert);
      }
      const laenge = Number(antwort.headers.get("content-length") || 0);
      if (laenge > MAX_BILD) return fehler_setzen(seite, z, "zu-gross", "Bild ist zu groß.");
      const bild = Buffer.from(await antwort.arrayBuffer());
      if (bild.length > MAX_BILD || !bild.subarray(0, 8).equals(PNG_KOPF)) return fehler_setzen(seite, z, "format", "Antwort ist kein gültiges PNG.");

      // erst vollständig schreiben, dann umbenennen: ein Monitor bekommt nie ein halbes Bild
      if (!ordner_anlegen()) return fehler_setzen(seite, z, "ablage", "Bild kann nicht gespeichert werden.");
      const zeit = Math.max(Date.now(), (z.zeit || 0) + 1);
      const datei = `${id}_${zeit}.png`;
      const tmp = path.join(ordner, datei + ".tmp");
      await fs.promises.writeFile(tmp, bild, { mode: 0o640 });
      await fs.promises.rename(tmp, path.join(ordner, datei));

      const wieder_ok = z.fehler && z.fehler.anzahl >= FEHLER_BIS_ANZEIGE;
      const alt = z.vorher;
      z.vorher = z.datei;
      z.datei = datei;
      z.zeit = zeit;
      z.dauer_ms = Number(antwort.headers.get("x-dauer-ms")) || null;
      z.blockiert = String(antwort.headers.get("x-blockiert") || "").split(",").filter(Boolean).slice(0, 20);
      z.hinweise = String(antwort.headers.get("x-hinweise") || "").split(",").filter(Boolean);
      z.fehler = null;
      z.naechster = zeit + seite.intervall * MINUTE;
      if (alt) fs.promises.unlink(path.join(ordner, alt)).catch(() => {});
      if (wieder_ok) {
        logger.event(`Standby-Webseite „${seite.name}“ (${host_von(seite.url)}): Aufnahme wieder erfolgreich.`, {
          action: "standby-seite-aufnahme",
          category: "network",
          type: "info",
          outcome: "success",
          wachalarm: { standby_seite: seite.id, host: host_von(seite.url) },
        });
      }
      logger.log("debug", `Standby-Webseite ${seite.id} aufgenommen (${z.dauer_ms} ms).`);
      verteilen(id);
    } finally {
      z.laeuft = false;
    }
  };

  /* ##### Monitore ##### */

  // verbundene Wachendisplays (echte Socket-Objekte)
  const monitore = new Map();

  const nutzung = (id) => {
    let n = 0;
    for (const s of monitore.values()) if (s.connected && s.data.standby_seite === id) n += 1;
    return n;
  };

  // welche Seite zeigt dieser Monitor? (gewählt, für den Benutzer bereitgestellt und für die Wache des Monitors)
  const seite_fuer_monitor = (socket) => {
    const user = socket.data.user;
    if (!aktiv || !user || !user.id || !ist_wachendisplay(socket.data.wachen_nr)) return null;
    const gewaehlt = sql.db_user_get_config_standby(user.id).seite;
    const seite = gewaehlt ? seiten.get(gewaehlt) : null;
    if (!seite || !waehlbar(user, seite)) return null;
    if (!ueberschneiden(wachen_von(seite.bereitgestellt), wachen_von([socket.data.wachen_nr]))) return null;
    return seite;
  };

  const paket_von = (seite) => {
    if (!seite) return { aktiv: false };
    const z = zustand_von(seite.id);
    const bis = gueltig_bis(seite, z);
    return {
      aktiv: true,
      id: seite.id,
      name: seite.name,
      status: status_von(seite, z),
      v: z.zeit,
      stand: z.zeit ? new Date(z.zeit).toISOString() : null,
      gueltig_bis: bis ? new Date(bis).toISOString() : null,
    };
  };

  const senden = (socket) => {
    if (!socket.connected) return;
    const id = socket.data.standby_seite;
    socket.emit("io.standby_seite", paket_von(id ? seiten.get(id) : null));
  };

  // alle Monitore einer Seite über ein neues Bild bzw. einen geänderten Status informieren
  const verteilen = (id) => {
    for (const s of monitore.values()) if (s.data.standby_seite === id) senden(s);
  };

  const monitor_starten = (socket) => {
    try {
      monitore.set(socket.id, socket);
      const seite = seite_fuer_monitor(socket);
      socket.data.standby_seite = seite ? seite.id : null;
      senden(socket);
      if (seite) {
        const z = zustand_von(seite.id);
        // erstes Bild sofort aufnehmen (sonst stünde bis zum nächsten Takt die Uhr)
        if (!z.datei && !z.laeuft && (!z.fehler || Date.now() >= z.naechster)) einreihen(seite.id);
      }
    } catch (error) {
      logger.log("error", `Standby-Webseiten: Monitor ${socket.id} konnte nicht eingerichtet werden: ${error.message}`);
    }
  };

  const monitor_trennen = (socket) => {
    monitore.delete(socket.id);
  };

  // nach geänderten Einstellungen eines Benutzers dessen Monitore neu zuordnen
  const benutzer_aktualisiert = (user_id) => {
    for (const s of monitore.values()) if (s.data.user && s.data.user.id === user_id) monitor_starten(s);
  };

  // nach Änderungen an den Seiten alle Monitore neu zuordnen
  const alle_neu_zuordnen = () => {
    for (const s of monitore.values()) {
      if (!s.connected) monitore.delete(s.id);
      else monitor_starten(s);
    }
  };

  /* ##### Planer ##### */

  const takt = () => {
    try {
      const jetzt = Date.now();
      for (const seite of seiten.values()) {
        if (!seite.aktiv || nutzung(seite.id) === 0) continue;
        const z = zustand_von(seite.id);
        if (!z.laeuft && !wartend.has(seite.id) && jetzt >= z.naechster) einreihen(seite.id);
        // abgelaufenes Bild ohne neue Aufnahme: Monitore auf die Uhr umstellen
        const status = status_von(seite, z);
        if (z.gemeldet !== status) {
          z.gemeldet = status;
          verteilen(seite.id);
        }
      }
      for (const s of monitore.values()) if (!s.connected) monitore.delete(s.id);
    } catch (error) {
      logger.log("error", `Standby-Webseiten: Planer: ${error.message}`);
    }
  };

  /* ##### Verwaltung (Admin-Seite) ##### */

  // Eingaben prüfen und speichern; liefert { id, hinweis }
  const speichern = async (body, benutzer) => {
    if (!aktiv) throw new EingabeFehler("Webseiten im Standby sind auf diesem Server nicht eingerichtet.");
    const id = body.id ? Number(body.id) : null;
    const bisher = id ? seiten.get(id) : null;
    if (id && !bisher) throw new EingabeFehler("Die Seite gibt es nicht mehr.");

    const name = String(body.name || "").trim();
    if (!name || name.length > 80) throw new EingabeFehler("Bitte einen Namen mit höchstens 80 Zeichen angeben.");
    const url_text = String(body.url || "").trim();
    let url;
    try {
      url = new URL(url_text);
    } catch (error) {
      throw new EingabeFehler("Die Adresse ist ungültig.");
    }
    if (url_text.length > 2000 || !["http:", "https:"].includes(url.protocol)) throw new EingabeFehler("Nur http- und https-Adressen (höchstens 2000 Zeichen).");
    if (url.username || url.password) throw new EingabeFehler("Zugangsdaten gehören nicht in die Adresse, sondern in „Anmeldung“.");

    const anmeldung = String(body.anmeldung || "keine");
    if (!ANMELDEARTEN.includes(anmeldung)) throw new EingabeFehler("Unbekannte Anmeldeart.");
    let benutzer_name = String(body.benutzer || "").trim();
    if (benutzer_name.length > 200) throw new EingabeFehler("Benutzername/Header ist zu lang.");
    if (anmeldung === "token" && benutzer_name && !/^[A-Za-z0-9-]{1,64}$/.test(benutzer_name)) throw new EingabeFehler("Ungültiger Header-Name (nur Buchstaben, Ziffern, Bindestrich).");
    if ((anmeldung === "basic" || anmeldung === "formular") && !benutzer_name) throw new EingabeFehler("Bitte den Benutzernamen angeben.");
    if (anmeldung === "keine") benutzer_name = "";

    // Geheimnis: leer lassen = unverändert (nur gleiche Anmeldeart), bei "keine" wird es gelöscht
    const neu = String(body.geheimnis || "");
    if (neu.length > 4000) throw new EingabeFehler("Passwort/Token ist zu lang.");
    let geheimnis = null;
    if (anmeldung !== "keine") {
      if (neu) geheimnis = verschluesseln(neu);
      else if (bisher && bisher.geheimnis && bisher.anmeldung === anmeldung) geheimnis = bisher.geheimnis;
      else throw new EingabeFehler(anmeldung === "token" ? "Bitte das Token angeben." : "Bitte das Passwort angeben.");
    }

    const intervall = Number(body.intervall);
    if (!INTERVALLE.includes(intervall)) throw new EingabeFehler("Abruf: 5 bis 120 Minuten in 5er-Schritten.");
    const zoom = Number(body.zoom || 100);
    if (!ZOOM_STUFEN.includes(zoom)) throw new EingabeFehler("Ungültiger Zoom.");
    const warten = Number(body.warten || 0);
    if (!WARTEN_STUFEN.includes(warten)) throw new EingabeFehler("Ungültige Wartezeit.");
    const ausschnitt = String(body.ausschnitt || "").trim();
    if (ausschnitt.length > 200) throw new EingabeFehler("Ausschnitt (CSS-Selektor) ist zu lang.");
    const bereitgestellt = nummern_normalisieren(body.bereitgestellt);
    const unbekannt = bereitgestellt ? bereitgestellt.split(",").filter((nr) => wachen_von([nr]).size === 0) : [];
    if (unbekannt.length) throw new EingabeFehler(`Zu ${unbekannt.join(", ")} gibt es keine aktive Wache.`);
    const aktiv_schalter = body.aktiv === "on" || body.aktiv === true;
    const proxy = body.proxy === "on" || body.proxy === true;

    // Server vom Render-Dienst freigegeben? (nicht erreichbar: trotzdem speichern, mit Hinweis)
    let hinweis = null;
    const dienst = await dienst_status(true);
    if (dienst.ok) {
      if (!server_freigegeben(dienst.erlaubte_server, url)) {
        throw new EingabeFehler(`Der Server ${url.host} ist im Render-Dienst nicht freigegeben (ERLAUBTE_SERVER: ${(dienst.erlaubte_server || []).join(", ") || "leer"}).`);
      }
      if (proxy && !dienst.proxy) throw new EingabeFehler("„Über Proxy“ ist gewählt, im Render-Dienst ist aber kein Proxy eingetragen (PROXY_URL).");
    } else {
      hinweis = `Render-Dienst ${dienst.meldung || "nicht erreichbar"} – der Server konnte nicht geprüft werden.`;
    }

    const gespeichert = sql.db_standby_seite_speichern(
      { id, name, url: url.href, anmeldung, benutzer: benutzer_name, geheimnis, proxy, intervall, warten, zoom, ausschnitt, bereitgestellt, aktiv: aktiv_schalter },
      benutzer
    );
    if (!gespeichert) throw new EingabeFehler("Die Seite gibt es nicht mehr.");
    seiten_laden();
    // Änderungen sofort aufnehmen (neue Vorschau, alte Fehler vergessen)
    const z = zustand_von(gespeichert);
    z.fehler = null;
    z.naechster = 0;
    alle_neu_zuordnen();
    if (aktiv_schalter) einreihen(gespeichert);
    logger.event(`Standby-Webseite „${name}“ (${url.host}) ${id ? "geändert" : "angelegt"} von ${benutzer}.`, {
      action: "standby-seite-gespeichert",
      category: "configuration",
      type: id ? "change" : "creation",
      outcome: "success",
      wachalarm: { standby_seite: gespeichert, host: url.host, anmeldung, intervall, bereitgestellt, aktiv: aktiv_schalter },
    });
    return { id: gespeichert, hinweis };
  };

  const loeschen = (id, benutzer) => {
    const seite = seiten.get(Number(id));
    if (!seite) throw new EingabeFehler("Die Seite gibt es nicht mehr.");
    sql.db_standby_seite_loeschen(seite.id);
    seiten_laden();
    zustand.delete(seite.id);
    alle_neu_zuordnen();
    aufraeumen();
    logger.event(`Standby-Webseite „${seite.name}“ gelöscht von ${benutzer}.`, {
      action: "standby-seite-geloescht",
      category: "configuration",
      type: "deletion",
      outcome: "success",
      wachalarm: { standby_seite: seite.id },
    });
    return seite.name;
  };

  // sofort aufnehmen (Admin: „Jetzt aufnehmen“), wartet auf das Ergebnis
  const jetzt_aufnehmen = async (id) => {
    const seite = seiten.get(Number(id));
    if (!seite) throw new EingabeFehler("Die Seite gibt es nicht mehr.");
    await einreihen(seite.id);
    return status_admin(seite);
  };

  // Status für die Admin-Seite (ohne Geheimnis)
  const status_admin = (seite) => {
    const z = zustand_von(seite.id);
    return {
      id: seite.id,
      status: status_von(seite, z),
      laeuft: z.laeuft || wartend.has(seite.id),
      stand: z.zeit ? new Date(z.zeit).toISOString() : null,
      v: z.zeit,
      dauer_ms: z.dauer_ms,
      blockiert: z.blockiert,
      hinweise: z.hinweise,
      fehler: z.fehler ? { code: z.fehler.code, meldung: z.fehler.meldung, seit: new Date(z.fehler.seit).toISOString(), anzahl: z.fehler.anzahl } : null,
      monitore: nutzung(seite.id),
    };
  };

  // Liste für die Admin-Seite: Geheimnis nur als „gesetzt/lesbar“
  const liste_admin = () =>
    [...seiten.values()].map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      host: host_von(s.url),
      anmeldung: s.anmeldung,
      benutzer: s.benutzer || "",
      geheimnis_gesetzt: Boolean(s.geheimnis),
      geheimnis_lesbar: s.geheimnis ? entschluesseln(s.geheimnis) !== undefined : true,
      proxy: Boolean(s.proxy),
      intervall: s.intervall,
      warten: s.warten,
      zoom: s.zoom,
      ausschnitt: s.ausschnitt || "",
      bereitgestellt: s.bereitgestellt,
      aktiv: Boolean(s.aktiv),
      geaendert_von: s.geaendert_von,
      geaendert_am: s.geaendert_am,
      ...status_admin(s),
    }));

  /* ##### Benutzer ##### */

  // Seiten, die der Benutzer wählen darf
  const auswahl_fuer = (user) =>
    aktiv
      ? [...seiten.values()].filter((s) => waehlbar(user, s)).map((s) => ({ id: s.id, name: s.name }))
      : [];

  // gewählte Seite prüfen (leer = keine); wirft EingabeFehler
  const auswahl_pruefen = (user, wert) => {
    if (wert === undefined || wert === null || wert === "") return null;
    const seite = seiten.get(Number(wert));
    if (!seite || !waehlbar(user, seite)) throw new EingabeFehler("Diese Webseite steht für Sie nicht zur Auswahl.");
    return seite.id;
  };

  // Pfad zum aktuellen Bild, wenn der Benutzer es sehen darf (gewählte Seite oder Admin), sonst null
  const bild_fuer = (user, id) => {
    const seite = seiten.get(Number(id));
    if (!aktiv || !seite || !user || !user.id) return null;
    if (!ist_admin(user)) {
      if (!waehlbar(user, seite)) return null;
      if (sql.db_user_get_config_standby(user.id).seite !== seite.id) return null;
    }
    const z = zustand.get(seite.id);
    return z && z.datei ? path.join(ordner, z.datei) : null;
  };

  /* ##### Start ##### */

  if (aktiv) {
    try {
      seiten_laden();
      if (ordner_anlegen()) {
        bilder_einlesen();
        aufraeumen();
      }
      setInterval(takt, TAKT).unref();
      setInterval(aufraeumen, AUFRAEUMEN_TAKT).unref();
      logger.log("log", `Standby-Webseiten: Render-Dienst ${cfg.url}, ${seiten.size} Seite(n), Bilder in ${ordner}.`);
    } catch (error) {
      logger.log("error", `Standby-Webseiten: Start fehlgeschlagen: ${error.message}`);
    }
  }

  return {
    aktiv,
    fehlt,
    ordner,
    ZOOM_STUFEN,
    INTERVALLE,
    WARTEN_STUFEN,
    EingabeFehler,
    dienst_status,
    liste_admin,
    speichern,
    loeschen,
    jetzt_aufnehmen,
    status_admin: (id) => (seiten.has(Number(id)) ? status_admin(seiten.get(Number(id))) : null),
    auswahl_fuer,
    auswahl_pruefen,
    bild_fuer,
    monitor_starten,
    monitor_trennen,
    benutzer_aktualisiert,
  };
};
