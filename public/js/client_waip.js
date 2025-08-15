// TODO: Remote-Reload per Socket

$(document).ready(function () {
  set_clock();
  updateWachennameAnimation();
  startRandomPositioning();
});

$(window).on("resize", function () {
  resize_text();
  updateWachennameAnimation();
  updateRandomPosition();
});

// Funktion zum Hinzufügen und Testen eines WMS-Layers
function AddMapLayer() {
  let maxMapZoom = 18; // Standard-Zoomstufe

  // Layer der Karte basierend auf dem Typ des Kartendienstes hinzufuegen
  if (map_service.type === "tile") {
    // Tile-Map hinzufuegen
    L.tileLayer(map_service.tile_url, {
      maxZoom: maxMapZoom,
    }).addTo(map);
  } else if (map_service.type === "wms") {
    // WMS-Map hinzufuegen
    var wmsLayer = L.tileLayer.wms(map_service.wms_url, {
      layers: map_service.wms_layers,
      format: map_service.wms_format,
      transparent: map_service.wms_transparent,
      version: map_service.wms_version,
    });

    // Fehlerbehandlung: Wenn der WMS-Layer nicht geladen werden kann, dann versuche den Tile-Layer
    wmsLayer.on("tileerror", function () {
      console.warn("WMS-Layer konnte nicht geladen werden, versuche Tile-Layer:", map_service.tile_url);
      // Tile-Map hinufuegen
      L.tileLayer(map_service.tile_url, {
        maxZoom: maxMapZoom,
      }).addTo(map);
    });

    wmsLayer.addTo(map);
  }
}

/* ############################ */
/* ######### BUTTONS ########## */
/* ############################ */

let waipAudio = document.getElementById("audio");
// Flag für laufendes TTS
let ttsActive = false;
let lastTTSSrc = null;

// Autoplay-Blockade anzeigen (Blinken des Volume-Off Icons)
function indicateAudioBlocked() {
  try {
    let icon = document.querySelector(".ion-md-volume-off") || document.querySelector(".ion-md-volume-high");
    if (!icon) return;
    if (icon.classList.contains("ion-md-volume-high")) {
      icon.classList.remove("ion-md-volume-high");
      icon.classList.add("ion-md-volume-off");
    }
    if (!document.getElementById("audio-blocked-style")) {
      const style = document.createElement("style");
      style.id = "audio-blocked-style";
      style.textContent = ".blink-audio{animation:blink-audio 1s linear infinite}@keyframes blink-audio{0%,50%{opacity:1}25%,75%{opacity:.2}}";
      document.head.appendChild(style);
    }
    icon.classList.add("blink-audio");
  } catch (e) {
    console.log("indicateAudioBlocked error", e);
  }
}

function resetAudioUi() {
  let tmp_element;
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".ion-md-pause");
  if (tmp_element && tmp_element.classList.contains("ion-md-pause")) {
    tmp_element.classList.remove("ion-md-pause");
    tmp_element.classList.add("ion-md-play-circle");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".ion-md-volume-high");
  if (tmp_element && tmp_element.classList.contains("ion-md-volume-high")) {
    tmp_element.classList.remove("ion-md-volume-high");
    tmp_element.classList.add("ion-md-volume-off");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
}

waipAudio.addEventListener("ended", function () {
  console.log("ended");
  resetAudioUi();
  // TTS-Flag zurücksetzen
  if (lastTTSSrc && waipAudio.src.indexOf("bell_message.mp3") === -1) {
    ttsActive = false;
    lastTTSSrc = null;
  }
});

// Neuer Pause-Handler (nutzerinitiiert)
waipAudio.addEventListener("pause", function () {
  // Wenn wirklich pausiert (nicht direkt nach play), UI anpassen
  if (waipAudio.paused) {
    resetAudioUi();
    if (ttsActive) {
      ttsActive = false;
      lastTTSSrc = null;
    }
  }
});

waipAudio.addEventListener("play", function () {
  let tmp_element;
  // Beim erfolgreichen Start Blinken entfernen
  const blinkIcon = document.querySelector(".blink-audio");
  if (blinkIcon) blinkIcon.classList.remove("blink-audio");
  // Pause-Symbol in Play-Symbol
  tmp_element = document.querySelector(".ion-md-play-circle");
  if (tmp_element && tmp_element.classList.contains("ion-md-play-circle")) {
    tmp_element.classList.remove("ion-md-play-circle");
    tmp_element.classList.add("ion-md-pause");
  }
  // Lautsprecher-Symbol in Leise-Symbol
  tmp_element = document.querySelector(".ion-md-volume-off");
  if (tmp_element && tmp_element.classList.contains("ion-md-volume-off")) {
    tmp_element.classList.remove("ion-md-volume-off");
    tmp_element.classList.add("ion-md-volume-high");
  }
  // Button Hintergrund entfernen, falls vorhanden
  tmp_element = document.querySelector("#volume");
  if (tmp_element && tmp_element.classList.contains("btn-danger")) {
    tmp_element.classList.remove("btn-danger");
  }
});

