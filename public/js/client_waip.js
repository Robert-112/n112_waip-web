// TODO: Remote-Reload per Socket

// optionaler Parameter ?anim=off: Animationen für leistungsschwache Geräte reduzieren
const reduceAnimation = typeof anim_off !== "undefined" && anim_off === true;

/* ############################ */
/* ####### SEKUNDENTAKT ####### */
/* ############################ */

// Ein gemeinsamer Takt für Uhr, Ablauf-Timer und alle Rückmeldungsbalken: alle Änderungen einer
// Sekunde landen im selben Frame (ein Layout pro Sekunde statt eines pro Timer)
const sekundentakt = new Map();

function takt_add(key, fn) {
  sekundentakt.set(key, fn);
}

function takt_remove(key) {
  sekundentakt.delete(key);
}

function takt_remove_prefix(prefix) {
  Array.from(sekundentakt.keys()).forEach(function (key) {
    if (key.indexOf(prefix) === 0) sekundentakt.delete(key);
  });
}

function takt_run() {
  sekundentakt.forEach(function (fn) {
    try {
      fn();
    } catch (e) {
      console.error("Sekundentakt:", e);
    }
  });
}

// auf den Sekundenwechsel ausrichten, damit die Uhr genau mit der Sekunde umspringt
setTimeout(function () {
  takt_run();
  setInterval(takt_run, 1000);
}, 1000 - (Date.now() % 1000));

$(document).ready(function () {
  set_clock();
  if (typeof show_login !== "undefined" && show_login && typeof user_authenticated !== "undefined" && !user_authenticated) {
    $("#wachenname-login-icon").removeClass("d-none");
  }
  updateWachennameAnimation();
  startRandomPositioning();
});

let _resize_debounce = null;
$(window).on("resize", function () {
  // Debounce: textFit erst nach Abschluss des Resize ausführen, nicht bei jedem Event
  clearTimeout(_resize_debounce);
  _resize_debounce = setTimeout(function () {
    resize_text(true);
    updateWachennameAnimation();
    updateRandomPosition();
  }, 250);
});

// Funktion zum Hinzufügen eines Kartenlayers (Tile oder WMS)
function AddMapLayer(targetMap) {
  const m = targetMap || map;
  let maxMapZoom = 18;

  if (map_service.type === "tile") {
    L.tileLayer(map_service.tile_url, { maxZoom: maxMapZoom }).addTo(m);
  } else if (map_service.type === "wms") {
    var wmsLayer = L.tileLayer.wms(map_service.wms_url, {
      layers: map_service.wms_layers,
      format: map_service.wms_format,
      transparent: map_service.wms_transparent,
      version: map_service.wms_version,
    });
    wmsLayer.once("tileerror", function () {
      console.warn("WMS-Layer konnte nicht geladen werden, versuche Tile-Layer:", map_service.tile_url);
      m.removeLayer(wmsLayer);
      L.tileLayer(map_service.tile_url, { maxZoom: maxMapZoom }).addTo(m);
    });
    wmsLayer.addTo(m);
  }
}

/* ############################ */
/* ######### BUTTONS ########## */
/* ############################ */

let waipAudio = document.getElementById("audio");
// Flag für laufendes TTS
let ttsActive = false;
let lastTTSSrc = null;
// Toast-Referenz für blockierte Audio-Wiedergabe
let audioBlockedToast = null;
// Flag ob Browser (noch) Autoplay blockiert
let audioBlocked = false;

// JS-basiertes Blinken – ersetzt CSS-Animation (schont CPU auf schwacher Hardware)
let _blinkInterval = null;
let _blinkElements = new Set();
let _blinkOn = true;

function startBlink(el) {
  if (!el) return;
  _blinkElements.add(el);
  if (!_blinkInterval) {
    _blinkInterval = setInterval(function () {
      _blinkOn = !_blinkOn;
      _blinkElements.forEach(function (e) { e.style.opacity = _blinkOn ? "1" : "0.15"; });
    }, 800);
  }
}

function stopAllBlinks() {
  if (_blinkInterval) { clearInterval(_blinkInterval); _blinkInterval = null; }
  _blinkElements.forEach(function (e) { e.style.opacity = ""; });
  _blinkElements.clear();
  _blinkOn = true;
}

// Autoplay-Blockade anzeigen (Blinken des Volume-Off Icons)
function indicateAudioBlocked() {
  try {
    // Wenn Sound explizit deaktiviert wurde (Query-Parameter ?sound=off -> sound_off=true), dann keine Prüfung / UI-Anzeige
    if (typeof sound_off !== "undefined" && sound_off === true) {
      return; // still bleiben
    }
    let icon = document.querySelector(".bi-volume-mute-fill") || document.querySelector(".bi-volume-up-fill");
    if (!icon) return;
    if (icon.classList.contains("bi-volume-up-fill")) {
      icon.classList.remove("bi-volume-up-fill");
      icon.classList.add("bi-volume-mute-fill");
    }
    // Blinken starten
    startBlink(icon);
    audioBlocked = true; // Blockade markieren
    showAudioBlockedToast();
  } catch (e) {
    console.log("indicateAudioBlocked error", e);
  }
}

function resetAudioUi() {
  let tmp_element;
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".bi-pause-circle-fill");
  if (tmp_element && tmp_element.classList.contains("bi-pause-circle-fill")) {
    tmp_element.classList.remove("bi-pause-circle-fill");
    tmp_element.classList.add("bi-play-circle-fill");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".bi-volume-up-fill");
  if (tmp_element && tmp_element.classList.contains("bi-volume-up-fill")) {
    tmp_element.classList.remove("bi-volume-up-fill");
    tmp_element.classList.add("bi-volume-mute-fill");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
  // Toast nur entfernen, wenn Autoplay NICHT mehr blockiert ist
  if (!audioBlocked) {
    removeAudioBlockedToast();
  }
}

// Flag: Listener am Toast-Element wurden bereits registriert (verhindert Akkumulation)
let toastListenersAdded = false;

// Toast erstellen – erscheint oben links über der Karte
function tryActivate(evt) {
  try {
    if (evt) evt.stopPropagation();
    // Falls Audio schon läuft einfach Toast schließen
    if (!waipAudio.paused) {
      removeAudioBlockedToast();
      return;
    }
    const p = waipAudio.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audioBlocked = false; // Erfolg -> Blockade aufgehoben
        removeAudioBlockedToast();
      }).catch((err) => {
        console.log("tryActivate play blocked", err);
        audioBlocked = true;
      });
    } else {
      // Ältere Browser ohne Promise
      audioBlocked = false; // wird als Erfolg gewertet
      removeAudioBlockedToast();
    }
  } catch (e) {
    console.log("tryActivate error", e);
    audioBlocked = true;
  }
}

function showAudioBlockedToast() {
  try {
    const container = document.getElementById("audio-toast-container");
    const toast = document.getElementById("audio-blocked-toast");
    if (!container || !toast) return;
    // Click-/Close-Listener nur einmalig am Toast-Element registrieren
    if (!toastListenersAdded) {
      toast.addEventListener("click", tryActivate);
      const closeBtn = toast.querySelector(".btn-close");
      if (closeBtn)
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeAudioBlockedToast();
        });
      toastListenersAdded = true;
    }
    if (!audioBlockedToast) {
      // Globale einmalige Listener neu registrieren (entfernen sich nach erstem Auslösen selbst)
      document.addEventListener("keydown", tryActivate, { once: true });
      document.addEventListener("click", tryActivate, { once: true });
    }
    // Sichtbar machen
    container.classList.remove("d-none");
    toast.classList.add("show");
    // Icon blinken lassen
    const iconInToast = toast.querySelector(".bi-volume-mute-fill");
    if (iconInToast) startBlink(iconInToast);
    audioBlockedToast = toast;
  } catch (e) {
    console.log("showAudioBlockedToast error", e);
  }
}

// Toast entfernen
function removeAudioBlockedToast() {
  if (audioBlockedToast) {
    const container = document.getElementById("audio-toast-container");
    if (container) container.classList.add("d-none");
    audioBlockedToast.classList.remove("show");
    audioBlockedToast = null;
    audioBlocked = false; // Beim expliziten Entfernen Flag zurücksetzen
  }
}

waipAudio.addEventListener("ended", function () {
  console.log("ended");
  resetAudioUi();
  // TTS-Flag zurücksetzen
  if (lastTTSSrc && waipAudio.src.indexOf("bell_message.mp3") === -1) {
    ttsActive = false;
    //lastTTSSrc = null;
  }
});

// Neuer Pause-Handler (nutzerinitiiert)
waipAudio.addEventListener("pause", function () {
  // Wenn wirklich pausiert (nicht direkt nach play), UI anpassen
  if (waipAudio.paused) {
    resetAudioUi();
    if (ttsActive) {
      ttsActive = false;
      //lastTTSSrc = null;
    }
  }
});

waipAudio.addEventListener("play", function () {
  let tmp_element;
  // Beim erfolgreichen Start Blinken stoppen
  stopAllBlinks();
  audioBlocked = false; // Wiedergabe läuft
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".bi-play-circle-fill");
  if (tmp_element && tmp_element.classList.contains("bi-play-circle-fill")) {
    tmp_element.classList.remove("bi-play-circle-fill");
    tmp_element.classList.add("bi-pause-circle-fill");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".bi-volume-mute-fill");
  if (tmp_element && tmp_element.classList.contains("bi-volume-mute-fill")) {
    tmp_element.classList.remove("bi-volume-mute-fill");
    tmp_element.classList.add("bi-volume-up-fill");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
  // Toast für blockierte Tonausgabe entfernen
  removeAudioBlockedToast();
});

// Play/Pause Steuerung: Button mit ID #playpause oder direkt Icon mit Klasse .bi-pause-circle-fill
$(document).on("click", "#playpause, .bi-pause-circle-fill", function (e) {
  // Falls Audio läuft -> stoppen & zurücksetzen
  if (!waipAudio.paused && !waipAudio.ended) {
    waipAudio.pause();
    waipAudio.currentTime = 0; // komplett abbrechen
    // UI sofort aktualisieren (pause Event feuert auch, aber zur Sicherheit direkt)
    resetAudioUi();
  } else if (waipAudio.paused) {
    // Erneut starten (falls erwünscht) -> hier optional, aktuell nicht automatisch Starten
    // waipAudio.play();
  }
});

