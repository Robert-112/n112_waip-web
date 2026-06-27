const e = require("express");

module.exports = (io, sql, fs, logger, app_cfg) => {
  const { tts_erstellen } = require("./tts.js")(fs, logger, sql, app_cfg);
  const waip_verteilen_socket = (einsatzdaten, socket, wachen_nr, reset_timestamp) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Lokale Kopie erstellen, damit das geteilte einsatzdaten-Objekt nicht durch
        // Berechtigungs-Stripping fuer andere Sockets im selben Raum veraendert wird.
        const data = { ...einsatzdaten };

        // Berechtigungen für den Einsatz, anhand der Wachen-Berechtigung ueberpruefen
        const permissions = await sql.db_user_check_permission_for_waip(socket, data.id);

        // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
        if (!permissions) {
          data.einsatznummer = "";
          data.objekt = "";
          data.objektteil = "";
          data.besonderheiten = "";
          data.strasse = "";
          data.hausnummer = "";
          data.einsatzdetails = "";
          data.wgs84_x = "";
          data.wgs84_y = "";
          // Flag setzen, dass Berechtigungen nicht ok sind
          data.permissions = false;
        } else {
          // Flag setzen, dass Berechtigungen ok sind
          data.permissions = true;
        }

        // Ablaufzeit zum Einsatz hinzufuegen, damit diese auf der Seite ausgewertet werden kann
        data.ablaufzeit = reset_timestamp;

        // pruefen ob Einsatz bereits genau so beim Client angezeigt wurde (Doppelalarmierung)
        const doppelalarm = await sql.db_einsatz_check_history(data, socket);

        if (doppelalarm) {
          // Log das Einsatz explizit nicht an Client gesendet wurde
          logger.log("waip", `Einsatz ${data.id} für Wache ${wachen_nr} nicht an Socket ${socket.id} gesendet, Doppelalarmierung.`);
          resolve(false);
        } else {
          // Einsatz-ID dem Socket zuweisen, fuer spaetere Abgleiche
          socket.data.waip_id = data.id;

          // Einsatzdaten an Client senden
          socket.emit("io.new_waip", data);
          logger.log("waip", `Einsatz ${data.id} für Wache ${wachen_nr} an ${socket.id} gesendet.`);

          // Client-Status mit Wachennummer aktualisieren
          sql.db_client_update_status(socket, data.id);

          // Sound erstellen und an Client senden
          const tts = await tts_erstellen(data, wachen_nr);
          if (tts) {
            // Sound-Link senden
            socket.emit("io.playtts", tts);
            logger.log("log", `ttsfile ${tts}`);
          }

          resolve(true);
        }
      } catch (error) {
        logger.log("error", `Fehler beim Verteilen der Waip-Einsatzdaten ${einsatzdaten.id} für einen Client ${socket.id}. ` + error);
        resolve(false);
      }
    });
  };

  const einsatz_verteilen_rooms = (waip_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // anhand der waip_id die beteiligten Wachennummern / Socket-Räume zum Einsatz ermitteln
        const socket_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);

        // waip_rooms muss größer 1 sein, da sonst nur der Standard-Raum '0' vorhanden ist
        if (socket_rooms.length == 1 && socket_rooms[0].room == "0") {
          // wenn kein Raum (keine Wache) ausser '0' zurueckgeliefert wird, dann Einsatz direkt wieder loeschen weil keine Wachen dazu hinterlegt
          logger.log("warn", `Keine Wache für den Einsatz mit der ID ${waip_id} vorhanden! Einsatz wird gelöscht!`);

          // FIXME db_einsatz_loeschen liefert die Anzahl der gelöschten Daten zurück, hier beachten
          sql.db_einsatz_loeschen(waip_id);
        } else {
          // Einsatzdaten an alle beteiligten Wachen (Websocket-Raum) verteilen
          for (const rooms of socket_rooms) {
            const wachen_nr = rooms.room;

            // Einsatzdaten passend pro Wache aus Datenbank laden
            const einsatzdaten = await sql.db_einsatz_get_for_wache(waip_id, wachen_nr);

            // alles Sockets der Wache ermitteln
            const sockets = await io.of("/waip").in(wachen_nr.toString()).fetchSockets();

            // an jeden Socket entsprechende Daten senden
            for (const socket of sockets) {
              // Prüfen ob für den Client die Anzeigezeit abgelaufen ist
              const reset_timestamp = await sql.db_client_get_alarm_anzeigbar(socket, einsatzdaten.id);

              if (!einsatzdaten || !reset_timestamp) {
                // Standby senden
                standby_verteilen_socket(socket);
                // wenn keine Einsatzdaten vorhanden sind, dann nichts senden (Standby)
                logger.log("waip", `Kein anzuzeigender Einsatz für ${wachen_nr} vorhanden, sende keine Einsatzdaten, sondern Standby.`);
                resolve(false);
              } else {
                // Einsatz an den einzelnen Socket versenden
                waip_verteilen_socket(einsatzdaten, socket, wachen_nr, reset_timestamp);
                resolve(true);
              }
            }
          }
        }
      } catch (error) {
        reject(new Error(`Fehler beim Verteilen der Waip-Einsatzdaten ${waip_id} an Socket-Räume}. ` + error));
      }
    });
  };

  const standby_verteilen_socket = (socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // die Einsatz-ID aus dem Websocket entfernen
        socket.data.waip_id = null;

        // Standby ohne Daten senden senden
        socket.emit("io.standby", null);

        // Client-Status mit Standby aktualisieren
        sql.db_client_update_status(socket, "Standby");
      } catch (error) {
        reject(new Error(`Fehler senden des Standby-Befehls für einen Client ${socket.id}. ` + error));
      }
    });
  };

  const rmld_verteilen_rooms = (obj_waip_uuid_with_rmld_uuid) => {
    return new Promise(async (resolve, reject) => {
      try {
        // alle waip-uuids durchgehen und jeweils die Rückmeldungsdaten anhand der einzelnen UUIDs im Array ermitteln und senden
        for (const key in obj_waip_uuid_with_rmld_uuid) {
          const waip_uuid = key;

          // Einsatz-ID mittels Einsatz-UUID ermitteln
          const waip_id = await sql.db_einsatz_get_waipid_by_uuid(waip_uuid);

          // anhand der waip_id die beteiligten Wachennummern / Socket-Räume in '/waip' zum Einsatz ermitteln
          // BUG hier werden die Räume anhand der Waip-Id ermittelt, das ist nicht ganz passend,
          // einzelne Websockets können aber schon einen anderen Einsatz anzeigen
          const waip_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);

          // Rückmeldungen an alle beteiligten Wachen ('/waip'-Websocket-Raum) verteilen
          for (const waip_room of waip_rooms) {
            const wachen_nr = waip_room.room;

            // alle zur Wache zugehörigen Alarmmonitor-Sockets ermitteln
            const waip_sockets = await io.of("/waip").in(wachen_nr.toString()).fetchSockets();

            // bestimmte Rückmeldungen passend pro Wache aus Datenbank laden
            const rmld_waip_arr = await sql.db_rmlds_get_for_wache(wachen_nr, waip_id, obj_waip_uuid_with_rmld_uuid[waip_uuid]);

            // an jeden Socket entsprechende Daten senden
            for (const waip_socket of waip_sockets) {
              // wenn socket.data.waip_id dem aktuellen Einsatz entspricht
              if (waip_socket.data.waip_id === waip_id) {
                // Rückmeldungen an Socket versenden
                rmld_arr_verteilen_socket(rmld_waip_arr, waip_socket);
              } else {
                // Protokollieren das es nicht gesendet wurde
                logger.log("log", `Rückmeldungen an Socket ${waip_socket.id} nicht gesendet, weil dieser einen anderen oder keinen Einsatz anzeigt.`);
              }
            }
          }

          // alle zum Einsatz zugehörigen Dashboard-Sockets ermitteln
          const dbrd_sockets = await io.of("/dbrd").in(waip_uuid.toString()).fetchSockets();

          // bestimmte Rückmeldungen passend pro Dashboard aus Datenbank laden
          const rmld_dbrd_arr = await sql.db_rmlds_get_for_wache(0, waip_id, obj_waip_uuid_with_rmld_uuid[waip_uuid]);

          // an jeden Socket entsprechende Daten senden
          for (const dbrd_socket of dbrd_sockets) {
            // Rückmeldungen an Socket versenden
            rmld_arr_verteilen_socket(rmld_dbrd_arr, dbrd_socket);
          }

          resolve(true);
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Einsatz. " + error));
      }
    });
  };

  const rmld_arr_verteilen_socket = (rmld_arr, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Prüfen ob Einsatz bei Socket noch angezeigt wird
        // TODO prüfen der ablaufzeit hinzufügen
        //const ablaufzeit = await sql.db_user_get_ablaufzeit(socket, einsatzdaten.id);

        // Rückmeldungen durchgehen und einzeln an Socket senden
        for (const rmld_data of rmld_arr) {
          // Lokale Kopie erstellen, damit das geteilte rmld_data-Objekt nicht durch
          // Berechtigungs-Stripping für andere Sockets im selben Raum verändert wird.
          const data = { ...rmld_data };

          // Berechtigungen für aufgerufenen Alarmmonitor überpruefen
          const permissions = await sql.db_user_check_permission_for_rmld(socket, data.wache_nr);

          // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
          if (!permissions) {
            data.rmld_alias = null;
            data.rmld_address = null;
          }

          // Rueckmeldung an Socket/Client senden
          socket.emit("io.new_rmld", data);

          const logMessage1 = `Rückmeldungen an Socket ${socket.id} gesendet.`;
          logger.log("log", logMessage1);
          const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(data)}`;
          logger.log("debug", logMessage2);
        }

        resolve(true);
      } catch (error) {
        logger.log("error", `Fehler beim Verteilen einer Rückmeldung für einen Client ${socket.id}. ` + error);
        resolve(false);
      }
    });
  };

  const dbrd_verteilen_socket = (dbrd_uuid, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatzdaten laden
        const einsatzdaten = await sql.db_einsatz_get_by_uuid(dbrd_uuid);
        if (!einsatzdaten) {
          // Standby senden wenn Einsatz nicht vorhanden
          // BUG hier kein standby senden, sondern nicht vorhanden
          socket.emit("io.deleted", null);
          const logMessage = `Der angefragte Einsatz ${dbrd_uuid} ist nicht - oder nicht mehr - vorhanden!, Dashboard-Socket ${socket.id} wurde getrennt.`;
          logger.log("log", logMessage);
          sql.db_client_update_status(socket, null);
        } else {
          const permissions = await sql.db_user_check_permission_for_waip(socket, einsatzdaten.id);

          // Daten entfernen wenn kann authentifizierter Nutzer
          if (!permissions) {
            delete einsatzdaten.einsatznummer;
            delete einsatzdaten.objekt;
            delete einsatzdaten.objektteil;
            delete einsatzdaten.besonderheiten;
            delete einsatzdaten.strasse;
            delete einsatzdaten.hausnummer;
            delete einsatzdaten.einsatzdetails;
            delete einsatzdaten.wgs84_x;
            delete einsatzdaten.wgs84_y;
            // Flag setzen, dass Berechtigungen nicht ok sind
            einsatzdaten.permissions = false;
          } else {
            // Flag setzen, dass Berechtigungen ok sind
            einsatzdaten.permissions = true;
          }

          // Einsatz-ID dem Websocket zuweisen
          socket.data.waip_id = einsatzdaten.id;
          // Einsatzdaten senden
          socket.emit("io.Einsatz", einsatzdaten);
          // Rueckmeldungen verteilen
          rmld_arr_verteilen_socket(einsatzdaten.id, socket);
          const logMessage = `Einsatzdaten für Dashboard ${dbrd_uuid} an Socket ${socket.id} gesendet`;
          logger.log("log", logMessage);
          sql.db_client_update_status(socket, einsatzdaten.id);
        }

        // Client-Status mit Wachennummer aktualisieren
        sql.db_client_update_status(socket, dbrd_uuid.uuid);
      } catch (error) {
        reject(new Error("Fehler beim Senden der Dashboard-Daten für einen Client. " + error));
      }
    });
  };

  // TODO WAIP: Funktion um Clients remote "neuzustarten" (Seite neu laden), niedrige Prioritaet

  // Funktion die alle xxx Sekunden ausgeführt wird
  const system_cleanup = async () => {
    // alte Einsätze aus der Datenbank laden
    const alte_einsaetze = await sql.db_einsaetze_get_old();

    // wenn alte Einsäzte vorhanden sind, dann aufräumen
    if (alte_einsaetze) {
      alte_einsaetze.forEach(async (waip) => {
        // Aufräumen der alten Einsätze
        logger.log("log", `Einsatz mit der ID ${waip.id} ist veraltet. Datenbank wird aufgeräumt.`);

        // Alarmmonitore ermitteln an die ein Standby gesendet werden muss
        const rooms_to_standby = await sql.db_einsatz_get_waip_rooms(waip.id);

        // Standby an die ermittelten Alarmmonitore senden
        if (rooms_to_standby) {
          rooms_to_standby.forEach(async (room_to_standby) => {
            // für jede Wache (room_to_standby.room) die verbundenen Sockets(Clients) ermitteln und Standby senden
            const room_sockets = await io.of("/waip").in(room_to_standby.room.toString()).fetchSockets();

            // TODO hier wäre es besser, das standby an den Raum zu senden, nicht an jeden Socket

            for (const socket of room_sockets) {
              // Standby senden
              const same_id = await sql.db_client_check_waip_id(socket.id, waip.id);
              if (same_id) {
                // Einsatz-ID aus dem Websocket entfernen
                socket.data.waip_id = null;
                // Standby senden
                standby_verteilen_socket(socket);
                // Audio stoppen
                socket.emit("io.stopaudio", null);
                logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet.`);
                sql.db_client_update_status(socket, null);
              }
            }
          });
        }

        // Dashboards trennen
        // io.deletet an alle Socket senden die im Namespace /dbrd im Raum der alte_einsaetze.uuid sind
        const dbrd_sockets = await io.of("/dbrd").in(waip.uuid.toString()).fetchSockets();
        // io.deletet an dbrd_sockets senden
        dbrd_sockets.forEach((socket) => {
          socket.emit("io.deleted", null);
          logger.log("log", `Dashboard mit dem Socket ${socket.id} wurde getrennt, Einsatz gelöscht.`);
        });

        // Einsatz mit allen zugehörigen Daten löschen
        sql.db_einsatz_loeschen(waip.id);
        logger.log("log", `Einsatz-Daten zu Einsatz ${waip.id} gelöscht.`);
      });
    }

    // alle User-Einstellungen prüfen und ggf. Standby senden, z.B. wenn Reset_Timestamp erreicht ist
    const socket_ids = await sql.db_socket_get_all_to_standby();
    if (socket_ids) {
      for (const row of socket_ids) {
        const sockets = await io.of("/waip").in(row.socket_id).fetchSockets();
        for (const socket of sockets) {
          // Einsatz-ID aus dem Websocket entfernen
          socket.data.waip_id = null;
          // Standby senden
          standby_verteilen_socket(socket);
          // Audio stoppen
          socket.emit("io.stopaudio", null);
          logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet`);
          sql.db_client_update_status(socket, null);
        }
      }
    }

    // loeschen alter Sounddaten nach Alter
    const retentionMinutes = app_cfg.global.time_to_delete_waip;
    const retentionMs = retentionMinutes * 60 * 1000;
    const nowTs = Date.now();
    fs.readdirSync(process.cwd() + app_cfg.global.soundpath).forEach((file) => {
      try {
        if (file.endsWith(".mp3") && !file.endsWith("_tmp.mp3") && !file.startsWith("bell")) {
          const fullPath = process.cwd() + app_cfg.global.soundpath + file;
          const stats = fs.statSync(fullPath);
          const age = nowTs - stats.mtimeMs;
          if (age > retentionMs) {
            fs.unlinkSync(fullPath);
            logger.log("log", `Veraltete Sound-Datei ${file} (> ${retentionMinutes}min) wurde gelöscht.`);
          }
        }
      } catch (error) {
        logger.log("error", `Fehler beim Löschen einer Sound-Datei ${file}: ${error}`);
      }
    });
  };

  // System alle xxx Sekunden aufräumen
  setInterval(system_cleanup, app_cfg.global.system_cleanup_time);

  return {
    waip_verteilen_socket: waip_verteilen_socket,
    einsatz_verteilen_rooms: einsatz_verteilen_rooms,
    standby_verteilen_socket: standby_verteilen_socket,
    rmld_arr_verteilen_socket: rmld_arr_verteilen_socket,
    rmld_verteilen_rooms: rmld_verteilen_rooms,
    dbrd_verteilen_socket: dbrd_verteilen_socket,
  };
};