// Play/Pause Steuerung: Button mit ID #playpause oder direkt Icon mit Klasse .ion-md-pause
$(document).on("click", "#playpause, .ion-md-pause", function (e) {
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
  waipAudio.play();
});

/* ############################ */
/* ####### TEXT-RESIZE ######## */
/* ############################ */

// Größen dynamisch anpassen, Hintergrundfarbe ggf. anpassen
function resize_text() {
  // Hintergrund im Standby schwarz setzen
  if ($("#waipclock").is(":visible")) {
    $("body").css("background-color", "#000");
  }
  // Uhr-Text nur Anpassen wenn sichtbar
  if ($("#clock_day").is(":visible")) {
    textFit(document.getElementsByClassName("clock_frame"), {
      minFontSize: 4,
      maxFontSize: 500,
    });
    textFit(document.getElementsByClassName("day_frame"), {
      minFontSize: 3,
      maxFontSize: 500,
    });
  }
  // Tableau nur Anpassen wenn sichtbar
  if ($("#waiptableau").is(":visible")) {
    textFit(document.getElementsByClassName("tf_singleline"), {
      minFontSize: 3,
      maxFontSize: 700,
    });
    textFit(document.getElementsByClassName("tf_multiline"), {
      minFontSize: 3,
      maxFontSize: 500,
      multiLine: true,
      reProcess: true,
    });
    // Karte neu setzen
    map.invalidateSize();
    $("body").css("background-color", "#222");
    // Anpassung der Schriftgröße aller Divs mit der Klasse "cl_em_alarmiert"
    textFit(document.getElementsByClassName("cl_em_alarmiert"), { minFontSize: 4, maxFontSize: 500 });
  }
}

// Text nach bestimmter Laenge, in Abhaengigkeit von Zeichen, umbrechen
function break_text_20(text) {
  var new_text;
  new_text = text.replace(/.{20}(\s+|\-+)+/g, "$&@");
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

// bei Inaktivitaet Header/Footer ausblenden
function do_on_Inactive() {
  // do something
  $(".navbar").fadeOut("slow");
  $(".footer").fadeOut("slow");
  $(".fullheight").css({
    height: "calc(100vh - 3rem)",
    cursor: "none",
  });
  $("body").css({
    paddingTop: "1rem",
    margin: 0,
  });
  resize_text();
}

// bei Activitaet Header/Footer einblenden
function do_on_Active() {
  start_inactivtimer();
  // do something
  $(".navbar").fadeIn("slow");
  $(".footer").fadeIn("slow");
  $("body").css({
    marginBottom: "60px",
    paddingTop: "5rem",
    paddingBottom: "0",
  });
  $(".fullheight").css({
    height: "calc(100vh - 60px - 5rem)",
    cursor: "auto",
  });
  resize_text();
}

// bei Event (Aktiviaet) alles zuruecksetzen
function resetActivTimer(e) {
  do_on_Active();
}

/* ############################ */
/* ####### Progressbar ####### */
/* ############################ */

let counter_ID = 0;

function start_counter(zeitstempel, ablaufzeit) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  let t1 = zeitstempel.split(/[- :]/),
    t2 = ablaufzeit.split(/[- :]/);

  let start = new Date(t1[0], t1[1] - 1, t1[2], t1[3], t1[4], t1[5]),
    end = new Date(t2[0], t2[1] - 1, t2[2], t2[3], t2[4], t2[5]);

  clearInterval(counter_ID);
  counter_ID = setInterval(function () {
    do_progressbar(start, end);
  }, 1000);
}

function do_progressbar(start, end) {
  today = new Date();
  // restliche Zeit ermitteln
  let current_progress = Math.round((100 / (end.getTime() - start.getTime())) * (end.getTime() - today.getTime()));

  let diff = Math.abs(end - today);
  let minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  let secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = "0" + secondsDifference;
  }
  let minutes = minutesDifference + ":" + secondsDifference;
  // Progressbar anpassen
  $("#standbytimer-bar")
    .css("width", current_progress + "%")
    .attr("aria-valuenow", current_progress);
  $("#standbytimer-text").text(minutes + " min");
}