$("#replay").on("click", function (event) {
  waipAudio.currentTime = 0;
  audio.src = lastTTSSrc; // letztes TTS erneut setzen
  waipAudio.play();
});

/* ############################ */
/* ####### TEXT-RESIZE ######## */
/* ############################ */

// Größen dynamisch anpassen, Hintergrundfarbe ggf. anpassen
function resize_text(reProcess) {
  // Hintergrund im Standby schwarz setzen
  if ($("#waipclock").is(":visible")) {
    $("body").css("background-color", "#000");
  }
  // Uhr-Text nur Anpassen wenn sichtbar
  if ($("#clock_day").is(":visible")) {
    try {
      textFit(document.getElementsByClassName("clock_frame"), { minFontSize: 4, maxFontSize: 500, reProcess: reProcess });
      textFit(document.getElementsByClassName("day_frame"), { minFontSize: 3, maxFontSize: 500, reProcess: reProcess });
    } catch (e) { console.error("resize_text clock_frame/day_frame:", e); }
    widgets_einpassen();
  }
  // Tableau nur Anpassen wenn sichtbar
  if ($("#waiptableau").is(":visible")) {
    try {
      textFit(document.getElementsByClassName("tf_singleline"), { minFontSize: 3, maxFontSize: 700, reProcess: reProcess });
    } catch (e) { console.error("resize_text tf_singleline:", e); }
    try {
      textFit(document.getElementsByClassName("tf_multiline"), { minFontSize: 3, maxFontSize: 500, multiLine: true, reProcess: reProcess });
    } catch (e) { console.error("resize_text tf_multiline:", e); }
    // Karte neu setzen
    map.invalidateSize();
    $("body").css("background-color", "#222");
    try {
      textFit(document.getElementsByClassName("cl_em_alarmiert"), { minFontSize: 4, maxFontSize: 500, reProcess: reProcess });
    } catch (e) { console.error("resize_text cl_em_alarmiert:", e); }
    layout_rmld();
  }
}

// Text nach bestimmter Laenge, in Abhaengigkeit von Zeichen, umbrechen
function break_text_25(text) {
  var new_text;
  new_text = text.replace(/.{25}(\s+|\-+)+/g, "$&@");
  new_text = new_text.split(/@/);
  new_text = new_text.join("<br />");
  //console.log(new_text);
  return new_text;
}

function break_text_80(text) {
  var new_text;
  new_text = text.replace(/.{80}\S*\s+/g, "$&@").split(/\s+@/);
  new_text = new_text.join("<br />");
  //console.log(new_text);
  return new_text;
}

/* ############################ */
/* ####### INAKTIVITAET ####### */
/* ############################ */

let timeoutID;

// Inactivitaet auswerten
function setup_inactivcheck() {
  this.addEventListener("mousemove", resetActivTimer, false);
  this.addEventListener("mousedown", resetActivTimer, false);
  this.addEventListener("keypress", resetActivTimer, false);
  this.addEventListener("DOMMouseScroll", resetActivTimer, false);
  this.addEventListener(
    "mousewheel",
    resetActivTimer,
    {
      passive: true,
    },
    false
  );
  this.addEventListener("touchmove", resetActivTimer, false);
  this.addEventListener("MSPointerMove", resetActivTimer, false);
  start_inactivtimer();
}

setup_inactivcheck();

// warte xxxx Millisekunden um dann do_on_Inactive zu starten
function start_inactivtimer() {
  clearTimeout(timeoutID);
  timeoutID = window.setTimeout(do_on_Inactive, 3000);
}

// Zustand: true = Navbar sichtbar (aktiv), false = ausgeblendet (inaktiv)
let _ui_active = true;

// Sichtbare Fensterhöhe: 100dvh statt 100vh, wo unterstützt. Safari (iPad/iPhone) rechnet 100vh
// inklusive der ausblendbaren Browserleisten - der Monitor ragte dann über das Fenster hinaus.
const VOLLE_HOEHE = window.CSS && CSS.supports && CSS.supports("height", "100dvh") ? "100dvh" : "100vh";

// bei Inaktivitaet Header/Footer ausblenden
function do_on_Inactive() {
  if (!_ui_active) return; // bereits inaktiv – kein erneuter Reflow
  _ui_active = false;
  $(".navbar").fadeOut("slow");
  $(".footer").fadeOut("slow");
  $(".fullheight").css({
    height: "calc(" + VOLLE_HOEHE + " - 3rem)",
    cursor: "none",
  });
  $("body").css({
    paddingTop: "1rem",
    margin: 0,
  });
  // resize nach abgeschlossenem fadeOut, nicht sofort – sonst misst textFit falsche Größen
  setTimeout(function () { resize_text(true); }, 650);
}

// bei Activitaet Header/Footer einblenden
function do_on_Active() {
  start_inactivtimer();
  if (_ui_active) return; // bereits aktiv – kein erneuter Reflow bei jeder Mausbewegung
  _ui_active = true;
  $(".navbar").fadeIn("slow");
  $(".footer").fadeIn("slow");
  $("body").css({
    marginBottom: "60px",
    paddingTop: "5rem",
    paddingBottom: "0",
  });
  $(".fullheight").css({
    height: "calc(" + VOLLE_HOEHE + " - 60px - 5rem)",
    cursor: "auto",
  });
  // resize nach abgeschlossenem fadeIn, nicht sofort
  setTimeout(function () { resize_text(true); }, 650);
}

// bei Event (Aktiviaet) alles zuruecksetzen
function resetActivTimer(e) {
  do_on_Active();
}

/* ############################ */
/* ####### Progressbar ####### */
/* ############################ */

function start_counter(zeitstempel, ablaufzeit) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  let t1 = zeitstempel.split(/[- :]/),
    t2 = ablaufzeit.split(/[- :]/);

  let start = new Date(t1[0], t1[1] - 1, t1[2], t1[3], t1[4], t1[5]),
    end = new Date(t2[0], t2[1] - 1, t2[2], t2[3], t2[4], t2[5]);

  takt_add("ablauf", function () {
    do_progressbar(start, end);
  });
}

function do_progressbar(start, end) {
  today = new Date();
  let current_progress = Math.round((100 / (end.getTime() - start.getTime())) * (end.getTime() - today.getTime()));

  if (current_progress <= 0) {
    takt_remove("ablauf");
    $("#standbytimer-bar").css("width", "0%").attr("aria-valuenow", 0);
    $("#standbytimer-text").text("");
    return;
  }

  let diff = Math.abs(end - today);
  let minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  let secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = "0" + secondsDifference;
  }
  $("#standbytimer-bar")
    .css("width", current_progress + "%")
    .attr("aria-valuenow", current_progress);
  $("#standbytimer-text").text(minutesDifference + ":" + secondsDifference + " min");
}

/* ########################### */
/* ######### LEAFLET ######### */
/* ########################### */

// Karte definieren
let map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
  // Zoom-Animation kostet auf schwacher Hardware spürbar Rechenzeit (Karte springt dann statt zu gleiten)
  zoomAnimation: !reduceAnimation,
  markerZoomAnimation: !reduceAnimation,
}).setView([51.733005, 14.338048], 13);

// Eigener Pane für den Zielmarker, damit er immer über Routen-Tooltips liegt
map.createPane("zielPane");
map.getPane("zielPane").style.zIndex = 700;

AddMapLayer();

// Attribution für Optionen anzeigen (nebeneinander)
try {
  const attrTexts = [];
  if (typeof rmld_off !== "undefined" && rmld_off) {
    attrTexts.push("Rückmeldungen deaktiviert");
  }
  if (typeof sound_off !== "undefined" && sound_off) {
    attrTexts.push("Soundprüfung deaktiviert");
  }
  if (reduceAnimation) {
    attrTexts.push("Animationen reduziert");
  }
  if (typeof show_login !== "undefined" && show_login && typeof user_authenticated !== "undefined" && !user_authenticated) {
    attrTexts.push("nicht angemeldet");
  }
  if (attrTexts.length) {
    const optAttr = L.control.attribution({ position: "bottomleft", prefix: "" });
    optAttr.addAttribution(attrTexts.join(" | "));
    optAttr.addTo(map);
  }
} catch (e) {
  // ignorieren
}

// Icon der Karte zuordnen
// Monitorauflösung prüfen (screen statt window.inner – unabhängig von Fenstergröße/Vollbild)
let is4K = screen.width * (window.devicePixelRatio || 1) >= 3840 &&
           screen.height * (window.devicePixelRatio || 1) >= 2160;
// Zoomstufe für Punkt-Einsätze ohne Routen bzw. Obergrenze beim Einpassen des Einsatzumkreises
const kartenStartZoom = is4K ? 16 : 14;
let markerSize = is4K ? [50, 82] : [25, 41];
let markerAnchor = is4K ? [25, 82] : [12, 41];
let markerShadowSize = is4K ? [82, 82] : [41, 41];
let redIcon = new L.Icon({
  iconUrl: "/media/marker-icon-2x-red.png",
  shadowUrl: "/media/marker-shadow.png",
  iconSize: markerSize,
  iconAnchor: markerAnchor,
  popupAnchor: [1, -34],
  shadowSize: markerShadowSize,
});

// Icon setzen
let marker = L.marker(new L.LatLng(0, 0), {
  icon: redIcon,
  pane: "zielPane",
}).addTo(map);

// GeoJSON vordefinieren
let geojson = L.geoJSON().addTo(map);
// true, wenn aktuell nur der Einsatzumkreis (ohne Zielkoordinaten) angezeigt wird,
// z.B. weil der Nutzer nicht angemeldet ist bzw. keine Berechtigung hat
let showEinsatzkreisBounds = false;

// OSRM-Routen-Layer und Inset-Map
let routeLayers = [];
let currentRoutes = [];
let insetMap = null;

// Routen-Versatz ist pixelbasiert -> nach jedem Zoomwechsel neu zeichnen, damit der
// Abstand zwischen mehreren Routen auf jeder Zoomstufe gleich breit wirkt.
// fitBounds hier NICHT erneut aufrufen, sonst würde jeder (auch manuelle) Zoom
// sofort wieder auf die berechneten Bounds zurückspringen.
map.on("zoomend", function () { draw_routes(currentRoutes, false); });

