/* Gemeinsame Kartenfunktionen für Alarmmonitor (/waip) und Dashboard (/dbrd):
   Zielmarker (Einsatzort) und OSRM-Routen der alarmierten Wachen. */

/* ########################### */
/* ####### Zielmarker ######## */
/* ########################### */

// Größe des Zielmarkers in CSS-Pixeln (auf 4K-Monitoren doppelt so groß)
function ziel_icon_groesse(gross) {
  return gross ? [68, 92] : [34, 46];
}

// Zielmarker: rote Stecknadel mit weißem Rand, schwarzer Kontur und weißem Punkt. Die doppelte
// Kontur (schwarz außen, weiß innen) hebt sich von jedem Untergrund ab, auch von roten/orangen Routen
// und Straßen. Bewusst ohne Schatten-Filter und Animation (schwache Hardware).
function ziel_icon(gross) {
  const g = ziel_icon_groesse(gross);
  const nadel = "M17 43C17 43 4 28 4 16.5a13 13 0 0 1 26 0C30 28 17 43 17 43z";
  return L.divIcon({
    className: "ziel-marker" + (gross ? " ziel-marker-gross" : ""),
    html:
      '<svg viewBox="0 0 34 46" width="' + g[0] + '" height="' + g[1] + '" aria-hidden="true">' +
      '<path d="' + nadel + '" fill="#111" stroke="#111" stroke-width="5" stroke-linejoin="round"/>' +
      '<path d="' + nadel + '" fill="#dc3545" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' +
      "</svg>" +
      '<i class="bi bi-circle-fill"></i>',
    iconSize: g,
    iconAnchor: [g[0] / 2, g[1]],
    popupAnchor: [0, -g[1]],
  });
}

/* ########################### */
/* ######## OSRM Routen ###### */
/* ########################### */

// Abstand (px) benachbarter Routen auf gemeinsam befahrenen Abschnitten. Bei vielen Routen auf
// derselben Straße wird der Abstand kleiner, damit das Bündel höchstens ROUTEN_BUENDEL_MAX breit wird.
const ROUTEN_ABSTAND = 5;
const ROUTEN_BUENDEL_MAX = 20;

// Versatzfaktoren je Route (Cache, wird nur bei neuen Routendaten berechnet)
const _routenVersatz = new WeakMap();

// Ermittelt für jede Route den seitlichen Versatz (px) je Stützpunkt. Versetzt wird NUR dort, wo
// mehrere Routen dieselbe Straße befahren (OSRM liefert dort identische Knoten). Fährt eine Route
// allein, bleibt sie genau auf der Straße. Reihenfolge im Bündel nach Wachennummer, damit sie
// zwischen Neuzeichnungen stabil bleibt.
function routen_versatz_berechnen(routes) {
  const mitGeo = routes
    .filter(function (r) { return r.geometry && r.geometry.coordinates && r.geometry.coordinates.length >= 2; })
    .slice()
    .sort(function (a, b) { return String(a.nr_wache).localeCompare(String(b.nr_wache)); });
  const key = function (c) { return c[0].toFixed(5) + "," + c[1].toFixed(5); };

  // Abschnitt (richtungsunabhängig) -> Indizes der Routen, die ihn befahren
  const abschnitte = new Map();
  const segmente = mitGeo.map(function (route, ri) {
    const co = route.geometry.coordinates;
    const seg = [];
    for (let i = 0; i < co.length - 1; i++) {
      const a = key(co[i]), b = key(co[i + 1]);
      if (a === b) { seg.push(null); continue; }
      const vorwaerts = a < b;
      const k = vorwaerts ? a + "|" + b : b + "|" + a;
      let liste = abschnitte.get(k);
      if (!liste) abschnitte.set(k, (liste = []));
      if (liste.indexOf(ri) < 0) liste.push(ri);
      seg.push({ k: k, vorwaerts: vorwaerts });
    }
    return seg;
  });

  mitGeo.forEach(function (route, ri) {
    // Versatz je Abschnitt: Rang im Bündel, zur Straßenmitte zentriert. Bei Gegenrichtung
    // Vorzeichen tauschen, damit die Route auf derselben Seite des Bündels bleibt.
    const segPx = segmente[ri].map(function (s) {
      if (!s) return 0;
      const liste = abschnitte.get(s.k);
      const n = liste.length;
      if (n < 2) return 0;
      const schritt = Math.min(ROUTEN_ABSTAND, ROUTEN_BUENDEL_MAX / (n - 1));
      const px = (liste.indexOf(ri) - (n - 1) / 2) * schritt;
      return s.vorwaerts ? px : -px;
    });
    // Leere Abschnitte (doppelte Punkte) übernehmen den Versatz des Vorgängers
    for (let i = 1; i < segPx.length; i++) if (segmente[ri][i] === null) segPx[i] = segPx[i - 1];
    // Je Stützpunkt den betragsmäßig größeren Versatz der angrenzenden Abschnitte nehmen: So bleibt
    // ein gemeinsamer Abschnitt auf ganzer Länge parallel, der Übergang liegt im Einzelabschnitt.
    const n = segPx.length + 1;
    const punktPx = new Array(n);
    for (let i = 0; i < n; i++) {
      const vor = i > 0 ? segPx[i - 1] : segPx[0];
      const nach = i < n - 1 ? segPx[i] : segPx[n - 2];
      punktPx[i] = Math.abs(vor) >= Math.abs(nach) ? vor : nach;
    }
    _routenVersatz.set(route, punktPx);
  });
}