/* ########################### */
/* ######### LEAFLET ######### */
/* ########################### */

// Karte definieren
let map = L.map("map", {
  zoomControl: false,
  attributionControl: false,
}).setView([51.733005, 14.338048], 13);

AddMapLayer();

// Icon der Karte zuordnen
// Markergröße dynamisch für 4K anpassen (4K jetzt nochmals größer)
let is4K = window.innerWidth >= 3840 && window.innerHeight >= 2160;
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
}).addTo(map);

// GeoJSON vordefinieren
let geojson = L.geoJSON().addTo(map);

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
});

socket.on("connect_error", function (err) {
  $("#waipModalTitle").text("FEHLER");
  $("#waipModalBody").text("Verbindung zum Server getrennt!");
  $("#waipModal").modal("show");
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
        //$('.ion-md-volume-high').toggleClass('ion-md-pause');
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
        tmp_element = document.querySelector(".ion-md-volume-high");
        if (tmp_element && tmp_element.classList.contains("ion-md-volume-high")) {
          tmp_element.classList.remove("ion-md-volume-high");
          tmp_element.classList.add("ion-md-volume-off");
        }
        indicateAudioBlocked();
      });
  }
});

// Daten löschen, Uhr anzeigen
socket.on("io.standby", function (data) {
  console.log("Standby", data);
  // Einsatz-ID auf 0 setzen
  waip_id = null;

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
  reset_rmld();
  recount_rmld();
  map.setView(new L.LatLng(0, 0), 14);
  // Tareset_responsebleau ausblenden
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
    resize_text();
    updateWachennameAnimation();
    updateRandomPosition();
  }, 200);
});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on("io.new_waip", function (data) {
  // DEBUG
  console.log("Neuer Einsatz:", data);
  // Einsatz-ID speichern
  waip_id = data.id;
  // Alarmzeitsetzen setzen, das format "YYYY-MM-DD HH:MM:SS" soll in "YYYY-MM-DD" & "HH:MM" umgewandelt werden
  let alarmzeit = data.zeitstempel.split(" ");
  //$("#alert_date").text("\xA0" + alarmzeit[0]);
  $("#alert_time").text("\xA0" + alarmzeit[1]);
  // Einsatznummer setzen, falls vorhanden
  if (data.einsatznummer) {
    $("#einsatznummer").text("\xA0" + data.einsatznummer);
  } else {
    // div fuer Einsatznummer entfernen
    $("#einsatznummer").remove();
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
      $("#einsatz_stichwort").addClass("ion-md-flame");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Hilfeleistungseinsatz":
      $("#einsatz_art").addClass("bg-info");
      $("#einsatz_stichwort").addClass("ion-md-construct");
      $("#rueckmeldung").removeClass("d-none");
      break;
    case "Rettungseinsatz":
      $("#einsatz_art").addClass("bg-warning");
      $("#einsatz_stichwort").addClass("ion-md-medkit");
      break;
    case "Krankentransport":
      $("#einsatz_art").addClass("bg-success");
      $("#einsatz_stichwort").addClass("ion-md-medical");
      break;
    default:
      $("#einsatz_art").addClass("bg-secondary");
      $("#einsatz_stichwort").addClass("ion-md-information-circle");
  }
  $("#einsatz_stichwort").text(" " + data.stichwort);
  // Sondersignal setzen
  $("#sondersignal").removeClass();
  switch (data.sondersignal) {
    case 1:
      $("#sondersignal").addClass("ion-md-notifications");
      break;
    default:
      $("#sondersignal").addClass("ion-md-notifications-off");
  }
  // Ortsdaten zusammenstellen und setzen
  let small_ortsdaten;
  small_ortsdaten = "";
  // Teilbjekt anfuegen
  if (data.objektteil) {
    small_ortsdaten = small_ortsdaten + break_text_20(data.objektteil) + "<br />";
  }
  // Objekt anfuegen
  if (data.objekt) {
    small_ortsdaten = small_ortsdaten + break_text_20(data.objekt);
    // ggf. weitere Einsatzdetails an Objekt anfügen, wenn Brand- oder Hilfeleistungseinsatz
    if (data.einsatzdetails && (data.einsatzart === "Brandeinsatz" || data.einsatzart === "Hilfeleistungseinsatz")) {
      small_ortsdaten = small_ortsdaten + " (" + data.einsatzdetails + ") ";
    }
    small_ortsdaten = small_ortsdaten + "<br />";
  }
  // Ort anfuegen
  if (data.ort) {
    small_ortsdaten = small_ortsdaten + break_text_20(data.ort) + "<br />";
  }
  // Ortsteil anfuegen, aber nur wenn nicht gleich Ort
  if (data.ortsteil) {
    // wenn Ortsteil gleich Ort, dann nicht anzeigen
    if (data.ortsteil !== data.ort) {
      small_ortsdaten = small_ortsdaten + break_text_20(data.ortsteil) + "<br />";
    }
  }
  // Strasse und Hausnummer anfuegen
  if (data.strasse) {
    // Hausnummer an Strasse anfuegen, falls vorhanden
    tmp_strasse = data.strasse;
    if (data.hausnummer) {
      tmp_strasse = data.strasse + "&nbsp;" + data.hausnummer;
    } else {
      tmp_strasse = data.strasse;
    }
    small_ortsdaten = small_ortsdaten + break_text_20(tmp_strasse) + "<br />";
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
    col_em_alarmiert = "col-6";
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

  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);
  // Zoomsstufe bei 4K anpassen
  let initialZoom = window.innerWidth >= 3840 && window.innerHeight >= 2160 ? 17 : 15;
  // Karte setzen
  if (data.wgs84_x && data.wgs84_y) {
    marker = L.marker(new L.LatLng(data.wgs84_x, data.wgs84_y), {
      icon: redIcon,
    }).addTo(map);
    map.setView(new L.LatLng(data.wgs84_x, data.wgs84_y), initialZoom);
  } else {
    geojson = L.geoJSON(JSON.parse(data.geometry));
    geojson.addTo(map);
    map.fitBounds(geojson.getBounds());
    map.setZoom(initialZoom);
  }

  // Ablaufzeit setzen
  start_counter(data.zeitstempel, data.ablaufzeit);
  // alte Rückmeldung entfernen
  reset_rmld();
  recount_rmld(data.uuid);
  // VIEW anpassen
  reset_view();
  // TODO: Einzeige vergrößern wenn Felder nicht angezeigt werden
  // Uhr ausblenden
  $("#waipclock").addClass("d-none");
  $("#waiptableau").removeClass("d-none");
  // Map neu zeichnen
  map.invalidateSize();
  //
  resize_text();
});