// Automatisches Einpassen nach Größenänderungen: Die Karte wird beim Alarm eingepasst, danach ändert
// sich ihre Größe aber oft noch (Navbar/Footer blenden nach 3 s aus, Fenster, Drehung, Layout nach
// textFit). Ohne erneutes Einpassen bliebe der Zoom der kleineren Karte stehen (z.B. iPhone Zoom 8
// statt 11). Hat jemand die Karte selbst verschoben oder gezoomt, bleibt seine Ansicht stehen.
let karteManuellBewegt = false;
map.on("dragstart", function () { karteManuellBewegt = true; });
["wheel", "dblclick", "touchmove"].forEach(function (ev) {
  map.getContainer().addEventListener(ev, function () { karteManuellBewegt = true; }, { passive: true });
});

function karte_einpassen() {
  if (currentRoutes.length) {
    draw_routes(currentRoutes, true);
  } else if (showEinsatzkreisBounds) {
    const gjBounds = geojson.getBounds();
    if (gjBounds.isValid()) map.fitBounds(gjBounds, { padding: [50, 50], maxZoom: kartenStartZoom });
  } else {
    const mPos = marker.getLatLng();
    if (mPos.lat !== 0 || mPos.lng !== 0) map.setView(mPos, kartenStartZoom);
  }
}

let _einpassenTimer = null;
map.on("resize", function () {
  // Inset-Karte (Größe relativ zur Hauptkarte) mitziehen, Ziel mittig halten
  if (insetMap) {
    const ziel = insetMap.getCenter();
    insetMap.invalidateSize();
    insetMap.setView(ziel, insetMap.getZoom(), { animate: false });
  }
  if (karteManuellBewegt || $("#waiptableau").hasClass("d-none")) return;
  // mehrere Größenänderungen kurz hintereinander (Ausblenden + textFit) nur einmal auswerten
  clearTimeout(_einpassenTimer);
  _einpassenTimer = setTimeout(karte_einpassen, 150);
});

/* ########################### */
/* ######## SOCKET.IO ######## */
/* ########################### */

// Websocket
let socket = io("/waip", {
  withCredentials: true,
});

// Wachen-ID bei Connect an Server senden
socket.on("connect", function () {
  socket.emit("WAIP", wachen_id);
  $("#waipModal").modal("hide");
  // TODO: bei Reconnect des Clients durch Verbindungsabbruch, erneut Daten anfordern
  console.log("Socket-Verbindung hergestellt, WAIP:", wachen_id);
  startNetzkopplungCheck();
});

/* ################################# */
/* ######## NETZKOPPLUNG ########## */
/* ################################# */
// Prueft periodisch per Image-Load, ob bekannte Internet-Domains erreichbar sind.
// Ist dies der Fall, deutet das auf eine unzulaessige Netzkopplung hin (der
// Alarmmonitor soll nur aus internetlosen Netzen erreichbar sein).
const NETZKOPPLUNG_TIMEOUT_MS = 5000;
const NETZKOPPLUNG_INTERVAL_MS = 8 * 60 * 60 * 1000; // ca. alle 8 Stunden (2-3x/Tag)
const NETZKOPPLUNG_JITTER_MS = 60 * 60 * 1000; // +/- 1 Stunde, damit nicht alle Clients gleichzeitig pruefen
let _netzkopplungStarted = false;
let _netzkopplungConnectTimer = null;

function checkUrlReachable(url) {
  return new Promise(function (resolve) {
    const img = new Image();
    let done = false;
    const timer = setTimeout(function () {
      if (!done) {
        done = true;
        img.src = ""; // laufenden Ladevorgang abbrechen
        resolve(false);
      }
    }, NETZKOPPLUNG_TIMEOUT_MS);

    img.onload = function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(true);
      }
    };
    img.onerror = function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(false);
      }
    };
    img.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now();
  });
}

function runNetzkopplungCheck(urls) {
  Promise.all(urls.map(checkUrlReachable)).then(function (reachable) {
    // Einzelergebnisse senden, die Auswertung (alle / einzelne / keine erreichbar) macht der Server
    const results = urls.map(function (url, i) {
      return { url: url, reachable: reachable[i] };
    });
    socket.emit("netzkopplung_check", { results: results });
    console.log("Netzkopplungspruefung durchgefuehrt, Ergebnis:", results);
  });
}

function startNetzkopplungCheck() {
  const urls = typeof netzkopplung_urls !== "undefined" ? netzkopplung_urls : [];
  if (!urls || urls.length === 0) return;

  // Nach jedem Verbindungsaufbau zeitversetzt (30-90s) pruefen, um den Seitenaufbau nicht zu belasten.
  // Auch nach einem Reconnect noetig: der Socket hat dann eine neue ID und auf dem Server einen neuen
  // Eintrag ohne Ergebnis.
  clearTimeout(_netzkopplungConnectTimer);
  _netzkopplungConnectTimer = setTimeout(function () {
    runNetzkopplungCheck(urls);
  }, 30000 + Math.floor(Math.random() * 60000));

  // periodische Pruefung nur einmal pro Seitenaufruf starten (nicht bei jedem Reconnect)
  if (_netzkopplungStarted) return;
  _netzkopplungStarted = true;

  const scheduleNext = function () {
    const jitter = Math.floor(Math.random() * (2 * NETZKOPPLUNG_JITTER_MS + 1)) - NETZKOPPLUNG_JITTER_MS;
    setTimeout(function () {
      runNetzkopplungCheck(urls);
      scheduleNext();
    }, NETZKOPPLUNG_INTERVAL_MS + jitter);
  };
  scheduleNext();
}

socket.on("connect_error", function (err) {
  $("#waipModalTitle").text("FEHLER");
  $("#waipModalBody").text("Verbindung zum Server getrennt!");
  $("#waipModal").modal("show");
});

socket.on("disconnect", function (reason) {
  console.log("Socket-Verbindung geschlossen:", reason);
});

// ID von Server und Client vergleichen, falls ungleich -> Seite neu laden
socket.on("io.version", function (server_id) {
  if (client_id != server_id) {
    $("#waipModal").modal("hide");
    setTimeout(function () {
      $("#waipModalTitle").text("ACHTUNG");
      $("#waipModalBody").text("Neue Server-Version. Seite wird gleich automatisch neu geladen!");
      $("#waipModal").modal("show");
      setTimeout(function () {
        location.reload();
      }, Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000);
    }, 1000);
  }
});

// ggf. Fehler ausgeben
socket.on("io.error", function (data) {
  console.log("Error:", data);
});

// Sounds stoppen
socket.on("io.stopaudio", function (data) {
  tmp_audio = document.getElementById("audio");
  tmp_audio.pause();
  tmp_audio.currentTime = 0;
});

// Sounds abspielen
socket.on("io.playtts", function (data) {
  let audio = document.getElementById("audio");
  audio.src = data;
  lastTTSSrc = audio.src;
  ttsActive = true;
  console.log($("#audio"));

  // Audio-Blockade des Browsers erkennen
  let playPromise = document.querySelector("audio").play();

  // In browsers that don't yet support this functionality,
  // playPromise won't be defined.
  if (playPromise !== undefined) {
    playPromise
      .then(function () {
        // Automatic playback started!
        audio.play();
        //$('.bi-volume-up-fill').toggleClass('bi-pause-circle-fill');
      })
      .catch(function (error) {
        console.log("Automatic playback failed");
        // Automatic playback failed.
        // Show a UI element to let the user manually start playback.
        let tmp_element;
        tmp_element = document.querySelector("#volume");
        /*if (!tmp_element.classList.contains('btn-danger')) {
        tmp_element.classList.add('btn-danger');
      };*/
        tmp_element = document.querySelector(".bi-volume-up-fill");
        if (tmp_element && tmp_element.classList.contains("bi-volume-up-fill")) {
          tmp_element.classList.remove("bi-volume-up-fill");
          tmp_element.classList.add("bi-volume-mute-fill");
        }
        indicateAudioBlocked();
      });
  }
});

// Daten löschen, Uhr anzeigen
socket.on("io.standby", function (data) {
  console.log("Standby", data);
  waip_id = null;
  takt_remove("ablauf");

  $("#einsatz_art").removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(" ");
  });
  $("#einsatz_stichwort").removeClass();
  $("#einsatz_stichwort").text("");
  $("#sondersignal").removeClass();
  $("#ortsdaten").text("");
  $("#besonderheiten").text("");
  $("#em_alarmiert").empty();
  $("#em_weitere").text("");
  $("#rueckmeldung").addClass("d-none");
  reset_rmld();
  recount_rmld();
  // Routen und Inset-Karte aufräumen
  destroy_inset_map();
  clear_route_layers();
  currentRoutes = []; // sonst zeichnet der nächste zoomend die alten Routen wieder ein
  // Leaflet-Reset: alle Layer entfernen und Basis-Kacheln + Platzhalter neu anlegen
  map.eachLayer(function (layer) { map.removeLayer(layer); });
  AddMapLayer();
  marker = L.marker(new L.LatLng(0, 0), { icon: redIcon }).addTo(map);
  geojson = L.geoJSON().addTo(map);
  showEinsatzkreisBounds = false;
  map.setView(new L.LatLng(0, 0), 14);
  // Tableau ausblenden
  $("#waiptableau").addClass("d-none");
  $("#waipclock").removeClass("d-none");
  // Art der Standbyanzeige bestimmen
  if (data) {
    // statt der Uhr ein iFrame anzeigen
    $("#clock_day").addClass("d-none");
    $("#frame_web").removeClass("d-none");
  }
  // 200ms warten
  setTimeout(function () {
    resize_text(true);
    updateWachennameAnimation();
    updateRandomPosition();
  }, 200);

});

/* ############################ */
/* ##### STANDBY-WIDGETS ###### */
/* ############################ */

// Wetter, Unwetterwarnungen und Termine kommen fertig aufbereitet vom Server (der Monitor selbst braucht
// keinen Internetzugang). Teil-Updates werden zusammengeführt, die Anzeige wird einmal pro Minute geprüft
// (veraltete Daten ausblenden, vergangene Termine entfernen, Tageswechsel).
const widgetDaten = { aktiv: { wetter: false, kalender: false }, max_age: 180, wetter: null, warnungen: null, kalender: null };