function routen_versatz(route, routes) {
  if (!_routenVersatz.has(route)) routen_versatz_berechnen(routes);
  return _routenVersatz.get(route) || null;
}

// Größter Versatz (px) aller Routen, z.B. als Rand beim Einpassen der Karte
function routen_versatz_max(routes) {
  let max = 0;
  (routes || []).forEach(function (r) {
    if (!r.geometry) return;
    const v = routen_versatz(r, routes);
    if (v) v.forEach(function (px) { if (Math.abs(px) > max) max = Math.abs(px); });
  });
  return max;
}

// Versetzt eine Latlng-Liste je Stützpunkt um versatzPx[i] Pixel senkrecht zur Linie. Wird bei jedem
// Redraw mit dem aktuellen Zoom neu berechnet, damit der Versatz auf jeder Zoomstufe gleich breit wirkt
// (Prinzip von Leaflet.PolylineOffset, hier ohne Zusatz-Abhängigkeit selbst umgesetzt).
function versatz_anwenden(targetMap, latlngs, versatzPx) {
  if (!versatzPx || latlngs.length < 2 || !versatzPx.some(function (v) { return v; })) return latlngs;
  const zoom = targetMap.getZoom();
  const pts = latlngs.map(function (ll) { return targetMap.project(ll, zoom); });
  const n = pts.length;
  const segPerp = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    segPerp.push({ x: -dy / len, y: dx / len });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let perp;
    if (i === 0) perp = segPerp[0];
    else if (i === n - 1) perp = segPerp[n - 2];
    else {
      const sx = segPerp[i - 1].x + segPerp[i].x, sy = segPerp[i - 1].y + segPerp[i].y;
      const slen = Math.sqrt(sx * sx + sy * sy) || 1;
      perp = { x: sx / slen, y: sy / slen };
    }
    out.push(L.point(pts[i].x + perp.x * versatzPx[i], pts[i].y + perp.y * versatzPx[i]));
  }
  return out.map(function (p) { return targetMap.unproject(p, zoom); });
}

// Zeichnet alle Routen und Wachen-Punkte auf targetMap. Vorhandene Layer in layerArr werden vorher
// entfernt, neue dort abgelegt. Rückgabe: die Wachen-Punkte (mit Namensschild), z.B. zum Einpassen.
function routen_zeichnen(targetMap, routes, layerArr) {
  layerArr.forEach(function (l) { targetMap.removeLayer(l); });
  layerArr.length = 0;
  const wachen = [];
  if (!routes || !routes.length) return wachen;

  const linien = [];
  const starts = [];
  routes.forEach(function (route) {
    const co = route.geometry && route.geometry.coordinates;
    if (co && co.length) {
      const latlngs = co.map(function (c) { return [c[1], c[0]]; });
      linien.push({ route: route, ll: versatz_anwenden(targetMap, latlngs, routen_versatz(route, routes)) });
      starts.push({ route: route, pos: latlngs[0] });
    } else if (route.coords) {
      // Keine Route vorhanden (z.B. Wache liegt im Einsatzbereich) -> nur Punkt mit Namen
      starts.push({ route: route, pos: [route.coords[0], route.coords[1]] });
    }
  });

  // Ebenenweise zeichnen (erst alle Schatten, dann alle Halos, dann alle Linien), damit Schatten und
  // Halo einer Route nicht die benachbarte Route im Bündel überdecken
  const ebene = function (opts) {
    linien.forEach(function (l) {
      const o = Object.assign({ lineCap: "round", lineJoin: "round", interactive: false }, opts);
      if (!o.color) o.color = l.route.color;
      layerArr.push(L.polyline(l.ll, o).addTo(targetMap));
    });
  };
  ebene({ color: "#000000", weight: 10, opacity: 0.18 });
  ebene({ color: "#ffffff", weight: 6, opacity: 0.65 });
  ebene({ weight: 4, opacity: 1.0 });

  // Wachen-Punkt auf der echten Wachenposition (nicht versetzt)
  starts.forEach(function (s) {
    const punkt = L.circleMarker(s.pos, {
      radius: 8, color: "#ffffff", weight: 2, fillColor: s.route.color, fillOpacity: 1.0,
    }).addTo(targetMap);
    if (s.route.name_wache) punkt.bindTooltip(s.route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
    layerArr.push(punkt);
    wachen.push(punkt);
  });
  return wachen;
}
