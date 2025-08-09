module.exports = (io, sql, app_cfg, logger, waip) => {
  // Socket.IO-Konfigurationen

  // Wachalarm
  const nsp_waip = io.of("/waip");
  nsp_waip.on("connection", (socket) => {
    // Benutzerinformationen im Socket speichern
    if (socket.request.user) {
      socket.data.user = socket.request.user;
      logger.log("debug", "Socket.IO: Benutzerinformationen im Socket gespeichert:", socket.data.user);
    } else {
      socket.data.user = { id: null, user: "Gast", permissions: null }; // Gast-Benutzer speichern
      logger.log("debug", "Socket.IO: Kein Benutzer angemeldet, Gast-Benutzer wird gespeichert.");
    }

    // Client-IP ermitteln
    const remote_ip = getRemoteIp(socket);

    // Session-Reload
    const session_timer = setInterval(() => {
      socket.request.session.reload((err) => {
        if (err) {
          // forces the client to reconnect
          socket.conn.close();
          logger.log("error", `Fehler beim Neuladen der Session für ${remote_ip} (${socket.id}): ${err.message}`);
        }
      });
    }, app_cfg.global.session_cookie_max_age / 2); // Reload alle 30 Sekunden (bei 1 Minute Session-Cookie)

    // Verbindungsfehler protokollieren
    socket.on("connection_error", (err) => {
      logger.log("error", err.message);
    });

    // trennen protokollieren und Client-Socket aus DB löschen
    socket.on("disconnect", (reason, details) => {
      logger.log("log", `Alarmmonitor von ${remote_ip} (${socket.id}) geschlossen. (Grund: ${reason}, Details: ${details})`);
      sql.db_client_delete(socket);
      clearInterval(session_timer);
    });

    // bei jedem Connect die Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);

    // Aufruf des Alarmmonitors einer bestimmten Wache verarbeiten
    socket.on("WAIP", async (wachen_nr) => {
      try {
        // prüfen ob Wachenummer in der Datenbank hinterlegt ist
        const result = await sql.db_wache_vorhanden(wachen_nr);
        if (!result) {
          throw `Abfrage der Wache ${wachen_nr} lieferte kein Ergebnis!`;
        }

        // Raum der Wache beitreten
        socket.join(wachen_nr);
        logger.log("waip", `Alarmmonitor Nr. ${wachen_nr} wurde von ${remote_ip} (${socket.id}) aufgerufen.`);

        // anzuzeigenden Einsatz für die aktuelle Wache und den aktuellen User abfragen
        const waip_data = await sql.db_einsatz_for_client_ermitteln(socket, wachen_nr);

        if (waip_data == null) {
          var einsatzdaten = null;
        } else {
          // Einsatzdaten abfragen
          var einsatzdaten = await sql.db_einsatz_get_for_wache(waip_data.id, wachen_nr);
        }

        // wenn Einsatz vorhanden, dann diesen senden, sonst Standby senden
        if (einsatzdaten) {
          // Einsatz senden, falls vorhanden
          logger.log("log", `Einsatz ${einsatzdaten.id} für Wache ${wachen_nr} vorhanden, wird jetzt an Client ${socket.id} gesendet.`);

          // letzten Einsatz an Alarmmonitor senden
          waip.waip_verteilen_socket(einsatzdaten, socket, wachen_nr, waip_data.reset_time);

          // alle vorhanden Rückmeldungen zur Wache aus Datenbank laden
          const rmld_waip_arr = await sql.db_rmlds_get_for_wache(wachen_nr, einsatzdaten.id, null);

          // vorhandene Rückmeldungen an Alarmmonitor senden
          if (rmld_waip_arr) {
            waip.rmld_arr_verteilen_socket(rmld_waip_arr, socket);
          }
        } else {
          // Standby an Alarmmonitor senden
          waip.standby_verteilen_socket(socket);
          logger.log("log", `Kein Einsatz für Wache ${wachen_nr} vorhanden, gehe in Standby.`);
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Alarmmonitors Nr. ${wachen_nr} von ${remote_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);

        // Fehlermeldung senden und Verbindung trennen
        socket.emit("io.error", logMessage);
        socket.disconnect(true);
      }
    });
  });

  // Dashboard
  const nsp_dbrd = io.of("/dbrd");
  nsp_dbrd.on("connection", (socket) => {
    // Benutzerinformationen im Socket speichern
    if (socket.request.user) {
      socket.data.user = socket.request.user;
      logger.log("debug", "Socket.IO: Benutzerinformationen im Socket gespeichert:", socket.data.user);
    } else {
      socket.data.user = { id: null, user: "Gast", permissions: null }; // Gast-Benutzer speichern
      logger.log("debug", "Socket.IO: Kein Benutzer angemeldet, Gast-Benutzer wird gespeichert.");
    }

    // Client-IP ermitteln
    const remote_ip = getRemoteIp(socket);

    // Verbindungsfehler protokollieren
    socket.on("connection_error", (err) => {
      logger.log("error", err.message);
    });

    // trennen protokollieren und Client-Socket aus DB löschen
    socket.on("disconnect", (reason, details) => {
      logger.log("log", `Dashboard von ${remote_ip} (${socket.id}) geschlossen. (Grund: ${reason}, Details: ${details})`);
      sql.db_client_delete(socket);
    });

    // bei jedem Connect die Server-Version senden, damit der Client diese prueft und die Seite ggf. neu laedt
    socket.emit("io.version", app_cfg.global.app_id);

    // Aufruf des Dashboards für einen bestimmten Einsatz-UUID verarbeiten
    socket.on("dbrd", async (uuid) => {
      try {
        // prüfen ob Dashboard/Einsatz vorhanden
        const dbrd = await sql.db_einsatz_check_uuid(uuid);
        if (!dbrd) {
          throw `Das Dashboards mit der UUID ${uuid} ist nicht mehr vorhanden (Anfrage lieferte kein Ergebnis)!`;
        } else {
          // Dashboard/Einsatz scheint vorhanden/plausibel, Socket-Room beitreten
          socket.join(dbrd.uuid);
          logger.log("dbrd", `Dashboard mit der UUID ${uuid} wurde von ${remote_ip} (${socket.id}) aufgerufen.`);

          // Einsatz an Dashboard senden
          waip.dbrd_verteilen_socket(dbrd.uuid, socket);

          // alle vorhanden Rückmeldungen zum Dashboard aus Datenbank laden
          const rmld_waip_arr = await sql.db_rmlds_get_for_wache(0, dbrd.id, null);

          // vorhandene Rückmeldungen an Alarmmonitor senden
          if (rmld_waip_arr) {
            waip.rmld_arr_verteilen_socket(rmld_waip_arr, socket);
          }
        }
      } catch (error) {
        const logMessage = `Fehler beim Aufruf des Dashboards mit der UUID ${uuid} von ${remote_ip} (${socket.id})! ${error}`;
        logger.log("error", logMessage);

        // Fehlermeldung senden und Verbindung trennen
        socket.emit("io.error", logMessage);
        socket.disconnect(true);
      }
    });
  });

  // Hilfsfunktion zum Ermitteln der Client-IP aus dem Socket
  const getRemoteIp = (socket) => {
    // Verbesserte IP-Adress-Ermittlung
    let client_ip = null;

    // Liste der möglichen Proxy-Header in Prioritätsreihenfolge
    const proxy_headers = [
      "x-real-ip",
      "x-client-ip",
      "cf-connecting-ip",
      "fastly-client-ip",
      "true-client-ip",
      "x-cluster-client-ip",
      "x-forwarded-for",
      "forwarded-for",
      "forwarded",
    ];

    // Durchsuche alle Proxy-Header
    for (const header of proxy_headers) {
      if (socket.handshake.headers[header]) {
        // Bei x-forwarded-for den ersten Eintrag nehmen (original client)
        if (header === "x-forwarded-for") {
          client_ip = socket.handshake.headers[header].split(",")[0].trim();
        } else {
          client_ip = socket.handshake.headers[header];
        }
        break;
      }
    }

    // Fallback auf Socket-Adresse
    if (!client_ip) {
      client_ip = socket.handshake.address;
    }

    // Bei IPv6-Format (::ffff:xxx.xxx.xxx.xxx) nur den IPv4-Teil verwenden
    if (client_ip && client_ip.includes("::ffff:")) {
      client_ip = client_ip.split("::ffff:")[1];
    }

    // Fallback auf localhost wenn keine IP gefunden wurde
    return client_ip;
  };
};
