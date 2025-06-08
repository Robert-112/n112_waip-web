module.exports = (db, app_cfg) => {
  // Module laden
  const { v5: uuidv5 } = require("uuid");

  // Hilfsfunktion um Datum&Zeit (29.12.23&20:06) in SQLite-Zeit umzuwandeln
  const Datetime_to_SQLiteDate = (s) => {
    if (s) {
      let d = new Date();
      let simpletime = new RegExp(/^\d{2}:\d{2}$/);
      let simpledate = new RegExp(/^\d{2}\.\d{2}\.\d{2}&\d{2}:\d{2}$/);
      if (!simpletime.test(s) && !simpledate.test(s)) {
        return null;
      }
      if (simpletime.test(s)) {
        let hour = parseInt(s.substring(0, 2), 10);
        let min = parseInt(s.substring(3, 5), 10);
        d.setHours(hour);
        d.setMinutes(min);
        let iso_date = d.toISOString();
        let sql_date = iso_date.replace(/T|Z/g, " ");
        sql_date = sql_date.trim();
        sql_date = sql_date.substring(0, 19);
        return sql_date;
      }
      if (simpledate.test(s)) {
        let day = parseInt(s.substring(0, 2), 10);
        let month = parseInt(s.substring(3, 5), 10) - 1; // Monate sind nullbasiert
        let year = parseInt(d.getFullYear().toString().substring(0, 2) + s.substring(6, 8), 10);
        let hour = parseInt(s.substring(9, 11), 10);
        let min = parseInt(s.substring(12, 14), 10);
        d.setDate(day);
        d.setMonth(month);
        d.setFullYear(year);
        d.setHours(hour);
        d.setMinutes(min);
        let iso_date = d.toISOString();
        let sql_date = iso_date.replace(/T|Z/g, " ");
        sql_date = sql_date.trim();
        sql_date = sql_date.substring(0, 19);
        return sql_date;
      } else {
        return null;
      }
    } else {
      return null;
    }
  };

  // SQL-Abfragen

  // Einsatz inkl. Einsatzmitteln in Datenbank speichern
  const db_einsatz_speichern = (content) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Abbrechen wenn keine UUID vorhanden ist
        if (!content.einsatzdaten.uuid) {
          throw new Error("Keine UUID überbermittelt, Einsatz wird nicht gespeichert.");
        }

        // Einsatzdaten verarbeiten/speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_einsaetze (
            id, uuid, els_einsatznummer, alarmzeit, ablaufzeit, einsatzart, stichwort, sondersignal, besonderheiten, einsatzdetails,
            ort, ortsteil, ortslage, strasse, hausnummer, ort_sonstiges, objekt, objektteil, objektnummer, objektart, 
            wachenfolge, wgs84_x, wgs84_y, geometry
          ) VALUES (
            (SELECT ID FROM waip_einsaetze WHERE els_einsatznummer LIKE ?),
            ?,
            ?,
            DATETIME(?, 'localtime'),
            DATETIME('now', '+${app_cfg.global.time_to_delete_waip} minutes', 'localtime'), 
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);

        const info = stmt.run(
          content.einsatzdaten.einsatznummer,
          content.einsatzdaten.uuid,
          content.einsatzdaten.einsatznummer,
          Datetime_to_SQLiteDate(content.einsatzdaten.alarmzeit),
          content.einsatzdaten.art,
          content.einsatzdaten.stichwort,
          parseInt(content.einsatzdaten.sondersignal, 10),
          content.einsatzdaten.besonderheiten,
          content.einsatzdaten.einsatzdetails,
          content.ortsdaten.ort,
          content.ortsdaten.ortsteil,
          content.ortsdaten.ortslage,
          content.ortsdaten.strasse,
          content.ortsdaten.hausnummer,
          content.ortsdaten.ort_sonstiges,
          content.ortsdaten.objekt,
          content.ortsdaten.objektteil,
          content.ortsdaten.objektnr,
          content.ortsdaten.objektart,
          content.ortsdaten.wachfolge,
          parseFloat(content.ortsdaten.wgs84_x),
          parseFloat(content.ortsdaten.wgs84_y),
          JSON.stringify(content.ortsdaten.geometry)
        );

        // anschließend die zugehörigen Einsatzmittel per Schliefe in DB speichern
        let itemsProcessed = 0;

        // letzte Einsatz-ID ermitteln
        let id = info.lastInsertRowid;

        // Abschluss der Schleife definieren
        const loop_done = (waip_id) => {
          resolve(waip_id);
        };

        if (content.alarmdaten === undefined) {
          //wenn keine Alarmdaten hinterlegt sind, loop_done direkt aufrufen
          loop_done(id);
        } else {
          // jedes einzelne Einsatzmittel und jede Alarmierung zum Einsatz speichern
          content.alarmdaten.forEach((item, index, array) => {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO waip_einsatzmittel (
                id, 
                em_waip_einsaetze_id, 
                em_station_id, 
                em_station_name, 
                em_funkrufname, 
                em_zeitstempel_alarmierung,
                em_zeitstempel_ausgerueckt
              ) VALUES (
                (SELECT ID FROM waip_einsatzmittel WHERE em_funkrufname LIKE ?),
                ?, 
                (SELECT ID FROM waip_wachen WHERE name_wache LIKE ?),
                ?,
                ?, 
                DATETIME(?),
                DATETIME(?)
              );
            `);

            stmt.run(
              item.einsatzmittel,
              id,
              item.wachenname,
              item.wachenname,
              item.einsatzmittel,
              Datetime_to_SQLiteDate(item.zeit_alarmierung),
              Datetime_to_SQLiteDate(item.zeit_ausgerueckt)
            );

            // Schleife erhoehen
            itemsProcessed++;

            // Schleife beenden
            if (itemsProcessed === array.length) {
              loop_done(id);
            }
          });
        }
      } catch (error) {
        reject(new Error("Fehler beim Speichern der Einsatzgrunddaten. " + error));
      }
    });
  };

  // letzten vorhanden Einsatz zu einer Wache für einen Client/User abfragen
  const db_einsatz_for_client_ermitteln = (socket, wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // wenn Wachen-ID 0 ist, dann % für SQL-Abfrage setzen
        if (parseInt(wachen_nr) == 0) {
          wachen_nr = "%";
        }

        // neuesten Einsatz für die gewählte Wachen-ID abfragen
        const stmt1 = db.prepare(`
          SELECT 
          em.em_waip_einsaetze_id AS waip_id
          FROM waip_einsatzmittel em
          WHERE 
          (SELECT wa.nr_wache FROM waip_wachen wa WHERE wa.id = em.em_station_id) LIKE ? || '%'
          ORDER BY (SELECT zeitstempel FROM waip_einsaetze WHERE id = em.em_waip_einsaetze_id) DESC LIMIT 1
        `);
        const row1 = stmt1.get(wachen_nr.toString());

        if (row1 === undefined) {
          resolve(null);
        } else {
          // User-ID ermitteln
          const user_id = socket.data.user && socket.data.user.id ? socket.data.user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt2 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          const row2 = stmt2.get(user_id);

          // Standard-Reset-Zeit aus app_cfg als Fallback
          reset_timestamp = app_cfg.global.default_time_for_standby;

          // Wenn ein benutzerdefinierter Reset-Counter vorhanden ist, diesen verwenden
          if (row2 !== undefined && row2.config_value) {
            reset_timestamp = row2.config_value;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt3 = db.prepare(`
            SELECT we.id, DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row3 = stmt3.get(reset_timestamp, row1.waip_id, reset_timestamp);

          if (row3 === undefined) {
            resolve(null);
          } else {
            resolve(row3);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der Einsätze für Wachen-ID " + wachen_nr + "). " + error));
      }
    });
  };

  // Überprüfung ob ein Einsatz mit dieser UUID vorhanden ist
  const db_einsatz_check_uuid = (uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, uuid FROM waip_einsaetze WHERE uuid LIKE ? ;
        `);
        const row = stmt.get(uuid);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen der UUID " + uuid + " für einen Einsatz. " + error));
      }
    });
  };

  // Prüfen ob Wachalarm bereits in dieser Form an diesen Socket gesendet wurde (Doppelalarmierung vermeiden)
  const db_einsatz_check_history = (einsatzdaten, socket) => {
    return new Promise((resolve, reject) => {
      try {
        const uuidNamespace = app_cfg.global.uuidNamespace;

        // Nur die relevanten Felder für den Vergleich behalten
        const relevantFields = {
          id: einsatzdaten.id,
          einsatzart: einsatzdaten.einsatzart,
          stichwort: einsatzdaten.stichwort,
          sondersignal: einsatzdaten.sondersignal,
          objekt: einsatzdaten.objekt,
          ort: einsatzdaten.ort,
          ortsteil: einsatzdaten.ortsteil,
          strasse: einsatzdaten.strasse,
          besonderheiten: einsatzdaten.besonderheiten,
        };

        // Einsatzdaten in kurze UUID-Strings umwandeln, diese UUIDs werden dann verglichen
        let uuid_einsatzdaten = uuidv5(JSON.stringify(relevantFields), uuidNamespace);
        let uuid_em_alarmiert = uuidv5(JSON.stringify(einsatzdaten.em_alarmiert || []), uuidNamespace);
        let uuid_em_weitere = uuidv5(JSON.stringify(einsatzdaten.em_weitere || []), uuidNamespace);

        // Abfrage ob zu Socket und Waip-ID bereits History-Daten hinterlegt sind
        const stmt = db.prepare(`
          SELECT * FROM waip_history 
          WHERE waip_uuid LIKE (
            SELECT uuid FROM waip_einsaetze WHERE id = ?
          ) AND socket_id LIKE ? ;
        `);

        const row = stmt.get(einsatzdaten.id, socket.id);

        // neu speichern oder aktualisieren
        if (row === undefined) {
          // wenn keine History-Daten hinterlegt sind, diese speichern
          const stmt = db.prepare(`
            INSERT INTO waip_history (
              waip_uuid, socket_id, uuid_einsatz_grunddaten, uuid_em_alarmiert, uuid_em_weitere
            ) VALUES (
              (SELECT uuid FROM waip_einsaetze WHERE id = ?),
              ?, ?, ?, ?
            );  
          `);

          stmt.run(einsatzdaten.id, socket.id, uuid_einsatzdaten, uuid_em_alarmiert, uuid_em_weitere);

          // Check-History = false
          resolve(false);
        } else {
          // wenn History-Daten hinterlegt sind, dann prüfen ob sich etwas verändert hat
          const isDoppelalarm = uuid_einsatzdaten === row.uuid_einsatz_grunddaten && uuid_em_alarmiert === row.uuid_em_alarmiert;

          // Nur aktualisieren wenn sich etwas geändert hat
          if (!isDoppelalarm) {
            const stmt = db.prepare(`
              UPDATE waip_history SET 
                uuid_einsatz_grunddaten = ?,
                uuid_em_alarmiert = ?,
                uuid_em_weitere = ?
              WHERE 
                waip_uuid LIKE (
                  SELECT uuid FROM waip_einsaetze WHERE id = ?
                ) AND 
                socket_id LIKE ? ;
            `);
            stmt.run(uuid_einsatzdaten, uuid_em_alarmiert, uuid_em_weitere, einsatzdaten.id, socket.id);
          }

          resolve(isDoppelalarm);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen der Einsatz-Historie. " + error));
      }
    });
  };

  // Einsatzdaten entsprechend der WAIP-ID zusammentragen
  const db_einsatz_get_for_wache = (waip_id, wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // falls waip_id oder wachen_nur keine zahlen sind, Abbruch
        if (isNaN(waip_id) || isNaN(wachen_nr)) {
          throw `WAIP-ID ${waip_id} oder Wachennummer ${wachen_nr} sind keine validen Zahlen!`;
        } else {
          // TODO hier auch andere Wachennummern berücksichtigen (z.B. 521201b), siehe auch Rückmeldungen
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          let len = wachen_nr.toString().length;
          if (parseInt(wachen_nr) != 0 && len != 2 && len != 4 && len != 6 && len == null) {
            throw `Wachennummer ${wachen_nr} hat keine valide Länge (0, 2, 4 oder 6)!`;
          }

          // wenn wachen_nr 0, dann % fuer Abfrage festlegen
          if (parseInt(wachen_nr) == 0) {
            wachen_nr = "%";
          }

          // FIXME: zentrale Abfrage zur Ausgabe der Alarmdaten wurde erneuert, asynchrone Rückgabe, Verweise und Verwendung prüfen!
          const stmt = db.prepare(`
              SELECT
                e.id,
                e.uuid,
                DATETIME(e.zeitstempel) zeitstempel,
                e.einsatzart, 
                e.stichwort, 
                e.sondersignal, 
                e.objekt, 
                e.ort, 
                e.ortsteil, 
                e.strasse, 
                e.hausnummer,
                e.besonderheiten, 
                e.wgs84_x, 
                e.wgs84_y,
                e.geometry
              FROM waip_einsaetze e
              WHERE e.id LIKE ?
              ORDER BY e.id DESC LIMIT 1;
            `);

          const einsatzdaten = stmt.get(waip_id.toString());

          if (einsatzdaten === undefined) {
            resolve(null);
          } else {
            // Abfrage der alarmierten Einsatzmittel der Wache
            const stmt1 = db.prepare(`
                SELECT 
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarmierung AS 'zeit'
                FROM waip_einsatzmittel
                WHERE 
                  em_waip_einsaetze_id = ? 
                  AND em_station_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || '%');
              `);
            // alarmierte Einsatzmittel den Einsatzdaten zuordnen
            einsatzdaten.em_alarmiert = stmt1.all(waip_id.toString(), wachen_nr.toString());

            // Abfrage der weiteren Einsatzmittel zum Einsatz
            const stmt2 = db.prepare(`
                SELECT 
                  em_funkrufname AS 'name',
                  em_zeitstempel_alarmierung AS 'zeit'
                FROM waip_einsatzmittel
                WHERE 
                  em_waip_einsaetze_id = ? 
                  AND (em_station_id NOT IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || '%') OR em_station_id IS NULL);
              `);
            // weitere Einsatzmittel den Einsatzdaten zuordnen
            einsatzdaten.em_weitere = stmt2.all(waip_id.toString(), wachen_nr.toString());

            // Einsatzdaten zurückgeben
            resolve(einsatzdaten);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Zusammenstellen der Einsatzdaten für WAIP-ID: " + waip_id + ". " + error));
      }
    });
  };

  // Einsatzdaten über die UUID zusammentragen
  const db_einsatz_get_by_uuid = (waip_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT e.id, e.uuid, e.zeitstempel, e.einsatzart, e.stichwort, e.sondersignal, e.objekt, 
            e.ort, e.ortsteil, e.strasse, e.hausnummer, e.besonderheiten,
            e.wgs84_x, e.wgs84_y, e.geometry
          FROM waip_einsaetze e 
          WHERE e.uuid LIKE ?;
        `);
        let einsatzdaten = stmt.get(waip_uuid);

        if (einsatzdaten === undefined) {
          throw `Abfrage der Einsatzdaten für UUID ${waip_uuid} lieferte kein Ergebnis!`;
        } else {
          // Einsatzmittel zum Einsatz finden
          const stmt1 = db.prepare(`
            SELECT 
              e.em_funkrufname, e.em_fmsstatus, e.em_station_name 
            FROM waip_einsatzmittel e 
            WHERE e.em_waip_einsaetze_id = ?;
          `);
          // Einsatzmittel den Einsatzdaten hinzufügen
          einsatzdaten.einsatzmittel = stmt1.all(einsatzdaten.id);

          // Wachen zum Einsatz finden und hinzufuegen
          const stmt2 = db.prepare(`
            SELECT DISTINCT 
              e.em_station_id, e.em_station_name 
            FROM waip_einsatzmittel e 
            WHERE e.em_waip_einsaetze_id = ?;
          `);
          einsatzdaten.wachen = stmt2.all(einsatzdaten.id);

          // Einsatzdaten zurückgeben
          resolve(einsatzdaten);
        }
      } catch (error) {
        reject(new Error("Fehler beim ermitteln eines Einsatzes über die UUID. " + error));
      }
    });
  };

  // mit Einsatznummer die UUID eines Einsatzes finden
  const db_einsatz_get_uuid_by_enr = (einsatz_nr) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT uuid
          FROM waip_einsaetze 
          WHERE els_einsatznummer LIKE ?;
        `);
        const row = stmt.get(einsatz_nr);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row.uuid);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der UUID eines Einsatzes mit der Einsatznummer " + einsatz_nr + error));
      }
    });
  };

  // mit UUID die ID eines Einsatzes finden
  const db_einsatz_get_waipid_by_uuid = (waip_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id 
          FROM waip_einsaetze 
          WHERE uuid LIKE ?;
        `);
        const row = stmt.get(waip_uuid);
        if (row === undefined) {
          throw `Keinen Einsatz mit der UUID ${waip_uuid} gefunden!`;
        } else {
          resolve(row.id);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der ID eines Einsatzes mit der UUID " + waip_uuid + error));
      }
    });
  };

  // alle aktivieren Einsaetze finden
  const db_einsatz_get_active = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            we.uuid, we.einsatzart, we.stichwort, we.ort, we.ortsteil, we.geometry,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 3 )) a,
            GROUP_CONCAT(DISTINCT SUBSTR( wa.nr_wache, 0, 5 )) b,
            GROUP_CONCAT(DISTINCT wa.nr_wache) c
          FROM waip_einsaetze we
          LEFT JOIN waip_einsatzmittel em ON em.em_waip_einsaetze_id = we.id
          LEFT JOIN waip_wachen wa ON wa.id = em.em_station_id
          GROUP BY we.id
          ORDER BY we.zeitstempel DESC, we.einsatzart, we.stichwort;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen aller aktiven Einsätze. " + error));
      }
    });
  };

  // alle potenziellen Socket-Rooms für einen Einsatz finden
  const db_einsatz_get_waip_rooms = (waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT CAST(w.nr_wache AS decimal) room FROM waip_wachen w
          WHERE w.nr_wache = 0
          UNION ALL
          SELECT CAST(w.nr_kreis AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_kreis
          UNION ALL
          SELECT CAST(w.nr_kreis || w.nr_traeger AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_kreis || w.nr_traeger
          UNION ALL
          SELECT CAST(w.nr_wache AS decimal) room FROM waip_wachen w
          LEFT JOIN waip_einsatzmittel em ON em.em_station_name = w.name_wache
          WHERE em.em_waip_einsaetze_id = ? GROUP BY w.nr_wache;
        `);
        const rows = stmt.all(waip_id, waip_id, waip_id);
        if (rows.length === 0) {
          throw `Kein Socket-Room für Einsatz ${waip_id} gefunden!`;
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der Socket-IO-Räume für Einsatz " + waip_id + ". " + error));
      }
    });
  };

  // veraltete Einsätze finden
  const db_einsaetze_get_old = () => {
    // BUG '-?' in Abfrage könnte falsch sein, ggf. durch '+ ablauf_minuten +' ersetzen
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, uuid, els_einsatznummer 
          FROM waip_einsaetze 
          WHERE DATETIME('now','localtime') >= ablaufzeit;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve();
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der zu löschender Einsätze. " + error));
      }
    });
  };

  // Status eines Einsatzes aktualisieren
  const db_einsatz_statusupdate = (einsatzstatus_data) => {
    // wenn keine Einsatznummer WAIP-Uuid gesetzt ist, einen Fehler ausgeben
    if (!einsatzstatus_data.einsatznummer && !einsatzstatus_data.waip_uuid) {
      throw "Einsatznummer oder WAIP-Uuid muss gesetzt sein!";
    }

    let uuid_query;
    // wenn Einsatznummer aber keiner WAIP-Uuid gesetzt ist, dann Einsatznummer für Abfrage verwenden
    if (einsatzstatus_data.einsatznummer && !einsatzstatus_data.waip_uuid) {
      uuid_query = `(SELECT uuid FROM waip_einsaetze WHERE els_einsatznummer = '${einsatzstatus_data.einsatznummer}')`;
    }
    // wenn WAIP-Uuid gesetzt ist, dann WAIP-Uuid für Abfrage verwenden
    if (einsatzstatus_data.waip_uuid) {
      uuid_query = `'${einsatzstatus_data.waip_uuid}'`;
    }

    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          UPDATE waip_einsaetze SET 
            ablaufzeit = DATETIME('now', 'localtime', '+${app_cfg.global.time_to_delete_waip} minutes')
          WHERE 
            waip_uuid LIKE ${uuid_query};
        `);
        const info = stmt.run();
        // Anzahl der aktualisierten Einsätze zurückgeben
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Aktualisieren des Status eines Einsatzes. " + error));
      }
    });
  };

  // Einsatzdaten vollständig löschen
  const db_einsatz_loeschen = (einsatz_id) => {
    return new Promise((resolve, reject) => {
      try {
        // History löschen
        const stmt1 = db.prepare(`
          DELETE FROM waip_history 
          WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE id = ?);
        `);
        stmt1.run(einsatz_id);
        // Rückmeldungen löschen
        const stmt2 = db.prepare(`
          DELETE FROM waip_rueckmeldungen 
          WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE id = ?);
        `);
        stmt2.run(einsatz_id);
        // Einsatzmittel löschen
        const stmt3 = db.prepare(`
          DELETE FROM waip_einsatzmittel 
          WHERE em_waip_einsaetze_id = ?;
        `);
        stmt3.run(einsatz_id);
        // Einsatz löschen
        const stmt4 = db.prepare(`
          DELETE FROM waip_einsaetze 
          WHERE id = ?;
        `);
        const info = stmt4.run(einsatz_id);
        // Anzahl der gelöschten Einsätze zurückgeben
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim Löschen der Daten zum Einsatz mit der ID " + einsatz_id + ". " + error));
      }
    });
  };

  // alle im System verfügbaren Wachen/Alarmmonitore abfragen
  const db_wache_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 'wache' typ, nr_wache nr, name_wache name 
          FROM waip_wachen 
          WHERE nr_wache is not '0'
          UNION ALL
          SELECT 'traeger' typ, nr_kreis || nr_traeger nr, name_traeger name 
          FROM waip_wachen 
          WHERE nr_kreis is not '0' 
          GROUP BY nr_traeger 
          UNION ALL
          SELECT 'kreis' typ, nr_kreis nr, name_kreis name 
          FROM waip_wachen 
          GROUP BY name_kreis 
          ORDER BY typ, name;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          throw `Keine Wachen / Alarmmonitore hinterlegt! Mindestens eine Standard-Wache muss vorhanden sein!`;
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der verfügbaren Wachen / Alarmmonitore. " + error));
      }
    });
  };

  // Prüffunktion um zu erkennen ob wachen_nr valide ist
  const db_wache_vorhanden = (wachen_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // wachen_nr muss eine Zahl sein, sonst nicht valide
        if (isNaN(wachen_nr)) {
          throw `Wachennummer ${wachen_nr} ist keine Zahl!`;
        } else {
          // wenn wachen_nr eine Zahl ist, dann prüfen ob die Länge valide ist
          let len = wachen_nr.toString().length;
          // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
          if (parseInt(wachen_nr) != 0 && len != 2 && len != 4 && len != 6) {
            // Fehler: Wachennummer nicht plausibel.
            throw `Wachennummer ${wachen_nr} ist nicht plausibel! 0, 2, 4 oder 6`;
          } else {
            // "Type" der wachen_nr in String umwandeln, damit SQL-Anweisungen wirklich funktionieren
            wachen_nr = wachen_nr + "";
            // wachen_nr plausibel, jetzt je nach Länge passende SQL-Anweisung ausführen
            if (parseInt(wachen_nr) == 0) {
              const stmt = db.prepare(`
                SELECT '1' length, nr_wache nr, name_wache name 
                FROM waip_wachen 
                WHERE nr_wache LIKE ?;
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (0) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 2) {
              const stmt = db.prepare(`
                SELECT '2' length, nr_kreis nr, name_kreis name 
                FROM waip_wachen 
                WHERE nr_kreis LIKE ? 
                GROUP BY name_kreis LIMIT 1
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (2) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 4) {
              const stmt = db.prepare(`
                SELECT '4' length, nr_kreis || nr_traeger nr, name_traeger name 
                FROM waip_wachen 
                WHERE nr_kreis LIKE SUBSTR(?,-4, 2) 
                  AND nr_traeger LIKE SUBSTR(?,-2, 2) 
                GROUP BY name_traeger LIMIT 1;
              `);
              const row = stmt.get(wachen_nr, wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (4) gefunden!`;
              } else {
                resolve(row);
              }
            }
            if (len == 6) {
              const stmt = db.prepare(`
                SELECT '6' length, nr_wache nr, name_wache name 
                FROM waip_wachen 
                WHERE nr_wache LIKE ?;
              `);
              const row = stmt.get(wachen_nr);
              if (row === undefined) {
                throw `keine Wachennummer ${wachen_nr} (6) gefunden!`;
              } else {
                resolve(row);
              }
            }
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Überprüfen der Wachennummer " + wachen_nr + ". " + error));
      }
    });
  };

  // Einsatzmittel-Daten speichern
  const db_einsatzmittel_update = (einsatzmittel_data) => {
    return new Promise((resolve, reject) => {
      try {
        // Variablen vorbereiten
        const itemsProcessed = 0;
        const arr_funkkenner = [];

        // alle Einsatzmittel per Schliefe in DB in Tabelle waip_einsatzmittel speichern
        einsatzmittel_data.einsatzmittel.forEach((item, index, array) => {
          // Bei Status 3 die Zeit für Ausrücken setzen
          if (item.fms_status == 3) {
            item.em_zeitstempel_ausgerueckt = item.fms_zeitstempel;
          } else {
            item.em_zeitstempel_ausgerueckt = null;
          }

          // Abfrage vorbereiten
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO waip_einsatzmittel (
              id, 
              zeitstempel,
              em_waip_einsaetze_id, 
              els_einsatznummer,
              em_funkrufname,
              em_kennzeichen,
              em_typ,
              em_bezeichnung,
              em_fmsstatus,
              em_wgs84_x,
              em_wgs84_y,
              em_issi,
              em_opta,
              em_radiochannel,
              em_station_id,
              em_station_nr,
              em_station_name,
              em_zeitstempel_ausgerueckt,
              em_zeitstempel_fms,
              em_staerke_els
            ) VALUES (
              (SELECT ID FROM waip_einsatzmittel WHERE em_funkrufname LIKE ?),
              DATETIME('now', 'localtime'), 
              (SELECT ID FROM waip_einsaetze WHERE els_einsatznummer LIKE ?),
              ?, 
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              (SELECT id FROM waip_wachen WHERE name_wache LIKE ?),
              (SELECT nr_wache FROM waip_wachen WHERE name_wache LIKE ?),
              ?,
              ?,
              ?
            );
          `);

          //Abfrage ausführen
          const info = stmt.run(
            item.funkrufname,
            item.einsatznummer,
            item.funkrufname,
            item.kennzeichen,
            item.typ,
            item.bezeichnung,
            item.fms_status,
            item.wgs84_x,
            item.wgs84_y,
            item.issi,
            item.opta,
            item.radiochannel,
            item.wachenname,
            item.wachenname,
            item.wachenname,
            Datetime_to_SQLiteDate(item.em_zeitstempel_ausgerueckt),
            Datetime_to_SQLiteDate(item.fms_zeitstempel),
            item.staerke
          );

          // item.funkrufname an arr_rmld_uuid anhängen
          arr_funkkenner.push(item.funkrufname);

          // Schleife erhoehen
          itemsProcessed++;

          // Schleife beenden
          if (itemsProcessed === array.length) {
            resolve(arr_funkkenner);
          }
        });
      } catch (error) {
        reject(new Error("Fehler beim Speichern der Einsatzmittel-Daten. " + error));
      }
    });
  };

  // Einsatzmittel in gesprochenen Rufnamen umwandeln
  const db_tts_einsatzmittel = (einsatzmittel_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // normierte Schreibweise "xx xx 00/00-00" festlegen
        let schreibweise = /[\/]\d{2}[-]\d{2}/g;
        let funkrufnummern = einsatzmittel_obj.name.match(schreibweise);

        // Schreibweise überprüfen und ggf. Übersetzung ermitteln
        if (funkrufnummern) {
          // Einsatzmitteltyp ermitteln
          let typ = funkrufnummern.toString().substring(1, 3);
          // Einsatzmittel-Nr ermitteln
          let nr = funkrufnummern.toString().substring(4, 6);
          nr = nr.toString().replace(/^0+/, "");

          // hinterlegte Ersetzungen finden
          const stmt = db.prepare(`
            SELECT rp_output name 
            FROM waip_replace 
            WHERE rp_typ = 'em_tts' AND rp_input = ?;
          `);

          const row = stmt.get(typ);

          if (row === undefined) {
            einsatzmittel_obj.tts_text = einsatzmittel_obj.name;
            resolve(einsatzmittel_obj);
          } else {
            einsatzmittel_obj.tts_text = row.name + " " + nr;
            resolve(row.name + " " + nr);
          }
          // Funkkenner des Einsatzmittels in gesprochen Text umwandeln
        } else {
          einsatzmittel_obj.tts_text = einsatzmittel_obj.name;
          resolve(einsatzmittel_obj);
        }
      } catch (error) {
        reject(new Error(`Fehler beim Übersetzen des Funkrufnamens ${funkrufname} für Text-to-Speech.` + error));
      }
    });
  };

  // Client-Status aktualisieren / speichern
  const db_client_update_status = (socket, client_status) => {
    return new Promise(async (resolve, reject) => {
      try {
        // Socket ID
        let socket_id = socket.id;

        // Client-IP-Adressen aus Socket ermitteln und als Array speichern
        let client_ips = [];

        // IP-Adresse aus verschiedenen Headern ermitteln
        if (socket.handshake.headers["x-forwarded-for"]) {
          // X-Forwarded-For Header enthält die ursprüngliche Client-IP
          client_ips.push(socket.handshake.headers["x-forwarded-for"].split(",")[0].trim());
        }

        if (socket.handshake.headers["forwarded"]) {
          // Forwarded Header nach RFC 7239
          const forwarded = socket.handshake.headers["forwarded"];
          const forMatch = forwarded.match(/for=([^;]+)/);
          if (forMatch) {
            client_ips.push(forMatch[1].trim());
          }
        }

        // Direkte Socket-Verbindung als Fallback
        if (socket.handshake.address) {
          client_ips.push(socket.handshake.address);
        }

        // Duplikate entfernen und als String zusammenführen
        client_ips = [...new Set(client_ips)].join(", ");

        // Namespace ermitteln, im dem sich der Socket aktuelle befindet
        let client_nsp = socket.nsp.name;

        // Raum ermitteln, in dem sich der Socket aktuell befindet
        let client_room = null;
        let roomKeys = Array.from(socket.rooms);
        if (roomKeys.length > 1) {
          client_room = roomKeys[1];
        }

        // Standby wenn Client-Status keine Nummer oder Null
        if (isNaN(client_status) || client_status == null) {
          client_status = "Standby";
        }

        // Nutzername, falls bekannt
        let user_name = socket.data.user.user;
        if (user_name === undefined) {
          user_name = "Gast";
        }

        // Berechtigungen, falls bekannt
        let user_permissions = socket.data.user.permissions;
        if (user_permissions === undefined) {
          user_permissions = "keine";
        }

        // User-Agent
        let user_agent = socket.request.headers["user-agent"];

        // Reset-Zeitstempel in Abhängigkeit der Einstellungen ermitteln
        let reset_timestamp = null;

        if (client_status !== "Standby") {
          // User-ID ermitteln
          const user_id = socket.data.user && socket.data.user.id ? socket.data.user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt1 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          const row1 = stmt1.get(user_id);

          // Standard-Reset-Zeit aus app_cfg als Fallback
          let time_for_standby = app_cfg.global.default_time_for_standby;

          // Wenn ein benutzerdefinierter Reset-Counter vorhanden ist, diesen verwenden
          if (row1 !== undefined && row1.config_value) {
            time_for_standby = row1.config_value;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt2 = db.prepare(`
            SELECT we.id, DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row2 = stmt2.get(time_for_standby, client_status, time_for_standby);

          if (row2 === undefined) {
            reset_timestamp = null;
          } else {
            reset_timestamp = row2.reset_time;
          }
        }

        // Client-Status in DB speichern
        const stmt2 = db.prepare(`
          INSERT OR REPLACE INTO waip_clients (
            id, 
            socket_id, 
            client_ips,
            client_nsp, 
            client_room,
            client_status,
            user_name, 
            user_permissions, 
            user_agent,
            reset_timestamp
          ) VALUES (
            (SELECT id FROM waip_clients WHERE socket_id = ?),
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          );        
        `);
        const info = stmt2.run(
          socket_id,
          socket_id,
          client_ips,
          client_nsp,
          client_room,
          client_status,
          user_name,
          user_permissions,
          user_agent,
          reset_timestamp
        );
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler bei Aktualisierung des Clientstatus. Status:" + client_status + error));
      }
    });
  };

  // Verbundene Clients ermitteln
  const db_client_get_connected = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim abfragen der verbundenen Clients:" + error));
      }
    });
  };

  // Client aus Datenbank entfernen
  const db_client_delete = (socket) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          DELETE FROM waip_clients WHERE socket_id = ?
        `);
        const info = stmt.run(socket.id);
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim löschen eines Clients. " + socket + error));
      }
    });
  };

  // Pruefen ob für einen Client ein Einsatz vorhanden ist
  const db_client_check_waip_id = (socket_id, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT client_status id FROM waip_clients WHERE socket_id LIKE ?;
        `);
        const row = stmt.get(socket_id);
        if (row === undefined) {
          resolve(null);
        } else {
          if (row.id == waip_id) {
            resolve(row);
          } else {
            resolve(null);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei Einsatzprüfung für einen Client. " + socket_id + waip_id + error));
      }
    });
  };

  // Daten in Protokollieren und Log begrenzen
  const db_log = (typ, text) => {
    return new Promise((resolve, reject) => {
      try {
        let do_log = true;
        // Debug Eintraege nur bei Development speichern
        let debug_regex = new RegExp("debug", "gi");
        if (typ.match(debug_regex)) {
          do_log = app_cfg.development.dev_log;
        }
        if (do_log) {
          // Log-Eintrag schreiben
          const stmt1 = db.prepare(`
            INSERT INTO waip_log (
              log_typ, 
              log_text
            ) VALUES (
              ?,
              ?
            );
          `);
          stmt1.run(typ, text);

          // Log begrenzen um Speicherplatz in der DB zu begrenzen
          const stmt2 = db.prepare(`
            DELETE FROM waip_log WHERE id IN
            (
              SELECT id FROM waip_log ORDER BY id DESC LIMIT ?, 100
            );
          `);
          const info = stmt2.run(app_cfg.global.db_limit_log);

          resolve(info.changes);
        }
      } catch (error) {
        reject(new Error("Fehler beim Schreiben eines Log-Eintrags. " + typ + text + error));
      }
    });
  };

  // letzten 10000 Log-Einträge abfragen
  const db_log_get_10000 = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_log ORDER BY id DESC LIMIT 10000;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen der letzten Log-Einträge. " + error));
      }
    });
  };

  // Client-Eintrag per Socket-ID finden
  const db_socket_get_by_id = (socket_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT * FROM waip_clients WHERE socket_id = ?;
        `);
        const row = stmt.get(socket_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen eines Client-Eintrags über die Socket-ID. " + socket_id + error));
      }
    });
  };

  // Sockets (Clients) finden, die in den Standby gehen sollen
  const db_socket_get_all_to_standby = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT socket_id FROM waip_clients
          WHERE reset_timestamp < DATETIME('now', 'localtime');
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim Abfragen Socket-IDs für Clients in Standby gehen sollen. " + error));
      }
    });
  };

  // Konfiguration der Anzeigezeit eines Users speichern
  const db_user_set_config_time = (user_id, reset_counter) => {
    return new Promise((resolve, reject) => {
      try {
        // reset_counter validieren, ansonsten auf default setzen
        if (!(reset_counter >= 1 && reset_counter <= app_cfg.global.time_to_delete_waip)) {
          reset_counter = app_cfg.global.default_time_for_standby;
        }
        // Anzeigezeit speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_user_config
          (id, user_id, config_type, config_value)
          VALUES (
            (SELECT id FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter'),
            ?,
            ?,
            ?
          );
        `);
        const info = stmt.run(user_id, user_id, "resetcounter", reset_counter);
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim speichern / aktualisieren der Einstellung der Anzeigezeit eines Benutzers. " + reset_counter + error));
      }
    });
  };

  // Konfiguration der Standby-URL eines Users speichern
  const db_user_set_config_url = (user_id, url) => {
    return new Promise((resolve, reject) => {
      try {
        // prüfen der übermittelte Wert wirklich eine URL ist, sonst fehler zurückgeben
        const url_regex = new RegExp(
          "^(https?:\\/\\/)?((?!localhost)(?!127\\.0\\.0\\.1)((\\d{1,3}\\.){3}\\d{1,3}|[\\da-z.-]+)\\.([a-z.]{2,6}|\\d{1,5})(:[0-9]{1,5})?(\\/.*)?)$",
          "i"
        );
        if (url && !url_regex.test(url)) {
          throw `Die übergebene URL ${url} ist nicht valide!`;
        }
        // URL speichern
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO waip_user_config
          (id, user_id, config_type, config_value)
          VALUES (
            (SELECT id FROM waip_user_config WHERE user_id = ? AND config_type = 'standbyurl'),
            ?,
            ?,
            ?
          );
        `);
        const info = stmt.run(user_id, user_id, "standbyurl", url);
        resolve(info.changes);
      } catch (error) {
        reject(new Error("Fehler beim speichern / aktualisieren der Einstellung der Standby-URL eines Benutzers. " + error));
      }
    });
  };

  // Einstellungen eines Benutzers laden
  const db_user_get_config = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            COALESCE(
              (SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter'), 
              ${app_cfg.global.default_time_for_standby}
            ) AS resetcounter,
            COALESCE(
              (SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'standbyurl'), 
              null
            ) AS standbyurl;
        `);
        const row = stmt.get(user_id, user_id);
        resolve(row);
      } catch (error) {
        reject(new Error("Fehler beim laden von Benutzer-Einstellungen. " + error));
      }
    });
  };

  // Prüfen ob die Anzeigezeit für einen Benutzer abgelaufen ist
  const db_client_get_alarm_anzeigbar = (socket, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        // Namespace ermitteln, im dem sich der Socket aktuelle befindet
        const client_nsp = socket.nsp.name;

        // Anzeigezeit für einen Alarmmonitor ermitteln
        if (client_nsp === "/waip") {
          // User-ID aus Socket ermitteln
          const user_id = socket.data.user && socket.data.user.id ? socket.data.user.id : null;

          // Reset-Counter des Users ermitteln
          const stmt1 = db.prepare(`
            SELECT config_value FROM waip_user_config
            WHERE user_id = ? AND config_type = 'resetcounter';
          `);
          let row1 = stmt1.get(user_id);

          // sollte kein Reset-Counter vorhanden sein, dann die Standard-Reset-Zeit aus app_cfg verwenden
          if (row1 == null) {
            // wenn row1 keine werte hat, das objekt config_value auf den default setzen
            row1 = {};
            row1.config_value = app_cfg.global.default_time_for_standby;
          }

          // prüfen ob der Zeitstempel des Einsatzes + Reset-Counter nicht über der aktuellen Uhrzeit liegt
          const stmt2 = db.prepare(`
            SELECT DATETIME(we.zeitstempel, ? || ' minutes') reset_time
            FROM waip_einsaetze we
            WHERE we.id = ? 
            AND DATETIME(we.zeitstempel, ? || ' minutes') > DATETIME('now', 'localtime');
          `);
          const row2 = stmt2.get(row1.config_value, waip_id, row1.config_value);

          // null zurückgeben, wenn der Einsatz nicht mehr angezeigt werden kann, ansonsten die Uhrzeit der Reset-Time
          if (row2 == null) {
            resolve(null);
          } else {
            resolve(row2.reset_time);
          }
        }

        // null zurückgeben, wenn kein Namespace ermittelt werden konnte
        resolve(null);
      } catch (error) {
        reject(new Error("Fehler beim Prüfen ob der Alarm für einen Nutzer angezeigt werden kann. " + waip_id + error));
      }
    });
  };

  // alle Benutzer laden
  const db_user_get_all = () => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, user, permissions, ip_address FROM waip_user;
        `);
        const rows = stmt.all();
        if (rows.length === 0) {
          resolve(null);
        } else {
          resolve(rows);
        }
      } catch (error) {
        reject(new Error("Fehler beim laden aller Benutzerdaten. " + error));
      }
    });
  };

  //  Standby-URL eines Benutzer laden
  const db_user_get_config_url = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'standbyurl';
        `);
        const row = stmt.get(user_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row.config_value);
        }
      } catch (error) {
        reject(new Error("Fehler beim laden der URL eines Benutzers. " + error));
      }
    });
  };

  // Berechtigung eines Nutzers für einen Einsatz überpruefen
  const db_user_check_permission_for_waip = (socket, waip_id) => {
    return new Promise((resolve, reject) => {
      try {
        // User-ID und Berechtigung aus Socket ermitteln
        const user_id = socket.data.user && socket.data.user.id ? socket.data.user.id : null;
        const permissions = socket.data.user && socket.data.user.permissions ? socket.data.user.permissions : null;

        // wenn keine user_id oder permissions übergeben wurden, dann false
        if (!user_id || !permissions) {
          resolve(false);
        }

        // wenn admin, dann true, ansonsten Berechtigung abfragen
        if (permissions == "admin") {
          resolve(true);
        } else {
          // Berechtigungen aus DB abfragen -> 52,62,6690,....
          const stmt = db.prepare(`
            SELECT GROUP_CONCAT(DISTINCT wa.nr_wache) wache FROM waip_einsatzmittel em
            LEFT JOIN waip_wachen wa ON wa.id = em.em_station_id
            WHERE em_waip_einsaetze_id = ?;
          `);
          const row = stmt.get(waip_id);
          // keine Wache für Benutzer hinterlegt, dann false
          if (row === undefined) {
            resolve(false);
          } else {
            // Berechtigungen mit Wache vergleichen, wenn gefunden, dann true, sonst false
            let permission_arr = permissions.split(",");
            const found = permission_arr.some((r) => row.wache.search(RegExp("," + r + "|\\b" + r)) >= 0);
            if (found) {
              resolve(true);
            } else {
              resolve(false);
            }
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim Überprüfen der Berechtigungen eines Benutzers für einen Einsatz. " + socket.data.user + waip_id + error));
      }
    });
  };

  // Berechtigung eines Nutzer für eine Rückmeldung überpruefen
  const db_user_check_permission_for_rmld = (socket, wache_nr) => {
    return new Promise((resolve, reject) => {
      try {
        // User-ID und Berechtigung aus Socket ermitteln
        const user_id = socket.data.user && socket.data.user.id ? socket.data.user.id : null;
        const permissions = socket.data.user && socket.data.user.permissions ? socket.data.user.permissions : null;

        // wenn keine user_id oder permissions übergeben wurden, dann false
        if (!user_id || !permissions) {
          resolve(false);
        }

        // wenn admin, dann true, ansonsten Berechtigung abfragen
        if (permissions == "admin") {
          resolve(true);
        }

        // Berechtigungen mit Wache vergleichen (52,62,6690,....), wenn gefunden, dann true, sonst false
        let permission_arr = permissions.split(",");
        const found = permission_arr.some((r) => wache_nr.search(RegExp("," + r + "|\\b" + r)) >= 0);
        if (found) {
          resolve(true);
        } else {
          resolve(false);
        }
      } catch (error) {
        reject(new Error("Fehler beim Überprüfen der Berechtigungen eines Benutzers für eine Rückmeldung. " + socket.data.user + wache_nr + error));
      }
    });
  };

  const db_rmld_check_einsatz = (rmld_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // UUID mittels Einsatznummer oder UUID abgleichen
        if (rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          var stmt = db.prepare(`SELECT e.uuid FROM waip_einsaetze e WHERE e.els_einsatznummer = ? ;`);
          var parameter = rmld_obj.einsatznummer;
        } else {
          var stmt = db.prepare(`SELECT e.uuid FROM waip_einsaetze e WHERE e.uuid = ? ;`);
          var parameter = rmld_obj.waip_uuid;
        }
        const row = stmt.get(parameter);
        if (row === undefined) {
          resolve();
        } else {
          resolve(row.uuid);
        }
      } catch (error) {
        reject(new Error("Fehler beim Prüfen eines Einsatzes für eine Rückmeldung. " + rmld_obj + error));
      }
    });
  };

  const db_rmld_single_save = (rmld_obj) => {
    return new Promise((resolve, reject) => {
      try {
        // wenn keine Einsatznummer WAIP-Uuid gesetzt ist, einen Fehler ausgeben
        if (!rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          throw "Einsatznummer oder WAIP-Uuid muss gesetzt sein!";
        }

        // if rmld_obj.response_alias is not set, then set to null
        if (!rmld_obj.response_alias) {
          rmld_obj.response_alias = null;
        }

        // if rmld_obj.rmld_address is not set, then set to null
        if (!rmld_obj.rmld_address) {
          rmld_obj.rmld_address = null;
        }

        // if rmld_obj.response_role is not set, then set to null
        if (!rmld_obj.response_role) {
          rmld_obj.response_role = null;
        }

        // Verschiedenen Funktionen innerhalb der Rückmeldungen auf 1 oder 0 setzen
        if (rmld_obj.response_capability_agt) {
          rmld_obj.response_capability_agt = 1;
        } else {
          rmld_obj.response_capability_agt = 0;
        }
        if (rmld_obj.response_capability_ma) {
          rmld_obj.response_capability_ma = 1;
        } else {
          rmld_obj.response_capability_ma = 0;
        }
        if (rmld_obj.response_capability_fzf) {
          rmld_obj.response_capability_fzf = 1;
        } else {
          rmld_obj.response_capability_fzf = 0;
        }
        if (rmld_obj.response_capability_med) {
          rmld_obj.response_capability_med = 1;
        } else {
          rmld_obj.response_capability_med = 0;
        }

        // if rmld_obj.time_arrival is not set, then set to null
        if (!rmld_obj.time_arrival) {
          rmld_obj.time_arrival = null;
        }

        // if rmld_obj.type_decision is not set, then set to null
        if (!rmld_obj.type_decision) {
          rmld_obj.type_decision = null;
        }

        // if rmld_obj.time_decision is not set, then set to null
        if (!rmld_obj.time_decision) {
          rmld_obj.time_decision = null;
        }

        // if rmld_obj.time_receive is not set, then set to null
        if (!rmld_obj.time_receive) {
          rmld_obj.time_receive = null;
        }

        // if rmld_obj.wache_nr is not set, then set to null
        if (!rmld_obj.wache_nr) {
          rmld_obj.wache_nr = null;
        }

        // if rmld_obj.wache_nr is number, convert to string
        if (typeof rmld_obj.wache_nr === "number") {
          rmld_obj.wache_nr = rmld_obj.wache_nr.toString();
        }

        let uuid_query;
        // wenn Einsatznummer aber keiner WAIP-Uuid gesetzt ist, dann Einsatznummer für Abfrage verwenden
        if (rmld_obj.einsatznummer && !rmld_obj.waip_uuid) {
          uuid_query = `(SELECT uuid FROM waip_einsaetze WHERE els_einsatznummer = '${rmld_obj.einsatznummer}')`;
        }
        // wenn WAIP-Uuid gesetzt ist, dann WAIP-Uuid für Abfrage verwenden
        if (rmld_obj.waip_uuid) {
          uuid_query = `'${rmld_obj.waip_uuid}'`;
        }

        // Abfrage für Insert / Replace vorbereiten
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO waip_rueckmeldungen (
              id, waip_uuid, rmld_uuid, rmld_alias, rmld_address, rmld_role, 
              rmld_capability_agt, rmld_capability_ma, rmld_capability_fzf, rmld_capability_med,
              time_receive, type_decision, time_decision, time_arrival, wache_id, wache_nr, wache_name)
            VALUES (
              (SELECT id FROM waip_rueckmeldungen WHERE rmld_uuid = ?),
              ${uuid_query},
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              (SELECT id FROM waip_wachen WHERE nr_wache = ?),
              (SELECT nr_wache FROM waip_wachen WHERE nr_wache = ?),
              (SELECT name_wache FROM waip_wachen WHERE nr_wache = ?)
            ); 
          `);

        // Daten in Datenbank speichern
        const info = stmt.run(
          rmld_obj.response_uuid,
          rmld_obj.response_uuid,
          rmld_obj.response_alias,
          rmld_obj.response_address,
          rmld_obj.response_role,
          rmld_obj.response_capability_agt,
          rmld_obj.response_capability_ma,
          rmld_obj.response_capability_fzf,
          rmld_obj.response_capability_med,
          rmld_obj.time_receive,
          rmld_obj.type_decision,
          rmld_obj.time_decision,
          rmld_obj.time_arrival,
          rmld_obj.wache_nr,
          rmld_obj.wache_nr,
          rmld_obj.wache_nr
        );

        resolve(rmld_obj.response_uuid);
      } catch (error) {
        reject(new Error("Fehler beim verarbeiten einer Rückmeldung. " + rmld_obj + error));
      }
    });
  };

  // bestimmte Rückmeldungen zu einem Einsatz einer Wache laden
  const db_rmlds_get_for_wache = (wachen_nr, waip_id, arr_rmld_uuid) => {
    return new Promise((resolve, reject) => {
      try {
        // wachen_nr muss 2, 4 oder 6 Zeichen lang sein
        let len = wachen_nr.toString().length;
        if (parseInt(wachen_nr) != 0 && len != 2 && len != 4 && len != 6 && len == null) {
          throw `Wachennummer ${wachen_nr} hat keine valide Länge (0, 2, 4 oder 6)!`;
        }

        // wenn wachen_nr 0, dann % fuer Abfrage festlegen
        if (parseInt(wachen_nr) == 0) {
          wachen_nr = "%";
        }

        // Abfrage für Rückmeldungen arr_rmld_uuid, in abhängigkeit ob arr_rmld_uuid gesetzt
        if (arr_rmld_uuid) {
          const stmt = db.prepare(`
            SELECT * 
            FROM waip_rueckmeldungen 
            WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE ID = ?)
            AND wache_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || '%')
            AND type_decision = ? 
            AND rmld_uuid IN (SELECT value FROM json_each(?));
          `);

          const rows = stmt.all(waip_id, wachen_nr.toString(), "accept", JSON.stringify(arr_rmld_uuid));

          if (rows.length === 0) {
            resolve(null);
          } else {
            resolve(rows);
          }
        } else {
          const stmt = db.prepare(`
            SELECT * 
            FROM waip_rueckmeldungen 
            WHERE waip_uuid = (SELECT uuid FROM waip_einsaetze WHERE ID = ?)
            AND wache_id IN (SELECT id FROM waip_wachen WHERE nr_wache LIKE ? || '%')
            AND type_decision = ? ;
          `);

          const rows = stmt.all(waip_id, wachen_nr.toString(), "accept");

          if (rows.length === 0) {
            resolve(null);
          } else {
            resolve(rows);
          }
        }
      } catch (error) {
        reject(new Error("Fehler beim laden von Rückmeldungen. " + wachen_nr + waip_id + arr_rmld_uuid + error));
      }
    });
  };

  // Benutzer-Objekt für Authorisierung aus der Datenbank laden
  const auth_deserializeUser = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT 
            id, 
            user, 
            permissions,
            (SELECT config_value FROM waip_user_config WHERE user_id = ? AND config_type = 'resetcounter') reset_counter
          FROM waip_user 
          WHERE id = ?;
        `);
        const row = stmt.get(id, id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_deserializeUser. " + id + error));
      }
    });
  };

  // Authorisierung über IP-Adresse
  const auth_ipstrategy = (profile_ip) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT user, id FROM waip_user WHERE ip_address = ?;
        `);
        const row = stmt.get(profile_ip);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ipstrategy. " + profile_ip + error));
      }
    });
  };

  // Abfrage des verschlüsselten Passwords zum Abgleich
  const auth_localstrategy_cryptpassword = (user) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT password FROM waip_user WHERE user = ?;
        `);
        const row = stmt.get(user);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_localstrategy_cryptpassword. " + user + error));
      }
    });
  };

  // User und Id für Authorisierung
  const auth_localstrategy_userid = (user) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT user, id FROM waip_user WHERE user = ?;
        `);
        const row = stmt.get(user);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_localstrategy_userid. " + user + error));
      }
    });
  };

  // sicherstellen das User Rechte für die API hat
  const auth_ensureApi = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const row = stmt.get(id);

        if (row === undefined) {
          resolve(false);
        } else {
          if (row.permissions == "api") {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ensureApi. " + id + error));
      }
    });
  };

  // sicherstellen das User Admin-Rechte hat
  const auth_ensureAdmin = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT permissions FROM waip_user WHERE id = ?;
        `);
        const row = stmt.get(id);
        if (row === undefined) {
          resolve(false);
        } else {
          if (row.permissions == "admin") {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_ensureAdmin. " + id + error));
      }
    });
  };

  // Neuen User anlegen
  const auth_create_new_user = (user, password, description, permissions, ip_address) => {
    return new Promise((resolve, reject) => {
      try {
        // Prüfen ob User bereits in Datenbank vorhanden
        const stmt1 = db.prepare(`
          SELECT user FROM waip_user WHERE user = ?
        `);
        const row1 = stmt1.get(user);

        // wenn User bereits vorhanden, dann Error ausgeben
        if (row1 !== undefined) {
          throw new Error("Es existiert bereits ein Benutzer mit diesem Namen! " + user);
        }

        const stmt2 = db.prepare(`
          INSERT INTO waip_user ( 
            user, 
            password,
            description,
            permissions, 
            ip_address 
          ) VALUES ( 
            ?, 
            ?, 
            ?, 
            ?, 
            ? 
          );
        `);
        const info = stmt2.run(user, password, description, permissions, ip_address);
        resolve(info.lastInsertRowid);
      } catch (error) {
        reject(new Error("Fehler beim Anlegen eines neuen Users. " + user + error));
      }
    });
  };

  // einen Nutzer aus der Datebank löschen
  const auth_deleteUser = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          DELETE FROM waip_user WHERE id = ?;
        `);
        const row = stmt.run(user_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_deleteUser. " + user_id + error));
      }
    });
  };

  // einen Nutzer in der Datenbank bearbeiten
  const auth_editUser = (query) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(query);
        const row = stmt.run();
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_editUser. " + id + error));
      }
    });
  };

  // einen Nutzer in der Datenbank anhand seiner ID suchen
  const auth_getUser = (user_id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
          SELECT id, user, description FROM waip_user WHERE id = ?;
        `);
        const row = stmt.run(user_id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_getUser. " + user_id + error));
      }
    });
  };

  // neuen Credential anlegen
  const auth_create_credentials = (user_id, external_id, public_key) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt2 = db.prepare(`
        INSERT INTO waip_user_credentials ( 
          user_id, 
          external_id,
          public_key,
        ) VALUES ( 
          ?, 
          ?, 
          ? 
        );
      `);
        const info = stmt2.run(user_id, external_id, public_key);
        resolve(info.lastInsertRowid);
      } catch (error) {
        reject(new Error("Fehler beim Anlegen eines Credential für einen Users. " + user_id + error));
      }
    });
  };

  // einen Nutzer in der Datenbank anhand seiner ID suchen
  const auth_getCredentials = (id) => {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(`
            SELECT * FROM waip_user_credentials WHERE external_id = ?;
          `);
        const row = stmt.run(id);
        if (row === undefined) {
          resolve(null);
        } else {
          resolve(row);
        }
      } catch (error) {
        reject(new Error("Fehler bei auth_getCredentials. " + id + error));
      }
    });
  };

  return {
    db_einsatz_speichern: db_einsatz_speichern,
    db_einsatz_for_client_ermitteln: db_einsatz_for_client_ermitteln,
    db_einsatz_check_uuid: db_einsatz_check_uuid,
    db_einsatz_check_history: db_einsatz_check_history,
    db_einsatz_get_for_wache: db_einsatz_get_for_wache,
    db_einsatz_get_by_uuid: db_einsatz_get_by_uuid,
    db_einsatz_get_uuid_by_enr: db_einsatz_get_uuid_by_enr,
    db_einsatz_get_waipid_by_uuid: db_einsatz_get_waipid_by_uuid,
    db_einsatz_get_active: db_einsatz_get_active,
    db_einsatz_get_waip_rooms: db_einsatz_get_waip_rooms,
    db_einsaetze_get_old: db_einsaetze_get_old,
    db_einsatz_statusupdate: db_einsatz_statusupdate,
    db_einsatz_loeschen: db_einsatz_loeschen,
    db_wache_get_all: db_wache_get_all,
    db_wache_vorhanden: db_wache_vorhanden,
    db_einsatzmittel_update: db_einsatzmittel_update,
    db_tts_einsatzmittel: db_tts_einsatzmittel,
    db_client_update_status: db_client_update_status,
    db_client_get_connected: db_client_get_connected,
    db_client_delete: db_client_delete,
    db_client_check_waip_id: db_client_check_waip_id,
    db_log: db_log,
    db_log_get_10000: db_log_get_10000,
    db_socket_get_by_id: db_socket_get_by_id,
    db_socket_get_all_to_standby: db_socket_get_all_to_standby,
    db_user_set_config_time: db_user_set_config_time,
    db_user_set_config_url: db_user_set_config_url,
    db_user_get_config: db_user_get_config,
    db_user_get_all: db_user_get_all,
    db_user_get_config_url: db_user_get_config_url,
    db_client_get_alarm_anzeigbar: db_client_get_alarm_anzeigbar,
    db_user_check_permission_for_waip: db_user_check_permission_for_waip,
    db_user_check_permission_for_rmld: db_user_check_permission_for_rmld,
    db_rmld_check_einsatz: db_rmld_check_einsatz,
    db_rmld_single_save: db_rmld_single_save,
    db_rmlds_get_for_wache: db_rmlds_get_for_wache,
    auth_deserializeUser: auth_deserializeUser,
    auth_ipstrategy: auth_ipstrategy,
    auth_localstrategy_cryptpassword: auth_localstrategy_cryptpassword,
    auth_localstrategy_userid: auth_localstrategy_userid,
    auth_ensureApi: auth_ensureApi,
    auth_ensureAdmin: auth_ensureAdmin,
    auth_create_new_user: auth_create_new_user,
    auth_deleteUser: auth_deleteUser,
    auth_editUser: auth_editUser,
    auth_getUser: auth_getUser,
    auth_create_credentials: auth_create_credentials,
    auth_getCredentials: auth_getCredentials,
  };
};