const WETTER_SYMBOLE = {
  "clear-day": ["bi-sun", "klar"],
  "clear-night": ["bi-moon-stars", "klar"],
  "partly-cloudy-day": ["bi-cloud-sun", "teils bewölkt"],
  "partly-cloudy-night": ["bi-cloud-moon", "teils bewölkt"],
  cloudy: ["bi-cloud", "bewölkt"],
  fog: ["bi-cloud-fog2", "Nebel"],
  wind: ["bi-wind", "windig"],
  rain: ["bi-cloud-rain", "Regen"],
  sleet: ["bi-cloud-sleet", "Schneeregen"],
  snow: ["bi-cloud-snow", "Schnee"],
  hail: ["bi-cloud-hail", "Hagel"],
  thunderstorm: ["bi-cloud-lightning-rain", "Gewitter"],
};
const WARN_STUFEN = { 1: "Wetterwarnung", 2: "Markante Wetterwarnung", 3: "Unwetterwarnung", 4: "Extremes Unwetter" };
const MINUTE_MS = 60 * 1000;

function wetter_symbol(icon) {
  return WETTER_SYMBOLE[icon] || ["bi-cloud", ""];
}

function grad(wert) {
  return typeof wert === "number" ? wert + "°" : "–";
}

function zwei(n) {
  return String(n).padStart(2, "0");
}

function uhrzeit(date) {
  return zwei(date.getHours()) + ":" + zwei(date.getMinutes());
}

function tages_start(date, plus) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (plus || 0));
  return d.getTime();
}

// "heute", "morgen" oder Wochentag (kurz) für einen Zeitpunkt
function tag_relativ(date) {
  const jetzt = new Date();
  const t = date.getTime();
  if (t >= tages_start(jetzt, 0) && t < tages_start(jetzt, 1)) return "heute";
  if (t >= tages_start(jetzt, 1) && t < tages_start(jetzt, 2)) return "morgen";
  return date.toLocaleDateString("de-DE", { weekday: "short" });
}

function veraltet(iso) {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > widgetDaten.max_age * MINUTE_MS;
}

function element(tag, klasse, text) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function termin_laeuft_noch(t, jetzt) {
  return Math.max(new Date(t.ende).getTime(), new Date(t.start).getTime() + 60 * MINUTE_MS) > jetzt;
}

function warnung_rendern(w) {
  const box = document.getElementById("standby_warnung");
  const liste = w && !veraltet(w.abgerufen) ? w.liste || [] : [];
  if (!widgetDaten.aktiv.wetter || liste.length === 0) {
    box.classList.add("d-none");
    return;
  }
  const erste = liste[0];
  box.classList.remove("stufe-1", "stufe-2", "stufe-3", "stufe-4");
  box.classList.add("stufe-" + (erste.stufe || 1));
  box.querySelector(".standby-warnung-stufe").textContent = WARN_STUFEN[erste.stufe] || WARN_STUFEN[1];
  box.querySelector(".standby-warnung-titel").textContent = erste.ereignis || erste.titel || "";
  let zeit = "";
  const beginn = erste.beginn ? new Date(erste.beginn) : null;
  const ende = erste.ende ? new Date(erste.ende) : null;
  const fmt = (d) => tag_relativ(d) + " " + uhrzeit(d);
  if (beginn && beginn.getTime() > Date.now()) {
    // Ende am selben Tag nur mit Uhrzeit ("heute 15:00 bis 22:00 Uhr")
    const gleicher_tag = ende && tages_start(ende, 0) === tages_start(beginn, 0);
    zeit = fmt(beginn) + (ende ? " bis " + (gleicher_tag ? uhrzeit(ende) : fmt(ende)) + " Uhr" : " Uhr");
  } else {
    zeit = ende ? "bis " + fmt(ende) + " Uhr" : "bis auf Weiteres";
  }
  zeit += " · DWD";
  if (liste.length > 1) zeit += " · " + (liste.length - 1) + (liste.length === 2 ? " weitere Warnung" : " weitere Warnungen");
  box.querySelector(".standby-warnung-zeit").textContent = zeit;
  box.classList.remove("d-none");
}

function wetter_rendern(w) {
  const box = document.getElementById("standby_wetter");
  if (!widgetDaten.aktiv.wetter || !w || veraltet(w.abgerufen) || (!w.aktuell && !w.heute)) {
    box.classList.add("d-none");
    return false;
  }
  const a = w.aktuell || {};
  const h = w.heute || {};
  const symbol = wetter_symbol(a.icon || h.icon);
  box.querySelector(".standby-wetter-ort").textContent = w.ort || "";
  box.querySelector(".standby-wetter-icon").className = "bi standby-wetter-icon " + symbol[0];
  box.querySelector(".standby-wetter-temp").textContent = grad(typeof a.temperatur === "number" ? a.temperatur : h.max);
  box.querySelector(".standby-wetter-zustand").textContent = symbol[1];
  box.querySelector(".standby-wetter-minmax").textContent = "↓ " + grad(h.min) + "  ↑ " + grad(h.max);
  box.querySelector(".standby-wetter-regen").textContent = typeof h.regen === "number" ? h.regen + " %" : "–";
  box.querySelector(".standby-wetter-wind").textContent = typeof a.wind === "number" ? a.wind + " km/h" : "–";
  box.querySelector(".standby-wetter-boeen").textContent = typeof a.boeen === "number" ? a.boeen + " km/h" : "–";

  const tage = box.querySelector(".standby-wetter-tage");
  const namen = ["Morgen", "Übermorgen"];
  const kinder = (w.tage || []).slice(0, 2).map(function (t, i) {
    const s = wetter_symbol(t.icon);
    const tag = element("div", "standby-tag");
    tag.appendChild(element("i", "bi " + s[0])).setAttribute("aria-hidden", "true");
    const text = element("div", "standby-tag-text");
    text.appendChild(element("span", "standby-klein", namen[i]));
    const temp = element("span", "standby-tag-temp", grad(t.max) + " ");
    temp.appendChild(element("span", null, "/ " + grad(t.min)));
    text.appendChild(temp);
    text.appendChild(element("span", "standby-klein", s[1] + (typeof t.regen === "number" && t.regen >= 30 ? ", Regen " + t.regen + " %" : "")));
    tag.appendChild(text);
    return tag;
  });
  tage.replaceChildren.apply(tage, kinder);

  const stand = a.stand ? new Date(a.stand) : w.abgerufen ? new Date(w.abgerufen) : null;
  box.querySelector(".standby-wetter-quelle").textContent = (stand ? "Stand " + uhrzeit(stand) + " · " : "") + "Quelle: Deutscher Wetterdienst";
  box.classList.remove("d-none");
  return true;
}

function kalender_rendern(k) {
  const box = document.getElementById("standby_kalender");
  if (!widgetDaten.aktiv.kalender || !k || veraltet(k.abgerufen)) {
    box.classList.add("d-none");
    return false;
  }
  const jetzt = new Date();
  const heute = tages_start(jetzt, 0);
  const termine = (k.termine || []).filter((t) => termin_laeuft_noch(t, jetzt.getTime())).slice(0, 4);

  // nach Tagen gruppieren (laufende mehrtägige Termine erscheinen unter "Heute")
  const gruppen = [];
  termine.forEach(function (t) {
    const start = new Date(t.start);
    const tag = Math.max(tages_start(start, 0), heute);
    let gruppe = gruppen.find((g) => g.tag === tag);
    if (!gruppe) {
      gruppe = { tag: tag, termine: [] };
      gruppen.push(gruppe);
    }
    let zeit;
    if (t.ganztaegig) zeit = "ganztägig";
    else if (start.getTime() < heute) zeit = "läuft";
    else zeit = uhrzeit(start);
    gruppe.termine.push({ zeit: zeit, titel: t.titel, ort: t.ort });
  });

  const liste = box.querySelector(".standby-kalender-liste");
  if (gruppen.length === 0) {
    liste.replaceChildren(element("div", "standby-kalender-leer", "Keine Termine in den nächsten Tagen"));
  } else {
    liste.replaceChildren.apply(
      liste,
      gruppen.map(function (g) {
        const datum = new Date(g.tag);
        const el = element("div", "standby-tag-gruppe");
        const kopf = element("div", "standby-tag-kopf");
        let name;
        if (g.tag === heute) name = element("span", "standby-tag-name heute", "Heute");
        else if (g.tag === tages_start(jetzt, 1)) name = element("span", "standby-tag-name", "Morgen");
        else name = element("span", "standby-tag-name", datum.toLocaleDateString("de-DE", { weekday: "long" }));
        kopf.appendChild(name);
        const kurz = datum.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
        kopf.appendChild(element("span", "standby-tag-datum", kurz + " " + zwei(datum.getDate()) + "." + zwei(datum.getMonth() + 1) + "."));
        el.appendChild(kopf);
        g.termine.forEach(function (t) {
          const zeile = element("div", "standby-termin");
          zeile.appendChild(element("span", "standby-termin-zeit", t.zeit));
          const text = element("div", "standby-termin-text");
          text.appendChild(element("span", "standby-termin-titel", t.titel));
          if (t.ort) text.appendChild(element("span", "standby-termin-ort", t.ort));
          zeile.appendChild(text);
          el.appendChild(zeile);
        });
        return el;
      })
    );
  }
  box.querySelector(".standby-kalender-stand").textContent = k.abgerufen ? "Stand " + uhrzeit(new Date(k.abgerufen)) : "";
  box.classList.remove("d-none");
  return true;
}

// Widget-Spalte verkleinern, bis Wetter und Termine vollständig hineinpassen (flache Bildschirme)
function widgets_einpassen() {
  const box = document.getElementById("standby_widgets");
  if (!box || box.classList.contains("d-none") || !$("#waipclock").is(":visible")) return;
  box.style.fontSize = "";
  const inhalt_hoehe = function () {
    const kinder = Array.from(box.children).filter((el) => !el.classList.contains("d-none"));
    if (kinder.length === 0) return 0;
    return kinder[kinder.length - 1].getBoundingClientRect().bottom - kinder[0].getBoundingClientRect().top;
  };
  let groesse = parseFloat(getComputedStyle(box).fontSize);
  for (let i = 0; i < 30 && inhalt_hoehe() > box.clientHeight && groesse > 8; i++) {
    groesse -= 0.5;
    box.style.fontSize = groesse + "px";
  }
}