socket.on("io.new_rmld", function (data) {
  // DEBUG
  console.log("neue Rückmeldung:", data);
  // FIXME  Änderung des Funktions-Typ berücksichtigen
  // Neue Rueckmeldung hinterlegen
  // HTML festlegen
  var item_type = "";
  var item_content = "";
  var item_classname = "";
  // wenn Einsatzkraft dann:
  if (data.rmld_role == "team_member") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Einsatzkraft'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Einsatzkraft";
    }
    item_classname = "ek";
    item_type = "ek";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "crew_leader") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Gruppenführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Gruppenführer";
    }
    item_classname = "gf";
    item_type = "gf";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "division_chief") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Zugführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Zugführer";
    }
    item_classname = "zf";
    item_type = "zf";
  }
  // wenn Maschinist dann:
  if (data.rmld_role == "group_commander") {
    // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Verbandsführer'
    if (data.rmld_alias) {
      item_content = data.rmld_alias;
    } else {
      item_content = "Verbandsführer";
    }
    item_classname = "vf";
    item_type = "vf";
  }

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
    data.rmld_alias,
    data.rmld_capability_agt,
    data.rmld_capability_fzf,
    data.rmld_capability_ma,
    data.rmld_capability_med,
    pg_start,
    pg_end
  ); // Anzahl der Rückmeldung zählen

  recount_rmld(pg_waip_uuid);
  // View anpassen
  reset_view();
  // Textgröße der Rückmeldungen anpassen
  resize_text();

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

let counter_rmld = [];

