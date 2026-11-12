// Gemeinsame Darstellung der Rückmeldungsbalken für Alarmmonitor und Dashboard, damit sich die
// Nutzer überall gleich zurechtfinden: Restzeit (fett) links, daneben Name und Funktionen.
// Passt der Text nicht in den Balken, läuft er als Ticker durch (CSS-Animation auf transform,
// Ränder weich ausgeblendet, siehe waip.css ".rmld-text").
(function (root) {
  "use strict";

  // Funktion (rmld_role) -> Typ (Zähler/Balkenfarbe) und Ersatztext, wenn kein Name übermittelt wird
  // (z.B. bei Gästen entfernt der Server den Namen)
  const ROLLEN = {
    team_member: { typ: "ek", text: "Einsatzkraft" },
    crew_leader: { typ: "gf", text: "Gruppenführer" },
    division_chief: { typ: "zf", text: "Zugführer" },
    group_commander: { typ: "vf", text: "Verbandsführer" },
  };

  // Typ und Anzeigename einer Rückmeldung ermitteln. Rückmeldungen ohne oder mit unbekannter
  // Funktion (die Rückmelde-App liefert z.T. keine rmld_role) zählen als Einsatzkraft,
  // sonst bliebe der Balken ohne Namen und die Rückmeldung fehlte in den Zählern.
  function rmld_rolle(data) {
    let rolle = ROLLEN[data.rmld_role];
    if (!rolle) {
      console.warn("Rückmeldung ohne bekannte Funktion (rmld_role=" + data.rmld_role + "), wird als Einsatzkraft angezeigt.");
      rolle = ROLLEN.team_member;
    }
    return { typ: rolle.typ, name: data.rmld_alias || rolle.text };
  }

  // Beschriftung eines Balkens einmalig anlegen; liefert das Element für die Restzeit
  function rmld_beschriftung_anlegen(overlay, text) {
    overlay.textContent = "";
    overlay.classList.add("rmld-text");
    const zeit = document.createElement("span");
    zeit.className = "rmld-zeit";
    const name = document.createElement("span");
    name.className = "rmld-name";
    const innen = document.createElement("span");
    innen.textContent = text;
    name.appendChild(innen);
    overlay.appendChild(zeit);
    overlay.appendChild(name);
    return zeit;
  }

  // Ankunftszeit erreicht: Restzeit durch Haken ersetzen, Name (ggf. mit Ticker) bleibt stehen
  function rmld_angekommen(zeit) {
    zeit.textContent = "";
    zeit.classList.add("ion-md-checkmark-circle");
  }

  // Ticker für alle Namen unterhalb von bereich (Standard: ganze Seite) setzen oder entfernen.
  // Erst alles messen, dann schreiben, damit nur ein Layout-Durchlauf entsteht.
  function rmld_ticker_aktualisieren(bereich) {
    const namen = Array.from((bereich || document).querySelectorAll(".rmld-text .rmld-name"));
    const mess = namen.map(function (el) {
      const innen = el.firstElementChild;
      return { el: el, innen: innen, ueber: innen ? innen.scrollWidth - el.clientWidth : 0, schrift: parseFloat(getComputedStyle(el).fontSize) || 16 };
    });
    mess.forEach(function (m) {
      if (!m.innen) return;
      if (m.ueber > 1) {
        // ca. 2,5 Schrifthöhen pro Sekunde, Bewegung = 60 % der Dauer (Rest Pause am Anfang/Ende)
        const dauer = Math.max(5, m.ueber / (2.5 * m.schrift) / 0.6);
        m.innen.style.setProperty("--ticker-weg", -(m.ueber + 4) + "px");
        m.innen.style.setProperty("--ticker-dauer", dauer.toFixed(1) + "s");
        m.el.classList.add("rmld-ticker");
      } else {
        m.el.classList.remove("rmld-ticker");
      }
    });
  }

  // Ticker-Aktualisierung für den nächsten Frame vormerken (mehrere Aufrufe hintereinander,
  // z.B. beim Laden eines Einsatzes mit vielen Rückmeldungen, ergeben nur einen Durchlauf)
  let _geplant = false;
  function rmld_ticker_planen() {
    if (_geplant) return;
    _geplant = true;
    requestAnimationFrame(function () {
      _geplant = false;
      rmld_ticker_aktualisieren(document);
    });
  }

  root.rmld_rolle = rmld_rolle;
  root.rmld_beschriftung_anlegen = rmld_beschriftung_anlegen;
  root.rmld_angekommen = rmld_angekommen;
  root.rmld_ticker_aktualisieren = rmld_ticker_aktualisieren;
  root.rmld_ticker_planen = rmld_ticker_planen;
})(window);