function widgets_rendern() {
  try {
    warnung_rendern(widgetDaten.warnungen);
    const mit_wetter = wetter_rendern(widgetDaten.wetter);
    const mit_kalender = kalender_rendern(widgetDaten.kalender);
    const mit_widgets = mit_wetter || mit_kalender;
    const block = document.getElementById("standby_block");
    const vorher = block.classList.contains("mit-widgets");
    document.getElementById("standby_widgets").classList.toggle("d-none", !mit_widgets);
    block.classList.toggle("mit-widgets", mit_widgets);
    widgets_einpassen();
    // Uhrgröße und Position neu berechnen, wenn sich das Layout geändert hat
    if (vorher !== mit_widgets && $("#waipclock").is(":visible")) {
      setTimeout(function () {
        resize_text(true);
        updateRandomPosition();
      }, 50);
    }
  } catch (e) {
    console.error("Standby-Widgets:", e);
  }
}

socket.on("io.widgets", function (data) {
  if (!data) return;
  if (data.aktiv) widgetDaten.aktiv = data.aktiv;
  if (data.max_age) widgetDaten.max_age = data.max_age;
  ["wetter", "warnungen", "kalender"].forEach(function (teil) {
    if (Object.prototype.hasOwnProperty.call(data, teil)) widgetDaten[teil] = data[teil];
  });
  widgets_rendern();
});

