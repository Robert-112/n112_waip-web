// Admin-Seite „Webseiten im Standby“: Dialog zum Anlegen/Bearbeiten, Vorschau, Status der Aufnahmen
(function () {
  const daten = JSON.parse(document.getElementById("seiten_daten").textContent);
  const seiten = new Map(daten.seiten.map((s) => [s.id, s]));
  const status = new Map();
  const $ = (id) => document.getElementById(id);

  const ANMELDUNG = {
    keine: { benutzer: null, geheimnis: null },
    token: { benutzer: ["Header-Name (optional)", "Authorization"], geheimnis: "Token" },
    basic: { benutzer: ["Benutzername", ""], geheimnis: "Passwort" },
    formular: { benutzer: ["Benutzername", ""], geheimnis: "Passwort" },
  };

  const zeit = (iso) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  async function post(pfad, body) {
    const res = await fetch(pfad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ _csrf: daten.csrf }, body || {})),
    });
    const antwort = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(antwort.error || "HTTP " + res.status);
    return antwort;
  }

  function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Status einer Seite als Inhalt (Badge + Text), für Tabelle und Dialoge
  function status_inhalt(st) {
    const box = el("span");
    if (!st) {
      box.appendChild(el("span", "text-body-secondary", "–"));
      return box;
    }
    const badge = (klasse, text) => box.appendChild(el("span", "badge me-1 " + klasse, text));
    if (st.laeuft) badge("text-bg-secondary", "wird aufgenommen …");
    if (st.status === "ok") {
      badge("text-bg-success", "ok");
      box.appendChild(el("span", "text-body-secondary", zeit(st.stand) + (st.dauer_ms ? " · " + (st.dauer_ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " s" : "")));
    } else if (st.fehler) {
      badge(st.status === "fehler" ? "text-bg-danger" : "text-bg-warning", st.status === "fehler" ? "Fehler" : "Fehlversuch");
      box.appendChild(el("span", "text-body-secondary", st.fehler.meldung + " · seit " + zeit(st.fehler.seit)));
    } else if (st.status === "fehler" && st.stand) {
      badge("text-bg-warning", "veraltet");
      box.appendChild(el("span", "text-body-secondary", "letzte Aufnahme " + zeit(st.stand)));
    } else if (!st.laeuft) {
      box.appendChild(el("span", "text-body-secondary", st.monitore > 0 ? "noch keine Aufnahme" : "noch keine Aufnahme (erfolgt, sobald ein Monitor sie zeigt)"));
    }
    if (st.blockiert && st.blockiert.length) {
      box.appendChild(el("div", "text-body-secondary", "blockiert (nicht freigegeben): " + st.blockiert.join(", ")));
    }
    if (st.hinweise && st.hinweise.includes("ausschnitt-fehlt")) {
      box.appendChild(el("div", "text-warning", "Ausschnitt nicht gefunden – ganze Seite aufgenommen."));
    }
    return box;
  }

  function vorschau_setzen(img, leer, st, id) {
    if (st && st.v) {
      img.src = "/standby_seite/" + id + ".png?v=" + st.v;
      img.classList.remove("d-none");
      leer.classList.add("d-none");
    } else {
      img.removeAttribute("src");
      img.classList.add("d-none");
      leer.classList.remove("d-none");
    }
  }

  function zeile_aktualisieren(st) {
    status.set(st.id, st);
    const zelle = document.querySelector('[data-status="' + st.id + '"]');
    if (zelle) zelle.replaceChildren(status_inhalt(st));
    const genutzt = document.querySelector('[data-genutzt="' + st.id + '"]');
    if (genutzt) genutzt.textContent = st.monitore === 1 ? "1 Monitor" : st.monitore + " Monitore";
  }

  async function status_laden() {
    try {
      const r = await post("/adm_edit_seiten/status");
      const d = r.dienst || {};
      const s = $("dienst_status");
      s.className = "badge align-self-center " + (d.ok ? "text-bg-success" : "text-bg-danger");
      s.textContent = d.ok ? "bereit" + (d.chromium ? " · Chromium " + d.chromium.split(".")[0] : "") : d.meldung || "nicht erreichbar";
      $("dienst_server").textContent = d.ok ? (d.erlaubte_server || []).join(", ") || "keine (ERLAUBTE_SERVER leer)" : "–";
      $("dienst_last").textContent = d.ok
        ? d.aufnahmen_stunde + " Aufnahme(n)" + (d.fehler_stunde ? ", " + d.fehler_stunde + " Fehler" : "") + (d.dauer_mittel_ms ? " · Ø " + (d.dauer_mittel_ms / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " s" : "")
        : "–";
      (r.seiten || []).forEach(zeile_aktualisieren);
    } catch (e) {
      $("dienst_status").className = "badge text-bg-danger align-self-center";
      $("dienst_status").textContent = "Status nicht abrufbar";
    }
  }

  async function aufnehmen(id, knopf, ziel) {
    knopf.disabled = true;
    ziel.replaceChildren(el("span", "text-body-secondary", "wird aufgenommen …"));
    try {
      const st = await post("/adm_edit_seiten/aufnehmen", { id: id });
      zeile_aktualisieren(st);
      return st;
    } catch (e) {
      ziel.replaceChildren(el("span", "text-danger", "Fehler: " + e.message));
      return null;
    } finally {
      knopf.disabled = false;
    }
  }

  /* ##### Dialog Anlegen/Bearbeiten ##### */

  const modal = new bootstrap.Modal($("seiteModal"));
  let bearbeitet = null;

  function anmeldung_anpassen() {
    const art = $("f_anmeldung").value;
    const a = ANMELDUNG[art];
    $("f_benutzer_feld").classList.toggle("d-none", !a.benutzer);
    $("f_geheimnis_feld").classList.toggle("d-none", !a.geheimnis);
    if (a.benutzer) {
      $("f_benutzer_label").textContent = a.benutzer[0];
      $("f_benutzer").placeholder = a.benutzer[1];
      $("f_benutzer").required = art !== "token";
    } else {
      $("f_benutzer").required = false;
    }
    if (a.geheimnis) {
      $("f_geheimnis_label").textContent = a.geheimnis;
      const gespeichert = bearbeitet && bearbeitet.geheimnis_gesetzt && bearbeitet.anmeldung === art;
      $("f_geheimnis").placeholder = gespeichert ? "gespeichert – leer lassen = unverändert" : "";
      $("f_geheimnis").required = !gespeichert;
    } else {
      $("f_geheimnis").required = false;
    }
  }

  function dialog_oeffnen(seite) {
    bearbeitet = seite;
    $("seiteTitel").textContent = seite ? "Seite bearbeiten" : "Seite anlegen";
    $("f_id").value = seite ? seite.id : "";
    $("f_name").value = seite ? seite.name : "";
    $("f_url").value = seite ? seite.url : "";
    $("f_intervall").value = seite ? seite.intervall : 30;
    $("f_anmeldung").value = seite ? seite.anmeldung : "keine";
    $("f_benutzer").value = seite ? seite.benutzer : "";
    $("f_geheimnis").value = "";
    $("f_proxy").checked = seite ? seite.proxy : false;
    $("f_bereitgestellt").value = seite ? seite.bereitgestellt.split(",").join(", ") : "";
    $("f_warten").value = seite ? seite.warten : 0;
    $("f_zoom").value = seite ? seite.zoom : 100;
    $("f_ausschnitt").value = seite ? seite.ausschnitt : "";
    $("f_aktiv").checked = seite ? seite.aktiv : true;
    $("f_loeschen").classList.toggle("d-none", !seite);
    $("f_loeschen").querySelector("span").textContent = "Löschen";
    $("f_loeschen").dataset.bestaetigt = "";
    $("f_aufnehmen").disabled = !seite;
    $("f_aufnehmen").title = seite ? "" : "Erst speichern";
    const st = seite ? status.get(seite.id) : null;
    vorschau_setzen($("f_vorschau"), $("f_vorschau_leer"), st, seite && seite.id);
    $("f_status").replaceChildren(seite ? status_inhalt(st) : el("span", "", "Nach dem Speichern wird die Seite sofort aufgenommen."));
    anmeldung_anpassen();
    modal.show();
  }

  $("f_anmeldung").addEventListener("change", anmeldung_anpassen);
  $("seite_neu").addEventListener("click", () => dialog_oeffnen(null));
  document.querySelectorAll(".seite-bearbeiten").forEach((b) => b.addEventListener("click", () => dialog_oeffnen(seiten.get(Number(b.dataset.id)))));

  $("f_aufnehmen").addEventListener("click", async () => {
    if (!bearbeitet) return;
    const st = await aufnehmen(bearbeitet.id, $("f_aufnehmen"), $("f_status"));
    if (st) {
      vorschau_setzen($("f_vorschau"), $("f_vorschau_leer"), st, bearbeitet.id);
      $("f_status").replaceChildren(status_inhalt(st));
    }
  });

  // Löschen: erster Klick fragt nach, zweiter löscht
  $("f_loeschen").addEventListener("click", () => {
    const b = $("f_loeschen");
    if (!b.dataset.bestaetigt) {
      b.dataset.bestaetigt = "1";
      b.querySelector("span").textContent = "Wirklich löschen?";
      return;
    }
    $("l_id").value = bearbeitet.id;
    $("loeschForm").submit();
  });

  /* ##### Vorschau groß ##### */

  const vorschau_modal = new bootstrap.Modal($("vorschauModal"));
  let vorschau_id = null;

  document.querySelectorAll(".seite-vorschau").forEach((b) =>
    b.addEventListener("click", () => {
      vorschau_id = Number(b.dataset.id);
      const seite = seiten.get(vorschau_id);
      $("vorschauTitel").textContent = seite.name;
      const st = status.get(vorschau_id);
      vorschau_setzen($("v_bild"), $("v_leer"), st, vorschau_id);
      $("v_status").replaceChildren(status_inhalt(st));
      vorschau_modal.show();
    })
  );

  $("v_aufnehmen").addEventListener("click", async () => {
    const st = await aufnehmen(vorschau_id, $("v_aufnehmen"), $("v_status"));
    if (st) {
      vorschau_setzen($("v_bild"), $("v_leer"), st, vorschau_id);
      $("v_status").replaceChildren(status_inhalt(st));
    }
  });

  status_laden();
  setInterval(status_laden, 30000);
})();
