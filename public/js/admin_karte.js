// Kleine Karte für die Admin-Dialoge (Wachen, Wetter-Standorte).
// Zeigt den gespeicherten Punkt (blau) und optional den automatischen Punkt (grau, gestrichelt).
// Ein Klick in die Karte setzt den Punkt neu und trägt die Koordinate in die Eingabefelder ein,
// Änderungen in den Feldern verschieben den Punkt.
// Kartendienst wie im Alarmmonitor (MAP_SERVICE_* aus der .env): WMS mit Rückfall auf den Tile-Server.
/* global L */
(function () {
  "use strict";

  const STANDARD = [51.9, 13.4]; // ungefähr Mitte Brandenburg, falls noch keine Koordinate da ist

  function kartendienst(map, dienst) {
    const max_zoom = 18;
    if (!dienst || dienst.type !== "wms" || !dienst.wms_url) {
      L.tileLayer(dienst && dienst.tile_url ? dienst.tile_url : "", { maxZoom: max_zoom }).addTo(map);
      return;
    }
    const wms = L.tileLayer.wms(dienst.wms_url, {
      layers: dienst.wms_layers,
      format: dienst.wms_format,
      transparent: dienst.wms_transparent,
      version: dienst.wms_version,
    });
    wms.once("tileerror", function () {
      map.removeLayer(wms);
      L.tileLayer(dienst.tile_url, { maxZoom: max_zoom }).addTo(map);
    });
    wms.addTo(map);
  }

  const zahl = (wert) => {
    const n = Number(String(wert ?? "").trim().replace(",", "."));
    return String(wert ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
  };

  // element: Container der Karte, dienst: map_service, felder: { lat, lon } Eingabefelder
  window.admin_karte = function (element, dienst, felder) {
    const map = L.map(element, { attributionControl: false, scrollWheelZoom: "center" }).setView(STANDARD, 7);
    kartendienst(map, dienst);
    let punkt = null;
    let auto = null;

    // Punkt als verschiebbarer Marker (blauer Kreis), Klick in die Karte setzt ihn ebenfalls
    const symbol = L.divIcon({
      className: "",
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      html: '<span style="display:block;width:20px;height:20px;border-radius:50%;background:#3498db;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6);cursor:grab"></span>',
    });

    const uebernehmen = (latlng) => {
      const lat = Math.round(latlng.lat * 100000) / 100000;
      const lon = Math.round(latlng.lng * 100000) / 100000;
      felder.lat.value = lat;
      felder.lon.value = lon;
      punkt_setzen(lat, lon);
      felder.lat.dispatchEvent(new Event("change", { bubbles: true }));
    };

    const punkt_setzen = (lat, lon) => {
      if (lat === null || lon === null) {
        if (punkt) map.removeLayer(punkt);
        punkt = null;
        return;
      }
      if (!punkt) {
        punkt = L.marker([lat, lon], { icon: symbol, draggable: true, keyboard: false, title: "Zum Verschieben ziehen" }).addTo(map);
        punkt.on("dragend", () => uebernehmen(punkt.getLatLng()));
      } else {
        punkt.setLatLng([lat, lon]);
      }
    };

    map.on("click", (ev) => uebernehmen(ev.latlng));
    [felder.lat, felder.lon].forEach((f) => f.addEventListener("input", () => punkt_setzen(zahl(felder.lat.value), zahl(felder.lon.value))));

    return {
      // nach dem Öffnen des Dialogs aufrufen (Leaflet braucht die sichtbare Größe)
      zeigen: function (auto_lat, auto_lon) {
        map.invalidateSize();
        if (auto) map.removeLayer(auto);
        auto = null;
        const a_lat = zahl(auto_lat);
        const a_lon = zahl(auto_lon);
        if (a_lat !== null && a_lon !== null) {
          auto = L.circleMarker([a_lat, a_lon], { radius: 7, color: "#888", weight: 2, dashArray: "3 3", fillOpacity: 0 }).addTo(map);
        }
        const lat = zahl(felder.lat.value);
        const lon = zahl(felder.lon.value);
        punkt_setzen(lat, lon);
        const ziel = lat !== null && lon !== null ? [lat, lon] : a_lat !== null && a_lon !== null ? [a_lat, a_lon] : null;
        map.setView(ziel || STANDARD, ziel ? 11 : 7);
      },
    };
  };
})();