// einmal pro Minute: veraltete Daten und vergangene Termine ausblenden, Tageswechsel
takt_add("widgets", function () {
  if (new Date().getSeconds() === 0) widgets_rendern();
});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on("io.new_waip", function (data) {
  console.log("Neuer Einsatz:", data);
  start_inactivtimer();
  // Einsatz-ID speichern
  waip_id = data.id;
  // Alarmzeitsetzen setzen, das format "YYYY-MM-DD HH:MM:SS" soll in "YYYY-MM-DD" & "HH:MM" umgewandelt werden
  let alarmzeit = data.zeitstempel.split(" ");
  //$("#alert_date").text("\xA0" + alarmzeit[0]);
  $("#alert_time").text("\xA0" + alarmzeit[1]);
  // Einsatznummer setzen, falls vorhanden
  if (data.einsatznummer) {
    $("#einsatznummer").removeClass("d-none");
    $("#einsatznummer").text("\xA0" + data.einsatznummer);
  } else {
    // div fuer Einsatznummer ausblenden
    $("#einsatznummer").addClass("d-none");
  }
  // Hintergrund der Einsatzart zunächst entfernen
  $("#einsatz_art").removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(" ");
  });
  // Icon der Einsatzart enfernen
  $("#einsatz_stichwort").removeClass();
  // Art und Stichwort festlegen hinterlegen
  switch (data.einsatzart) {
    case "Brandeinsatz":
      $("#einsatz_art").addClass("bg-danger");
      $("#einsatz_stichwort").addClass("bi-fire");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Hilfeleistungseinsatz":
      $("#einsatz_art").addClass("bg-info");
      $("#einsatz_stichwort").addClass("bi-tools");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Rettungseinsatz":
      $("#einsatz_art").addClass("bg-warning");
      $("#einsatz_stichwort").addClass("bi-heart-pulse-fill");
      break;
    case "Krankentransport":
      $("#einsatz_art").addClass("bg-success");
      $("#einsatz_stichwort").addClass("bi-asterisk");
      break;
    default:
      $("#einsatz_art").addClass("bg-secondary");
      $("#einsatz_stichwort").addClass("bi-info-circle-fill");
  }
  $("#einsatz_stichwort").text(" " + data.stichwort);
  // Sondersignal setzen
  $("#sondersignal").removeClass();
  switch (data.sondersignal) {
    case 1:
      $("#sondersignal").addClass("bi-bell-fill");
      break;
    default:
      $("#sondersignal").addClass("bi-bell-slash-fill");
  }
  // Ortsdaten zusammenstellen und setzen
  let small_ortsdaten;
  small_ortsdaten = "";
  // Teilbjekt anfuegen
  if (data.objektteil) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.objektteil) + "<br />";
  }
  // Objekt anfuegen
  if (data.objekt) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.objekt);
    // ggf. weitere Einsatzdetails an Objekt anfügen, wenn Brand- oder Hilfeleistungseinsatz
    if (data.einsatzdetails && (data.einsatzart === "Brandeinsatz" || data.einsatzart === "Hilfeleistungseinsatz")) {
      small_ortsdaten = small_ortsdaten + " (" + data.einsatzdetails + ") ";
    }
    small_ortsdaten = small_ortsdaten + "<br />";
  }
  // Ort anfuegen
  if (data.ort) {
    small_ortsdaten = small_ortsdaten + break_text_25(data.ort) + "<br />";
  }
  // Ortsteil anfuegen, aber nur wenn nicht gleich Ort
  if (data.ortsteil) {
    // wenn Ortsteil gleich Ort, dann nicht anzeigen
    if (data.ortsteil !== data.ort) {
      small_ortsdaten = small_ortsdaten + break_text_25(data.ortsteil) + "<br />";
    }
  }
  // Strasse und Hausnummer anfuegen
  if (data.strasse) {
    let tmp_strasse = data.hausnummer ? data.strasse + "&nbsp;" + data.hausnummer : data.strasse;
    small_ortsdaten = small_ortsdaten + break_text_25(tmp_strasse) + "<br />";
  }
  if (small_ortsdaten.substr(small_ortsdaten.length - 4) == "<br />") {
    small_ortsdaten = small_ortsdaten.slice(0, -4);
  }
  $("#ortsdaten").html(small_ortsdaten);
  // Besonderheiten zurücksetzen und dann neu schreiben
  $("#besonderheiten").text(data.besonderheiten);
  // alarmierte Einsatzmittel setzen
  $("#em_alarmiert_new").empty();
  const data_em_alarmiert = data.em_alarmiert;
  const anzahl_em_alarmiert = data_em_alarmiert.length;
  let hight_em_alarmiert = 0;
  let col_em_alarmiert = 0;
  // wenn anzahl max 2 dann
  if (anzahl_em_alarmiert <= 2) {
    hight_em_alarmiert = "h-100";
    // ein einzelnes Fahrzeug über die volle Breite, sonst bleibt neben der Kachel eine Lücke
    col_em_alarmiert = anzahl_em_alarmiert === 1 ? "col-12" : "col-6";
  }
  // wenn anzahl zwischen 3 und 4 dann
  if (anzahl_em_alarmiert > 2 && anzahl_em_alarmiert <= 4) {
    hight_em_alarmiert = "h-50";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl zwischen 5 und 6 dann
  if (anzahl_em_alarmiert > 4 && anzahl_em_alarmiert <= 6) {
    hight_em_alarmiert = "h-33";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl zwischen 7 und 8 dann
  if (anzahl_em_alarmiert > 6 && anzahl_em_alarmiert <= 8) {
    hight_em_alarmiert = "h-25";
    col_em_alarmiert = "col-6";
  }
  // wenn anzahl ist 9
  if (anzahl_em_alarmiert == 9) {
    hight_em_alarmiert = "h-33";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 10 und 12 dann
  if (anzahl_em_alarmiert > 9 && anzahl_em_alarmiert <= 12) {
    hight_em_alarmiert = "h-25";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 13 und 15 dann
  if (anzahl_em_alarmiert > 12 && anzahl_em_alarmiert <= 15) {
    hight_em_alarmiert = "h-20";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl zwischen 16 und 18 dann
  if (anzahl_em_alarmiert > 15 && anzahl_em_alarmiert <= 18) {
    hight_em_alarmiert = "h-16-5";
    col_em_alarmiert = "col-4";
  }
  // wenn anzahl größer 19
  if (anzahl_em_alarmiert > 18) {
    hight_em_alarmiert = "h-10";
    col_em_alarmiert = "col-4";
  }

  for (let i in data_em_alarmiert) {
    let tmp = data_em_alarmiert[i].name.replace(/[^a-z0-9\s]/gi, "").replace(/[_\s]/g, "-");
    $("#em_alarmiert_new").append('<div id="id_' + tmp + '" class="' + hight_em_alarmiert + " " + col_em_alarmiert + ' p-1"></div>');
    $("#id_" + tmp).append(
      '<div class="px-1 w-100 h-100 d-flex align-items-center rounded bg-secondary cl_em_alarmiert text-nowrap">' +
        data_em_alarmiert[i].name +
        "</div>"
    );
  }
  // weitere alarmierte Einsatzmittel setzen
  $("#em_weitere").text("");

  try {
    let data_em_weitere = data.em_weitere;

    if (data_em_weitere.length > 0) {
      let tmp_weitere;
      for (let i in data_em_weitere) {
        if (tmp_weitere) {
          tmp_weitere = tmp_weitere + ", " + data_em_weitere[i].name;
        } else {
          tmp_weitere = data_em_weitere[i].name;
        }
      }
      $("#em_weitere").text(tmp_weitere);
    }
  } catch (e) {
    console.log(e); // error in the above string (in this case, yes)!
  }

  // Rückmeldungs-Timer vollständig zurücksetzen
  takt_remove_prefix("rmld-");

  // Routen und Inset-Karte aus vorherigem Einsatz löschen
  destroy_inset_map();
  clear_route_layers();
  currentRoutes = []; // sonst zeichnet zoomend (durch setView unten) die Routen des alten Einsatzes wieder ein
  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);

  // Ablaufzeit setzen
  start_counter(data.zeitstempel, data.ablaufzeit);
  // alte Rückmeldung entfernen
  reset_rmld();
  recount_rmld(data.uuid);
  // VIEW anpassen
  reset_view();
  // Uhr ausblenden, Tableau einblenden – MUSS vor map.fitBounds passieren,
  // damit der Kartencontainer eine reale Größe hat wenn Leaflet rechnet
  $("#waipclock").addClass("d-none");
  $("#waiptableau").removeClass("d-none");
  // Leaflet die tatsächliche Containergröße mitteilen, bevor fitBounds aufgerufen wird
  map.invalidateSize();
  // neuer Einsatz: automatisches Einpassen wieder erlauben
  karteManuellBewegt = false;

  const initialZoom = kartenStartZoom;

  // Karte setzen (Punkt oder GeoJSON mit Rand zentrieren)
  if (data.wgs84_x && data.wgs84_y) {
    const lat = data.wgs84_x;
    const lng = data.wgs84_y;
    showEinsatzkreisBounds = false;
    marker = L.marker(new L.LatLng(lat, lng), { icon: redIcon, pane: "zielPane" }).addTo(map);
    map.setView(new L.LatLng(lat, lng), initialZoom);
    // Inset-Karte nur bei Punkt-Einsatz mit Vollberechtigung
    if (data.permissions) {
      create_inset_map(lat, lng);
    }
  } else {
    try {
      const gjData = JSON.parse(data.geometry);
      geojson = L.geoJSON(gjData).addTo(map);
      // Ohne Zielkoordinaten (fehlende Berechtigung) zeigen wir nur den Einsatzumkreis -
      // dessen Bounds müssen auch beim Zeichnen der Wachen-Routen erhalten bleiben,
      // damit der Kreis nicht durch einen späteren fitBounds auf eine einzelne Wache
      // weggezoomt wird.
      showEinsatzkreisBounds = true;
      const gjBounds = geojson.getBounds();
      if (gjBounds.isValid()) {
        map.fitBounds(gjBounds, { padding: [50, 50], maxZoom: initialZoom });
      } else {
        map.setView(gjBounds.getCenter(), initialZoom);
      }
    } catch (e) {
      console.error("GeoJSON Parsing/Rendering Fehler", e);
    }
  }

  resize_text(true);
});

// OSRM-Routen empfangen und auf der Karte zeichnen
socket.on("io.routes", function (routes) {
  currentRoutes = routes || [];
  draw_routes(currentRoutes);
});

socket.on("io.new_rmld", function (data) {
  console.log("neue Rückmeldung:", data);
  // Rückmeldungen deaktiviert? (rmld_off wird serverseitig ins Template injiziert)
  try {
    if (typeof rmld_off !== "undefined" && rmld_off) {
      console.log("Rückmeldungen sind deaktiviert (rmld=off), io.new_rmld ignoriert.");
      return; // nichts tun
    }
  } catch (e) {
    // falls Variable nicht existiert einfach normal fortfahren
  }
  // DEBUG
  // FIXME  Änderung des Funktions-Typ berücksichtigen
  // Neue Rueckmeldung hinterlegen
  // HTML festlegen
  // Typ und Anzeigename (Name, sonst Funktion) gemeinsam mit dem Dashboard ermitteln (rmld_anzeige.js)
  const rolle = rmld_rolle(data);
  const item_type = rolle.typ;
  let item_content = rolle.name;

  // Anzeigename im Balken: Alias, sonst Rollenname (Qualifikationen hängt add_resp_progressbar selbst an)
  const anzeige_name = item_content;

  if (data.rmld_capability_agt > 0) {
    item_content += " AGT";
  }
  if (data.rmld_capability_fzf > 0) {
    item_content += " FZF";
  }
  if (data.rmld_capability_ma > 0) {
    item_content += " MA";
  }
  if (data.rmld_capability_med > 0) {
    item_content += " MED";
  }

  // Variablen für Anzeige vorbereiten
  var pg_waip_uuid = data.waip_uuid;
  var pg_rmld_uuid = data.rmld_uuid;
  var pg_start = new Date(data.time_decision);
  var pg_end = new Date(data.time_arrival);

  // Progressbar hinterlegen
  add_resp_progressbar(
    data.waip_uuid,
    data.rmld_uuid,
    item_type,
    anzeige_name,
    data.rmld_capability_agt,
    data.rmld_capability_fzf,
    data.rmld_capability_ma,
    data.rmld_capability_med,
    pg_start,
    pg_end
  ); // Anzahl der Rückmeldung zählen

  recount_rmld(pg_waip_uuid);
  // View anpassen; das ganze Tableau nur neu einpassen, wenn sich dadurch die Aufteilung geändert hat
  // (meist nur bei der ersten Rückmeldung), sonst reichen die Zähler
  if (reset_view()) _rmld_resize_full = true;
  // Spalten und Balkengröße an die neue Anzahl anpassen
  layout_rmld();
  // debounced, damit bei Batch-Eingang nur einmal eingepasst wird
  clearTimeout(_rmld_resize_timer);
  _rmld_resize_timer = setTimeout(function () {
    if (_rmld_resize_full) {
      resize_text(true);
    } else {
      resize_rmld_counter();
    }
    _rmld_resize_full = false;
  }, 150);

  // Bing abspielen (nur wenn kein laufendes TTS überlagert wird)
  let audio = document.getElementById("audio");
  try {
    // Wenn TTS aktiv und noch nicht beendet -> abbrechen
    if (ttsActive && !audio.paused && !audio.ended && audio.src === lastTTSSrc && !/bell_message\.mp3/.test(audio.src)) {
      console.log("Bell übersprungen: TTS aktiv (" + audio.src + ")");
      return;
    }
    // Wenn anderes Audio (nicht Glocke) gerade spielt, überspringen
    if (!ttsActive && !audio.paused && !audio.ended && !/bell_message\.mp3/.test(audio.src)) {
      console.log("Bell übersprungen: anderes Audio läuft (" + audio.src + ")");
      return;
    }
    // Glocke abspielen wenn nichts oder Glocke selbst
    if (!/bell_message\.mp3/.test(audio.src)) {
      audio.src = "/media/bell_message.mp3";
    }
    let playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(function () {
        console.log("Notification playback failed");
        indicateAudioBlocked();
      });
    }
  } catch (e) {
    console.log("Bell playback error", e);
    indicateAudioBlocked();
  }
});

/* ########################### */
/* ####### Rückmeldung ####### */
/* ########################### */

let _rmld_resize_timer = null;
let _rmld_resize_full = false;

// Nach einer Rückmeldung ändern sich nur die Zähler – nur diese neu einpassen
function resize_rmld_counter() {
  try {
    textFit(document.querySelectorAll("#container_rmld .tf_singleline"), { minFontSize: 3, maxFontSize: 700, reProcess: true });
  } catch (e) {
    console.error("resize_rmld_counter:", e);
  }
}

// Spalten und Balkenhöhe der Rückmeldungen aus Anzahl und verfügbarer Höhe berechnen. Alle Größen
// hängen nur von der Containergröße ab, dadurch sieht die Anzeige auf 1080p und 4K gleich aus.
// Wenige Rückmeldungen: 2 pro Reihe (breite Balken), bei vielen 3 und ab ca. 25 auch 4 pro Reihe.
function layout_rmld() {
  const box = document.getElementById("rmld_progressbars");
  if (!box) return;
  const anzahl = box.children.length;
  const hoehe = box.clientHeight;
  if (!anzahl || !hoehe) return;
  // 2026-11-12 verkleinert (vorher 15 % / 11 %): bei vielen Rückmeldungen wirkten die Balken zu wuchtig
  const h_max = hoehe * 0.12; // höchstens 12 % der Bereichshöhe je Balken
  const h_min = hoehe * 0.085; // darunter lieber eine Spalte mehr
  let spalten = 4;
  let balken_h = 0;
  for (let s = 2; s <= 4; s++) {
    const h = Math.min(h_max, hoehe / Math.ceil(anzahl / s) / 1.15); // 15 % Abstand zwischen den Reihen
    if (h >= h_min || s === 4) {
      spalten = s;
      balken_h = h;
      break;
    }
  }
  box.style.setProperty("--rmld-spalten", spalten);
  box.style.setProperty("--rmld-h", balken_h.toFixed(1) + "px");
  // Ticker für überlange Texte (gemeinsam mit dem Dashboard, siehe rmld_anzeige.js)
  rmld_ticker_aktualisieren(box);
}

function reset_rmld() {
  const regex = /^pg-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
  $("#rmld_progressbars").children().each(function () {
    const match = regex.exec($(this).attr("id"));
    if (match) {
      takt_remove("rmld-" + match[1]);
      $(this).remove();
    }
  });
}

function add_resp_progressbar(p_uuid, p_id, p_type, p_content, p_agt, p_fzf, p_ma, p_med, p_start, p_end) {
  // Hintergrund der Progressbar festlegen
  let bar_background = "";
  let bar_border = "";
  // wenn p_agt 1 ist
  if (p_agt == 1) {
    bar_border = "border border-warning";
  }
  switch (p_type) {
    case "ek":
      bar_background = "bg-success";
      break;
    case "gf":
      bar_background = "bg-info";
      break;
    case "zf":
      bar_background = "bg-light";
      break;
    case "vf":
      bar_background = "bg-danger";
      break;
    default:
      bar_background = "";
      break;
  }
  var bar_uuid = "bar-" + p_uuid;
  // pruefen ob div mit id 'pg-'+p_id schon vorhanden ist
  var pgbar = document.getElementById("pg-" + p_id);
  if (!pgbar) {
    // col-4 hinzufügen mit id
    // Breite und Höhe der Balken setzt layout_rmld()
    $("#rmld_progressbars").append('<div class="rmld-item px-1 pg-' + p_type + '" id="pg-' + p_id + '"></div>');
    // Progressbar hinzufügen mit id
    $("#pg-" + p_id).append(
      '<div class="progress rmld-bar position-relative ' + bar_border + " " + bar_uuid + '" id="pg-' + p_type + "-" + p_id + '"></div>'
    );
    // wenn p_agt > 0 ist, dann als Klasse p_agt hinterlegen
    if (p_agt > 0) {
      $("#pg-" + p_id).addClass("p_agt");
    }
    // wenn p_fzf > 0 ist, dann als Klasse p_fzf hinterlegen
    if (p_fzf > 0) {
      $("#pg-" + p_id).addClass("p_fzf");
    }
    // wenn p_ma > 0 ist, dann als Klasse p_ma hinterlegen
    if (p_ma > 0) {
      $("#pg-" + p_id).addClass("p_ma");
    }
    // wenn p_med > 0 ist, dann als Klasse p_med hinterlegen
    if (p_med > 0) {
      $("#pg-" + p_id).addClass("p_med");
    }
    $("#pg-" + p_type + "-" + p_id).append(
      '<div id="pg-bar-' +
        p_id +
        '" class="progress-bar ' +
        bar_background +
        '" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>'
    );
    // hier tf_singleline
    $("#pg-" + p_type + "-" + p_id).append(
      '<div id="pg-text-' + p_id + '" class="justify-content-center align-items-center d-flex position-absolute h-100 w-100"></div>'
    );
  } else {
    // TODO PG-Bar ändern falls neue/angepasste Rückmeldung
  }

  // Statischen Overlay-Text einmalig vorberechnen (ändert sich nicht)
  let _caps = [];
  if (p_agt > 0) _caps.push("AGT");
  if (p_fzf > 0) _caps.push("FZF");
  if (p_ma > 0) _caps.push("MA");
  if (p_med > 0) _caps.push("MED");
  let _overlay_text = (p_content || "") + (_caps.length > 0 ? " (" + _caps.join(", ") + ")" : "");

  // DOM-Referenzen einmalig cachen
  let _$bar = $("#pg-bar-" + p_id);
  let _$overlay = $("#pg-text-" + p_id);

  // Beschriftung einmalig anlegen – kein Rebuild jede Sekunde (gemeinsam mit dem Dashboard, siehe rmld_anzeige.js)
  let _timeNode = rmld_beschriftung_anlegen(_$overlay[0], _overlay_text);

  // Zeitstempel als Millisekunden cachen
  let _start_ms = p_start.getTime();
  let _end_ms = p_end.getTime();

  takt_add("rmld-" + p_id, function () {
    let now = Date.now();
    let current_progress = Math.round((100 / (_start_ms - _end_ms)) * (_start_ms - now));

    if (current_progress >= 100) {
      _$bar.css("width", "100%").attr("aria-valuenow", 100);
      rmld_angekommen(_timeNode);
      takt_remove("rmld-" + p_id);
      _$bar = _$overlay = null; // DOM-Referenzen für GC freigeben
    } else {
      let diff = Math.abs(_end_ms - now);
      let min = Math.floor(diff / 60000);
      let sec = Math.floor((diff % 60000) / 1000);
      _$bar.css("width", current_progress + "%").attr("aria-valuenow", current_progress);
      // textContent direkt – kein jQuery-Overhead im 1-Sek-Takt
      _timeNode.textContent = min + ":" + (sec < 10 ? "0" + sec : sec);
    }
  });
}

function recount_rmld(p_uuid) {
  let bar_uuid = "bar-" + p_uuid;
  let agt_count = 0;
  // Zähler auf 0 Setzen
  $("#gs-counter").text(0);
  $("#ek-counter").text(0);
  $("#gf-counter").text(0);
  $("#zf-counter").text(0);
  $("#vf-counter").text(0);
  $("#agt-counter").text(0);
  $("#ma-counter").text(0);
  $("#fzf-counter").text(0);
  $("#med-counter").text(0);

  $("#gs-counter").text($(".pg-").length + $(".pg-ek").length + $(".pg-gf").length + $(".pg-zf").length + $(".pg-vf").length);

  $("#ek-counter").text($(".pg-ek").length);
  $("#gf-counter").text($(".pg-gf").length);
  $("#zf-counter").text($(".pg-zf").length);
  $("#vf-counter").text($(".pg-vf").length);

  $("#agt-counter").text($(".p_agt").length);
  $("#ma-counter").text($(".p_ma").length);
  $("#fzf-counter").text($(".p_fzf").length);
  $("#med-counter").text($(".p_med").length);
}

// Aufteilung des Tableaus als vergleichbare Zeichenkette (Klassen sortiert, da alterClass sie neu anhängt)
function view_signature() {
  return ["#container_rmld", "#container_ortsdaten", "#container_einsatzmittel", "#container_weitere", "#container_besonderheiten"]
    .map(function (id) {
      const el = document.querySelector(id);
      return el ? el.className.split(/\s+/).sort().join(" ") : "";
    })
    .join("|");
}

// passt die Aufteilung an; Rückgabe true, wenn sie sich dadurch geändert hat
function reset_view() {
  const vorher = view_signature();
  // Variablen
  let rmld_on = false;
  let em_weitere_on = false;
  let besonderheiten_on = false;
  // boolean für container_rmld
  if (
    $("#gs-counter").text() == "0" &&
    $("#ek-counter").text() == "0" &&
    $("#gf-counter").text() == "0" &&
    $("#zf-counter").text() == "0" &&
    $("#vf-counter").text() == "0"
  ) {
    rmld_on = false;
  } else {
    rmld_on = true;
  }
  // boolean wenn #em_weitere nicht leer ist
  if ($("#em_weitere").text() == "") {
    em_weitere_on = false;
  } else {
    em_weitere_on = true;
  }
  // boolean wenn #besonderheiten nicht leer ist
  if ($("#besonderheiten").text() == "") {
    besonderheiten_on = false;
  } else {
    besonderheiten_on = true;
  }
  console.log("rmld_on:", rmld_on, "em_weitere_on:", em_weitere_on, "besonderheiten_on:", besonderheiten_on);
  // VIEW anpassen
  if (rmld_on && (!em_weitere_on || em_weitere_on) && besonderheiten_on) {
    $("#container_rmld").removeClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-45");
    alterClass("#container_ortsdaten", "col-*", "col-5");
    alterClass("#container_einsatzmittel", "h-*", "h-45");
    alterClass("#container_einsatzmittel", "col-*", "col-7");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-15");
  }
  // v2, v6 - wenn keine Rückmeldungen, egal ob weitere Einsatzmittel und keine Besonderheiten vorhanden sind
  if (!rmld_on && (!em_weitere_on || em_weitere_on) && !besonderheiten_on) {
    $("#container_rmld").addClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-45");
    alterClass("#container_ortsdaten", "col-*", "col-12");
    alterClass("#container_einsatzmittel", "h-*", "h-45");
    alterClass("#container_einsatzmittel", "col-*", "col-12");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-5");
  }
  // v3, v5 - wenn Besonderheiten, keine Rückmeldungen, egal ob weitere Einsatzmittel
  if (!rmld_on && (em_weitere_on || !em_weitere_on) && besonderheiten_on) {
    $("#container_rmld").addClass("d-none");
    // wenn max. 2 Einsatzmittel alarmirt sind, dann mehr Höhe für Text
    if ($("#em_alarmiert_new").children().length <= 2) {
      alterClass("#container_ortsdaten", "h-*", "h-55");
      alterClass("#container_ortsdaten", "col-*", "col-12");
      alterClass("#container_einsatzmittel", "h-*", "h-25");
      alterClass("#container_einsatzmittel", "col-*", "col-12");
    } else {
      alterClass("#container_ortsdaten", "h-*", "h-40");
      alterClass("#container_ortsdaten", "col-*", "col-12");
      alterClass("#container_einsatzmittel", "h-*", "h-40");
      alterClass("#container_einsatzmittel", "col-*", "col-12");
    }
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-15");
  }
  // v4, v7 - keine Besonderheiten, aber Rückmeldungen und egal ob weitere Einsatzmittel
  if (!besonderheiten_on && rmld_on && (em_weitere_on || !em_weitere_on)) {
    $("#container_rmld").removeClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-55");
    alterClass("#container_ortsdaten", "col-*", "col-5");
    alterClass("#container_einsatzmittel", "h-*", "h-55");
    alterClass("#container_einsatzmittel", "col-*", "col-7");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-5");
  }
  return view_signature() !== vorher;
}

/* ########################### */
/* ####### SCREENSAVER ####### */
/* ########################### */

// Uhrzeit und Datum für Bildschirmschoner
function set_clock() {
  // TODO Sekunden anzeigen
  // Wochentage
  let d_names = new Array("Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag");
  // Monate
  let m_names = new Array("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember");
  // Aktuelle Zeit
  let d = new Date();
  let curr_day = d.getDay();
  let curr_date = d.getDate();
  let curr_month_id = d.getMonth();
  curr_month_id = curr_month_id + 1;
  var curr_year = d.getFullYear();
  let curr_hour = d.getHours();
  let curr_min = d.getMinutes();
  let curr_sek = d.getSeconds();
  // Tag und Monat Anpassen
  if (String(curr_date).length == 1) curr_date = "0" + curr_date;
  if (String(curr_month_id).length == 1) curr_month_id = "0" + curr_month_id;
  // Uhrzeit und Minute anpassen
  if (curr_min <= 9) {
    curr_min = "0" + curr_min;
  }
  if (curr_hour <= 9) {
    curr_hour = "0" + curr_hour;
  }
  if (curr_sek <= 9) {
    curr_sek = "0" + curr_sek;
  }
  let curr_month = d.getMonth();
  var curr_year = d.getFullYear();
  let element_time = curr_hour + ":" + curr_min;
  let element_day = d_names[curr_day] + ", " + curr_date + ". " + m_names[curr_month];
  let element_date_time = curr_date + "." + curr_month_id + "." + curr_year + " - " + element_time + ":" + curr_sek;
  // Easter-Egg :-)
  if (element_time.substr(0, 5) == "13:37") {
    element_time = "1337";
  }
  // Sekunden jede Sekunde aktualisieren
  $("#clock-seconds").text(":" + curr_sek);

  // nur erneuern wenn sich Zeit geändert hat
  if ($("#clock-hhmm").text() !== element_time) {
    $("#clock-hhmm").text(element_time);
    $("#day").text(element_day);
    // resize_text nur wenn Uhr sichtbar ist – während Alarm (waiptableau sichtbar) ist
    // ein vollständiges textFit-Reprocessing jede Minute unnötige CPU-Last
    if ($("#waipclock").is(":visible")) {
      resize_text(true);
    }
  }
}

// Uhrzeit jede Sekunde anpassen (im gemeinsamen Sekundentakt)
takt_add("uhr", set_clock);

/* ############################ */
/* ####### WACHENNAME ####### */
/* ############################ */

// Vereinfachte Animation: alle 5s Schritt nach rechts, am Rand Richtung umkehren
let wachennameInterval;
let wachennameDirection = 1; // 1 = rechts, -1 = links
const WACHENNAME_STEP = 50; // Pixel pro Schritt
const WACHENNAME_INTERVAL_MS = 10000; // 10 Sekunden

function updateWachennameAnimation() {
  const wachenname = document.getElementById("wachenname_footer");
  if (!wachenname) return;

  // Vorherige CSS-Animation und evtl. Style-Tag entfernen
  wachenname.style.animation = "none";
  const oldStyle = document.getElementById("wachenname-animation");
  if (oldStyle) oldStyle.remove();

  // Positionierungsbasis setzen
  wachenname.style.position = "relative";
  if (!wachenname.dataset.posX) {
    wachenname.dataset.posX = "0";
    wachenname.style.left = "0px";
  }

  // Begrenzungen neu berechnen (Fensterbreite als Container)
  const containerWidth = window.innerWidth;
  const elementWidth = wachenname.offsetWidth;
  const maxTranslate = Math.max(0, containerWidth - elementWidth - 40); // etwas Rand

  // Falls aktuelle Position außerhalb nach Resize
  let currentX = parseInt(wachenname.dataset.posX, 10) || 0;
  if (currentX > maxTranslate) {
    currentX = maxTranslate;
    wachenname.dataset.posX = String(currentX);
    wachenname.style.left = currentX + "px";
    wachennameDirection = -1;
  }

  // Intervall zurücksetzen
  if (wachennameInterval) {
    clearInterval(wachennameInterval);
  }

  wachennameInterval = setInterval(() => {
    let x = parseInt(wachenname.dataset.posX, 10) || 0;
    x += wachennameDirection * WACHENNAME_STEP;

    // Randprüfung und Richtungswechsel
    if (x >= maxTranslate) {
      x = maxTranslate;
      wachennameDirection = -1;
    } else if (x <= 0) {
      x = 0;
      wachennameDirection = 1;
    }

    wachenname.dataset.posX = String(x);
    wachenname.style.left = x + "px";
  }, WACHENNAME_INTERVAL_MS);
}

/* ############################ */
/* ####### RANDOM POSITION ####### */
/* ############################ */

let randomPositionInterval;

function startRandomPositioning() {
  // Initiale Position setzen
  updateRandomPosition();

  // Alle 3 Minuten die Position aktualisieren
  randomPositionInterval = setInterval(updateRandomPosition, 180000);
}

function updateRandomPosition() {
  const screenSaver = document.getElementById("screen_saver");
  const block = document.getElementById("standby_block");

  if (!screenSaver || !block) return;

  // Dimensionen des Containers und des Blocks (Uhr, Warnung, Widgets)
  const containerRect = screenSaver.getBoundingClientRect();
  const elementRect = block.getBoundingClientRect();

  // Maximale Positionen berechnen (unter Berücksichtigung der Blockgröße)
  const maxX = Math.max(0, containerRect.width - elementRect.width);
  const maxY = Math.max(0, containerRect.height - elementRect.height);

  // Zufällige Position berechnen
  const randomX = Math.floor(Math.random() * maxX);
  const randomY = Math.floor(Math.random() * maxY);

  // Position via transform – löst keinen Layout-Reflow aus (Compositor-Thread)
  block.style.transform = `translate(${randomX}px, ${randomY}px)`;
}

/* ############################ */
/* ####### ALTER CLASS ####### */
/* ############################ */

function alterClass(elementId, removeClassPattern, addClass) {
  // Element mit der angegebenen ID auswählen
  const element = document.querySelector(elementId);

  if (element) {
    // Alle Klassen des Elements durchlaufen
    element.classList.forEach((className) => {
      // Wenn die Klasse dem Muster entspricht, entfernen
      if (className.match(new RegExp(removeClassPattern.replace("*", ".*")))) {
        element.classList.remove(className);
      }
    });
    // Neue Klasse hinzufügen
    element.classList.add(addClass);
  }
}

/* ########################### */
/* ######## OSRM Routen ###### */
/* ########################### */

function clear_route_layers() {
  routeLayers.forEach(function (l) { map.removeLayer(l); });
  routeLayers = [];
}

// Versetzt eine Latlng-Liste um offsetPx Pixel senkrecht zur Linie. Wird bei jedem Redraw mit
// dem aktuellen Zoom neu berechnet, damit der Versatz auf jeder Zoomstufe gleich breit wirkt
// (analog zum Prinzip von Leaflet.PolylineOffset, hier ohne Zusatz-Abhängigkeit selbst umgesetzt).
function offsetLatLngs(targetMap, latlngs, offsetPx) {
  if (!offsetPx || latlngs.length < 2) return latlngs;
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
    out.push(L.point(pts[i].x + perp.x * offsetPx, pts[i].y + perp.y * offsetPx));
  }
  return out.map(function (p) { return targetMap.unproject(p, zoom); });
}

