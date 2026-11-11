// textFit – Text in feste Container einpassen (gleiche Schnittstelle wie textFit 2.x)
//
// Ersetzt textFit.min.js. Unterschied: Die Binärsuche läuft für alle übergebenen Elemente
// im Gleichschritt. Pro Runde werden erst alle Schriftgrößen gesetzt und danach alle gemessen,
// dadurch entsteht ein Layout-Durchlauf pro Runde statt einer pro Element und Runde
// (Alarmansicht: ca. 30 statt ca. 250 Layouts). Das Ergebnis ist identisch.
// Voraussetzung: Die Größe der Container hängt nicht von ihrem Inhalt ab (feste Höhe/Breite).
//
// Unterstützte Optionen: minFontSize, maxFontSize, multiLine, detectMultiLine, reProcess, widthOnly
(function (root) {
  "use strict";

  const defaults = {
    minFontSize: 6,
    maxFontSize: 80,
    multiLine: false,
    detectMultiLine: true,
    reProcess: true,
    widthOnly: false,
  };

  function innerSize(el) {
    const cs = window.getComputedStyle(el);
    return {
      w: el.clientWidth - parseInt(cs.paddingLeft, 10) - parseInt(cs.paddingRight, 10),
      h: el.clientHeight - parseInt(cs.paddingTop, 10) - parseInt(cs.paddingBottom, 10),
    };
  }

  function toArray(els) {
    if (!els) return [];
    if (typeof els.toArray === "function") return els.toArray(); // jQuery
    if (els.nodeType === 1) return [els];
    return Array.prototype.slice.call(els);
  }

  function textFit(els, options) {
    const o = Object.assign({}, defaults, options || {});

    // 1. lesen: Zielgröße je Element (Elemente ohne Größe, z.B. ausgeblendete, überspringen)
    const items = [];
    toArray(els).forEach(function (el) {
      if (!el || el.nodeType !== 1) return;
      if (!o.reProcess && el.getAttribute("textFitted")) return;
      const size = innerSize(el);
      if (!size.w || (!o.widthOnly && !size.h)) return;
      items.push({ el: el, w: size.w, h: size.h });
    });
    if (!items.length) return;

    // 2. schreiben: Inhalt einmalig in einen inline-block-Span packen, der gemessen wird
    items.forEach(function (it) {
      if (!o.reProcess) it.el.setAttribute("textFitted", 1);
      it.span = it.el.querySelector("span.textFitted");
      if (!it.span || it.span.parentNode !== it.el) {
        const span = document.createElement("span");
        span.className = "textFitted";
        span.style.display = "inline-block";
        while (it.el.firstChild) span.appendChild(it.el.firstChild);
        it.el.appendChild(span);
        it.span = span;
      }
    });

    // 3. lesen: mehrzeiligen Inhalt erkennen
    items.forEach(function (it) {
      it.multiLine = o.multiLine;
      if (o.detectMultiLine && !it.multiLine) {
        const fontSize = parseInt(window.getComputedStyle(it.span).fontSize, 10);
        if (it.span.scrollHeight >= fontSize * 2) it.multiLine = true;
      }
    });

    // 4. schreiben: Startwerte
    items.forEach(function (it) {
      if (!it.multiLine) it.el.style.whiteSpace = "nowrap";
      it.low = o.minFontSize;
      it.high = o.maxFontSize;
      it.size = o.minFontSize;
    });

    // 5. Binärsuche im Gleichschritt: alle schreiben, dann alle messen
    let active = items;
    while (active.length) {
      active.forEach(function (it) {
        it.mid = (it.low + it.high) >> 1;
        it.span.style.fontSize = it.mid + "px";
      });
      active.forEach(function (it) {
        if (it.span.scrollWidth <= it.w && (o.widthOnly || it.span.scrollHeight <= it.h)) {
          it.size = it.mid;
          it.low = it.mid + 1;
        } else {
          it.high = it.mid - 1;
        }
      });
      active = active.filter(function (it) {
        return it.low <= it.high;
      });
    }

    // 6. schreiben: Endgröße
    items.forEach(function (it) {
      it.span.style.fontSize = it.size + "px";
    });
  }

  root.textFit = textFit;
})(window);
