const e = require("express");

module.exports = (io, sql, fs, logger, app_cfg) => {
  const waip_verteilen_socket = (einsatzdaten, socket, wachen_nr, reset_timestamp) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Berechtigungen für den Einsatz, anhand der Wachen-Berechtigung ueberpruefen
        const permissions = await sql.db_user_check_permission_for_waip(socket, einsatzdaten.id);

        // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
        if (!permissions) {
          einsatzdaten.einsatznummer = "";
          einsatzdaten.objekt = "";
          einsatzdaten.objektteil = "";
          einsatzdaten.besonderheiten = "";
          einsatzdaten.strasse = "";
          einsatzdaten.hausnummer = "";
          einsatzdaten.einsatzdetails = "";
          einsatzdaten.wgs84_x = "";
          einsatzdaten.wgs84_y = "";
          // Flag setzen, dass Berechtigungen nicht ok sind
          einsatzdaten.permissions = false;
        } else {
          // Flag setzen, dass Berechtigungen ok sind
          einsatzdaten.permissions = true;
        }

        // Ablaufzeit zum Einsatz hinzufuegen, damit diese auf der Seite ausgewertet werden kann
        einsatzdaten.ablaufzeit = reset_timestamp;

        // pruefen ob Einsatz bereits genau so beim Client angezeigt wurde (Doppelalarmierung)
        const doppelalarm = await sql.db_einsatz_check_history(einsatzdaten, socket);

        if (doppelalarm) {
          // Log das Einsatz explizit nicht an Client gesendet wurde
          logger.log("waip", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} nicht an Socket ${socket.id} gesendet, Doppelalarmierung.`);
          resolve(false);
        } else {
          // Einsatz-ID dem Socket zuweisen, fuer spaetere Abgleiche
          socket.data.waip_id = einsatzdaten.id;

          // Einsatzdaten an Client senden
          socket.emit("io.new_waip", einsatzdaten);
          logger.log("waip", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} an ${socket.id} gesendet.`);

          // Client-Status mit Wachennummer aktualisieren
          sql.db_client_update_status(socket, einsatzdaten.id);

          // Sound erstellen und an Client senden
          const tts = await tts_erstellen(app_cfg, einsatzdaten, wachen_nr);
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
            wachen_nr = rooms.room;

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
          waip_uuid = key;

          // Einsatz-ID mittels Einsatz-UUID ermitteln
          const waip_id = await sql.db_einsatz_get_waipid_by_uuid(waip_uuid);

          // anhand der waip_id die beteiligten Wachennummern / Socket-Räume in '/waip' zum Einsatz ermitteln
          // BUG hier werden die Räume anhand der Waip-Id ermittelt, das ist nicht ganz passend,
          // einzelne Websockets können aber schon einen anderen Einsatz anzeigen
          const waip_rooms = await sql.db_einsatz_get_waip_rooms(waip_id);

          // Rückmeldungen an alle beteiligten Wachen ('/waip'-Websocket-Raum) verteilen
          for (const waip_room of waip_rooms) {
            wachen_nr = waip_room.room;

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
          // Berechtigungen für aufgerufenen Alarmmonitor überpruefen
          const permissions = await sql.db_user_check_permission_for_rmld(socket, rmld_data.wache_nr);

          // wenn Berechtigungen nicht passen / nicht vorhanden sind, dann Daten entfernen
          if (!permissions) {
            rmld_data.rmld_alias = null;
            rmld_data.rmld_address = null;
          }

          // Rueckmeldung an Socket/Client senden
          socket.emit("io.new_rmld", rmld_data);

          const logMessage1 = `Rückmeldungen an Socket ${socket.id} gesendet.`;
          logger.log("log", logMessage1);
          const logMessage2 = `Rückmeldung JSON: ${JSON.stringify(rmld_data)}`;
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

  // Konstanten für TTS-Konfiguration
  const TTS_CONFIG = {
    audio: {
      sampleRate: 44100,
      channels: 2,
      bitrate: "128k",
    },
    fileExtensions: {
      wav: ".wav",
      mp3: ".mp3",
      tmp: "_tmp.mp3",
    },
  };

  // Plattform-spezifische TTS-Implementierungen
  const ttsImplementations = {
    win32: {
      createTTS: async (tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell) => {
        const pwshell_commands = [
          `
          Add-Type -AssemblyName System.speech;
          $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;
          $speak.SetOutputToWaveFile("${wav_tts}");
          $speak.Speak("${tts_text}");
          $speak.Dispose();
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar ${TTS_CONFIG.audio.sampleRate} -ac ${TTS_CONFIG.audio.channels} -ab ${TTS_CONFIG.audio.bitrate} -f mp3 ${mp3_tmp};
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts};
          rm ${wav_tts};
          rm ${mp3_tmp};
          `,
        ];

        return new Promise((resolve, reject) => {
          const proc = require("child_process");
          const pwshell_childD = proc.spawn("powershell", pwshell_commands, { shell: true });

          pwshell_childD.stderr.on("data", (data) => {
            reject(new Error(`Fehler beim Erstellen der TTS-Datei (win32): ${data}`));
          });

          pwshell_childD.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Powershell-Prozess beendet mit Code ${code}`));
            }
          });

          pwshell_childD.stdin.end();
        });
      },
    },
    linux: {
      createTTS: async (tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell) => {
        const lxshell_commands = [
          "-c",
          `
          pico2wave --lang=de-DE --wave=${wav_tts} "${tts_text}"
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i ${wav_tts} -vn -ar ${TTS_CONFIG.audio.sampleRate} -ac ${TTS_CONFIG.audio.channels} -ab ${TTS_CONFIG.audio.bitrate} -f mp3 ${mp3_tmp}
          ffmpeg -nostats -hide_banner -loglevel 0 -y -i "concat:${mp3_bell}|${mp3_tmp}" -acodec copy ${mp3_tts}
          rm ${wav_tts}
          rm ${mp3_tmp}`,
        ];

        const proc = require("child_process");

        const maxAttempts = 3;
        const retryDelayMs = 500;

        const runOnce = () => {
          return new Promise((resolve, reject) => {
            const lxshell_childD = proc.spawn("/bin/sh", lxshell_commands, { shell: true });
            let stderr = "";

            lxshell_childD.stderr.on("data", (data) => {
              stderr += data.toString();
            });

            lxshell_childD.on("error", (err) => {
              reject(err);
            });

            lxshell_childD.on("exit", (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Linux TTS-Prozess beendet mit Code ${code}. ${stderr}`));
              }
            });

            lxshell_childD.stdin.end();
          });
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) logger.log("log", `TTS-Versuch ${attempt}/${maxAttempts} für ${wav_tts}`);
            await runOnce();
            if (attempt > 1) logger.log("log", `TTS erfolgreich nach ${attempt} Versuch(en) für ${wav_tts}`);
            return;
          } catch (err) {
            logger.log("warn", `TTS-Versuch ${attempt}/${maxAttempts} fehlgeschlagen: ${err.message}`);
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, retryDelayMs));
            } else {
              throw new Error(`Linux TTS-Prozess nach ${maxAttempts} Versuchen fehlgeschlagen: ${err.message}`);
            }
          }
        }
      },
    },
  };

  const tts_erstellen = async (app_cfg, einsatzdaten, wachen_nr) => {
    try {
      let full_half = "";
      if (einsatzdaten.permissions) {
        // Berechtigungen vorhanden, volle Einsatzdaten verwenden
        full_half = "full";
      } else {
        // Berechtigungen nicht vorhanden, reduzierte Einsatzdaten verwenden
        full_half = "half";
      }

      // Einsatz-UUID inkl. Wachennummer und Permissions als Dateinamen verwenden und unnötige Zeichen entfernen
      const id = einsatzdaten.uuid.replace(/\W/g, "") + "_" + wachen_nr + "_" + full_half;
      const soundPath = process.cwd() + app_cfg.global.soundpath;
      const mediaPath = app_cfg.global.mediapath;

      // Pfade der Sound-Dateien definieren
      const wav_tts = soundPath + id + TTS_CONFIG.fileExtensions.wav;
      const mp3_tmp = soundPath + id + TTS_CONFIG.fileExtensions.tmp;
      const mp3_tts = soundPath + id + TTS_CONFIG.fileExtensions.mp3;
      const mp3_url = mediaPath + id + TTS_CONFIG.fileExtensions.mp3;

      // Prüfen ob mp3 bereits existiert
      if (fs.existsSync(mp3_tts)) {
        return mp3_url;
      }

      // Alarmgong basierend auf Einsatzart wählen
      const mp3_bell =
        soundPath +
        (einsatzdaten.einsatzart === "Brandeinsatz" || einsatzdaten.einsatzart === "Hilfeleistungseinsatz" ? "bell_long.mp3" : "bell_short.mp3");

      // Sprachansage Text erstellen
      let tts_text = `${einsatzdaten.einsatzart}, ${einsatzdaten.stichwort}. `;
      // Orts-/Objekt-Text zusammensetzen ohne 'null' oder leere Teile
      const locParts = [];
      if (einsatzdaten.objektteil) locParts.push(einsatzdaten.objektteil);
      if (einsatzdaten.objekt) locParts.push(einsatzdaten.objekt);
      if (einsatzdaten.ort) locParts.push(einsatzdaten.ort);
      // Ortsteil nur anhängen, wenn vorhanden und nicht identisch zu Ort (case-insensitive)
      if (einsatzdaten.ortsteil && (!einsatzdaten.ort || einsatzdaten.ortsteil.toLowerCase() !== einsatzdaten.ort.toLowerCase())) {
        locParts.push(einsatzdaten.ortsteil);
      }
      tts_text += locParts.join(", ");

      // Textersetzungen aus Datenbank laden in TTS-Text durchführen
      tts_text = await sql.db_tts_ortsdaten(tts_text);

      // Einsatzmittel TTS-Text verarbeiten
      await Promise.all(einsatzdaten.em_alarmiert.map((em) => sql.db_tts_einsatzmittel(em)));
      const tts_text_em_alarmiert = einsatzdaten.em_alarmiert.map((em) => em.tts_text).join(", ");
      tts_text += `. Für ${tts_text_em_alarmiert}`;

      // Sondersignal hinzufügen
      tts_text += einsatzdaten.sondersignal == 1 ? ", mit Sondersignal" : ", ohne Sonderrechte";
      tts_text += ". Ende der Durchsage!";

      // Ungewollte Zeichen entfernen
      tts_text = tts_text.replace(/[:/-]/g, " ");

      // Plattform-spezifische TTS-Erstellung
      const platform = process.platform;
      if (!ttsImplementations[platform]) {
        throw new Error(`TTS für das Betriebssystem ${platform} nicht verfügbar!`);
      }

      await ttsImplementations[platform].createTTS(tts_text, wav_tts, mp3_tmp, mp3_tts, mp3_bell);
      return mp3_url;
    } catch (error) {
      // Fallback: Standard-Gong zurückgeben, wenn TTS-Erstellung fehlschlägt
      const bkp_mp3_bell =
        app_cfg.global.mediapath +
        (einsatzdaten.einsatzart === "Brandeinsatz" || einsatzdaten.einsatzart === "Hilfeleistungseinsatz" ? "bell_long.mp3" : "bell_short.mp3");
      logger.log("warn", `TTS-Erstellung fehlgeschlagen, sende nur Gong. Fehler: ${error.message}`);
      return bkp_mp3_bell;
    }
  };

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