// Feste Reihenfolge nach Wachennummer, damit der Versatz zwischen Redraws stabil bleibt
function assignRouteOffsets(routes) {
  const step = 5; // Pixel Abstand zwischen benachbarten Routen
  const sorted = routes.filter(function (r) { return r.geometry; })
    .slice().sort(function (a, b) { return String(a.nr_wache).localeCompare(String(b.nr_wache)); });
  const offsets = new Map();
  sorted.forEach(function (r, i) { offsets.set(r, (i - (sorted.length - 1) / 2) * step); });
  return offsets;
}

function draw_routes(routes, fit) {
  if (fit === undefined) fit = true;
  clear_route_layers();
  if (!routes || !routes.length) return;

  const allBounds = [];
  const offsets = assignRouteOffsets(routes);

  routes.forEach(function (route) {
    if (!route.geometry) {
      // Keine Route vorhanden (z.B. Wache liegt im Einsatzbereich) -> nur Label anzeigen
      if (route.coords) {
        const labelMarker = L.circleMarker([route.coords[0], route.coords[1]], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: route.color,
          fillOpacity: 1.0,
        }).addTo(map);
        if (route.name_wache) labelMarker.bindTooltip(route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
        routeLayers.push(labelMarker);
        try {
          const b = L.latLngBounds([route.coords, route.coords]);
          if (b.isValid()) allBounds.push(b);
        } catch (_) {}
      }
      return;
    }

    const latlngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
    const offsetLL = offsetLatLngs(map, latlngs, offsets.get(route) || 0);

    // Schatten
    const shadow = L.polyline(offsetLL, {
      color: "#000000", weight: 10, opacity: 0.18, lineCap: "round", lineJoin: "round",
    }).addTo(map);
    routeLayers.push(shadow);

    // Halo (weißer Hintergrund) für besseren Kontrast
    const halo = L.polyline(offsetLL, {
      color: "#ffffff", weight: 5, opacity: 0.65, lineCap: "round", lineJoin: "round",
    }).addTo(map);
    routeLayers.push(halo);

    // Farbige Linie
    const layer = L.polyline(offsetLL, {
      color: route.color, weight: 4, opacity: 1.0, lineCap: "round", lineJoin: "round",
    }).addTo(map);
    routeLayers.push(layer);

    // Startpunkt-Marker (Wache)
    if (offsetLL.length) {
      const startMarker = L.circleMarker(offsetLL[0], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: route.color,
        fillOpacity: 1.0,
      }).addTo(map);
      if (route.name_wache) startMarker.bindTooltip(route.name_wache, { permanent: true, direction: "top", offset: [0, -10], className: "route-label" });
      routeLayers.push(startMarker);
    }

    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) allBounds.push(bounds);
    } catch (_) {}
  });

  if (allBounds.length || showEinsatzkreisBounds) {
    let combined = allBounds.length ? allBounds[0] : null;
    for (let i = 1; i < allBounds.length; i++) combined = combined.extend(allBounds[i]);
    // Einsatzumkreis einbeziehen, falls nur dieser (statt Zielkoordinaten) angezeigt wird -
    // sonst würde der Kreis von den Bounds der Wachen-Marker/-Routen verdrängt
    if (showEinsatzkreisBounds) {
      try {
        const gjBounds = geojson.getBounds();
        if (gjBounds.isValid()) combined = combined ? combined.extend(gjBounds) : gjBounds;
      } catch (_) {}
    }
    if (!combined) return;
    // Marker-Position einbeziehen falls vorhanden
    try {
      const mPos = marker.getLatLng();
      if (mPos.lat !== 0 || mPos.lng !== 0) combined = combined.extend(mPos);
    } catch (_) {}

    // Nur beim Eintreffen neuer Routendaten die Sicht anpassen, nicht bei jedem
    // Zoomwechsel (sonst würde manuelles Zoomen sofort wieder überschrieben)
    if (!fit) return;

    const insetEl = document.getElementById("map-inset");
    const insetVisible = insetEl && !insetEl.classList.contains("d-none");

    if (insetVisible) {
      // Inset in den Quadranten verschieben, der dem Routenstart (Wache) gegenüberliegt
      const firstCoords = routes.length && routes[0].geometry && routes[0].geometry.coordinates;
      const startCoord = firstCoords && firstCoords.length ? firstCoords[0] : null; // [lng, lat]
      const center = combined.getCenter();
      const stationSouth = startCoord ? startCoord[1] < center.lat : true;
      const stationWest  = startCoord ? startCoord[0] < center.lng : true;

      // Inset gegenüber der Wache positionieren
      insetEl.style.top    = stationSouth ? "auto" : "10px";
      insetEl.style.bottom = stationSouth ? "10px" : "auto";
      insetEl.style.left   = stationWest  ? "auto" : "10px";
      insetEl.style.right  = stationWest  ? "10px" : "auto";

      // fitBounds-Padding aus tatsächlicher Inset-Größe lesen, damit responsive CSS-Änderungen
      // (min(260px, 38%)) automatisch berücksichtigt werden. Das Inset liegt in einer Ecke: Es genügt,
      // auf EINER Achse Platz freizuhalten (Streifen neben ODER über/unter dem Inset), dann kann nichts
      // darunter liegen. Bisher wurde auf beiden Achsen freigehalten -> Karte unnötig weit herausgezoomt.
      const insetB = insetEl.offsetWidth + 12; // Breite/Höhe + 10px Rand + 2px Border
      const insetH = insetEl.offsetHeight + 12;
      const nebenInset = { // Streifen links/rechts freihalten
        paddingTopLeft: [stationWest ? 15 : insetB, 15],
        paddingBottomRight: [stationWest ? insetB : 15, 15],
      };
      const ueberInset = { // Streifen oben/unten freihalten
        paddingTopLeft: [15, stationSouth ? 15 : insetH],
        paddingBottomRight: [15, stationSouth ? insetH : 15],
      };
      const zoomNeben = map.getBoundsZoom(combined, false, L.point(15 + insetB, 30));
      const zoomUeber = map.getBoundsZoom(combined, false, L.point(30, 15 + insetH));
      map.fitBounds(combined, zoomNeben >= zoomUeber ? nebenInset : ueberInset);
    } else {
      map.fitBounds(combined, { padding: [15, 15] });
    }
  }
}

function create_inset_map(lat, lng) {
  destroy_inset_map();
  const el = document.getElementById("map-inset");
  if (!el) return;
  el.classList.remove("d-none");
  insetMap = L.map("map-inset", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
  }).setView([lat, lng], 17);
  AddMapLayer(insetMap);
  L.marker(new L.LatLng(lat, lng), { icon: redIcon }).addTo(insetMap);
}

function destroy_inset_map() {
  if (insetMap) {
    insetMap.remove();
    insetMap = null;
  }
  const el = document.getElementById("map-inset");
  if (el) el.classList.add("d-none");
}
