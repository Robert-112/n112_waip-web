module.exports = function (app, sql, app_cfg, passport, auth, saver, logger) {
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
  app.get("/", (req, res) => {
    res.render("page_home", {
      public: app_cfg.public,
      title: "Startseite",
      user: req.user,
    });
  });

  // Ueber die Anwendung
  app.get("/ueber", (req, res) => {
    res.render("about", {
      public: app_cfg.public,
      title: "Über",
      user: req.user,
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
      await saver.save_einsatz(req.body, remote_ip);
      // Protokollieren
      const msg = "Einsatzdaten erfolgreich übermittelt und verarbeitet (/api/einsatzdaten).";
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/einsatzdaten).";
      logger.log("error", msg + " " + error);
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
      logger.log("log", msg);
      // OK zurücksenden
      res.status(200);
      res.send(msg);
    } catch (error) {
      // Fehler Protokollieren und Fehlermeldung senden
      const msg = "Fehler bei der Datenverarbeitung (/api/rueckmeldung).";
      logger.log("error", msg + " " + error);
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
      error: req.flash("errorMessage"),
    });
  });

  // Login-Formular verarbeiten
  app.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        req.flash("errorMessage", "Authentifizierung fehlgeschlagen! Bitte prüfen Sie Benutzername und Passwort.");
        return res.redirect("/login");
      }
      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }
        if (req.body.rememberme) {
          // der Benutzer muss sich fuer 5 Jahre nicht anmelden
          req.session.cookie.maxAge = 5 * 365 * 24 * 60 * 60 * 1000;
        }
        return res.redirect("/");
      });
    })(req, res, next);
  });

  // Logout verarbeiten
  app.post("/logout", function (req, res) {
    req.session.destroy(function (err) {
      res.redirect("/");
    });
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
        user_standbyurl: data.standbyurl,
        error: req.flash("errorMessage"),
        success: req.flash("successMessage"),
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
      req.flash("successMessage", "Einstellungen für die Anzeigezeit wurden erfolgreich gespeichert");
      res.redirect("/einstellungen");
    } catch (error) {
      req.flash("errorMessage", "Fehler beim Speichern der Einstellungen für die Anzeigezeit. " + error);
      res.redirect("/einstellungen");
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
      const wache = await sql.db_wache_vorhanden(parameter_id);
      if (wache) {
        res.render("waip", {
          public: app_cfg.public,
          title: "Alarmmonitor",
          wachen_id: parameter_id,
          data_wache: wache.name,
          map_service: app_cfg.public.map_service,
          app_id: app_cfg.global.app_id,
          user: req.user,
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
        error: req.flash("errorMessage"),
        success: req.flash("successMessage"),
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

  /* ###################### */
  /* ##### Testseiten ##### */
  /* ###################### */

  // Wachalarm-Uhr testen
  app.get("/test_clock", function (req, res) {
    res.render("tests/test_clock", {
      public: app_cfg.public,
      title: "Test Datum/Uhrzeit",
      user: req.user,
    });
  });

  // Alarmmonitor testen
  app.get("/test_wachalarm", function (req, res) {
    res.render("tests/test_wachalarm", {
      public: app_cfg.public,
      title: "Test Wachalarm",
      user: req.user,
    });
  });

  // Dashboard testen
  app.get("/test_dashboard", function (req, res) {
    res.render("tests/test_dashboard", {
      public: app_cfg.public,
      title: "Test Dashboard",
      user: req.user,
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
