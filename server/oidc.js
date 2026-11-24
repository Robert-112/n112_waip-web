// Anmeldung über Keycloak (OpenID Connect) mit Passport. Für jeden Eintrag in OIDC_PROVIDER entsteht eine eigene
// Passport-Strategy "oidc-<id>". Keycloak wird erst beim ersten Login abgefragt (Discovery), damit der Wachalarm
// auch startet und Alarme verteilt, wenn Keycloak nicht erreichbar ist. Schlägt die Abfrage fehl, wird es beim
// nächsten Login erneut versucht.
module.exports = (app_cfg, sql, passport, logger) => {
  // openid-client erst laden, wenn Keycloak konfiguriert ist
  let client = null;
  let OidcStrategy = null;
  const bibliothek = () => {
    if (!client) {
      // erst zuweisen, wenn beide Teile geladen sind (sonst bleibt nach einem Fehler ein halber Zustand)
      const geladen = require("openid-client");
      OidcStrategy = require("openid-client/passport").Strategy;
      client = geladen;
    }
  };

  // Proxy für die Verbindungen zu Keycloak (OIDC_<ID>_PROXY): undici erst laden, wenn ein Proxy eingetragen ist.
  // Es wird fetch aus demselben Paket verwendet, damit ProxyAgent und fetch sicher zusammenpassen.
  let undici = null;
  const proxy_bibliothek = () => {
    if (!undici) undici = require("undici");
    return undici;
  };

  // Proxy-Adresse ohne Zugangsdaten für das Log
  const proxy_anzeige = (adresse) => {
    try {
      const url = new URL(adresse);
      if (url.username || url.password) {
        url.username = "***";
        url.password = "";
      }
      return url.href.replace(/\/$/, "");
    } catch {
      return "(ungültig)";
    }
  };

  // fetch für openid-client, das über den Proxy des Providers läuft (gilt für Discovery, Token-Abruf und Userinfo)
  const proxy_fetch = (p) => {
    const { ProxyAgent, fetch } = proxy_bibliothek();
    const agent = new ProxyAgent(p.proxy);
    return (url, optionen) => fetch(url, { ...optionen, dispatcher: agent });
  };

  // je Provider: { promise, config } – promise läuft, solange die Discovery nicht abgeschlossen ist
  const zustand = {};

  const provider = (id) => app_cfg.oidc.find((p) => p.id === id) || null;

  // Werte eines Claims als Liste von Texten (Keycloak liefert je nach Mapper Text, Liste oder kommagetrennt)
  const claim_liste = (wert) =>
    []
      .concat(wert ?? [])
      .flatMap((v) => String(v).split(/[,;]/))
      .map((v) => v.trim())
      .filter(Boolean);

  // Claims aus ID-Token und Userinfo zusammenführen: Rollen und Wachen können je nach Mapper in einem
  // oder beiden stehen
  const claims_lesen = async (p, config, tokens) => {
    const id_token = tokens.claims() || {};
    let userinfo = {};
    if (config.serverMetadata().userinfo_endpoint && tokens.access_token) {
      try {
        userinfo = await client.fetchUserInfo(config, tokens.access_token, id_token.sub);
      } catch (error) {
        logger.log("warn", `Keycloak '${p.id}': Userinfo nicht abrufbar, es werden nur die Angaben aus dem ID-Token verwendet. ${error.message}`);
      }
    }
    const rollen = (c) => (c.resource_access && c.resource_access[p.client_id] && c.resource_access[p.client_id].roles) || [];
    return {
      sub: id_token.sub,
      benutzername: id_token.preferred_username || userinfo.preferred_username || id_token.email || userinfo.email || id_token.sub,
      name: id_token.name || userinfo.name || [id_token.given_name, id_token.family_name].filter(Boolean).join(" "),
      rollen: [...new Set([...claim_liste(rollen(id_token)), ...claim_liste(rollen(userinfo))])],
      wachen: [...claim_liste(id_token[p.claim_wachen]), ...claim_liste(userinfo[p.claim_wachen])],
    };
  };

  // nach erfolgreicher Anmeldung bei Keycloak: Rolle prüfen, Konto suchen/anlegen, Rechte übernehmen
  const verify = (p, config) => async (req, tokens, done) => {
    try {
      const c = await claims_lesen(p, config, tokens);
      const ereignis = { ...logger.from_req(req), user: { name: c.benutzername }, wachalarm: { login_methode: "keycloak", keycloak: p.id } };
      if (!c.sub) {
        return done(null, false, { message: "keine-id" });
      }
      if (!c.rollen.includes(p.rolle)) {
        logger.event(`Anmeldung über Keycloak '${p.id}' abgelehnt: ${c.benutzername} fehlt die Client-Rolle '${p.rolle}'.`, {
          ...ereignis,
          level: "warn",
          action: "login",
          category: "authentication",
          type: "start",
          outcome: "failure",
          reason: "keine-rolle",
        });
        return done(null, false, { message: "keine-rolle" });
      }
      // nur Wachen-, Kreis- oder Leitstellennummern übernehmen, nie "admin" o.ä. aus einem Gruppen-Attribut
      const wachen = c.wachen.filter((w) => /^\d+$/.test(w));
      const ignoriert = c.wachen.filter((w) => !/^\d+$/.test(w));
      if (ignoriert.length > 0) {
        logger.log("warn", `Keycloak '${p.id}': ungültige Werte in '${p.claim_wachen}' für ${c.benutzername} ignoriert: ${ignoriert.join(", ")}`);
      }
      const ergebnis = sql.auth_oidc_anmelden({ provider: p.id, provider_name: p.name, sub: c.sub, benutzername: c.benutzername, name: c.name, wachen: wachen });
      if (ergebnis.neu) {
        logger.event(`Benutzer ${ergebnis.user} wurde bei der ersten Anmeldung über Keycloak '${p.id}' angelegt (Rechte: ${ergebnis.rechte}).`, {
          ...ereignis,
          user: { name: ergebnis.user, id: ergebnis.id },
          action: "user-angelegt",
          category: "iam",
          type: ["user", "creation"],
          outcome: "success",
        });
      } else if (ergebnis.rechte_vorher !== ergebnis.rechte) {
        logger.event(`Rechte von ${ergebnis.user} durch Keycloak '${p.id}' geändert: ${ergebnis.rechte_vorher} → ${ergebnis.rechte}.`, {
          ...ereignis,
          user: { name: ergebnis.user, id: ergebnis.id },
          action: "user-geaendert",
          category: "iam",
          type: ["user", "change"],
          outcome: "success",
        });
      }
      // ID-Token für das Abmelden bei Keycloak merken (wird nach req.logIn in die Session geschrieben)
      req.oidc_anmeldung = { provider: p.id, id_token: tokens.id_token };
      return done(null, { id: ergebnis.id, user: ergebnis.user });
    } catch (error) {
      return done(error);
    }
  };

  // Strategy für einen Provider bereitstellen (Discovery beim ersten Aufruf), liefert den Namen der Strategy
  const strategie = async (p) => {
    const name = "oidc-" + p.id;
    if (zustand[p.id] && zustand[p.id].config) return name;
    if (!zustand[p.id]) {
      bibliothek();
      const optionen = { timeout: 10 };
      // nur für Tests ohne TLS (z.B. lokaler Keycloak), im Betrieb immer https
      if (p.issuer.startsWith("http://")) {
        optionen.execute = [client.allowInsecureRequests];
        logger.log("warn", `Keycloak '${p.id}' wird ohne TLS angesprochen (${p.issuer}). Nur für Tests verwenden!`);
      }
      // wird von openid-client in die Konfiguration übernommen und gilt auch für alle späteren Abfragen
      if (p.proxy) optionen[client.customFetch] = proxy_fetch(p);
      zustand[p.id] = {
        promise: client
          .discovery(new URL(p.issuer), p.client_id, p.client_secret, undefined, optionen)
          .then((config) => {
            passport.use(
              name,
              new OidcStrategy(
                {
                  config: config,
                  name: name,
                  sessionKey: "oidc_" + p.id,
                  callbackURL: p.callback_url,
                  scope: p.scope,
                  passReqToCallback: true,
                },
                verify(p, config)
              )
            );
            zustand[p.id].config = config;
            logger.log("log", `Keycloak '${p.id}' (${p.issuer}) eingerichtet.`);
          })
          .catch((error) => {
            // beim nächsten Login erneut versuchen
            delete zustand[p.id];
            throw error;
          }),
      };
    }
    await zustand[p.id].promise;
    return name;
  };

  // Adresse zum Beenden der Keycloak-Sitzung, null wenn nicht gewünscht oder nicht möglich
  const abmelde_url = (anmeldung) => {
    const p = anmeldung && provider(anmeldung.provider);
    const config = p && zustand[p.id] && zustand[p.id].config;
    if (!p || !p.logout || !config || !config.serverMetadata().end_session_endpoint) return null;
    const parameter = { post_logout_redirect_uri: app_cfg.public.url.replace(/\/+$/, "") + "/", client_id: p.client_id };
    if (anmeldung.id_token) parameter.id_token_hint = anmeldung.id_token;
    return client.buildEndSessionUrl(config, parameter).href;
  };

  if (app_cfg.oidc.length > 0) {
    logger.log(
      "log",
      `Anmeldung über Keycloak aktiviert: ${app_cfg.oidc.map((p) => p.id + " (" + p.issuer + (p.proxy ? ", über Proxy " + proxy_anzeige(p.proxy) : "") + ")").join(", ")}`
    );
    try {
      bibliothek();
    } catch (error) {
      logger.log("error", `Anmeldung über Keycloak nicht möglich, das Paket openid-client fehlt (npm install ausführen): ${error.message}`);
    }
    if (app_cfg.oidc.some((p) => p.proxy)) {
      try {
        proxy_bibliothek();
      } catch (error) {
        logger.log("error", `Anmeldung über Keycloak mit Proxy nicht möglich, das Paket undici fehlt (npm install ausführen): ${error.message}`);
      }
    }
  }

  return {
    provider: provider,
    strategie: strategie,
    abmelde_url: abmelde_url,
  };
};
