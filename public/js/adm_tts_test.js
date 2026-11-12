// Admin-Seite "Aussprache testen": Texte probehören und Ersetzungen (waip_replace) anpassen
(function () {
  "use strict";

  const daten = JSON.parse(document.getElementById("tts_daten").textContent);
  let ersetzungen = daten.ersetzungen || [];
  const csrf = daten.csrf;

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
    form: $("tts_form"),
    id: $("rp_id"),
    typ: $("rp_typ"),
    input: $("rp_input"),
    inputLabel: $("rp_input_label"),
    inputHilfe: $("rp_input_hilfe"),
    output: $("rp_output"),
    outputWarnung: $("rp_output_warnung"),
    status: $("rp_status"),
    btnProbe: $("btn_probe"),
    btnSpeichern: $("btn_speichern"),
    btnNeu: $("btn_neu"),
    filter: $("liste_filter"),
    listeTyp: $("liste_typ"),
    listeBody: $("liste_body"),
    listeLeer: $("liste_leer"),
    meldung: $("tts_meldung"),
  };

  const TYP_NAME = { orte_tts: "Ortsdaten", em_tts: "Fahrzeugtyp" };

  // ---------- Hilfsfunktionen ----------

  const meldung = (art, titel, text) => {
    const card = el.meldung.querySelector(".card");
    card.classList.remove("bg-danger", "bg-success");
    card.classList.add(art === "fehler" ? "bg-danger" : "bg-success");
    el.meldung.querySelector(".card-title").textContent = titel;
    el.meldung.querySelector(".card-text").textContent = text;
    el.meldung.classList.remove("d-none");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const meldungAus = () => el.meldung.classList.add("d-none");
  $("tts_meldung_schliessen").addEventListener("click", meldungAus);

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

  // Buttons während einer Anfrage sperren
  const beschaeftigt = async (button, fn) => {
    const buttons = [el.btnMit, el.btnOhne, el.btnProbe, el.btnSpeichern];
    buttons.forEach((b) => (b.disabled = true));
    const alt = button.innerHTML;
    button.innerHTML = "&nbsp;bitte warten …";
    try {
      return await fn();
    } finally {
      buttons.forEach((b) => (b.disabled = false));
      button.innerHTML = alt;
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

  const span = (text, cls) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  };

  // Treffer der Ersetzungen unter dem gesprochenen Text auflisten
  const trefferAnzeigen = (res, kandidat) => {
    el.treffer.replaceChildren();
    el.fehlerhaft.replaceChildren();
    const liste = res.treffer || [];
    if (liste.length === 0) {
      el.treffer.appendChild(span(res.modus === "roh" ? "Ohne Ersetzungen gesprochen." : "Keine Ersetzung hat gegriffen.", "small text-muted"));
    } else {
      const titel = span("Angewendete Ersetzungen:", "small text-muted d-block mb-1");
      el.treffer.appendChild(titel);
      liste.forEach((t) => {
        const zeile = document.createElement("div");
        zeile.className = "small mb-1";
        const badge = span(t.kandidat ? "Entwurf" : "#" + t.id, "badge mr-1 " + (t.kandidat ? "badge-warning" : "badge-secondary"));
        zeile.append(badge, span(t.rp_input, "text-monospace"), " → ", span(t.rp_output, "font-weight-bold"));
        if (t.anzahl > 1) zeile.append(span(` (${t.anzahl}×)`, "text-muted"));
        if (!t.kandidat && t.id) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-link btn-sm py-0 ion-md-create";
          b.title = "In den Editor laden";
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

  // ---------- Probehören ----------

  const vorschau = async (button, body, titel) => {
    meldungAus();
    try {
      const res = await beschaeftigt(button, () => post("/adm_tts_test/vorschau", body));
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

  const kandidatAusFormular = () => ({
    id: el.id.value ? Number(el.id.value) : null,
    rp_typ: el.typ.value,
    rp_input: el.input.value,
    rp_output: el.output.value,
  });

  el.btnProbe.addEventListener("click", () => {
    const k = kandidatAusFormular();
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

  // Markiertes Wort aus dem Testtext als Suchtext übernehmen
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
    el.output.focus();
    el.output.select();
  });

  // ---------- Editor ----------

  const typGeaendert = () => {
    if (el.typ.value === "em_tts") {
      el.inputLabel.textContent = "Typ-Kennziffer";
      el.inputHilfe.textContent = "Zweistellige Kennziffer aus dem Funkrufnamen, z.B. 23 bei „…/23-01“. Probehören spricht „Für <Ausgabewert> 1“.";
    } else {
      el.inputLabel.textContent = "Suchtext (regulärer Ausdruck)";
      el.inputHilfe.textContent = "Wird im Text gesucht (Groß-/Kleinschreibung egal) und durch den Ausgabewert ersetzt.";
    }
    statusAktualisieren();
  };

  const statusAktualisieren = () => {
    const k = kandidatAusFormular();
    el.status.className = "small mb-2";
    if (k.id) {
      el.status.textContent = `Bearbeitet Eintrag #${k.id}. Speichern ändert diesen Eintrag.`;
      el.status.classList.add("text-info");
    } else {
      const gleich = ersetzungen.find((r) => r.rp_typ === k.rp_typ && r.rp_input === (k.rp_typ === "em_tts" ? k.rp_input.trim() : k.rp_input));
      if (gleich && k.rp_input) {
        el.status.textContent = `Für diesen Eingabewert gibt es schon Eintrag #${gleich.id} („${gleich.rp_output}“). Speichern überschreibt ihn.`;
        el.status.classList.add("text-warning");
      } else {
        el.status.textContent = "Neuer Eintrag.";
        el.status.classList.add("text-muted");
      }
    }
    el.outputWarnung.classList.toggle("d-none", !/[:/-]/.test(el.output.value));
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

  el.typ.addEventListener("change", () => {
    // Typwechsel macht aus einer Bearbeitung einen neuen Eintrag
    el.id.value = "";
    typGeaendert();
  });
  el.input.addEventListener("input", statusAktualisieren);
  el.output.addEventListener("input", statusAktualisieren);
  el.btnNeu.addEventListener("click", formularLeeren);

  el.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    meldungAus();
    const k = kandidatAusFormular();
    try {
      const res = await beschaeftigt(el.btnSpeichern, () => post("/adm_tts_test/speichern", k));
      ersetzungen = res.ersetzungen;
      el.id.value = res.id;
      statusAktualisieren();
      listeAnzeigen();
      meldung("ok", "Gespeichert", `Ersetzung #${res.id} wurde ${res.aktion === "angelegt" ? "angelegt" : "geändert"}.`);
    } catch (error) {
      meldung("fehler", "Nicht gespeichert", error.message);
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
      const aktionen = document.createElement("div");
      aktionen.className = "btn-group btn-group-sm";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "btn btn-primary ion-md-play";
      play.title = "Ausgabewert anhören";
      play.addEventListener("click", () =>
        vorschau(
          play,
          r.rp_typ === "em_tts" ? { modus: "ersetzt", kandidat: r } : { text: r.rp_output, modus: "roh" },
          `Eintrag #${r.id}`
        )
      );
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn-secondary ion-md-create";
      edit.title = "Bearbeiten";
      edit.addEventListener("click", () => bearbeiten(r.id));
      aktionen.append(play, edit);
      tr.append(
        td(String(r.id)),
        td(TYP_NAME[r.rp_typ] || r.rp_typ),
        td(span(r.rp_input, "text-monospace")),
        td(r.rp_output),
        td(aktionen, "text-right text-nowrap")
      );
      el.listeBody.appendChild(tr);
    });
    el.listeLeer.classList.toggle("d-none", zeilen.length > 0);
  };

  el.filter.addEventListener("input", listeAnzeigen);
  el.listeTyp.addEventListener("change", listeAnzeigen);

  // Strg+Enter im Testtext = mit Ersetzungen anhören
  el.text.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      el.btnMit.click();
    }
  });

  typGeaendert();
  listeAnzeigen();
})();
