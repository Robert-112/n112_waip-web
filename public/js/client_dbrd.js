
$(document).ready(function() {
  // Sound nicht beim laden der Seite abspielen
  var audio = document.getElementById('audio');
  audio.src = ('/media/bell_message.mp3');
  audio.volume = 0.0;
  setTimeout(function () {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 1.0;
  }, 1000);
});


/* ########################### */
/* ######### LEAFLET ######### */
/* ########################### */

// Karte definieren
var map = L.map('map', {
  zoomControl: false,
  attributionControl: false
}).setView([51.733005, 14.338048], 13);

// Layer der Karte
mapLink = L.tileLayer(
  map_tile, {
    maxZoom: 18
  }).addTo(map);

// Icon der Karte zuordnen
var redIcon = new L.Icon({
  iconUrl: '/media/marker-icon-2x-red.png',
  shadowUrl: '/media/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Icon setzen
var marker = L.marker(new L.LatLng(0, 0), {
  icon: redIcon
}).addTo(map);

// GeoJSON vordefinieren
var geojson = L.geoJSON().addTo(map);


/* ########################### */
/* ####### Rückmeldung ####### */
/* ########################### */

var counter_rmld = [];

var counter_ID = 0;

function start_counter(zeitstempel, ablaufzeit) {
  // Split timestamp into [ Y, M, D, h, m, s ]
  var t1 = zeitstempel.split(/[- :]/),
    t2 = ablaufzeit.split(/[- :]/);

  var start = new Date(t1[0], t1[1] - 1, t1[2], t1[3], t1[4], t1[5]),
    end = new Date(t2[0], t2[1] - 1, t2[2], t2[3], t2[4], t2[5]);

  clearInterval(counter_ID);
  counter_ID = setInterval(function () {
    do_progressbar(start, end);
  }, 1000);
};

function reset_rmld(p_uuid) {
  var bar_uuid = 'bar-' + p_uuid;
  $('#pg-ek').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
  $('#pg-gf').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
  $('#pg-zf').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
  $('#pg-vf').children().each(function (i) {
    if (!$(this).hasClass(bar_uuid)) {
      $(this).remove();
    };
  });
};

function add_resp_progressbar(p_uuid, p_id, p_type, p_content, p_agt, p_fzf, p_ma, p_med, p_start, p_end) {
  // Hintergrund der Progressbar festlegen
  var bar_background = '';
  var bar_border = '';
  if (p_agt == 1) {
    bar_border = 'border border-warning';
  };
  switch (p_type) {
    case 'ek':
      bar_background = 'bg-success';
      break;
    case 'gf':
      bar_background = 'bg-info';
      break;
    case 'zf':
      bar_background = 'bg-light';
      break;
    case 'vf':
      bar_background = 'bg-danger';
      break;
    default:
      bar_background = '';
      break;
  };
  var bar_uuid = 'bar-' + p_uuid;
  // pruefen ob div mit id 'pg-'+p_id schon vorhanden ist
  var pgbar = document.getElementById('pg-' + p_id);
  if (!pgbar) {
    // col-4 hinzufügen mit id
    $('#pg-container').append('<div class="col-xl-4 col-6 pg-' + p_type+ '" id="pg-' + p_id + '"></div>');
    // Progressbar hinzufügen mit id
    $('#pg-' + p_id).append('<div class="progress mt-1 position-relative ' + bar_border + ' ' + bar_uuid + '" id="pg-' + p_type + '-' + p_id + '" style="height: 15px; font-size: 14px;"></div>');
    // wenn p_agt > 0 ist, dann als Klasse p_agt hinterlegen
    if (p_agt > 0) {
      $('#pg-' + p_id).addClass('p_agt');
    };
    // wenn p_fzf > 0 ist, dann als Klasse p_fzf hinterlegen
    if (p_fzf > 0) {  
      $('#pg-' + p_id).addClass('p_fzf');
    };
    // wenn p_ma > 0 ist, dann als Klasse p_ma hinterlegen
    if (p_ma > 0) {
      $('#pg-' + p_id).addClass('p_ma');
    };
    // wenn p_med > 0 ist, dann als Klasse p_med hinterlegen
    if (p_med > 0) {
      $('#pg-' + p_id).addClass('p_med');
    };
    //$('#pg-' + p_type + '-' + p_id ).append('<div id="pg-bar-' + p_id + '" class="progress-bar progress-bar-striped ' + bar_background + '" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>');
    //$('#pg-bar-' + p_id).append('<small id="pg-text-' + p_id + '" class="w-100"></small>');
    $('#pg-' + p_type + '-' + p_id ).append('<div id="pg-bar-' + p_id + '" class="progress-bar progress-bar-striped ' + bar_background + '" role="progressbar" style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>');
    $('#pg-' + p_type + '-' + p_id ).append('<div id="pg-text-' + p_id + '" class="justify-content-center align-items-center d-flex position-absolute h-100 w-100"></div>');
  } else {
    // TODO PG-Bar ändern falls neue/angepasste Rückmeldung
  };
  // Zeitschiene Anpassen
  clearInterval(counter_rmld[p_id]);
  counter_rmld[p_id] = 0;
  counter_rmld[p_id] = setInterval(function () {
    do_rmld_bar(p_id, p_start, p_end, p_content, p_agt, p_fzf, p_ma, p_med);
  }, 1000);
};

function do_rmld_bar(p_id, start, end, content, agt, fzf, ma, med) {
  //console.log(p_id);
  today = new Date();
  // restliche Zeit ermitteln
  var current_progress = Math.round(100 / (start.getTime() - end.getTime()) * (start.getTime() - today.getTime()));

  var diff = Math.abs(end - today);
  var minutesDifference = Math.floor(diff / 1000 / 60);
  diff -= minutesDifference * 1000 * 60;
  var secondsDifference = Math.floor(diff / 1000);
  if (secondsDifference <= 9) {
    secondsDifference = '0' + secondsDifference;
  };

  if (content) {
    var pg_text_done = ' ' + content;
    var pg_text_time = minutesDifference + ':' + secondsDifference + ' - ' + content;
  } else {
    var pg_text_done = '';
    var pg_text_time = minutesDifference + ':' + secondsDifference;
  };
  if (agt > 0) {
    pg_text_done += ' AGT';
  };
  if (fzf > 0) {
    pg_text_done += ' FZF';
  };
  if (ma > 0) {
    pg_text_done += ' MA';
  };
  if (med > 0) {
    pg_text_done += ' MED';
  };

  // Progressbar anpassen
  if (current_progress >= 100) {
    $('#pg-bar-' + p_id)
      .css('width', '100%')
      .attr('aria-valuenow', 100)
    $('#pg-text-' + p_id).text(pg_text_done)
      .addClass('ion-md-checkmark-circle');
    // FIXME Counter_Id not defined
    clearInterval(counter_ID[p_id]);
  } else {
    $('#pg-bar-' + p_id)
      .css('width', current_progress + '%')
      .attr('aria-valuenow', current_progress);
    $('#pg-text-' + p_id).text(pg_text_time);
  };
};

function recount_rmld(p_uuid) {
  let bar_uuid = 'bar-' + p_uuid;
  // Zähler auf 0 Setzen
  $('#ek-counter').text(0);
  $('#gf-counter').text(0);
  $('#zf-counter').text(0);
  $('#vf-counter').text(0);
  $('#agt-counter').text(0);
  $('#ma-counter').text(0);
  $('#fzf-counter').text(0);
  $('#med-counter').text(0);

  $('#gs-counter').text($('.pg-').length + $('.pg-ek').length + $('.pg-gf').length + $('.pg-zf').length + $('.pg-vf').length);

  $('#ek-counter').text($('.pg-ek').length);
  $('#gf-counter').text($('.pg-gf').length);
  $('#zf-counter').text($('.pg-zf').length);
  $('#vf-counter').text($('.pg-vf').length);

  /*$('.pg-ek').children().each(function (i) {
    if ($(this).hasClass(progress-bar)) {
      const tmp_count = parseInt($('#ek-counter').text());
      $('#ek-counter').text(tmp_count + 1);
    };
  });  
  // GF zählen
  $('#pg-gf').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      const tmp_count = parseInt($('#gf-counter').text());
      $('#gf-counter').text(tmp_count + 1);
    };
  });
  // ZF zählen
  $('#pg-zf').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      const tmp_count = parseInt($('#zf-counter').text());
      $('#zf-counter').text(tmp_count + 1);
    };
  });
  // VF zählen
  $('#pg-vf').children().each(function (i) {
    if ($(this).hasClass(bar_uuid)) {
      const tmp_count = parseInt($('#vf-counter').text());
      $('#vf-counter').text(tmp_count + 1);
    };
  });*/
  // zähle all Elemente mit der class p_agt und dem wert 1
  console.log($('.p_agt').length);

  $('#agt-counter').text($('.p_agt').length);
  $('#ma-counter').text($('.p_ma').length);
  $('#fzf-counter').text($('.p_fzf').length);
  $('#med-counter').text($('.p_med').length);
  


  // Rückmeldecontainer anzeigen/ausblenden
  if ($('#ek-counter').text() == '0 EK' && $('#gf-counter').text() == '0 GF' && $('#zf-counter').text() == '0 ZF' && $('#vf-counter').text() == '0 VF') {
    $('#rmld_container').addClass('d-none');
  } else {
    $('#rmld_container').removeClass('d-none');
  };
};
  
  

/* ########################### */
/* ####### Timeline ######## */
/* ########################### */

    // DOM element where the Timeline will be attached
    var container = document.getElementById('visualization');
    var items = new vis.DataSet();
    var groups = new vis.DataSet();

    // Configuration for the Timeline
    var customDate = new Date();
    var alert_start = new Date(customDate.setMinutes(customDate.getMinutes() - 3));
    var timeline_end = new Date(customDate.setMinutes(customDate.getMinutes() + 15));
    var options = {
      rollingMode: {
        follow: true,
        offset: 0.25
      },
      type: 'point',
      locale: 'de',
      start: alert_start,
      end: timeline_end
    };

    // Create a Timeline
    var timeline = new vis.Timeline(container, items, options);
    timeline.setGroups(groups);

    // Button für Timeline-Ansicht auf alle Einträge
    document.getElementById('fit_timeline').onclick = function() {
      timeline.toggleRollingMode();
      timeline.setWindow(timeline.getItemRange().min, timeline.getItemRange().max, {animation: false});
      timeline.fit();
    };
 
/* ########################### */
/* ######## SOCKET.IO ######## */
/* ########################### */

// Websocket
var socket = io('/dbrd', {
  withCredentials: true
});

// Wachen-ID bei Connect an Server senden
socket.on('connect', function () {
  socket.emit('dbrd', dbrd_uuid);
  $('#waipModal').modal('hide');
  // TODO: bei Reconnect des Clients durch Verbindungsabbruch, erneut Daten anfordern
});

socket.on('connect_error', function (err) {
  $('#waipModalTitle').text('FEHLER');
  $('#waipModalBody').tex('Verbindung zum Server getrennt!');
  $('#waipModal').modal('show');
});

// ID von Server und Client vergleichen, falls ungleich -> Seite neu laden
socket.on('io.version', function (server_id) {
  if (client_id != server_id) {
    $('#waipModal').modal('hide');
    setTimeout(function () {
      $('#waipModalTitle').html('ACHTUNG');
      $('#waipModalBody').html('Neue Server-Version. Seite wird in 10 Sekunden neu geladen!');
      $('#waipModal').modal('show');
      setTimeout(function () {
        location.reload();
      }, Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000);
    }, 1000);
  };
});

// ggf. Fehler ausgeben
socket.on('io.error', function (data) {
  console.log('Error:', data);
});

// Daten löschen, Uhr anzeigen
socket.on('io.deleted', function (data) {
	console.log('del')
  // Einsatz nicht mehr vorhanden
  $('#waipModal').modal('hide');
  setTimeout(function () {
    $('#waipModalTitle').html('ACHTUNG');
    $('#waipModalBody').html(`Der aufgerufene Einsatz wurde gel&ouml;scht und ist in diesem System nicht mehr verfügbar.<br>
    Sie werden in einer Minute auf die Startseite zurückgeleitet.`);
    $('#waipModal').modal('show');
    setTimeout(function () {
      window.location.href = window.location.origin;
    }, 60000);
  }, 1000);
});

// Einsatzdaten laden, Wachalarm anzeigen
socket.on('io.Einsatz', function (data) {
  // DEBUG
  console.log(data);
  // Einsatz-ID speichern
  waip_id = data.id;
  // DBRD-ID und Zeit setzten
  $('#dbrd_id').html(data.uuid);
  $('#einsatz_datum').html(data.zeitstempel);
  
  // Hintergrund der Einsatzart zunächst entfernen
  $('#einsatz_art').removeClass(function (index, className) {
    return (className.match(/(^|\s)bg-\S+/g) || []).join(' ');
  });
  // Icon der Einsatzart enfernen
  $('#einsatz_stichwort').removeClass();
  // Art und Stichwort festlegen hinterlegen
  switch (data.einsatzart) {
    case 'Brandeinsatz':
      $('#einsatz_art').addClass('bg-danger');
      $('#einsatz_stichwort').addClass('ion-md-flame');
      $('#rueckmeldung').removeClass('d-none');
      break;
    case 'Hilfeleistungseinsatz':
      $('#einsatz_art').addClass('bg-info');
      $('#einsatz_stichwort').addClass('ion-md-construct');
      $('#rueckmeldung').removeClass('d-none');
      break;
    case 'Rettungseinsatz':
      $('#einsatz_art').addClass('bg-warning');
      $('#einsatz_stichwort').addClass('ion-md-medkit');
      break;
    case 'Krankentransport':
      $('#einsatz_art').addClass('bg-success');
      $('#einsatz_stichwort').addClass('ion-md-medical');
      break;
    default:
      $('#einsatz_art').addClass('bg-secondary');
      $('#einsatz_stichwort').addClass('ion-md-information-circle');
  };
  $('#einsatz_stichwort').html(' ' + data.stichwort);
  // Sondersignal setzen
  $('#sondersignal').removeClass();
  switch (data.sondersignal) {
    case 1:
      $('#sondersignal').addClass('ion-md-notifications');
      break;
    default:
      $('#sondersignal').addClass('ion-md-notifications-off');
  };
  // Ortsdaten zusammenstellen und setzen
  $('#einsatzort_list').empty();
  if (data.objekt) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.objekt+ '</li>');
  };
  if (data.ort) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.ort+ '</li>');
  };
  if (data.ortsteil) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.ortsteil+ '</li>');
  };
  if (data.strasse) {
    $('#einsatzort_list').append('<li class="list-group-item">' + data.strasse+ '</li>');
  };
  if (data.besonderheiten) {
    $('#einsatzort_list').append('<li class="list-group-item text-warning">' + data.besonderheiten+ '</li>');
  };
  // Alte Einsatzmittel loeschen
  var table_em = document.getElementById('table_einsatzmittel');
  table_em.getElementsByTagName('tbody')[0].innerHTML = '';
  // Einsatzmittel-Tabelle
  for (var i in data.einsatzmittel) {

    var wache_vorhanden = false;
    var wache_zeile = 0;
    var wachen_idstr =data.einsatzmittel[i].em_station_name.replace(/[^A-Z0-9]+/ig, '_');
    for (var j = 0, row; row = table_em.rows[j]; j++) {
      //console.log(row.cells[0].innerHTML);
      if (row.cells[0].innerHTML == data.einsatzmittel[i].em_station_name) {
        wache_vorhanden = true;
        wache_zeile = j;
      };
    };
    if (!wache_vorhanden){
      // Zeile fuer Wache anlegen, falls diese noch nicht hinterlegt
      var tableRef = document.getElementById('table_einsatzmittel').getElementsByTagName('tbody')[0];
      var newRow = tableRef.insertRow();

      //var newCell = newRow.insertCell(0);
      // Wachennamen hinterlegen
      var new_th = document.createElement('th');
      new_th.innerHTML = data.einsatzmittel[i].em_station_name;
      //var newText = document.createTextNode(data.einsatzmittel[i].wachenname);
      //newCell.outerHTML = "<th></th>";
      //newCell.appendChild(newText);
      newRow.appendChild(new_th);

      //Flex-Element fuer Einsatzmittel der Wache erzeugen
    var flex_div_wa = document.createElement('div');
    flex_div_wa.className = 'd-flex flex-wrap justify-content-between align-items-center';
    flex_div_wa.id = wachen_idstr;

    //Flexelement zur Tabelle hinzuefuegen
    var new_td = document.createElement('td');
    new_td.appendChild(flex_div_wa);
    newRow.appendChild(new_td);
    //table_em.rows[wache_zeile].cells[1].appendChild(flex_div_wa);
    };
    
    //Flex-Element fuer Einsatzmittel erzeugen
    var flex_div_em = document.createElement('div');
    flex_div_em.className = 'flex-fill rounded bg-secondary text-nowrap p-2 m-1';

    //Justify-Rahmen feuer Einsatzmittel erzeugen
    var justify_div = document.createElement('div');
    justify_div.className = 'd-flex justify-content-between';

    //Einsatzmittel-Div erzeugen
    var em_div  = document.createElement('div');
    em_div.className = 'pr-2';
    em_div.innerHTML = data.einsatzmittel[i].em_funkrufname;
    
    //Status-Div erzeugen
    var status_div  = document.createElement('div');
    switch (data.einsatzmittel[i].em_fmsstatus) {
      case '1':
        status_div.className = 'p-2 badge badge-info';
        break;
      case '2':
        status_div.className = 'p-2 badge badge-success';
        break;
      case '3':
        status_div.className = 'p-2 badge badge-warning';
        break;
      case '4':
        status_div.className = 'p-2 badge badge-danger';
        break;
      default:
        status_div.className = 'p-2 badge badge-dark';
        break;
    }

    status_div.innerHTML = data.einsatzmittel[i].em_fmsstatus;

    //Erzeugte Div zusammensetzen
    flex_div_em.appendChild(justify_div);
    justify_div.appendChild(em_div);
    justify_div.appendChild(status_div);

    // Einsatzmittel hinzuefuegen
    document.getElementById(wachen_idstr).appendChild(flex_div_em);
  
  };
  // Karte leeren
  map.removeLayer(marker);
  map.removeLayer(geojson);
  // Karte setzen
  if (data.wgs84_x && data.wgs84_y) {
    marker = L.marker(new L.LatLng(data.wgs84_x, data.wgs84_y), {
      icon: redIcon
    }).addTo(map);
    map.setView(new L.LatLng(data.wgs84_x, data.wgs84_y), 15);
  } else {
    geojson = L.geoJSON(JSON.parse(data.geometry));
    geojson.addTo(map);
    map.fitBounds(geojson.getBounds());
    map.setZoom(13);
  };
  // Marker in Timeline setzen
  var markerText = 'Alarmierung';
  var alarm_zeit = 'alarm_zeit';  
    timeline.addCustomTime(
      data.zeitstempel,
      alarm_zeit
    );
    timeline.customTimes[timeline.customTimes.length - 1].hammer.off("panstart panmove panend");
    timeline.setCustomTimeMarker(markerText, alarm_zeit, false);

  // TODO Ablaufzeit setzen
});