function reset_rmld() {
  // alle Rückmeldungen zurücksetzen, indem alle Rückmeldungen mit der Klasse "pg-" + UUID gelöscht werden

  let arr_rmld_uuids = [];

  // Selektiere alle Elemente unterhalb von #container_rmld
  $("#rmld_progressbars")
    .children()
    .each(function () {
      console.log("Element:", $(this));
      // Überprüfe, ob die ID des Elements mit dem Regex übereinstimmt
      const regex = /^pg-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      const elementId = $(this).attr("id");
      if (regex.test(elementId)) {
        // UUID aus der ID extrahieren
        const uuid = elementId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)[0];
        // UUID zur Liste hinzufügen
        arr_rmld_uuids.push(uuid);
        console.log("Gefundene UUID:", uuid);
        // Element löschen
        $(this).remove();
      }
    });

  // timer löschen, dabei die Liste arr_rmld_uuids durchgehen
  for (let i = 0; i < arr_rmld_uuids.length; i++) {
    let p_id = arr_rmld_uuids[i];
    console.log("ID:", p_id);
    // timer löschen
    clearInterval(counter_rmld[p_id]);
  }
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
    $("#rmld_progressbars").append('<div class="col-sm-4 col-6 px-1 pg-' + p_type + '" id="pg-' + p_id + '"></div>');
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
        '" class="progress-bar progress-bar-striped ' +
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

  // Zeitschiene Anpassen
  clearInterval(counter_rmld[p_id]);
  counter_rmld[p_id] = 0;
  counter_rmld[p_id] = setInterval(function () {
    do_rmld_bar(p_id, p_start, p_end, p_content, p_agt, p_fzf, p_ma, p_med);
  }, 1000);
}

function do_rmld_bar(p_id, start, end, content, agt, fzf, ma, med) {
  //console.log(p_id);
  today = new Date();
  // restliche Zeit ermitteln
  let current_progress = Math.round((100 / (start.getTime() - end.getTime())) * (start.getTime() - today.getTime()));

  let diff = Math.abs(end - today);
  let minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  let secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = "0" + secondsDifference;
  }

  if (content) {
    var pg_text_done = " " + content;
    var pg_text_time = minutesDifference + ":" + secondsDifference + " - " + content;
  } else {
    var pg_text_done = "";
    var pg_text_time = minutesDifference + ":" + secondsDifference;
  }
  if (agt > 0) {
    pg_text_done += " AGT";
  }
  if (fzf > 0) {
    pg_text_done += " FZF";
  }
  if (ma > 0) {
    pg_text_done += " MA";
  }
  if (med > 0) {
    pg_text_done += " MED";
  }

  // Progressbar anpassen
  if (current_progress >= 100) {
    $("#pg-bar-" + p_id)
      .css("width", "100%")
      .attr("aria-valuenow", 100);
    $("#pg-text-" + p_id)
      .text(pg_text_done)
      .addClass("ion-md-checkmark-circle");
    clearInterval(counter_ID[p_id]);
  } else {
    $("#pg-bar-" + p_id)
      .css("width", current_progress + "%")
      .attr("aria-valuenow", current_progress)
      .text(pg_text_time);
  }
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

function reset_view() {
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
  console.log("rmld_on:", rmld_on);
  console.log("em_weitere_on:", em_weitere_on);
  console.log("besonderheiten_on:", besonderheiten_on);
  // VIEW anpassen
  // v1 - wenn Rückmeldungen, weitere Einsatzmittel und Besonderheiten vorhanden sind
  if (rmld_on && (!em_weitere_on || em_weitere_on) && besonderheiten_on) {
    console.log("v1");
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
    console.log("v2, v6");
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
    console.log("v3, v5");
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
    console.log("v4, v7");
    $("#container_rmld").removeClass("d-none");
    alterClass("#container_ortsdaten", "h-*", "h-55");
    alterClass("#container_ortsdaten", "col-*", "col-5");
    alterClass("#container_einsatzmittel", "h-*", "h-55");
    alterClass("#container_einsatzmittel", "col-*", "col-7");
    alterClass("#container_weitere", "h-*", "h-5");
    alterClass("#container_besonderheiten", "h-*", "h-5");
  }
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
  // nur erneuern wenn sich Zeit geändert hat
  if ($("#time").text() !== element_time) {
    // Uhrzeit anzeigen
    $("#time").text(element_time);
    // Datum (Text) anzeigen
    $("#day").text(element_day);
    resize_text();
  }
}

// Uhrzeit jede Sekunden anpassen
setInterval(set_clock, 1000);

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
  const clockDay = document.getElementById("clock_day");

  if (!screenSaver || !clockDay) return;

  // Dimensionen des Containers und des Elements
  const containerRect = screenSaver.getBoundingClientRect();
  const elementRect = clockDay.getBoundingClientRect();

  // Maximale Positionen berechnen (unter Berücksichtigung der Elementgröße)
  const maxX = containerRect.width - elementRect.width;
  const maxY = containerRect.height - elementRect.height;

  // Zufällige Position berechnen
  const randomX = Math.floor(Math.random() * maxX);
  const randomY = Math.floor(Math.random() * maxY);

  // Position setzen
  clockDay.style.position = "absolute";
  clockDay.style.left = `${randomX}px`;
  clockDay.style.top = `${randomY}px`;
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
