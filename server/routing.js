module.exports = function (app, sql, app_cfg, passport, auth, saver, logger, tts, widgets) {
  // HTTP-Antworten mit Fehlerstatus (401/403/404/5xx) strukturiert protokollieren
  app.use(logger.http_error_middleware);

  // Änderungen an der Konfiguration durch Administratoren protokollieren
  const config_event = (req, message, action, type, wachalarm) => {
    logger.event(message, {
      ...logger.from_req(req),
      action: action,
      category: "configuration",
      type: type,
      outcome: "success",
      wachalarm: wachalarm,
    });
  };

  // Erfolgreiche Anmeldung protokollieren
  const login_success = (req, user, methode) => {
    logger.event(`Benutzer ${user.user} hat sich angemeldet (${methode}).`, {
      ...logger.from_req(req),
      user: { name: user.user, id: user.id },
      action: "login",
      category: "authentication",
      type: "start",
      outcome: "success",
      wachalarm: { login_methode: methode, angemeldet_bleiben: methode === "passwort" ? Boolean(req.body.rememberme) : undefined },
    });
  };
  // Hilfsfunktion zum prüfen ob der Inhaltstyp JSON ist
  const checkContentType = (req, res, next) => {
    if (!req.is("application/json")) {
      const msg = `Der Inhalt der Anfrage wurde mit ungültigem oder nicht erlaubtem Medientyp übermittelt (${req.originalUrl}).`;
      res.status(415).send(msg);
      logger.log("error", msg);
    } else {
      next();
    }
  };

  // Hilfsfunktion zum Ermitteln der Client-IP
  const getRemoteIp = (req) => {
    // Prüfe verschiedene Header in der Reihenfolge ihrer Zuverlässigkeit
    const headers = [req.headers["x-real-ip"], req.headers["x-forwarded-for"], req.socket.remoteAddress];

    for (const header of headers) {
      if (!header) continue;

      // Bei x-forwarded-for nehmen wir die erste IP (Client-IP)
      if (header === req.headers["x-forwarded-for"]) {
        const ips = header.split(",").map((ip) => ip.trim());
        if (ips.length > 0) return ips[0];
      } else {
        return header;
      }
    }

    // Fallback auf localhost wenn keine IP gefunden wurde
    return "127.0.0.1";
  };

  /* ########################### */
  /* ##### Statische Seiten #### */
  /* ########################### */

  // Startseite
  app.get("/", async (req, res, next) => {
    try {
      let user_waips = null;
      let user_dbrds = null;
      if (req.user) {
        // Alarmmonitore und aktuelle Dashboards fuer den User laden
        user_waips = await sql.db_get_user_waips(req.user.id);
        user_dbrds = await sql.db_get_user_dbrds(req.user.id);
      }
      // Anzahl laufender Einsätze für die Dashboard-Kachel (dieselbe Liste wie die öffentliche Dashboard-Übersicht)
      const einsaetze = await sql.db_einsatz_get_active();
      res.render("page_home", {
        public: app_cfg.public,
        title: "Wachalarm IP-Web",
        user: req.user,
        user_waips: user_waips,
        user_dbrds: user_dbrds,
        einsaetze_aktiv: einsaetze ? einsaetze.length : 0,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Startseite. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Ueber die Anwendung
  app.get("/ueber", (req, res) => {
    res.render("about", {
      public: app_cfg.public,
      title: "Über",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Impressum
  app.get("/impressum", (req, res) => {
    if (app_cfg.public.ext_imprint) {
      res.redirect(app_cfg.public.url_imprint);
    } else {
      res.render("imprint", {
        public: app_cfg.public,
        title: "Impressum",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    }
  });

  // Datenschutzerklaerung
  app.get("/datenschutz", (req, res) => {
    if (app_cfg.public.ext_privacy) {
      res.redirect(app_cfg.public.url_privacy);
    } else {
      res.render("privacy", {
        public: app_cfg.public,
        title: "Datenschutzerklärung",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    }
  });

  /* ##################### */
  /* ######## API ######## */
  /* ##################### */

  // Aufruf von /api
  app.get("/api", (req, res, next) => {
    const err = new Error(`Der Aufruf dieser Seite ist nicht gestattet. 
     Kontaktieren Sie den Betreiber der Seite für weitere Informationen.`);
    logger.log("error", err);
    err.status = 403;
    next(err);
  });

  // API-Token abrufen
  app.post(
    "/api/get_token",
    passport.authenticate("local", {
      //TODO bessere Rückmeldung ohne Umleitung auf Seite
      failureRedirect: "/api",
      failureFlash: "Authentifizierung fehlgeschlagen! Bitte prüfen Sie Benutzername und Passwort.",
      failureMessage: true,
    }),
    async (req, res) => {
      const new_token = await auth.ensureApi(req.user.id);
      logger.event(`API-Token für ${req.user.user} ${new_token ? "ausgestellt" : "verweigert (keine API-Berechtigung)"}.`, {
        ...logger.from_req(req),
        level: new_token ? "info" : "warn",
        action: "api-token",
        category: ["authentication", "api"],
        type: new_token ? "allowed" : "denied",
        outcome: new_token ? "success" : "failure",
        reason: new_token ? undefined : "keine-api-berechtigung",
      });
      if (new_token) {
        res.json({ message: "Neues Zugangs-Token generiert", token: new_token });
      } else {
        res.status(401).json({ msg: "Keine Berechtigung zur Nutzung der Rest-API" });
      }
    }
  );

  // POST von neuen oder aktualisierten Einsätzen
  app.post("/api/einsatzdaten", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Einsatz speichern
      const result = await saver.save_einsatz(req.body, remote_ip);
      // Protokollieren (nur IDs und Zähler, keine Einsatzinhalte)
      const msg = "Einsatzdaten erfolgreich übermittelt und verarbeitet (/api/einsatzdaten).";
      logger.event(result ? `Einsatz ${result.waip_id} von ${remote_ip} empfangen und gespeichert.` : `Einsatz von ${remote_ip} empfangen, aber verworfen (keine aktive Wache beteiligt).`, {
        ...logger.from_req(req),
        action: result ? "einsatz-empfangen" : "einsatz-verworfen",
        category: "api",
        type: "creation",
        outcome: "success",
        reason: result ? undefined : "keine-aktive-wache",
        wachalarm: result ? { einsatz_id: result.waip_id, anzahl_wachen: result.anzahl_wachen, anzahl_einsatzmittel: result.anzahl_einsatzmittel } : undefined,
      });
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzdaten).";
      logger.event(msg + " " + error, {
        ...logger.from_req(req),
        level: "error",
        action: "einsatz-empfangen",
        category: "api",
        type: "error",
        outcome: "failure",
        error: error,
      });
      res.status(500);
      res.send(msg);
    }
  });

  // POST des aktuellen Status eines Einsatzes (laufend, abgeschlossen)
  app.post("/api/einsatzstatus", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Rückmeldungen speichern
      await saver.save_einsatzstatus(req.body, remote_ip);
      const msg = "Einsatzstatus erfolgreich aktualisiert (/api/einsatzstatus).";
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzstatus).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  // POST von neuen oder aktualisierten Rückmeldungen
  app.post("/api/rueckmeldung", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Rückmeldungen speichern
      await saver.save_rmld(req.body, remote_ip);
      const msg = "Rückmeldungen erfolgreich übermittelt und verarbeitet (/api/rueckmeldung).";
      logger.event(msg, {
        ...logger.from_req(req),
        action: "rueckmeldung-empfangen",
        category: "api",
        type: "creation",
        outcome: "success",
        wachalarm: { anzahl_rueckmeldungen: Array.isArray(req.body) ? req.body.length : undefined },
      });
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/rueckmeldung).";
      logger.event(msg + " " + error, {
        ...logger.from_req(req),
        level: "error",
        action: "rueckmeldung-empfangen",
        category: "api",
        type: "error",
        outcome: "failure",
        error: error,
      });
      res.status(500);
      res.send(msg);
    }
  });

  // POST von neuen oder aktualisierten Statusmeldungen
  app.post("/api/einsatzmittel", passport.authenticate("jwt", { session: false }), checkContentType, async (req, res) => {
    try {
      // Client-IP ermitteln
      const remote_ip = getRemoteIp(req);
      // Einsatzmittel speichern
      await saver.save_einsatzmittel(req.body, remote_ip);
      logger.log("log", "Einsatzmittel erfolgreich übermittelt und verarbeitet (/api/einsatzmittel).");
      res.sendStatus(200);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzmittel).";
      logger.log("error", msg + " " + error);
      res.status(500);
      res.send(msg);
    }
  });

  /* ##################### */
  /* ####### Login ####### */
  /* ##################### */

  // Loginseite
  app.get("/login", (req, res) => {
    res.render("login", {
      public: app_cfg.public,
      title: "Login",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
      error: req.query.error || null,
    });
  });

  // Login-Formular verarbeiten
  app.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        const msg = encodeURIComponent("Authentifizierung fehlgeschlagen! Bitte prüfen Sie Benutzername und Passwort.");
        return res.redirect("/login?error=" + msg);
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        if (req.body.rememberme) {
          // der Benutzer muss sich fuer 5 Jahre nicht anmelden
          req.session.cookie.maxAge = 5 * 365 * 24 * 60 * 60 * 1000;
        }
        login_success(req, user, "passwort");
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/login_cert", (req, res, next) => {
    passport.authenticate("trusted-header", (err, user, info) => {
      if (err) {
        logger.event("Interner Fehler bei der Zertifikats-Authentifizierung: " + err, {
          ...logger.from_req(req),
          level: "error",
          action: "login",
          category: "authentication",
          type: ["start", "error"],
          outcome: "failure",
          error: err,
          wachalarm: { login_methode: "zertifikat" },
        });
        return res.redirect("/login?error=" + encodeURIComponent("Interner Fehler bei der Zertifikats-Authentifizierung."));
      }
      if (!user) {
        // CN aus dem vom Proxy gesetzten Header (Zertifikat wurde dort bereits geprüft)
        const dn = req.headers["x-ssl-client-dn"];
        const cn = dn ? String(dn).split(",")[0].split("=")[1] : null;
        logger.event(`Anmeldung per Client-Zertifikat fehlgeschlagen (${dn ? "kein Benutzer für CN " + cn : "kein Zertifikat"}).`, {
          ...logger.from_req(req),
          user: cn ? { name: cn } : undefined,
          level: "warn",
          action: "login",
          category: "authentication",
          type: "start",
          outcome: "failure",
          reason: dn ? "zertifikat-unbekannt" : "kein-zertifikat",
          wachalarm: { login_methode: "zertifikat" },
        });
        return res.redirect(
          "/login?error=" +
            encodeURIComponent("Authentifizierung mittels Client-Zertifikat fehlgeschlagen! Bitte wenden Sie sich an den Administrator.")
        );
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        // der Benutzer muss sich fuer 1 Tag nicht anmelden
        req.session.cookie.maxAge = 1 * 24 * 60 * 60 * 1000;
        login_success(req, user, "zertifikat");
        return res.redirect("/");
      });
    })(req, res, next);
  });

  // Logout verarbeiten
  app.post("/logout", function (req, res) {
    if (req.user) {
      logger.event(`Benutzer ${req.user.user} hat sich abgemeldet.`, {
        ...logger.from_req(req),
        action: "logout",
        category: ["authentication", "session"],
        type: "end",
        outcome: "success",
      });
    }
    req.session.destroy(function (err) {
      res.redirect("/");
    });
  });

  /* ######################### */
  /* ##### Session Utils ##### */
  /* ######################### */

  // Keep-Alive für Session (wird vom Client periodisch aufgerufen)
  app.get("/session/keepalive", (req, res) => {
    try {
      if (req.session) {
        // Touch erneuert das Ablaufdatum im Store (bei entsprechendem Store) und rolling sendet neues Cookie
        req.session.touch();
        res.json({ status: "ok", expires: req.session.cookie.expires });
      } else {
        res.status(440).json({ status: "no-session" });
      }
    } catch (error) {
      logger.log("error", "Fehler beim KeepAlive der Session: " + error);
      res.status(500).json({ status: "error" });
    }
  });

  /* ######################### */
  /* ##### Monitoring     ##### */
  /* ######################### */

  // Check_MK Local Check: gibt Anwendungsstatus im Check_MK-Format aus (mehrere Services).
  // Nur von localhost erreichbar; keine Session-Auth erforderlich.
  app.get("/check_mk", async (req, res, next) => {
    const client_ip = req.ip;
    if (client_ip !== "127.0.0.1" && client_ip !== "::1" && client_ip !== "::ffff:127.0.0.1") {
      return res.status(403).end();
    }
    try {
      const [rows, stats] = await Promise.all([
        sql.db_client_get_connected(),
        sql.db_monitoring_get_stats(),
      ]);

      const lines = [];

      // Service 1: verbundene Clients
      const clients = rows || [];
      const total = clients.length;
      const waip  = clients.filter((c) => c.client_nsp === "/waip").length;
      const dbrd  = clients.filter((c) => c.client_nsp === "/dbrd").length;
      const alarm = clients.filter((c) => c.client_status && c.client_status !== "Standby").length;
      lines.push(`0 waip_clients total=${total};;;0;|waip=${waip};;;0;|dbrd=${dbrd};;;0;|alarm=${alarm};;;0; ${total} Clients (${waip}x /waip, ${dbrd}x /dbrd, ${alarm}x im Einsatz)`);

      // Service 1b: Netzkopplung (reine Info, kein Warning/Error)
      // 1 = alle, 2 = einzelne Internet-Testadressen erreichbar, beides gilt als Verdacht
      const netzkopplung_count = clients.filter((c) => c.netzkopplung === 1 || c.netzkopplung === 2).length;
      lines.push(`0 waip_netzkopplung count=${netzkopplung_count};;;0; ${netzkopplung_count} Client(s) mit erreichbaren Internet-Testadressen (moegliche Netzkopplung)`);

      // Service 2: Einsätze in der Datenbank
      const einsatz_total = stats.einsatz.total ?? 0;
      const last_min      = stats.einsatz.last_min;
      const last_text     = last_min != null ? `letzter vor ${last_min} min` : "keine Einsätze vorhanden";
      lines.push(`0 waip_einsaetze count=${einsatz_total};;;0;|last_min=${last_min ?? ""};;;0; ${einsatz_total} Einsätze in DB (${last_text})`);

      // Service 3: konfigurierte Wachen
      const wachen_total  = stats.wachen.total  ?? 0;
      const wachen_active = stats.wachen.active ?? 0;
      lines.push(`0 waip_wachen active=${wachen_active};;;0;|total=${wachen_total};;;0; ${wachen_active}/${wachen_total} Wachen aktiv konfiguriert`);

      // Service 4: Prozess-Laufzeit
      const uptime_s = Math.floor(process.uptime());
      const uptime_h = Math.floor(uptime_s / 3600);
      const uptime_m = Math.floor((uptime_s % 3600) / 60);
      lines.push(`0 waip_uptime seconds=${uptime_s};;;0; Laufzeit: ${uptime_h}h ${uptime_m}min`);

      res.type("text").send(lines.join("\n") + "\n");
    } catch (error) {
      logger.log("error", "Fehler beim Abrufen der Monitoring-Daten fuer Check_MK: " + error);
      res.type("text").send("3 waip_clients - Datenbankabfrage fehlgeschlagen\n");
    }
  });

  /* ######################### */
  /* ##### Einstellungen ##### */
  /* ######################### */

  // Einstellungen anzeigen
  app.get("/einstellungen", auth.ensureAuthenticated, async (req, res, next) => {
    try {
      const data = await sql.db_user_get_config(req.user.id);
      res.render("user/user_config", {
        public: app_cfg.public,
        title: "Einstellungen",
        user: req.user,
        user_reset_counter: data.resetcounter,
        standby: sql.db_user_get_config_standby(req.user.id),
        widgets_wetter_aktiv: widgets.wetter_aktiv,
        widgets_kalender_erlaubt: widgets.erlaubte_kalender(),
        session_max_age: app_cfg.global.session_cookie_max_age,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite für die Einstellungen. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Einstellungen zur Anzeigezeit speichern
  app.post("/einstellungen_zeit", auth.ensureAuthenticated, async (req, res) => {
    try {
      await sql.db_user_set_config_time(req.user.id, req.body.set_reset_counter);
      res.redirect("/einstellungen?success=" + encodeURIComponent("Einstellungen für die Anzeigezeit wurden erfolgreich gespeichert"));
    } catch (error) {
      res.redirect("/einstellungen?error=" + encodeURIComponent("Fehler beim Speichern der Einstellungen für die Anzeigezeit. " + error));
    }
  });

  // Einstellungen zur Standby-Anzeige speichern (Wetter/Kalender ein/aus, Kalender-Adresse)
  app.post("/einstellungen_standby", auth.ensureAuthenticated, async (req, res) => {
    const zurueck = (art, text) => res.redirect("/einstellungen?" + art + "=" + encodeURIComponent(text));
    try {
      const wetter = req.body.standby_wetter === "on";
      const kalender = req.body.standby_kalender === "on";
      const eingabe = String(req.body.ical_url || "").trim().slice(0, 2000);
      let ical_url = "";
      let domain = null;
      if (eingabe) {
        try {
          const geprueft = widgets.kalender_url_pruefen(eingabe);
          ical_url = geprueft.url;
          domain = geprueft.domain.host;
        } catch (error) {
          if (error instanceof widgets.KalenderFehler) return zurueck("error", error.message);
          throw error;
        }
      }
      if (kalender && !ical_url) {
        return zurueck("error", "Bitte eine öffentliche Kalender-Adresse angeben oder die Termine ausschalten.");
      }
      await sql.db_user_set_config_standby(req.user.id, { wetter, kalender, ical_url });
      logger.event(`Standby-Einstellungen von ${req.user.user} geändert (Wetter: ${wetter ? "an" : "aus"}, Kalender: ${kalender ? "an" : "aus"}).`, {
        ...logger.from_req(req),
        action: "standby-einstellungen",
        category: "configuration",
        type: "change",
        outcome: "success",
        wachalarm: { standby: { wetter: wetter, kalender: kalender, kalender_domain: domain } },
      });
      // verbundene Monitore des Benutzers sofort umstellen
      widgets.benutzer_aktualisiert(req.user.id);
      zurueck("success", "Einstellungen für die Standby-Anzeige wurden gespeichert.");
    } catch (error) {
      logger.log("error", error);
      zurueck("error", "Fehler beim Speichern der Standby-Einstellungen.");
    }
  });

  /* ##################### */
  /* ##### Wachalarm ##### */
  /* ##################### */

  // /waip nach /waip/0 umleiten
  app.get("/waip", async (req, res, next) => {
    try {
      const data = await sql.db_wache_get_all();
      res.render("overviews/overview_waip", {
        public: app_cfg.public,
        title: "Alarmmonitor",
        list_wachen: data,
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /waip. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Alarmmonitor aufrufen /waip/<wachennummer>
  app.get("/waip/:wachen_id", async (req, res, next) => {
    try {
      const parameter_id = req.params.wachen_id;
      const rmldOff = req.query.rmld === "off"; // optionaler Parameter zum Deaktivieren der Rückmeldungen
      const soundOff = req.query.sound === "off"; // optionaler Parameter zum Deaktivieren der Audio-Blockadeprüfung
      const animOff = req.query.anim === "off"; // optionaler Parameter zum Reduzieren von Animationen (leistungsschwache Geräte)
      const wache = await sql.db_wache_vorhanden(parameter_id);
      if (wache) {
        res.render("waip", {
          public: app_cfg.public,
          title: "Alarmmonitor - " + wache.name,
          wachen_id: parameter_id,
          data_wache: wache.name,
          map_service: app_cfg.public.map_service,
          app_id: app_cfg.global.app_id,
          user: req.user,
          session_max_age: app_cfg.global.session_cookie_max_age,
          rmld_off: rmldOff,
          sound_off: soundOff,
          anim_off: animOff,
        });
      } else {
        const err = new Error(`Wache ${parameter_id} nicht vorhanden!`);
        err.status = 404;
        next(err);
      }
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /waip/${req.params.wachen_id}. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  /* ######################## */
  /* ###### Dashboard ####### */
  /* ######################## */

  // Dashboard-Übersicht anzeigen
  app.get("/dbrd", async (req, res, next) => {
    try {
      const data = await sql.db_einsatz_get_active();
      res.render("overviews/overview_dbrd", {
        public: app_cfg.public,
        title: "Dashboard",
        map_service: app_cfg.public.map_service,
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /dbrd. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Dashboard für einen Einsatz anzeigen
  app.get("/dbrd/:dbrd_uuid", async (req, res, next) => {
    try {
      let dbrd_uuid = req.params.dbrd_uuid;
      const wache = await sql.db_einsatz_check_uuid(dbrd_uuid);
      if (wache) {
        res.render("dbrd", {
          public: app_cfg.public,
          title: "Dashboard",
          dbrd_uuid: dbrd_uuid,
          map_service: app_cfg.public.map_service,
          app_id: app_cfg.global.app_id,
          user: req.user,
          session_max_age: app_cfg.global.session_cookie_max_age,
        });
      } else {
        throw `Dashboard oder Einsatz mit der UUID ${dbrd_uuid} nicht (mehr) vorhanden!`;
      }
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /dbrd/<dbrd_uuid>. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  /* ########################## */
  /* ##### Administration ##### */
  /* ########################## */

  // verbundene Clients anzeigen
  app.get("/adm_show_clients", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_client_get_connected();
      res.render("admin/adm_show_clients", {
        public: app_cfg.public,
        title: "Verbundene PCs/Benutzer",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_clients. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // laufende Einsaetze anzeigen
  app.get("/adm_show_missions", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_einsatz_get_active();
      res.render("admin/adm_show_missions", {
        public: app_cfg.public,
        title: "Akutelle Einsätze",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_missions. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Logdatei
  app.get("/adm_show_log", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_log_get_10000();
      res.render("admin/adm_show_log", {
        public: app_cfg.public,
        title: "Log-Datei",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        dataSet: data,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_show_log. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Benutzer editieren
  app.get("/adm_edit_users", auth.ensureAdmin, async (req, res, next) => {
    try {
      const data = await sql.db_user_get_all();
      res.render("admin/adm_edit_users", {
        public: app_cfg.public,
        title: "Benutzer und Rechte verwalten",
        user: req.user,
        users: data,
        session_max_age: app_cfg.global.session_cookie_max_age,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error(`Fehler beim Laden der Seite /adm_edit_users. ` + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  app.post("/adm_edit_users", auth.ensureAdmin, (req, res) => {
    if (req.user && req.user.permissions == "admin") {
      switch (req.body["modal_method"]) {
        case "DELETE":
          auth.deleteUser(req, res);
          break;
        case "EDIT":
          auth.editUser(req, res);
          break;
        case "ADDNEW":
          auth.createUser(req, res);
          break;
      }
    } else {
      res.redirect("/adm_edit_users");
    }
  });

  // Wachen-Administration anzeigen
  app.get("/adm_edit_wachen", auth.ensureAdmin, async (req, res, next) => {
    try {
      const wachen = await sql.db_wachen_get_all_full();
      res.render("admin/adm_edit_wachen", {
        public: app_cfg.public,
        title: "Wachen verwalten",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        wachen,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error("Fehler beim Laden der Seite /adm_edit_wachen. " + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Wache bearbeiten
  app.post("/adm_edit_wachen/edit", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_update(req.body);
      config_event(req, `Wache ${req.body.nr_wache} (ID ${req.body.id}) wurde von ${req.user.user} bearbeitet (aktiv: ${req.body.aktiv ? "ja" : "nein"}).`, "wache-geaendert", "change", {
        wache_nr: req.body.nr_wache,
        ziel_id: req.body.id,
      });
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich bearbeitet."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Bearbeiten der Wache. " + error));
    }
  });

  // Wache löschen
  app.post("/adm_edit_wachen/delete", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_delete(req.body.id);
      config_event(req, `Wache mit ID ${req.body.id} wurde von ${req.user.user} gelöscht.`, "wache-geloescht", "deletion", {
        ziel_id: req.body.id,
      });
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich gelöscht."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Löschen der Wache. " + error));
    }
  });

  // Neue Wache anlegen
  app.post("/adm_edit_wachen/create", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wache_create(req.body);
      config_event(req, `Wache ${req.body.nr_wache} wurde von ${req.user.user} angelegt.`, "wache-angelegt", "creation", {
        wache_nr: req.body.nr_wache,
      });
      res.redirect("/adm_edit_wachen?success=" + encodeURIComponent("Wache erfolgreich angelegt."));
    } catch (error) {
      res.redirect("/adm_edit_wachen?error=" + encodeURIComponent("Fehler beim Anlegen der Wache. " + error));
    }
  });

  /* ##### Wetter-Standorte (Standby-Widgets) ##### */

  // Eingaben eines Wetter-Standorts prüfen und vereinheitlichen; gibt { ort } oder { fehler } zurück
  const wetter_ort_pruefen = async (body, mit_nr) => {
    const zahl = (wert) => Number(String(wert ?? "").trim().replace(",", "."));
    const ort = {
      id: body.id,
      nr: String(body.nr ?? "").trim(),
      name: String(body.name ?? "").trim().slice(0, 100),
      lat: zahl(body.lat),
      lon: zahl(body.lon),
      warncell_id: String(body.warncell_id ?? "").trim(),
    };
    if (mit_nr && (!/^\d+$/.test(ort.nr) || ![1, 2, 4, 6].includes(ort.nr.length))) {
      return { fehler: "Die Nummer muss 1 (Leitstelle), 2 (Kreis), 4 (Träger) oder 6 (Wache) Ziffern haben." };
    }
    if (!String(body.lat ?? "").trim() || !isFinite(ort.lat) || ort.lat < -90 || ort.lat > 90) return { fehler: "Die Breite (Lat) ist ungültig, z.B. 52.41787." };
    if (!String(body.lon ?? "").trim() || !isFinite(ort.lon) || ort.lon < -180 || ort.lon > 180) return { fehler: "Die Länge (Lon) ist ungültig, z.B. 12.53254." };
    if (ort.warncell_id && !/^\d{6,10}$/.test(ort.warncell_id)) return { fehler: "Die Warnzelle muss eine Zahl (DWD-Warnzellen-ID) sein oder leer bleiben." };
    ort.warncell_id = ort.warncell_id ? Number(ort.warncell_id) : null;
    if (mit_nr && !ort.name) {
      // Bezeichnung aus den Wachen übernehmen, falls nicht angegeben
      try {
        ort.name = (await sql.db_wache_vorhanden(ort.nr)).name;
      } catch (e) {
        ort.name = "";
      }
    }
    return { ort };
  };

  // Wetter-Standorte anzeigen
  app.get("/adm_edit_wetter", auth.ensureAdmin, async (req, res, next) => {
    try {
      const orte = await sql.db_wetter_orte_get_all();
      res.render("admin/adm_edit_wetter", {
        public: app_cfg.public,
        title: "Wetter-Standorte verwalten",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        orte,
        wetter_aktiv: widgets.wetter_aktiv,
        brightsky_url: app_cfg.widgets.brightsky_url,
        error: req.query.error || null,
        success: req.query.success || null,
      });
    } catch (error) {
      const err = new Error("Fehler beim Laden der Seite /adm_edit_wetter. " + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Wetter-Standort anlegen
  app.post("/adm_edit_wetter/create", auth.ensureAdmin, async (req, res) => {
    try {
      const { ort, fehler } = await wetter_ort_pruefen(req.body, true);
      if (fehler) return res.redirect("/adm_edit_wetter?error=" + encodeURIComponent(fehler));
      await sql.db_wetter_ort_create(ort);
      config_event(req, `Wetter-Standort ${ort.nr} wurde von ${req.user.user} angelegt.`, "wetter-ort-angelegt", "creation", { wetter_ort: ort.nr });
      res.redirect("/adm_edit_wetter?success=" + encodeURIComponent(`Standort ${ort.nr} angelegt. Verbundene Monitore übernehmen ihn beim nächsten Aufruf.`));
    } catch (error) {
      const doppelt = String(error).includes("UNIQUE");
      res.redirect("/adm_edit_wetter?error=" + encodeURIComponent(doppelt ? "Für diese Nummer gibt es bereits einen Standort." : "Fehler beim Anlegen des Standorts. " + error));
    }
  });

  // Wetter-Standort bearbeiten
  app.post("/adm_edit_wetter/edit", auth.ensureAdmin, async (req, res) => {
    try {
      const { ort, fehler } = await wetter_ort_pruefen(req.body, false);
      if (fehler) return res.redirect("/adm_edit_wetter?error=" + encodeURIComponent(fehler));
      await sql.db_wetter_ort_update(ort);
      config_event(req, `Wetter-Standort ID ${ort.id} wurde von ${req.user.user} bearbeitet.`, "wetter-ort-geaendert", "change", { ziel_id: ort.id });
      res.redirect("/adm_edit_wetter?success=" + encodeURIComponent("Standort gespeichert. Verbundene Monitore übernehmen ihn beim nächsten Aufruf."));
    } catch (error) {
      res.redirect("/adm_edit_wetter?error=" + encodeURIComponent("Fehler beim Bearbeiten des Standorts. " + error));
    }
  });

  // Wetter-Standort löschen
  app.post("/adm_edit_wetter/delete", auth.ensureAdmin, async (req, res) => {
    try {
      await sql.db_wetter_ort_delete(req.body.id);
      config_event(req, `Wetter-Standort ID ${req.body.id} wurde von ${req.user.user} gelöscht.`, "wetter-ort-geloescht", "deletion", { ziel_id: req.body.id });
      res.redirect("/adm_edit_wetter?success=" + encodeURIComponent("Standort gelöscht."));
    } catch (error) {
      res.redirect("/adm_edit_wetter?error=" + encodeURIComponent("Fehler beim Löschen des Standorts. " + error));
    }
  });

  // Erreichbarkeit von Bright Sky für die Statusanzeige der Admin-Seite
  app.post("/adm_edit_wetter/status", auth.ensureAdmin, checkContentType, async (req, res) => {
    res.json(await widgets.brightsky_pruefen());
  });

  // Wetter und Warnungen für eine Nummer oder Koordinate testen (ohne Zwischenspeicher)
  app.post("/adm_edit_wetter/test", auth.ensureAdmin, checkContentType, async (req, res) => {
    try {
      let ort = null;
      if (req.body.nr) {
        ort = sql.db_wetter_ort_ermitteln(String(req.body.nr).trim());
        if (!ort) return res.status(404).json({ error: "Für diese Nummer wurde kein Standort gefunden (weder hier noch in den Wachen)." });
      } else {
        const { ort: geprueft, fehler } = await wetter_ort_pruefen(req.body, false);
        if (fehler) return res.status(400).json({ error: fehler });
        ort = geprueft;
      }
      const start = Date.now();
      const ergebnis = await widgets.wetter_testen(ort);
      res.json({ ort, ...ergebnis, dauer_ms: Date.now() - start });
    } catch (error) {
      logger.log("warn", `Wetter-Test fehlgeschlagen: ${error.message}`);
      res.status(502).json({ error: "Bright Sky nicht erreichbar oder fehlerhaft: " + error.message });
    }
  });

  // Ersetzung vor dem Speichern prüfen. Bei orte_tts ist der Eingabewert ein regulärer Ausdruck,
  // ein fehlerhafter Ausdruck würde sonst erst bei der nächsten Sprachansage auffallen.
  const ersetzung_pruefen = (rp) => {
    const typ = String(rp.rp_typ || "").trim();
    const input = String(rp.rp_input || "");
    if (!typ || !input.trim() || rp.rp_output === undefined || rp.rp_output === null || String(rp.rp_output) === "") {
      return "Typ, Eingabewert und Ausgabewert müssen ausgefüllt sein.";
    }
    if (typ === "orte_tts") {
      try {
        new RegExp(input, "gi");
      } catch (error) {
        return `Der Eingabewert ist kein gültiger regulärer Ausdruck (${error.message}).`;
      }
      if ("".match(new RegExp(input, "gi"))) {
        return "Der Eingabewert würde einen leeren Text treffen und überall eingefügt werden.";
      }
    }
    return null;
  };

  /* ##### Ersetzungen und Aussprache (waip_replace) ##### */

  // Typen mit Wirkung auf die Sprachansage (Probehören möglich, je Eingabewert nur ein Eintrag)
  const TTS_TYPEN = ["orte_tts", "em_tts"];
  const TTS_VORSCHAU_MAX_LAENGE = 500;

  const ersetzung_laden = async (id) => (await sql.db_replace_get_all_full()).find((r) => r.id === Number(id));

  // Seite anzeigen: alle Ersetzungen, Probehören für die Sprachansage
  app.get("/adm_edit_replace", auth.ensureAdmin, async (req, res, next) => {
    try {
      res.render("admin/adm_edit_replace", {
        public: app_cfg.public,
        title: "Ersetzungen verwalten",
        user: req.user,
        session_max_age: app_cfg.global.session_cookie_max_age,
        ersetzungen: await sql.db_replace_get_all_full(),
        tts_typen: TTS_TYPEN,
        tts_provider: tts.tts_provider_key(),
        tts_stimme: tts.tts_provider_key() === "piper" ? app_cfg.tts.piper_voice : null,
        max_laenge: TTS_VORSCHAU_MAX_LAENGE,
        error: req.query.error || null,
      });
    } catch (error) {
      const err = new Error("Fehler beim Laden der Seite /adm_edit_replace. " + error);
      logger.log("error", err);
      err.status = 500;
      next(err);
    }
  });

  // Frühere eigene Testseite ist in der Ersetzungsseite aufgegangen
  app.get("/adm_tts_test", (req, res) => res.redirect(301, "/adm_edit_replace"));

  // Probehören: Text (optional mit Ersetzungen bzw. einer noch nicht gespeicherten Ersetzung) sprechen lassen.
  // Antwort als JSON mit dem tatsächlich gesprochenen Text, den Treffern und der Audiodatei (Base64-WAV).
  app.post("/adm_edit_replace/vorschau", auth.ensureAdmin, checkContentType, async (req, res) => {
    try {
      const modus = String(req.body.modus || "ersetzt");
      const kandidat = req.body.kandidat && typeof req.body.kandidat === "object" ? req.body.kandidat : null;
      let text = String(req.body.text || "").trim();
      let treffer = [];
      let fehlerhaft = [];

      if (kandidat && !TTS_TYPEN.includes(kandidat.rp_typ)) {
        return res.status(400).json({ error: "Dieser Typ wirkt nicht auf die Sprachansage und kann nicht angehört werden." });
      }

      if (kandidat && kandidat.rp_typ === "em_tts") {
        // Fahrzeugtyp: so sprechen, wie er in der Alarmansage vorkommt ("Für <Ausgabewert> <Nr>")
        if (!String(kandidat.rp_output || "").trim()) return res.status(400).json({ error: "Bitte einen Ausgabewert eingeben." });
        text = `Für ${String(kandidat.rp_output).trim()} 1`;
        // Als Entwurf markieren, solange die Werte nicht dem gespeicherten Eintrag entsprechen
        const gespeichert = kandidat.id ? await ersetzung_laden(kandidat.id) : null;
        const entwurf = !gespeichert || gespeichert.rp_input !== kandidat.rp_input || gespeichert.rp_output !== kandidat.rp_output;
        treffer = [{ id: kandidat.id || null, rp_input: kandidat.rp_input, rp_output: kandidat.rp_output, anzahl: 1, kandidat: entwurf }];
      } else {
        if (!text) return res.status(400).json({ error: "Bitte einen Text eingeben." });
        if (kandidat && kandidat.rp_input) {
          try {
            new RegExp(String(kandidat.rp_input), "gi");
          } catch (error) {
            return res.status(400).json({ error: `Der Eingabewert ist kein gültiger regulärer Ausdruck (${error.message}).` });
          }
        }
        if (modus !== "roh") {
          ({ text, treffer, fehlerhaft } = sql.tts_ersetzungen_anwenden(text, kandidat));
        }
      }

      text = tts.tts_text_bereinigen(text).replace(/\s+/g, " ").trim();
      if (text.length > TTS_VORSCHAU_MAX_LAENGE) {
        return res.status(400).json({ error: `Der Text ist zu lang (max. ${TTS_VORSCHAU_MAX_LAENGE} Zeichen).` });
      }
      if (!text) return res.status(400).json({ error: "Nach den Ersetzungen bleibt kein Text übrig." });

      const start = Date.now();
      const { audio, mime, provider } = await tts.tts_vorschau(text);
      res.json({
        text_gesprochen: text,
        treffer,
        fehlerhaft,
        provider,
        dauer_ms: Date.now() - start,
        mime,
        audio: audio.toString("base64"),
      });
    } catch (error) {
      logger.log("warn", `Aussprache-Vorschau fehlgeschlagen: ${error.message}`);
      res.status(502).json({ error: "Sprachausgabe fehlgeschlagen: " + error.message });
    }
  });

  // Ersetzung speichern: mit id wird der Eintrag geändert, sonst neu angelegt. Bei den Sprachausgabe-Typen
  // wird ein vorhandener Eintrag mit gleichem Eingabewert überschrieben (dort wirkt ohnehin nur einer);
  // Wachen-Aliase dürfen denselben Eingabewert mehrfach haben (ein Name → mehrere Wachen).
  app.post("/adm_edit_replace/speichern", auth.ensureAdmin, checkContentType, async (req, res) => {
    try {
      const rp = {
        id: req.body.id ? Number(req.body.id) : null,
        rp_typ: String(req.body.rp_typ || "").trim(),
        rp_input: String(req.body.rp_input || ""),
        rp_output: String(req.body.rp_output || "").trim(),
      };
      // Leerzeichen am Rand nur bei Regex-Suchtexten erhalten (können dort gewollt sein)
      if (rp.rp_typ !== "orte_tts") rp.rp_input = rp.rp_input.trim();
      const pruef_fehler = ersetzung_pruefen(rp);
      if (pruef_fehler) return res.status(400).json({ error: pruef_fehler });

      const vorhandene = await sql.db_replace_get_all_full();
      if (!rp.id) {
        const gleich = TTS_TYPEN.includes(rp.rp_typ) && vorhandene.find((r) => r.rp_typ === rp.rp_typ && r.rp_input === rp.rp_input);
        if (gleich) rp.id = gleich.id;
      } else if (!vorhandene.some((r) => r.id === rp.id)) {
        return res.status(404).json({ error: "Die Ersetzung existiert nicht mehr. Bitte als neuen Eintrag speichern." });
      }

      let aktion;
      if (rp.id) {
        await sql.db_replace_update(rp);
        aktion = "geaendert";
        config_event(req, `Ersetzung mit ID ${rp.id} wurde von ${req.user.user} bearbeitet.`, "ersetzung-geaendert", "change", {
          ziel_id: rp.id,
        });
      } else {
        rp.id = Number(await sql.db_replace_create(rp));
        aktion = "angelegt";
        config_event(req, `Ersetzung mit ID ${rp.id} wurde von ${req.user.user} angelegt.`, "ersetzung-angelegt", "creation", {
          ziel_id: rp.id,
        });
      }
      res.json({ ok: true, id: rp.id, aktion, ersetzungen: await sql.db_replace_get_all_full() });
    } catch (error) {
      logger.log("error", `Ersetzung nicht gespeichert: ${error.message}`);
      res.status(500).json({ error: "Fehler beim Speichern der Ersetzung. " + error.message });
    }
  });

  // Ersetzung löschen
  app.post("/adm_edit_replace/loeschen", auth.ensureAdmin, checkContentType, async (req, res) => {
    try {
      const id = Number(req.body.id);
      if (!id || !(await ersetzung_laden(id))) return res.status(404).json({ error: "Die Ersetzung existiert nicht (mehr)." });
      await sql.db_replace_delete(id);
      config_event(req, `Ersetzung mit ID ${id} wurde von ${req.user.user} gelöscht.`, "ersetzung-geloescht", "deletion", {
        ziel_id: id,
      });
      res.json({ ok: true, id, ersetzungen: await sql.db_replace_get_all_full() });
    } catch (error) {
      logger.log("error", `Ersetzung nicht gelöscht: ${error.message}`);
      res.status(500).json({ error: "Fehler beim Löschen der Ersetzung. " + error.message });
    }
  });

  /* ###################### */
  /* ##### Testseiten ##### */
  /* ###################### */

  // Wachalarm-Uhr testen
  app.get("/test_clock", function (req, res) {
    res.render("tests/test_clock", {
      public: app_cfg.public,
      title: "Test Datum/Uhrzeit",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Alarmmonitor testen
  app.get("/test_wachalarm", function (req, res) {
    res.render("tests/test_wachalarm", {
      public: app_cfg.public,
      title: "Test Wachalarm",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  // Dashboard testen
  app.get("/test_dashboard", function (req, res) {
    res.render("tests/test_dashboard", {
      public: app_cfg.public,
      title: "Test Dashboard",
      user: req.user,
      session_max_age: app_cfg.global.session_cookie_max_age,
    });
  });

  /* ######################## */
  /* ##### Fehlerseiten ##### */
  /* ######################## */

  // 404 abfangen und an error handler weiterleiten
  app.use((req, res, next) => {
    let err = new Error("Seite nicht gefunden!");
    err.status = 404;
    next(err);
  });

  // error handler
  app.use((err, req, res, next) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = app_cfg.development.dev_log ? err : {};
    // render the error page
    res.status(err.status || 500);
    res.render("page_error", {
      public: app_cfg.public,
      user: req.user,
    });
  });
};
