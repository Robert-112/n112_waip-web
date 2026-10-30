module.exports = (app, app_cfg, sql, bcrypt, passport, io, logger) => {
  const crypto = require("crypto");
  const session = require("express-session");
  const SQLiteStore = require("connect-sqlite3")(session);
  const LocalStrategy = require("passport-local").Strategy;
  const CertStrategy = require("passport-trusted-header").Strategy;
  const sessionStore = new SQLiteStore();

  // JWT-Authentifizierung
  const jwt = require("jsonwebtoken");
  const passportJWT = require("passport-jwt");
  let ExtractJwt = passportJWT.ExtractJwt;
  let JwtStrategy = passportJWT.Strategy;
  let jwtOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: app_cfg.global.jwtsecret,
  };

  const sessionMiddleware = session({
    store: sessionStore,
    key: "connect.sid",
    secret: app_cfg.global.sessionsecret,
    resave: false,
    saveUninitialized: true,
    // rolling: true sorgt dafür, dass bei jeder Antwort das Ablaufdatum des Cookies erneuert wird,
    // solange der Client aktiv bleibt.
    rolling: true,
    cookie: {
      maxAge: app_cfg.global.session_cookie_max_age,
      // Cookie nicht bei Formular-Absendungen von fremden Seiten mitsenden (CSRF-Schutz).
      // Gilt nur für neu angelegte Sessions, bestehende behalten ihre gespeicherten Cookie-Einstellungen.
      sameSite: "lax",
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF-Schutz für Formulare: Das Token wird aus der Session-ID abgeleitet (HMAC), in der Session selbst
  // wird nichts gespeichert. Geprüft werden nur POST-Anfragen, die API (JWT statt Cookie) ist ausgenommen,
  // Socket.IO läuft nicht über Express. Ein ungültiges Token verwirft nur das Formular, die Anmeldung bleibt bestehen.
  // Rücksprungziele nach ungültigem Token; nur feste Ziele, damit keine Weiterleitung auf fremde Seiten möglich ist
  const csrf_redirects = {
    "/login": "/login",
    "/logout": "/",
    "/einstellungen_zeit": "/einstellungen",
    "/adm_edit_users": "/adm_edit_users",
    "/adm_edit_wachen": "/adm_edit_wachen",
    "/adm_edit_replace": "/adm_edit_replace",
  };
  app.use((req, res, next) => {
    const expected = crypto.createHmac("sha256", app_cfg.global.sessionsecret).update("csrf:" + req.sessionID).digest("hex");
    res.locals.csrf_token = expected;
    if (req.method !== "POST" || req.path.startsWith("/api/")) {
      return next();
    }
    const received = String((req.body && req.body._csrf) || "");
    if (received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
      return next();
    }
    logger.log("warn", `Formular ${req.path} mit ungültigem CSRF-Token verworfen.`);
    const target = csrf_redirects[req.path] || csrf_redirects["/" + req.path.split("/")[1]] || "/";
    const msg = "Das Formular war nicht mehr gültig (z.B. nach längerer Wartezeit). Bitte erneut versuchen.";
    res.redirect(target + (target === "/" ? "" : "?error=" + encodeURIComponent(msg)));
  });

  function onlyForHandshake(middleware) {
    return (req, res, next) => {
      const isHandshake = req._query.sid === undefined;
      if (isHandshake) {
        middleware(req, res, next);
      } else {
        next();
      }
    };
  }

  io.engine.use(onlyForHandshake(sessionMiddleware));
  io.engine.use(onlyForHandshake(passport.session()));
  io.engine.use(
    onlyForHandshake((req, res, next) => {
      if (req.user) {
        next();
      } else {
        //res.writeHead(401);
        //res.end();
        next();
      }
    })
  );

  // Benutzerauthentifizierung per Login
  passport.use(
    new LocalStrategy(
      {
        usernameField: "user",
      },
      async (user, password, done) => {
        try {
          // Verschlüsseltes Passwort aus DB abfragen
          const row = await sql.auth_localstrategy_cryptpassword(user);
          if (!row) return done(null, false);
          // Passwort-Hash mit dem aus der DB vergleichen
          const res = await bcrypt.compare(password, row.password);
          if (!res) return done(null, false);
          // Benutzerdaten zurückgeben
          const userRow = await sql.auth_localstrategy_userid(user);
          return done(null, userRow);
        } catch (error) {
          logger.log("error", "Fehler bei der Benutzer-Authentifizierung: " + error);
        }
      }
    )
  );

  // Optionen für die Trusted Header Strategie, Schreibweise der Header ist entscheidend!
  var certOptions = {
    headers: ["x-ssl-client-dn"],
  };

  // Trusted Header Strategie für Client-Zertifikate
  passport.use(
    new CertStrategy(certOptions, async (requestHeaders, done) => {
      try {
        // Überprüfen, ob der Header x-ssl-client-dn vorhanden ist und daraus DN und CN extrahieren
        const dn = requestHeaders["x-ssl-client-dn"];
        const cn = dn.split(",")[0].split("=")[1];

        // User anhand des CN (Common Name) aus der Datenbank holen
        let user_id = await sql.auth_certstrategy_userid(cn);
        if (user_id) {
          logger.log("debug", "Benutzer gefunden für CN: " + cn);
          return done(null, user_id);
        }
        logger.log("debug", "Kein Benutzer gefunden für CN: " + cn);
        // Kein Benutzer gefunden, Authentifizierung fehlgeschlagen
        return done(null, false);
      } catch (error) {
        logger.log("error", "Fehler bei der Authentifizierung mit Client-Zertifikat: " + error);
      }
    })
  );

  // JWT-Authentifizierung
  passport.use(
    new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
      // User anhand der ID aus dem Token holen
      let user_id = await sql.auth_getUser(jwt_payload.id);
      if (user_id) {
        return done(null, user_id);
      }
      return done(null, false);
    })
  );

  // Funktion die den Benutzer anhand der ID speichert
  passport.serializeUser((user, done) => {
    return done(null, user.id);
  });

  // Funktion die den Benutzer anhand der ID wiederherstellt
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await sql.auth_deserializeUser(id);
      if (!user) {
        return done(null, false);
      } else {
        return done(null, user);
      }
    } catch (error) {
      logger.log("error", "Fehler bei passport.deserializeUser: " + error);
    }
  });

  // Funktion die prueft ob der Benutzer angemeldet ist
  const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
      // req.user is available for use here
      return next();
    }
    // denied. redirect to login
    let err = new Error("Sie sind nicht angemeldet!");
    err.status = 401;
    next(err);
  };

  const ensureAdmin = async (req, res, next) => {
    if (req.isAuthenticated()) {
      const is_admin = await sql.auth_ensureAdmin(req.user.id);
      if (is_admin) {
        // req.user is available for use here
        return next();
      } else {
        let err = new Error("Sie verfügen nicht über die notwendigen Berechtigungen!");
        err.status = 401;
        next(err);
      }
    } else {
      // denied. redirect to login
      let err = new Error("Sie sind nicht angemeldet!");
      err.status = 401;
      next(err);
    }
  };

  const ensureApi = (user_id) => {
    return new Promise(async (resolve, reject) => {
      try {
        const api_user = await sql.auth_ensureApi(user_id);
        if (api_user) {
          // User wird mit seiner ID identifiziert
          let payload = { id: user_id };
          // Gültigkeit des API-Tokens auf 15 Minuten begrenzen
          let token = jwt.sign(payload, jwtOptions.secretOrKey, { expiresIn: "15m" });
          resolve(token);
        } else {
          resolve(null);
        }
      } catch (error) {
        logger.log("error", "Fehler beim Prüfen der API-Berechtigung für einen User: " + error);
        resolve(null);
      }
    });
  };

  // Berechtigungen aus dem Benutzer-Formular prüfen und vereinheitlichen: "admin", "api" und "keine"
  // bleiben unverändert, sonst eine Liste von Wachen-, Kreis- oder Leitstellennummern ("52,6601").
  // Leerzeichen und leere Einträge werden entfernt, alles andere ist ungültig (Rückgabe null).
  const normalize_permissions = (permissions) => {
    if (permissions === "admin" || permissions === "api" || permissions === "keine") {
      return permissions;
    }
    const list = String(permissions || "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (list.length === 0 || !list.every((p) => /^\d+$/.test(p))) {
      return null;
    }
    return list.join(",");
  };

  const invalid_permissions_msg = "Ungültige Berechtigungen! Erlaubt sind 'admin' oder Wachennummern, z.B. 52,6601.";

  const createUser = async (req, res) => {
    try {
      const permissions = normalize_permissions(req.body.permissions);
      if (!permissions) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(invalid_permissions_msg));
      }
      const hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
      const result = await sql.auth_create_new_user(req.body.username, hash, req.body.description || "", permissions, req.body.ip);
      if (result) {
        return res.redirect(
          "/adm_edit_users?success=" + encodeURIComponent("Neuer Benutzer wurde angelegt.")
        );
      } else {
        throw new Error("Fehler beim Erstellen eines neuen Benutzers. " + req.body.username);
      }
    } catch (error) {
      logger.log("error", "Fehler beim Erstellen eines neuen Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Erstellen eines neuen Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  const deleteUser = async (req, res) => {
    try {
      if (req.user.id == req.body.id) {
        return res.redirect(
          "/adm_edit_users?error=" + encodeURIComponent("Sie können sich nicht selbst löschen!")
        );
      } else {
        const result = await sql.auth_deleteUser(req.body.id);
        if (result) {
          return res.redirect(
            "/adm_edit_users?success=" +
              encodeURIComponent("Benutzer '" + req.body.username + "' wurde gelöscht!")
          );
        } else {
          throw new Error("Fehler beim Löschen eines Benutzers. " + req.body.username);
        }
      }
    } catch (error) {
      logger.log("error", "Fehler beim Löschen eines Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Löschen eines Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  const editUser = async (req, res) => {
    try {
      // Benutzer-ID muss eine Zahl sein
      if (!/^\d+$/.test(String(req.body.modal_id))) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent("Ungültige Benutzer-ID."));
      }
      const id = Number(req.body.modal_id);

      const permissions = normalize_permissions(req.body.permissions);
      if (!permissions) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(invalid_permissions_msg));
      }

      if (Number(req.user.id) === id && permissions !== "admin") {
        return res.redirect(
          "/adm_edit_users?error=" +
            encodeURIComponent("Sie können Ihr Recht als Administrator nicht selbst ändern!")
        );
      }

      // Passwort nur ändern, wenn eines eingegeben wurde (null = unverändert)
      let messages = [];
      let hash = null;
      if (req.body.password && req.body.password.length > 0) {
        hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
        messages.push("Passwort geändert.");
      }

      const result = await sql.auth_editUser(id, hash, req.body.description || "", permissions, req.body.ip || "");
      if (result) {
        const successMsg = messages.concat(["Benutzer aktualisiert."]).join(" ");
        return res.redirect(
          "/adm_edit_users?success=" + encodeURIComponent(successMsg)
        );
      } else {
        throw new Error("Fehler beim Ändern eines Benutzers.");
      }
    } catch (error) {
      logger.log("error", "Fehler beim Ändern eines Benutzers: " + error);
      return res.redirect(
        "/adm_edit_users?error=" +
          encodeURIComponent("Fehler beim Ändern eines Benutzers. Bitte Log-Datei prüfen.")
      );
    }
  };

  return {
    ensureAuthenticated: ensureAuthenticated,
    ensureAdmin: ensureAdmin,
    ensureApi: ensureApi,
    createUser: createUser,
    deleteUser: deleteUser,
    editUser: editUser,
  };
};
