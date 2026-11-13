// Admin-Seite "Ersetzungen": Ersetzungen (waip_replace) anlegen, bearbeiten, löschen und
// für die Sprachansage probehören
(function () {
  "use strict";

  const daten = JSON.parse(document.getElementById("rp_daten").textContent);
  let ersetzungen = daten.ersetzungen || [];
  const csrf = daten.csrf;
  const TTS_TYPEN = daten.tts_typen || ["orte_tts", "em_tts"];

  // Bekannte Typen mit Beschriftung; weitere Typen aus der Tabelle werden generisch angezeigt
  const TYPEN = {
    orte_tts: {
      name: "Ortsdaten",
      zweck: "Sprachansage",
      input: "Suchtext (regulärer Ausdruck)",
      inputHilfe: "Wird im Ansagetext gesucht (Groß-/Kleinschreibung egal) und durch den Ausgabewert ersetzt.",
      output: "So soll es gesprochen werden",
      outputHilfe: "",
    },
    em_tts: {
      name: "Fahrzeugtyp",
      zweck: "Sprachansage",
      input: "Typ-Kennziffer",
      inputHilfe: "Zweistellige Kennziffer aus dem Funkrufnamen, z.B. 23 bei „…/23-01“.",
      output: "So soll es gesprochen werden",
      outputHilfe: "Probehören spricht „Für <Ausgabewert> 1“, wie in der Alarmansage.",
    },
    station_alias: {
      name: "Wachen-Alias",
      zweck: "Alarmierung",
      input: "Wachenname beim Einsatzmittel",
      inputHilfe: "Name der Wache, wie er in den Einsatzdaten beim Einsatzmittel steht.",
      output: "Wachennummer",
      outputHilfe: "Einsätze mit diesem Wachennamen gehen zusätzlich an diese Wache. Ein Name darf mehreren Wachen zugeordnet sein.",
    },
  };
  const typInfo = (typ) =>
    TYPEN[typ] || { name: typ, zweck: "", input: "Eingabewert", inputHilfe: "", output: "Ausgabewert", outputHilfe: "" };
  const istTts = (typ) => TTS_TYPEN.includes(typ);

  const $ = (id) => document.getElementById(id);
  const el = {
    text: $("tts_text"),
    btnMit: $("btn_mit"),
    btnOhne: $("btn_ohne"),
    btnMarkierung: $("btn_markierung"),
    ergebnis: $("tts_ergebnis"),
    ergebnisTitel: $("tts_ergebnis_titel"),
    audio: $("tts_audio"),
    gesprochen: $("tts_gesprochen"),
    treffer: $("tts_treffer"),
    fehlerhaft: $("tts_fehlerhaft"),
    form: $("rp_form"),
    formTitel: $("rp_form_titel"),
    id: $("rp_id"),
    typ: $("rp_typ"),
    input: $("rp_input"),
    inputLabel: $("rp_input_label"),
    inputHilfe: $("rp_input_hilfe"),
    output: $("rp_output"),
    outputLabel: $("rp_output_label"),
    outputHilfe: $("rp_output_hilfe"),
    outputWarnung: $("rp_output_warnung"),
    status: $("rp_status"),
    btnProbe: $("btn_probe"),
    btnSpeichern: $("btn_speichern"),
    btnNeu: $("btn_neu"),
    btnLoeschen: $("btn_loeschen"),
    filter: $("liste_filter"),
    listeTyp: $("liste_typ"),
    listeBody: $("liste_body"),
    listeLeer: $("liste_leer"),
    meldung: $("rp_meldung"),
    loeschenModal: $("loeschen_modal"),
    loeschenText: $("loeschen_text"),
    loeschenOk: $("loeschen_ok"),
  };

  // ---------- Hilfsfunktionen ----------

  // Rückmeldung als schließbarer Alert, gleicher Aufbau wie das Mixin "meldungen"
  const meldung = (art, titel, text) => {
    const fehler = art === "fehler";
    const alert = document.createElement("div");
    alert.className = "alert alert-dismissible d-flex align-items-start gap-2 " + (fehler ? "alert-danger" : "alert-success");
    alert.setAttribute("role", "alert");
    const icon = document.createElement("i");
    icon.className = "bi flex-shrink-0 " + (fehler ? "bi-x-circle-fill" : "bi-check-circle-fill");
    icon.setAttribute("aria-hidden", "true");
    const inhalt = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = titel + ": ";
    inhalt.append(strong, text);
    const schliessen = document.createElement("button");
    schliessen.type = "button";
    schliessen.className = "btn-close";
    schliessen.setAttribute("data-bs-dismiss", "alert");
    schliessen.setAttribute("aria-label", "Schließen");
    alert.append(icon, inhalt, schliessen);
    el.meldung.replaceChildren(alert);
    el.meldung.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const meldungAus = () => el.meldung.replaceChildren();

  // Button mit Bootstrap-Icon und optionalem Text befüllen
  const iconButton = (button, icon, text) => {
    const i = document.createElement("i");
    i.className = "bi " + icon + (text ? " me-1" : "");
    i.setAttribute("aria-hidden", "true");
    button.replaceChildren(i);
    if (text) button.append(text);
  };

  const span = (text, cls) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  };

  const post = async (url, body) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, _csrf: csrf }),
      cache: "no-store",
    });
    const typ = resp.headers.get("content-type") || "";
    // Ungültiges CSRF-Token oder abgelaufene Anmeldung: Server leitet auf eine HTML-Seite um
    if (resp.redirected || !typ.includes("application/json")) {
      throw new Error("Die Sitzung ist abgelaufen oder die Seite ist veraltet. Bitte die Seite neu laden (ggf. neu anmelden).");
    }
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || `Fehler ${resp.status}`);
    return json;
  };

  // Buttons während einer Anfrage sperren, am auslösenden Button einen Spinner zeigen
  let laeuft = false;
  const beschaeftigt = async (button, fn) => {
    const buttons = [el.btnMit, el.btnOhne, el.btnProbe, el.btnSpeichern, el.btnLoeschen, el.loeschenOk];
    const vorher = buttons.map((b) => b.disabled);
    buttons.forEach((b) => (b.disabled = true));
    button.disabled = true;
    laeuft = true;
    const alt = Array.from(button.childNodes);
    const spinner = document.createElement("span");
    spinner.className = "spinner-border spinner-border-sm" + (button.textContent.trim() ? " me-1" : "");
    spinner.setAttribute("aria-hidden", "true");
    button.replaceChildren(spinner, ...(button.textContent.trim() ? ["bitte warten …"] : []));
    try {
      return await fn();
    } finally {
      laeuft = false;
      buttons.forEach((b, i) => (b.disabled = vorher[i]));
      button.disabled = false;
      button.replaceChildren(...alt);
      statusAktualisieren();
    }
  };

  let audioUrl = null;
  const abspielen = (base64, mime) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/wav" }));
    el.audio.src = audioUrl;
    el.audio.play().catch(() => {
      /* Autoplay blockiert: Wiedergabe über die Steuerelemente möglich */
    });
  };

  // ---------- Probehören ----------

  // Treffer der Ersetzungen unter dem gesprochenen Text auflisten
  const trefferAnzeigen = (res, kandidat) => {
    el.treffer.replaceChildren();
    el.fehlerhaft.replaceChildren();
    const liste = res.treffer || [];
    if (liste.length === 0) {
      el.treffer.appendChild(span(res.modus === "roh" ? "Ohne Ersetzungen gesprochen." : "Keine Ersetzung hat gegriffen.", "small text-body-secondary"));
    } else {
      el.treffer.appendChild(span("Angewendete Ersetzungen:", "small text-body-secondary d-block mb-1"));
      liste.forEach((t) => {
        const zeile = document.createElement("div");
        zeile.className = "small mb-1";
        const badge = span(t.kandidat ? "Entwurf" : "#" + t.id, "badge me-1 " + (t.kandidat ? "text-bg-warning" : "text-bg-secondary"));
        zeile.append(badge, span(t.rp_input, "font-monospace"), " → ", span(t.rp_output, "fw-bold"));
        if (t.anzahl > 1) zeile.append(span(` (${t.anzahl}×)`, "text-body-secondary"));
        if (!t.kandidat && t.id) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-link btn-sm py-0 link-info";
          b.title = "In den Editor laden";
          b.setAttribute("aria-label", "Ersetzung #" + t.id + " bearbeiten");
          iconButton(b, "bi-pencil");
          b.addEventListener("click", () => bearbeiten(t.id));
          zeile.append(b);
        }
        el.treffer.appendChild(zeile);
      });
    }
    // Hinweis, wenn der Entwurf im Testtext nicht vorkommt
    if (kandidat && kandidat.rp_typ === "orte_tts" && !liste.some((t) => t.kandidat)) {
      el.treffer.appendChild(span("Der Suchtext kommt im Testtext nicht vor – der Entwurf wurde nicht angewendet.", "small text-warning d-block"));
    }
    (res.fehlerhaft || []).forEach((f) => {
      el.fehlerhaft.appendChild(span(`Ersetzung #${f.id || "Entwurf"} „${f.rp_input}“ ist fehlerhaft und wird übersprungen: ${f.fehler}`, "small text-danger d-block"));
    });
  };

  const vorschau = async (button, body, titel) => {
    meldungAus();
    try {
      const res = await beschaeftigt(button, () => post("/adm_edit_replace/vorschau", body));
      res.modus = body.modus;
      el.ergebnis.classList.remove("d-none");
      el.ergebnisTitel.textContent = `${titel} – gesprochen wurde (${res.dauer_ms} ms):`;
      el.gesprochen.textContent = res.text_gesprochen;
      trefferAnzeigen(res, body.kandidat);
      abspielen(res.audio, res.mime);
    } catch (error) {
      meldung("fehler", "Fehler", error.message);
    }
  };

  el.btnMit.addEventListener("click", () => vorschau(el.btnMit, { text: el.text.value, modus: "ersetzt" }, "Mit Ersetzungen"));
  el.btnOhne.addEventListener("click", () => vorschau(el.btnOhne, { text: el.text.value, modus: "roh" }, "Ohne Ersetzungen"));

  // Strg+Enter im Testtext = mit Ersetzungen anhören
  el.text.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      el.btnMit.click();
    }
  });

  const kandidatAusFormular = () => ({
    id: el.id.value ? Number(el.id.value) : null,
    rp_typ: el.typ.value,
    rp_input: el.input.value,
    rp_output: el.output.value,
  });

  el.btnProbe.addEventListener("click", () => {
    const k = kandidatAusFormular();
    if (!istTts(k.rp_typ)) return;
    if (!k.rp_output.trim()) {
      meldung("fehler", "Fehler", "Bitte eingeben, wie es gesprochen werden soll.");
      el.output.focus();
      return;
    }
    if (k.rp_typ === "orte_tts") {
      if (!k.rp_input) {
        meldung("fehler", "Fehler", "Bitte einen Suchtext eingeben.");
        el.input.focus();
        return;
      }
      // Ohne Testtext den Suchtext selbst als Testtext verwenden (bei einfachen Wörtern sinnvoll)
      if (!el.text.value.trim()) el.text.value = k.rp_input.replace(/\\b/g, "").replace(/\\(.)/g, "$1");
    }
    vorschau(el.btnProbe, { text: el.text.value, modus: "ersetzt", kandidat: k }, "Entwurf");
  });

  // Markiertes Wort aus dem Testtext als neue Ortsdaten-Ersetzung in den Editor übernehmen
  el.btnMarkierung.addEventListener("click", () => {
    const markiert = el.text.value.substring(el.text.selectionStart, el.text.selectionEnd).trim();
    if (!markiert) {
      meldung("fehler", "Hinweis", "Bitte zuerst im Testtext ein Wort oder eine Wortgruppe markieren.");
      return;
    }
    formularLeeren();
    el.typ.value = "orte_tts";
    typGeaendert();
    // Sonderzeichen für den regulären Ausdruck schützen
    el.input.value = markiert.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    el.output.value = markiert;
    statusAktualisieren();
    el.form.scrollIntoView({ behavior: "smooth", block: "center" });
    el.output.focus();
    el.output.select();
  });

  // ---------- Editor ----------

  // Typ-Auswahl aus bekannten und in der Tabelle vorkommenden Typen aufbauen
  const typOptionen = (select, mitAlle) => {
    const wert = select.value;
    const typen = [...new Set([...Object.keys(TYPEN), ...ersetzungen.map((r) => r.rp_typ).filter(Boolean)])];
    select.replaceChildren();
    if (mitAlle) select.append(new Option("Alle Typen", ""));
    typen.forEach((t) => {
      const info = typInfo(t);
      select.append(new Option(info.zweck ? `${info.name} (${info.zweck})` : info.name, t));
    });
    if (wert !== undefined && [...select.options].some((o) => o.value === wert)) select.value = wert;
  };

  const typGeaendert = () => {
    const info = typInfo(el.typ.value);
    el.inputLabel.textContent = info.input;
    el.inputHilfe.textContent = info.inputHilfe;
    el.outputLabel.textContent = info.output;
    el.outputHilfe.textContent = info.outputHilfe;
    statusAktualisieren();
  };

  const statusAktualisieren = () => {
    const k = kandidatAusFormular();
    const tts = istTts(k.rp_typ);
    el.formTitel.textContent = k.id ? `Ersetzung #${k.id} bearbeiten` : "Neue Ersetzung";
    el.btnLoeschen.classList.toggle("d-none", !k.id);
    if (!laeuft) el.btnProbe.disabled = !tts;
    el.btnProbe.title = tts ? "" : "Dieser Typ wirkt nicht auf die Sprachansage.";
    el.outputWarnung.classList.toggle("d-none", !tts || !/[:/-]/.test(el.output.value));

    el.status.className = "small mb-3";
    const input = k.rp_typ === "orte_tts" ? k.rp_input : k.rp_input.trim();
    const gleiche = ersetzungen.filter((r) => r.rp_typ === k.rp_typ && r.rp_input === input && r.id !== k.id);
    if (k.id) {
      el.status.textContent = `Speichern ändert Eintrag #${k.id}.`;
      el.status.classList.add("text-info");
    } else if (gleiche.length && input && tts) {
      el.status.textContent = `Für diesen Eingabewert gibt es schon Eintrag #${gleiche[0].id} („${gleiche[0].rp_output}“). Speichern überschreibt ihn.`;
      el.status.classList.add("text-warning");
    } else if (gleiche.length && input) {
      el.status.textContent = `Für diesen Eingabewert gibt es schon ${gleiche.map((r) => `#${r.id} (${r.rp_output})`).join(", ")}. Speichern legt einen weiteren Eintrag an.`;
      el.status.classList.add("text-info");
    } else {
      el.status.textContent = "Speichern legt einen neuen Eintrag an.";
      el.status.classList.add("text-body-secondary");
    }
  };

  const formularLeeren = () => {
    el.id.value = "";
    el.input.value = "";
    el.output.value = "";
    statusAktualisieren();
  };

  const bearbeiten = (id) => {
    const r = ersetzungen.find((e) => e.id === id);
    if (!r) return;
    el.id.value = r.id;
    el.typ.value = r.rp_typ;
    el.input.value = r.rp_input;
    el.output.value = r.rp_output;
    typGeaendert();
    el.form.scrollIntoView({ behavior: "smooth", block: "center" });
    el.output.focus();
  };

  el.typ.addEventListener("change", typGeaendert);
  el.input.addEventListener("input", statusAktualisieren);
  el.output.addEventListener("input", statusAktualisieren);
  el.btnNeu.addEventListener("click", () => {
    formularLeeren();
    el.input.focus();
  });

  // Nach Speichern/Löschen Liste und Auswahlfelder mit dem Serverstand aktualisieren
  const datenUebernehmen = (neu) => {
    ersetzungen = neu;
    typOptionen(el.typ, false);
    typOptionen(el.listeTyp, true);
    listeAnzeigen();
  };

  el.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    meldungAus();
    try {
      const res = await beschaeftigt(el.btnSpeichern, () => post("/adm_edit_replace/speichern", kandidatAusFormular()));
      el.id.value = res.id;
      datenUebernehmen(res.ersetzungen);
      statusAktualisieren();
      meldung("ok", "Gespeichert", `Ersetzung #${res.id} wurde ${res.aktion === "angelegt" ? "angelegt" : "geändert"}.`);
    } catch (error) {
      meldung("fehler", "Nicht gespeichert", error.message);
    }
  });

  // ---------- Löschen ----------

  const modal = window.bootstrap ? bootstrap.Modal.getOrCreateInstance(el.loeschenModal) : null;
  let loeschenId = null;

  const loeschenFragen = (id) => {
    const r = ersetzungen.find((e) => e.id === id);
    if (!r || !modal) return;
    loeschenId = id;
    el.loeschenText.replaceChildren(
      `Ersetzung #${r.id} (${typInfo(r.rp_typ).name}) `,
      span(r.rp_input, "font-monospace"),
      " → ",
      span(r.rp_output, "fw-bold"),
      " wirklich löschen?"
    );
    modal.show();
  };

  el.btnLoeschen.addEventListener("click", () => loeschenFragen(Number(el.id.value)));

  el.loeschenOk.addEventListener("click", async () => {
    const id = loeschenId;
    meldungAus();
    try {
      const res = await beschaeftigt(el.loeschenOk, () => post("/adm_edit_replace/loeschen", { id }));
      modal.hide();
      if (Number(el.id.value) === id) formularLeeren();
      datenUebernehmen(res.ersetzungen);
      meldung("ok", "Gelöscht", `Ersetzung #${id} wurde gelöscht.`);
    } catch (error) {
      modal.hide();
      meldung("fehler", "Nicht gelöscht", error.message);
    }
  });

  // ---------- Liste ----------

  const listeAnzeigen = () => {
    const filter = el.filter.value.trim().toLowerCase();
    const typ = el.listeTyp.value;
    const zeilen = ersetzungen.filter(
      (r) =>
        (!typ || r.rp_typ === typ) &&
        (!filter || String(r.rp_input).toLowerCase().includes(filter) || String(r.rp_output).toLowerCase().includes(filter) || String(r.id) === filter)
    );
    el.listeBody.replaceChildren();
    zeilen.forEach((r) => {
      const tr = document.createElement("tr");
      const td = (inhalt, cls) => {
        const c = document.createElement("td");
        if (cls) c.className = cls;
        c.append(inhalt);
        return c;
      };
      const knopf = (cls, icon, titel, aktion) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn " + cls;
        b.title = titel;
        b.setAttribute("aria-label", `${titel} (Ersetzung #${r.id})`);
        iconButton(b, icon);
        if (aktion) b.addEventListener("click", () => aktion(b));
        else b.disabled = true;
        return b;
      };
      const aktionen = document.createElement("div");
      aktionen.className = "btn-group btn-group-sm";
      aktionen.append(
        istTts(r.rp_typ)
          ? knopf("btn-primary", "bi-play-fill", "Anhören", (b) =>
              vorschau(b, r.rp_typ === "em_tts" ? { modus: "ersetzt", kandidat: r } : { text: r.rp_output, modus: "roh" }, `Eintrag #${r.id}`)
            )
          : knopf("btn-outline-secondary", "bi-volume-mute", "Kein Teil der Sprachansage", null),
        knopf("btn-secondary", "bi-pencil", "Bearbeiten", () => bearbeiten(r.id)),
        knopf("btn-outline-danger", "bi-trash", "Löschen", () => loeschenFragen(r.id))
      );
      const info = typInfo(r.rp_typ);
      const typZelle = document.createElement("span");
      typZelle.append(info.name);
      if (info.zweck) typZelle.append(span(" · " + info.zweck, "small text-body-secondary d-none d-md-inline"));
      tr.append(
        td(String(r.id)),
        td(typZelle),
        td(span(r.rp_input, "font-monospace")),
        td(r.rp_output),
        td(aktionen, "text-end text-nowrap")
      );
      el.listeBody.appendChild(tr);
    });
    el.listeLeer.classList.toggle("d-none", zeilen.length > 0);
  };

  el.filter.addEventListener("input", listeAnzeigen);
  el.listeTyp.addEventListener("change", listeAnzeigen);

  // ---------- Start ----------
  typOptionen(el.typ, false);
  typOptionen(el.listeTyp, true);
  el.typ.value = "orte_tts";
  typGeaendert();
  listeAnzeigen();
})();
