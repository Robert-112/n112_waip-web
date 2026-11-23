// Verbindungsstatus gespeicherter Kalender-Adressen (Termine, eigener Ticker) nachladen und anzeigen.
// Erwartet Elemente mit data-kalender-status="ical_url" bzw. "ticker_url" im übergebenen Bereich.
// Die Abfrage läuft erst nach dem Aufbau der Seite, damit sie nicht auf den Kalender-Server wartet.
window.kalender_status_laden = function (bereich, adresse, body) {
  const zellen = bereich.querySelectorAll("[data-kalender-status]");
  const zeit = (iso) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const setzen = (zelle, symbol, farbe, text) => {
    const i = document.createElement("i");
    i.className = "bi " + symbol + " me-1 " + farbe;
    i.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.textContent = text;
    zelle.replaceChildren(i, span);
    zelle.classList.remove("d-none");
  };
  zellen.forEach((zelle) => {
    zelle.classList.add("d-none");
    zelle.replaceChildren();
  });
  // nur die jüngste Abfrage zählt (Dialog für einen anderen Benutzer geöffnet, bevor die Antwort kam)
  const nr = String(Number(bereich.dataset.kalenderAnfrage || 0) + 1);
  bereich.dataset.kalenderAnfrage = nr;
  const aktuell = () => bereich.dataset.kalenderAnfrage === nr;
  fetch(adresse, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
    .then((r) => {
      if (!aktuell() || !r.aktiv) return;
      zellen.forEach((zelle) => {
        const st = r[zelle.dataset.kalenderStatus];
        if (!st) return; // keine Adresse gespeichert
        if (!st.ok) return setzen(zelle, "bi-x-circle-fill", "text-danger", st.text);
        let text = "Verbindung in Ordnung";
        if (zelle.dataset.kalenderStatus === "ical_url") text += " · " + (st.anzahl === 1 ? "1 anstehender Termin" : st.anzahl + " anstehende Termine");
        if (st.abgerufen) text += " · Stand " + zeit(st.abgerufen);
        if (st.veraltet) return setzen(zelle, "bi-exclamation-triangle-fill", "text-warning", text + " (letzter Abruf fehlgeschlagen, ältere Daten)");
        setzen(zelle, "bi-check-circle-fill", "text-success", text);
      });
    })
    .catch(() => {
      if (!aktuell()) return;
      // nur bei Feldern mit gespeicherter Adresse
      zellen.forEach((zelle) => {
        const feld = bereich.querySelector('[name="' + zelle.dataset.kalenderStatus + '"]');
        if (feld && feld.value) setzen(zelle, "bi-question-circle", "text-body-secondary", "Verbindung konnte nicht geprüft werden.");
      });
    });
};
