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

  // Anmeldungen über Keycloak gelten höchstens OIDC_<ID>_SESSION_STUNDEN, auch wenn die Session durch Aktivität
  // (rolling) weiterläuft. Danach ist eine neue Anmeldung nötig, bei der die Rechte aus Keycloak aktualisiert werden.
  const oidc_abgelaufen = (req) => Boolean(req.user && req.session && req.session.oidc && Date.now() > req.session.oidc.ablauf);
  app.use((req, res, next) => {
    if (!oidc_abgelaufen(req)) return next();
    logger.log("log", `Anmeldung von ${req.user.user} über Keycloak ist abgelaufen, Benutzer wird abgemeldet.`);
    req.logout((err) => next(err));
  });

  // CSRF-Schutz für Formulare: Das Token wird aus der Session-ID abgeleitet (HMAC), in der Session selbst
  // wird nichts gespeichert. Geprüft werden nur POST-Anfragen, die API (JWT statt Cookie) ist ausgenommen,
  // Socket.IO läuft nicht über Express. Ein ungültiges Token verwirft nur das Formular, die Anmeldung bleibt bestehen.
  // Rücksprungziele nach ungültigem Token; nur feste Ziele, damit keine Weiterleitung auf fremde Seiten möglich ist
  const csrf_redirects = {
    "/login": "/login",
    "/logout": "/",
    "/einstellungen_zeit": "/einstellungen",
    "/einstellungen_standby": "/einstellungen",
    "/adm_edit_wetter": "/adm_edit_wetter",
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
    logger.event(`Formular ${req.path} mit ungültigem CSRF-Token verworfen.`, {
      ...logger.from_req(req),
      level: "warn",
      action: "csrf-abgelehnt",
      category: "web",
      type: "denied",
      outcome: "failure",
    });
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
        passReqToCallback: true,
      },
      async (req, user, password, done) => {
        // Fehlgeschlagene Anmeldung protokollieren. Ein unbekannter Benutzername wird nicht gespeichert,
        // weil darin versehentlich ein Passwort stehen kann.
        const login_failed = (reason, user_name) => {
          logger.event(`Anmeldung fehlgeschlagen (${reason}) von ${logger.from_req(req).client_ip}.`, {
            ...logger.from_req(req),
            user: user_name ? { name: user_name } : undefined,
            level: "warn",
            action: "login",
            category: "authentication",
            type: "start",
            outcome: "failure",
            reason: reason,
            wachalarm: { login_methode: "passwort" },
          });
        };
        try {
          // Verschlüsseltes Passwort aus DB abfragen
          const row = await sql.auth_localstrategy_cryptpassword(user);
          if (!row) {
            login_failed("benutzer-unbekannt");
            return done(null, false);
          }
          // mit Keycloak verknüpfte Konten melden sich nur über Keycloak an
          if (row.extern) {
            login_failed("keycloak-konto", user);
            return done(null, false);
          }
          // Konten ohne Passwort (z.B. Zertifikats-Nutzer) können sich nicht per Passwort anmelden
          if (!row.password || !password) {
            login_failed("kein-passwort", user);
            return done(null, false);
          }
          // Passwort-Hash mit dem aus der DB vergleichen
          const res = await bcrypt.compare(password, row.password);
          if (!res) {
            login_failed("passwort-falsch", user);
            return done(null, false);
          }
          // Benutzerdaten zurückgeben
          const userRow = await sql.auth_localstrategy_userid(user);
          return done(null, userRow);
        } catch (error) {
          logger.log("error", "Fehler bei der Benutzer-Authentifizierung: " + error);
          return done(error);
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
        return done(error);
      }
    })
  );

  // JWT-Authentifizierung
  passport.use(
    new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
      try {
        // User anhand der ID aus dem Token holen
        let user_id = await sql.auth_getUser(jwt_payload.id);
        if (user_id) {
          return done(null, user_id);
        }
        return done(null, false);
      } catch (error) {
        logger.log("error", "Fehler bei der Authentifizierung per JWT: " + error);
        return done(error);
      }
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
      return done(error);
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

  // Stammdaten pflegen (Wachen, Wetter-Standorte, Ersetzungen/Aussprache, Ticker-Quellen):
  // Administratoren und Benutzer mit der Zusatzrolle "datenpflege"
  const ensureDatenpflege = (req, res, next) => {
    if (!req.isAuthenticated()) {
      const err = new Error("Sie sind nicht angemeldet!");
      err.status = 401;
      return next(err);
    }
    try {
      if (sql.auth_ensureDatenpflege(req.user.id)) return next();
    } catch (error) {
      return next(error);
    }
    const err = new Error("Sie verfügen nicht über die notwendigen Berechtigungen!");
    err.status = 401;
    next(err);
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

  // Zusatzrollen neben den Wachen-Rechten (Formular: Checkbox name="rollen"); Administratoren und API-Benutzer
  // brauchen keine, Administratoren dürfen ohnehin alles
  const ROLLEN = ["datenpflege"];
  const normalize_rollen = (wert, permissions) => {
    if (permissions === "admin" || permissions === "api") return "";
    const liste = []
      .concat(wert || [])
      .flatMap((v) => String(v).split(","))
      .map((r) => r.trim())
      .filter((r) => ROLLEN.includes(r));
    return [...new Set(liste)].join(",");
  };

  const invalid_permissions_msg = "Ungültige Wachen-Rechte! Erlaubt sind Wachen-, Kreis- oder Leitstellennummern, z.B. 52,6601.";

  // Felder des Benutzer-Dialogs prüfen. Lokale Rollen: Administrator (Checkbox rolle_admin) ersetzt die
  // Wachen-Rechte, Datenpfleger (rollen) kommt zu ihnen hinzu. anmeldung = "" (Wachalarm: Passwort/Zertifikat)
  // oder die ID eines Keycloak (OIDC_PROVIDER), dann mit der Keycloak-ID des Benutzers in oidc_sub.
  // Rückgabe: { fehler } oder { permissions_lokal, rollen, rechte_modus, anmeldung }
  const formular_lesen = (req, bisheriger_provider) => {
    let anmeldung = null;
    const provider_id = String(req.body.anmeldung || "").trim();
    if (provider_id) {
      // nicht mehr konfigurierte Keycloaks bleiben für bestehende Verknüpfungen auswählbar
      if (!app_cfg.oidc.some((p) => p.id === provider_id) && provider_id !== bisheriger_provider) {
        return { fehler: "Unbekannter Keycloak '" + provider_id + "'." };
      }
      const sub = String(req.body.oidc_sub || "").trim();
      if (!/^[\w.@:|+-]{1,255}$/.test(sub)) {
        return { fehler: "Bitte eine gültige Keycloak-ID angeben (z.B. 3f2c9a1e-…, zu finden in Keycloak beim Benutzer unter „ID“)." };
      }
      anmeldung = { provider: provider_id, sub: sub };
    }

    let permissions_lokal;
    if (req.body.rolle_admin) {
      permissions_lokal = "admin";
    } else {
      const roh = req.body.waip_rights !== undefined ? req.body.waip_rights : req.body.permissions;
      // Keycloak-Konten dürfen ohne lokale Wachen auskommen (Rechte kommen aus Keycloak)
      if (anmeldung && String(roh || "").trim() === "") {
        permissions_lokal = "";
      } else {
        permissions_lokal = normalize_permissions(roh);
        if (!permissions_lokal || permissions_lokal === "admin") {
          return { fehler: invalid_permissions_msg };
        }
      }
    }
    return {
      permissions_lokal: permissions_lokal,
      rollen: normalize_rollen(req.body.rollen, permissions_lokal),
      rechte_modus: req.body.rechte_modus === "ersetzen" ? "ersetzen" : "ergaenzen",
      anmeldung: anmeldung,
    };
  };

  const anmeldung_text = (anmeldung) => (anmeldung ? `Keycloak ${anmeldung.provider}` : "Wachalarm");

  // Änderungen an Benutzern protokollieren (ausführender Admin steht in user.name)
  const iam_event = (req, message, action, type, wachalarm) => {
    logger.event(message, {
      ...logger.from_req(req),
      action: action,
      category: "iam",
      type: ["user", type],
      outcome: "success",
      wachalarm: wachalarm,
    });
  };

  const createUser = async (req, res) => {
    try {
      const f = formular_lesen(req, null);
      if (f.fehler) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(f.fehler));
      }
      // Keycloak-Konten haben kein Passwort, Wachalarm-Konten brauchen eines
      let hash = null;
      if (!f.anmeldung) {
        if (!req.body.password) {
          return res.redirect("/adm_edit_users?error=" + encodeURIComponent("Bitte ein Passwort vergeben."));
        }
        hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
      }
      const result = await sql.auth_create_new_user(req.body.username, hash, req.body.description || "", f.permissions_lokal, req.body.ip, f.rollen, {
        rechte_modus: f.rechte_modus,
        anmeldung: f.anmeldung,
      });
      if (result) {
        iam_event(req, `Benutzer ${req.body.username} wurde von ${req.user.user} angelegt (Anmeldung: ${anmeldung_text(f.anmeldung)}, Rechte: ${f.permissions_lokal || "nur Keycloak"}${f.rollen ? ", Rollen: " + f.rollen : ""}).`, "user-angelegt", "creation", {
          ziel_benutzer: req.body.username,
          rechte: f.permissions_lokal,
          rollen: f.rollen || undefined,
          anmeldung: anmeldung_text(f.anmeldung),
        });
        return res.redirect(
          "/adm_edit_users?success=" + encodeURIComponent("Neuer Benutzer wurde angelegt.")
        );
      } else {
        throw new Error("Fehler beim Erstellen eines neuen Benutzers. " + req.body.username);
      }
    } catch (error) {
      if (error.code === "VERKNUEPFUNG_BELEGT") {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(error.message));
      }
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
          iam_event(req, `Benutzer ${req.body.username} (ID ${req.body.id}) wurde von ${req.user.user} gelöscht.`, "user-geloescht", "deletion", {
            ziel_benutzer: req.body.username,
            ziel_benutzer_id: String(req.body.id),
          });
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
      const eigenes_konto = Number(req.user.id) === id;

      const bisher = ((await sql.db_user_get_all()) || []).find((u) => u.id === id);
      if (!bisher) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent("Benutzer nicht gefunden."));
      }

      const f = formular_lesen(req, bisher.oidc_provider);
      if (f.fehler) {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(f.fehler));
      }

      if (eigenes_konto && f.permissions_lokal !== "admin") {
        return res.redirect(
          "/adm_edit_users?error=" +
            encodeURIComponent("Sie können Ihr Recht als Administrator nicht selbst ändern!")
        );
      }
      // das eigene Konto nicht an Keycloak binden, sonst ist bei einem Ausfall von Keycloak keine Anmeldung möglich
      if (eigenes_konto && f.anmeldung && !bisher.oidc_provider) {
        return res.redirect(
          "/adm_edit_users?error=" +
            encodeURIComponent("Sie können Ihr eigenes Konto nicht mit Keycloak verknüpfen. Bitte von einem anderen Administrator-Konto aus vornehmen.")
        );
      }

      // Passwort nur ändern, wenn eines eingegeben wurde (null = unverändert); Keycloak-Konten haben keines
      let messages = [];
      let hash = null;
      if (!f.anmeldung && req.body.password && req.body.password.length > 0) {
        hash = await bcrypt.hash(req.body.password, app_cfg.global.saltRounds);
        messages.push("Passwort geändert.");
      }
      const verknuepft = f.anmeldung && (bisher.oidc_provider !== f.anmeldung.provider || bisher.oidc_sub !== f.anmeldung.sub);
      const getrennt = !f.anmeldung && bisher.oidc_provider;
      if (verknuepft) messages.push("Konto mit Keycloak verknüpft, die Anmeldung per Passwort ist damit nicht mehr möglich.");
      if (getrennt) messages.push("Verknüpfung mit Keycloak entfernt." + (hash ? "" : " Bitte ein Passwort vergeben, sonst ist keine Anmeldung möglich."));

      const result = await sql.auth_editUser(id, {
        password_hash: hash,
        description: req.body.description || "",
        permissions_lokal: f.permissions_lokal,
        ip_address: req.body.ip || "",
        rollen: f.rollen,
        rechte_modus: f.rechte_modus,
        anmeldung: f.anmeldung,
      });
      if (result) {
        iam_event(req, `Benutzer-ID ${id} wurde von ${req.user.user} geändert (Anmeldung: ${anmeldung_text(f.anmeldung)}, lokale Rechte: ${f.permissions_lokal || "keine"}${f.rollen ? ", Rollen: " + f.rollen : ""}${hash ? ", Passwort geändert" : ""}).`, "user-geaendert", "change", {
          ziel_benutzer_id: String(id),
          rechte: f.permissions_lokal,
          rollen: f.rollen || undefined,
          passwort_geaendert: hash !== null,
          anmeldung: anmeldung_text(f.anmeldung),
        });
        const successMsg = messages.concat(["Benutzer aktualisiert."]).join(" ");
        return res.redirect(
          "/adm_edit_users?success=" + encodeURIComponent(successMsg)
        );
      } else {
        throw new Error("Fehler beim Ändern eines Benutzers.");
      }
    } catch (error) {
      if (error.code === "VERKNUEPFUNG_BELEGT") {
        return res.redirect("/adm_edit_users?error=" + encodeURIComponent(error.message));
      }
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
    ensureDatenpflege: ensureDatenpflege,
    ensureApi: ensureApi,
    createUser: createUser,
    deleteUser: deleteUser,
    editUser: editUser,
  };
};
