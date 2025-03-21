module.exports = (io, sql, fs, logger, app_cfg) => {
  // Module laden
  const { parse } = require("json2csv");
  const async = require("async");
  const nodemailer = require("nodemailer");
  let proc = require("child_process");

  const waip_verteilen_for_one_client = (einsatzdaten, socket, wachen_nr) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Prüfen ob der Client im Standby sein sollte
        const ablaufzeit = await sql.db_user_get_time_left(socket, einsatzdaten.id);

        if (!ablaufzeit) {
          // wenn keine Ablaufzeit oder keine Einsatzdaten vorhanden sind, dann Standby senden
          standby_verteilen_for_one_client(socket);
          logger.log("log", `Kein anzuzeigender Einsatz für Socket ${socket.id} (Zeit abgelaufen), sende Standby.`);
          resolve(false);
        } else {
          // Berechtigungen für aufgerufenen Alarmmonitor überpruefen
          const permissions = await sql.db_user_check_permission_by_wachen_nr(socket, wachen_nr);

          // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
          if (!permissions) {
            einsatzdaten.objekt = "";
            einsatzdaten.besonderheiten = "";
            einsatzdaten.strasse = "";
            einsatzdaten.wgs84_x = "";
            einsatzdaten.wgs84_y = "";
          }

          // Ablaufzeit zum Einsatz hinzufuegen
          einsatzdaten.ablaufzeit = ablaufzeit;

          // pruefen ob Einsatz bereits genau so beim Client angezeigt wurde (Doppelalarmierung)
          const doppelalarm = await sql.db_einsatz_check_history(einsatzdaten, socket);

          if (doppelalarm) {
            // Log das Einsatz explizit nicht an Client gesendet wurde
            logger.log("waip", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} nicht an Socket ${socket.id} gesendet, Doppelalarmierung.`);
            resolve(false);
          } else {
            // Einsatzdaten an Client senden
            socket.emit("io.new_waip", einsatzdaten);
            logger.log("waip", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} an ${socket.id} gesendet.`);
            // Client-Status mit Wachennummer aktualisieren
            sql.db_client_update_status(socket, einsatzdaten.id);

            // vorhandene Rückmeldungen an Alarmmonitor senden
            rmld_verteilen_for_one_client(einsatzdaten, socket, wachen_nr);

            // Sound erstellen
            const tts = await tts_erstellen(app_cfg, einsatzdaten);
            if (tts) {
              // Sound-Link senden
              socket.emit("io.playtts", tts);
              logger.log("log", `ttsfile ${tts}`);
            }

            resolve(true);
          }
        }
      } catch (error) {
        logger.log("error", `Fehler beim Verteilen der Waip-Einsatzdaten ${einsatzdaten.id} für einen Client ${socket.id}. ` + error);
      }
    });
  };

  const waip_verteilen_for_rooms = (waip_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // anhand der waip_id die beteiligten Wachennummern / Socket-Räume zum Einsatz ermitteln
        const socket_rooms = await sql.db_einsatz_get_rooms(waip_id);

        // waip_rooms muss größer 1 sein, da sonst nur der Standard-Raum '0' vorhanden ist
        if (socket_rooms.length == 1 && socket_rooms[0].room == "0") {
          // wenn kein Raum (keine Wache) ausser '0' zurueckgeliefert wird, dann Einsatz direkt wieder loeschen weil keine Wachen dazu hinterlegt
          logger.log("warn", `Keine Wache für den Einsatz mit der ID ${waip_id} vorhanden! Einsatz wird gelöscht!`);
          // FIXME db_einsatz_loeschen liefert die Anzahl der gelöschten Daten zurück, hier beachten
          sql.db_einsatz_loeschen(waip_id);
        } else {
          // Einsatzdaten an alle beteiligten Wachen (Websocket-Raum) verteilen
          socket_rooms.forEach(async (room) => {
            wachen_nr = room.room;

            // Einsatzdaten passend pro Wache aus Datenbank laden
            const einsatzdaten = await sql.db_einsatz_get_for_wache(waip_id, wachen_nr);

            // alles Sockets der Wache ermitteln
            const sockets = await io.of("/waip").in(wachen_nr).fetchSockets();

            // an jeden Socket entsprechende Daten senden
            for (const socket of sockets) {
              if (!einsatzdaten) {
                // Standby senden
                standby_verteilen_for_one_client(socket);
                // wenn keine Einsatzdaten vorhanden sind, dann nichts senden (Standby)
                logger.log("waip", `Kein Einsatz passender ${wachen_nr} vorhanden, sende keine Einsatzdaten, sondern Standby.`);
                resolve(false);
              } else {
                // Einsatz an den einzelnen Socket versenden
                waip_verteilen_for_one_client(einsatzdaten, socket, wachen_nr);
                resolve(true);
              }
            }
          });
        }
      } catch (error) {
        reject(new Error(`Fehler beim Verteilen der Waip-Einsatzdaten ${waip_id} an Wachen ${socket_rooms}. ` + error));
      }
    });
  };

  const standby_verteilen_for_one_client = (socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Standby senden
        socket.emit("io.standby", null);

        // Client-Status mit Standby aktualisieren
        sql.db_client_update_status(socket, "Standby");
      } catch (error) {
        reject(new Error(`Fehler senden des Standby-Befehls für einen Client ${socket.id}. ` + error));
      }
    });
  };

  const rmld_verteilen_by_uuid = (arr_rmld_uuid) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatz-ID mittels Einsatz-UUID ermitteln
        const waip_id = await sql.db_einsatz_get_waipid_by_uuid(waip_uuid);

        // am Einsatz beteiligte Socket-Räume ermitteln
        const socket_rooms = await sql.db_einsatz_get_rooms(waip_id);

        // Rückmeldungen an alle relevanten Alarmmonitore verteilen
        if (socket_rooms) {
          socket_rooms.forEach((row) => {
            // fuer jede Wache(row.room) die verbundenen Sockets(Clients) ermitteln
            // BUG io.nsps ist wohl falsch
            let room_sockets = io.nsps["/waip"].adapter.rooms[row.room];

            if (typeof room_sockets !== "undefined") {
              // an jeden Socket in Rückmeldung senden
              Object.keys(room_sockets.sockets).forEach(async (socket_id) => {
                // wenn Raum zum Einsatz aufgerufen ist, dann Rueckmeldung aus DB laden und an diesen versenden
                const rmld_obj = await sql.db_rmld_get_by_rmlduuid(rmld_uuid);
                if (rmld_obj) {
                  // Rückmeldung an Clients/Räume senden, wenn richtiger Einsatz angezeigt wird
                  const same_id = await sql.db_client_check_waip_id(socket_id, waip_id);
                  if (same_id) {
                    let socket = io.of("/waip").connected[socket_id];
                    socket.emit("io.new_rmld", rmld_obj);
                    const logMessage1 = `Rückmeldung ${rmld_uuid} für den Einsatz mit der ID ${waip_id} an Wache ${row.room} gesendet.`;
                    logger.log("log", logMessage1);
                    const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
                    logger.log("debug", logMessage2);
                  }
                }
              });
            }
          });
        }

        // Dashboards ermitteln, welche den Einsatz geladen haben
        const dbrd_sockets = await sql.db_socket_get_dbrd(waip_id);

        if (dbrd_sockets) {
          // Rueckmeldung auslesen
          const rmld_obj = await sql.db_rmld_get_by_rmlduuid(rmld_uuid);
          if (rmld_obj) {
            // Rückmeldung an Dashboards senden
            dbrd_sockets.forEach(function (row) {
              let socket = io.of("/dbrd").connected[row.socket_id];
              socket.emit("io.new_rmld", rmld_obj);
              const logMessage1 = `Rückmeldung ${rmld_uuid} für den Einsatz mit der ID ${waip_id} an Dashboard ${waip_uuid} gesendet.`;
              logger.log("log", logMessage1);
              const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
              logger.log("debug", logMessage2);
            });
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Einsatz. " + error));
      }
    });
  };

  const rmld_verteilen_for_one_client = (waip_id, socket, wachen_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Rueckmeldung an einen bestimmten Client senden
        if (typeof socket.id !== "undefined") {
          console.warn("waip_id", waip_id);
          console.warn("wachen_id", wachen_id);
          const rmld_obj = await sql.db_rmld_get_fuer_wache(waip_id, wachen_id);
          console.warn("rmld_obj", rmld_obj);
          if (rmld_obj) {
            // Rueckmeldung nur an den einen Socket senden
            socket.emit("io.new_rmld", rmld_obj);
            const logMessage1 = `Vorhandene Rückmeldungen an Socket ${socket.id} gesendet.`;
            logger.log("log", logMessage1);
            const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_obj)}`;
            logger.log("debug", logMessage2);
            resolve(true);
          } else {
            const logMessage = `Keine Rückmeldungen für Einsatz-ID ${waip_id} und Wachen-ID ${wachen_id} vorhanden.`;
            logger.log("log", logMessage1);
            resolve(false);
          }
        } else {
          logger.log("error", `Es wurde keine socket.id an die Funktion übergeben! `);
        }
      } catch (error) {
        reject(new Error("Fehler beim Verteilen der Rückmeldungen für einen Client. ", error));
      }
    });
  };

  const dbrd_verteilen = (dbrd_uuid, socket) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Einsatzdaten laden
        const einsatzdaten = await sql.db_einsatz_get_by_uuid(dbrd_uuid);
        if (!einsatzdaten) {
          // Standby senden wenn Einsatz nicht vorhanden
          // BUG hier kein standby senden, sondern nicht vorhanden
          socket.emit("io.standby", null);
          const logMessage = `Der angefragte Einsatz ${dbrd_uuid} ist nicht - oder nicht mehr - vorhanden!, Standby an Dashboard-Socket ${socket.id} gesendet.`;
          logger.log("log", logMessage);
          sql.db_client_update_status(socket, null);
        } else {
          const valid = await sql.db_user_check_permission_by_waip_id(socket.request.user, einsatzdaten.id);
          // Daten entfernen wenn kann authentifizierter Nutzer
          if (!valid) {
            delete einsatzdaten.objekt;
            delete einsatzdaten.besonderheiten;
            delete einsatzdaten.strasse;
            delete einsatzdaten.wgs84_x;
            delete einsatzdaten.wgs84_y;
          }
          // Einsatzdaten senden
          socket.emit("io.Einsatz", einsatzdaten);
          // Rueckmeldungen verteilen
          rmld_verteilen_for_one_client(einsatzdaten.id, socket, 0);
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

  const tts_erstellen = (app_cfg, einsatzdaten) => {
    return new Promise((resolve, reject) => {
      try {
        // Einsatz-UUID als Dateinamen verwenden und unnötige Zeichen aus entfernen
        let id = einsatzdaten.uuid.replace(/\W/g, "");

        // Pfade der Sound-Dateien definieren
        let wav_tts = process.cwd() + app_cfg.global.soundpath + id + ".wav";
        let mp3_tmp = process.cwd() + app_cfg.global.soundpath + id + "_tmp.mp3";
        let mp3_tts = process.cwd() + app_cfg.global.soundpath + id + ".mp3";
        let mp3_url = app_cfg.global.mediapath + id + ".mp3";

        // prüfen ob mp3_url bereits existiert, wenn ja dann direkt zurückgeben und Funktion beenden
        if (fs.existsSync(mp3_tts)) {
          resolve(mp3_url);
          return;
        }

        // unterscheiden des Alarmgongs nach Einsatzart
        let mp3_bell;
        if (einsatzdaten.einsatzart == "Brandeinsatz" || einsatzdaten.einsatzart == "Hilfeleistungseinsatz") {
          mp3_bell = process.cwd() + app_cfg.global.soundpath + "bell_long.mp3";
        } else {
          mp3_bell = process.cwd() + app_cfg.global.soundpath + "bell_short.mp3";
        }

        // Grunddaten der Sprachansage zusammensetzen
        let tts_text = einsatzdaten.einsatzart + ", " + einsatzdaten.stichwort;
        if (einsatzdaten.objekt) {
          tts_text = tts_text + ". " + einsatzdaten.objekt + ", " + einsatzdaten.ort + ", " + einsatzdaten.ortsteil;
        } else {
          tts_text = tts_text + ". " + einsatzdaten.ort + ", " + einsatzdaten.ortsteil;
        }

        // für jedes Einsatzmittel den gesprochenen Funkrufnamen ermitteln
        einsatzdaten.em_alarmiert.forEach(async (einsatzmittel_obj) => {
          await sql.db_tts_einsatzmittel(einsatzmittel_obj);
        });

        // Verkette alle Werte von tts_text aus einsatzdaten.em_alarmiert
        let tts_text_em_alarmiert = einsatzdaten.em_alarmiert.map((em) => em.tts_text).join(", ");
        tts_text = tts_text + ". Für " + tts_text_em_alarmiert;

        // Unterscheidung nach Sondersignal
        if (einsatzdaten.sondersignal == 1) {
          tts_text = tts_text + ", mit Sondersignal";
        } else {
          tts_text = tts_text + ", ohne Sonderrechte";
        }

        // Abschluss
        tts_text = tts_text + ". Ende der Durchsage!";

        // ungewollte Zeichen aus Sprachansage entfernen
        tts_text = tts_text.replace(/:/g, " ");
        tts_text = tts_text.replace(/\//g, " ");
        tts_text = tts_text.replace(/-/g, " ");

        // Sprachansage als mp3 erstellen
        switch (process.platform) {
          // Windows
          case "win32":
            // Powershell
            let pwshell_commands = [
              // TTS-Schnittstelle von Windows ansprechen
              `
              Add-Type -AssemblyName System.speech;
              $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;
              # Ausgabedatei und Sprachtext
              $speak.SetOutputToWaveFile("${wav_tts}");
              $speak.Speak("${tts_text}");
              $speak.Dispose();
              # speak.wav in mp3 umwandeln
              ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar 44100 -ac 2 -ab 128k -f mp3 ${mp3_tmp};
              # Gong und Ansage zu einer mp3 zusammensetzen
              ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts};
              # Dateien loeschen
              rm ${wav_tts};
              rm ${mp3_tmp};
              `,
            ];
            let pwshell_options = {
              shell: true,
            };
            let pwshell_childD = proc.spawn("powershell", pwshell_commands);
            pwshell_childD.stdin.setEncoding("ascii");
            pwshell_childD.stderr.setEncoding("ascii");
            pwshell_childD.stderr.on("data", (data) => {
              const message = `Fehler beim Erstellen der TTS-Datei (win32): ${data}`;
              logger.log("error", message);
              reject(new Error(message));
            });
            pwshell_childD.on("exit", () => {
              resolve(mp3_url);
            });
            pwshell_childD.stdin.end();
            break;
          // LINUX
          case "linux":
            // bash
            let lxshell_commands = [
              // TTS-Schnittstelle SVOX PicoTTS
              "-c",
              `
              pico2wave --lang=de-DE --wave=${wav_tts} "${tts_text}"
              ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar 44100 -ac 2 -ab 128k -f mp3 ${mp3_tmp}
              ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts}
              rm ${wav_tts}
              rm ${mp3_tmp}`,
            ];
            let lxshell_options = {
              shell: true,
            };
            logger.log("debug", `Erstellung der TTS-Datei: ${lxshell_commands}`);
            let lxshell_childD = proc.spawn("/bin/sh", lxshell_commands);
            lxshell_childD.stdin.setEncoding("ascii");
            lxshell_childD.stderr.setEncoding("ascii");
            lxshell_childD.on("exit", (code, signal) => {
              if (code > 0) {
                const message = `Exit-Code ${code}; Fehler beim erstellen der TTS-Datei (linux).`;
                logger.log("error", message);
                reject(new Error(message));
              } else {
                resolve(mp3_url);
              }
            });
            lxshell_childD.stdin.end();
            break;
          // anderes OS
          default:
            reject(new Error("TTS für dieses Server-Betriebssystem nicht verfügbar!"));
        }
      } catch (error) {
        logger.log("error", `Fehler beim Erstellen der TTS-Datei. ` + error);
      }
    });
  };

  // Funktion die alle xxx Sekunden ausgeführt wird
  const system_cleanup = async () => {
    // alte Einsätze aus der Datenbank laden
    const old_waips = await sql.db_einsaetze_get_old();

    // wenn alte Einsäzte vorhanden sind, dann aufräumen
    console.warn("old_waips", old_waips);
    if (old_waips) {
      old_waips.forEach(async (waip) => {
        // Aufräumen der alten Einsätze
        logger.log("log", `Einsatz mit der ID ${waip.id} ist veraltet. Datenbank wird aufgeräumt.`);

        // Alarmmonitore auf Standby setzen
        const rooms = await sql.db_einsatz_get_rooms(waip.id);
        console.warn("rooms", rooms);
        if (rooms) {
          rooms.forEach(async (room) => {
            // für jede Wache (room.room) die verbundenen Sockets(Clients) ermitteln und Standby senden
            console.warn("room", room);
            const room_sockets = await io.of("/waip").in(room.room).fetchSockets();
            console.warn("room_sockets", room_sockets);
            // TODO hier wäre es besser, das standby an den Raum zu senden, nicht an jeden Socket
            if (room_sockets.length > 0) {
              Object.keys(room_sockets.sockets).forEach(async (socket_id) => {
                // Standby senden
                let socket = io.of("/waip").connected[socket_id];
                const same_id = await sql.db_client_check_waip_id(socket.id, waip.id);
                if (same_id) {
                  socket.emit("io.standby", null);
                  socket.emit("io.stopaudio", null);
                  logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet.`);
                  sql.db_client_update_status(socket, null);
                }
              });
            }
          });
        }

        // Dashboards trennen
        const dashboard_ids = sql.db_socket_get_dbrd(waip.id);

        // TODO TEST: Dashboard-Trennen-Funktion testen
        // if dashboard_ids is not {null} then do the
        if (dashboard_ids) {
          console.warn("dashboard_ids", dashboard_ids);
          /*
          dashboard_ids.forEach((row) => {
            let socket = io.of("/dbrd").connected[row.socket_id];
            if (typeof socket !== "undefined") {
              socket.emit("io.deleted", null);
              logger.log("log", `Dashboard mit dem Socket ${socket.id} wurde getrennt, Einsatz gelöscht.`);
              sql.db_client_update_status(socket, null);
            }
          });*/
        }

        // Einsatz mit löschen
        sql.db_einsatz_loeschen(waip.id);
        logger.log("log", `Einsatz-Daten zu Einsatz ${waip.id} gelöscht.`);

        // Rückmeldungen löschen
        sql.db_rmld_loeschen(waip.uuid);
        logger.log("log", `Rückmeldungen zu Einsatz ${waip.id} gelöscht.`);
        

        // beteiligte Einsatzmittel löschen
      });
    }

    // alte Einsätze aus der Datenbank löschen
    sql.db_einsaetze_get_old((old_waips) => {
      // FIXME war zuvor eine Schleife die zurückgeliefert wurde!!!!
      // wurde in Version 2 geändert in ein Object, welches jetzt hier in einer Schleife abzuarbeiten ist

      // nach alten Einsaetzen suchen und diese ggf. loeschen
      if (old_waips) {
        // iterate trough old_waips with for each
        old_waips.forEach((waip) => {
          // Einsatz mit der ID "waip.id" ist veraltet und kann gelöscht werden
          // Dashboards trennen, deren Einsatz geloescht wurde
          // beteiligte Wachen zum Einsatz ermitteln
        });
      }
    });

    // loeschen alter Sounddaten nach alter (15min) und socket-id (nicht mehr verbunden)
    fs.readdirSync(process.cwd() + app_cfg.global.soundpath).forEach(async (file) => {
      // nur die mp3s von alten clients loeschen
      if (file.substring(0, 4) != "bell" && file.substring(file.length - 3) == "mp3" && file.substring(file.length - 8) != "_tmp.mp3") {
        // Socket-ID aus Datei-Namen extrahieren
        socket_name = file.substring(0, file.length - 4);
        // Socket-ID anpassen, damit die SQL-Abfrage ein Ergebnis liefert
        // TODO: löschen?: socket_name = socket_name.replace("waip", "/waip#");
        const socketid = await sql.db_socket_get_by_id(socket_name);
        if (!socketid) {
          try {
            // Datei loeschen
            fs.unlinkSync(process.cwd() + app_cfg.global.soundpath + file);
            logger.log("log", `Veraltete Sound-Datei ${file} wurde gelöscht.`);
          } catch (error) {
            logger.log("error", `Fehler beim löschen der Sound-Datei ${file} , Fehlermeldung: ${error}`);
          }
        }
      }
    });

    // alle User-Einstellungen prüfen und ggf. Standby senden
    sql.db_socket_get_all_to_standby((socket_ids) => {
      if (socket_ids) {
        socket_ids.forEach((row) => {
          let socket = io.of("/waip").connected[row.socket_id];
          if (typeof socket !== "undefined") {
            socket.emit("io.standby", null);
            socket.emit("io.stopaudio", null);
            logger.log("log", `Standby an Alarmmonitor-Socket ${socket.id} gesendet`);
            sql.db_client_update_status(socket, null);
          }
        });
      }
    });
  };

  // System alle xxx Sekunden aufräumen
  setInterval(system_cleanup, app_cfg.global.system_cleanup_time);

  return {
    waip_verteilen_for_one_client: waip_verteilen_for_one_client,
    waip_verteilen_for_rooms: waip_verteilen_for_rooms,
    standby_verteilen_for_one_client: standby_verteilen_for_one_client,
    rmld_verteilen_for_one_client: rmld_verteilen_for_one_client,
    rmld_verteilen_by_uuid: rmld_verteilen_by_uuid,
    dbrd_verteilen: dbrd_verteilen,
  };
};