socket.on('io.new_rmld', function (data) {
  // DEBUG
  console.log('neue Rückmeldung:',data);
  // FIXME  Änderung des Funktions-Typ berücksichtigen
  // Neue Rueckmeldung hinterlegen

    // HTML festlegen
    var item_type = '';
    var item_content = '';
    var item_classname = '';
    // wenn Einsatzkraft dann:
    if (data.rmld_role == 'team_member') {
      // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Einsatzkraft'
      if (data.rmld_alias) {
        item_content = data.rmld_alias;
      } else {
        item_content = 'Einsatzkraft';
      };
      item_classname = 'ek';
      item_type = 'ek';
    };
    // wenn Maschinist dann:
    if (data.rmld_role == 'crew_leader') {
      // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Gruppenführer'
      if (data.rmld_alias) {
        item_content = data.rmld_alias;
      } else {
        item_content = 'Gruppenführer';
      };
      item_classname = 'gf';
      item_type = 'gf';
    };
    // wenn Maschinist dann:
    if (data.rmld_role == 'division_chief') {
      // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Zugführer'
      if (data.rmld_alias) {
        item_content = data.rmld_alias;
      } else {
        item_content = 'Zugführer';
      };
      item_classname = 'zf';
      item_type = 'zf';
    };    
    // wenn Maschinist dann:
    if (data.rmld_role == 'group_commander') {
      // wenn data.rmld_alias nicht leer ist, dann data.rmld_alias, sonst 'Verbandsführer'
      if (data.rmld_alias) {
        item_content = data.rmld_alias;
      } else {
        item_content = 'Verbandsführer';
      };
      item_classname = 'vf';
      item_type = 'vf';
    };

    if (data.rmld_capability_agt > 0) {
      item_content += ' AGT';
    };
    if (data.rmld_capability_fzf > 0) {
      item_content += ' FZF';
    };
    if (data.rmld_capability_ma > 0) {
      item_content += ' MA';
    };
    if (data.rmld_capability_med > 0) {
      item_content += ' MED';
    };

    // Variablen für Anzeige vorbereiten
    var pg_waip_uuid = data.waip_uuid;
    var pg_rmld_uuid = data.rmld_uuid;
    var pg_start = new Date(data.time_decision);
    var pg_end = new Date(data.time_arrival);
    var timeline_item = {
      id: data.rmld_uuid,
      group: data.wache_id,
      className: item_classname,
      start: new Date(data.time_decision),
      /*end: new Date(data.time_arrival),*/
      content: item_content
    };
    // Progressbar hinterlegen
    add_resp_progressbar(data.waip_uuid, data.rmld_uuid, item_type, data.rmld_alias, data.rmld_capability_agt, data.rmld_capability_fzf, data.rmld_capability_ma, data.rmld_capability_med, pg_start, pg_end);
    // in Timeline hinterlegen
    items.update(timeline_item);
    groups.update({ id: data.wache_id, content: data.wache_name });
    // Anzahl der Rückmeldung zählen
    recount_rmld(pg_waip_uuid);

  var audio = document.getElementById('audio');
  audio.src = ('/media/bell_message.mp3');
  // Audio-Blockade des Browsers erkennen
  var playPromise = document.querySelector('audio').play();
  if (playPromise !== undefined) {
    playPromise.then(function () {
      audio.play();
    }).catch(function (error) {
      console.log('Notification playback failed'); 
    });
  };
});
