module.exports = (app_cfg, sql, waip, logger) => {

  // Speichern eines neuen Einsatzes
  const save_einsatz = (waip_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        let waip_json = await validate_einsatz(waip_data);
        if (waip_json) {

          // pruefen, ob vielleicht schon ein Einsatz mit einer UUID gespeichert ist
          let waip_uuid = await sql.db_einsatz_get_uuid_by_enr(waip_json.einsatzdaten.einsatznummer);
          if (waip_uuid) {
            // wenn ein Einsatz mit UUID schon vorhanden ist, dann diese setzten / ueberschreiben
            waip_json.einsatzdaten.uuid = waip_uuid;
          }

          // Einsatzdaten in Datenbank speichern und ID des Einsatzes zurückbekommen
          const waip_id = await sql.db_einsatz_speichern(waip_json);
          logger.log(
            "log",
            `Neuer Einsatz von ${remote_addr} wurde mit der ID ${waip_id} gespeichert und wird jetzt weiter verarbeitet: ${JSON.stringify(waip_json)}`
          );

          // true zurückgeben
          resolve(true);

          // TODO: an dieser Stelle für die Einsatzmittel die koordinaten der Heimatwachen ermitteln und für diese eine Anfrage beim Routing-Server machen

          // Einsatz an Socket-IO-Räume verteilen
          waip.einsatz_verteilen_rooms(waip_id);

          // Einsatzmittel an Socket-IO-Räume verteilen
          //TODO waip.einsatzmittel_verteilen_rooms(waip_id);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren eines Einsatzes. " + waip_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern eines neuen Einsatzes (WAIP-JSON). " + remote_addr + " " + error));
      }
    });
  };

  const save_rmld = (rmld_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("log", `${rmld_data.length} Rückmeldung(en) von ${remote_addr} erhalten.`);
        logger.log("debug", `Rückmeldung(en) von ${remote_addr} werden jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);

        // Variable vorbereiten, in der die Einsatznummern inkl. der zugeöhrigen Rückmeldungen gespeichert werden
        let obj_waip_uuid_mit_rmld_uuid = {};
        let arr_rmld_anzahl = 0;

        let valid = await validate_rmld(rmld_data);
        if (valid) {
          // alle Rückmeldungen per Schliefe in DB in Tabelle waip_rueckmeldungen speichern
          await Promise.all(
            rmld_data.map(async (item) => {
              try {
                // prüfen ob es zur Rückmeldung auch einen Einsatz gibt
                const waip_uuid = await sql.db_rmld_check_einsatz(item);

                if (waip_uuid) {
                  // jetzt einzelne Rückmeldung speichern
                  const response_uuid = await sql.db_rmld_single_save(item);

                  // response_uuid in einem Array speichern, welches waip_uuid als Key hat
                  if (!obj_waip_uuid_mit_rmld_uuid[waip_uuid]) {
                    obj_waip_uuid_mit_rmld_uuid[waip_uuid] = [];
                  }

                  // Rückmeldung in Array speichern, falls noch nicht vorhanden
                  if (!obj_waip_uuid_mit_rmld_uuid[waip_uuid].includes(response_uuid)) obj_waip_uuid_mit_rmld_uuid[waip_uuid].push(response_uuid);

                  // Anzahl erhöhen
                  arr_rmld_anzahl++;

                  logger.log("log", `Neue Rückmeldung von ${remote_addr} wurde mit der ID ${response_uuid} gespeichert.`);
                } else {
                  logger.log("warn", `Kein Einsatz für die Rückmeldung ${item.response_uuid} gefunden, wird nicht gespeichert!`);
                }
              } catch (error) {
                logger.log("error", `Fehler beim speichern einer neuen Rückmeldung. ${error}`);
              }
            })
          );

          // prüfen ob Einsatz-UUIDs mit Rückmeldungs-UUIDs gespeichert wurden
          if (Object.keys(obj_waip_uuid_mit_rmld_uuid).length > 0) {
            // true zurückgeben
            resolve(`Von ${rmld_data.lenght} Rückmeldungen wurden ${arr_rmld_anzahl} gespeichert.`);

            // Rückmeldung verteilen
            waip.rmld_verteilen_rooms(obj_waip_uuid_mit_rmld_uuid);
          } else {
            // false zurückgeben
            resolve(`Von ${rmld_data.lenght} Rückmeldungen wurde keine gespeichert!`);
          }
        }
      } catch (error) {
        reject(new Error("Allgemeiner Fehler beim speichern von neuen Rückmeldung(en). " + remote_addr + error));
      }
    });
  };

  const save_einsatzstatus = (einsatzstatus_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("log", `${rmld_data.length} Meldung(en) zu Einsatzstatus von ${remote_addr} erhalten.`);
        logger.log("debug", `Eisnatzstatus von ${remote_addr} werden jetzt verarbeitet: ${JSON.stringify(einsatzstatus_data)}`);

        let valid = await validate_einsatzstatus(einsatzstatus_data);
        if (valid) {
          // Status eines Einsatzes aktualisieren
          const anz_update = await sql.db_einsatz_statusupdate(einsatzstatus_data);
          if (anz_update > 0) {
            if (einsatzstatus_data.waip_uuid) {
              logger.log("log", `Einsatzstatus zum Einsatz ${einsatzstatus_data.waip_uuid} aktualisiert. Anzahl: ${anz_update}.`);
            } else {
              logger.log("log", `Einsatzstatus zum Einsatz ${einsatzstatus_data.einsatznummer}  aktualisiert. Anzahl: ${anz_update}.`);
            }
          } else {
            logger.log("log", `Es wurde kein Einsatzstatus aktualisiert.`);
          }
          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren einer Einsatz-Status-Meldung. " + einsatzstatus_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern einer Einsatz-Status-Meldung. " + remote_addr + error));
      }
    });
  };

  const save_einsatzmittel = (einsatzmittel_data, remote_addr) => {
    return new Promise(async (resolve, reject) => {
      try {
        logger.log("debug", `Einsatzmittel von ${remote_addr} erhalten, wird jetzt verarbeitet: ${JSON.stringify(rmld_data)}`);
        let valid = await validate_einsatzmittel(einsatzmittel_data);
        if (valid) {
          // Einsatzmittel speichern
          const arr_funkrufnamen = await sql.db_einsatzmittel_update(einsatzmittel_data);
          logger.log("log", `${arr_uuid_rueckmeldungen.length} Einsatzmittel von ${remote_addr} erhalten.`);

          // Einsatzmittel verteilen
          //waip.em_verteilen_by_id(arr_funkrufnamen);

          // true zurückgeben
          resolve(true);
        } else {
          // Error-Meldung erstellen
          throw new Error("Fehler beim validieren eines Einsatzmittels. " + einsatzmittel_data);
        }
      } catch (error) {
        reject(new Error("Fehler beim speichern eines Einsatzmittels. " + remote_addr + error));
      }
    });
  };

  const validate_einsatz = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // false wenn data NULL oder nicht definiert
        if (data === null || data === undefined) {
          resolve(false);
        }
        // wenn data string ist, diesen in json umwandeln
        if (data.constructor == String) {
          let tmp = JSON.parse(data);
          resolve(tmp);
        }
        // wenn data object ist, dann testen ob dieses JSON-Konform ist
        if (data.constructor === Object) {
          let text = JSON.stringify(data);
          if (
            /^[\],:{}\s]*$/.test(
              text
                .replace(/\\["\\\/bfnrtu]/g, "@")
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
                .replace(/(?:^|:|,)(?:\s*\[)+/g, "")
            )
          ) {
            let tmp = JSON.parse(text);
            resolve(tmp);
          } else {
            resolve(false);
          }
        }
        // Log
        logger.log("debug", "Validierung WAIP: " + JSON.stringify(data));
      } catch (error) {
        reject(new Error("Fehler beim Validieren einer WAIP-Einsatzmeldung " + data + error));
      }
    });
  };

  const validate_rmld = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Rückmeldung auf Plausibilität

        // Log
        logger.log("debug", "Validierung RMLD: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren einer Rückmeldung " + data + error));
      }
    });
  };

  const validate_einsatzmittel = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Einsatzmittel auf Plausibilität

        // Log
        logger.log("debug", "Validierung Einsatzmittel: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren eines Einsatzmittels " + data + error));
      }
    });
  };

  const validate_einsatzstatus = (data) => {
    return new Promise((resolve, reject) => {
      try {
        // TODO Validierung: Einsatzstatus auf Plausibilität

        // Log
        logger.log("debug", "Validierung Einsatzstatus: " + JSON.stringify(data));

        resolve(true);
      } catch (error) {
        reject(new Error("Fehler beim Validieren des Einsatzstatus " + data + error));
      }
    });
  };

  return {
    save_einsatz: save_einsatz,
    save_rmld: save_rmld,
    save_einsatzstatus: save_einsatzstatus,
    save_einsatzmittel: save_einsatzmittel,
  };
};
