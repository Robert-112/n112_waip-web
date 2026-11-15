const fs = require("fs");
const path = require("path");

// .env laden (kein externes Paket noetig)
try {
  const lines = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env nicht gefunden – Umgebungsvariablen des Systems werden verwendet
}

const app_cfg = {};

app_cfg.global = {
  http_port: Number(process.env.HTTP_PORT) || 3001,
  database: process.env.DATABASE || "./database.sqlite3",
  db_limit: Number(process.env.DB_LIMIT) || 500,
  db_limit_log: Number(process.env.DB_LIMIT_LOG) || 100000,
  soundpath: process.env.SOUNDPATH || "/public/media/",
  mediapath: process.env.MEDIAPATH || "/media/",
  uuidNamespace: process.env.UUID_NAMESPACE || "59cc72ec-4ff5-499d-81e2-ec49c1d01252",
  time_to_delete_waip: Number(process.env.TIME_TO_DELETE_WAIP) || 30,
  // Kurz-Archiv beendeter Brand-/Hilfeleistungseinsätze im Dashboard: Aufbewahrung in Tagen, 0 = aus
  archive_days: Math.max(0, Number(process.env.ARCHIVE_DAYS ?? 3) || 0),
  default_time_for_standby: Number(process.env.DEFAULT_TIME_FOR_STANDBY) || 15,
  system_cleanup_time: Number(process.env.SYSTEM_CLEANUP_TIME) || 10000,
  defaultuser: process.env.DEFAULT_USER || "me",
  defaultpass: process.env.DEFAULT_PASS || "123",
  defaultapiuser: process.env.DEFAULT_API_USER || "apiuser",
  defaultapipass: process.env.DEFAULT_API_PASS || "apiuser123",
  defaultuserip: process.env.DEFAULT_USER_IP || "127.0.0.1",
  saltRounds: Number(process.env.SALT_ROUNDS) || 10,
  sessionsecret: process.env.SESSION_SECRET || "0987654321abcdef#xyz",
  jwtsecret: process.env.JWT_SECRET || "1234567890abcdef#xyz",
  session_cookie_max_age: Number(process.env.SESSION_COOKIE_MAX_AGE) || 60000,
  authRegex: process.env.AUTH_REGEX || "(\\d+)[\\.\\-](\\d+)[\\.\\-](\\w+)",
  rightsRegex: process.env.RIGHTS_REGEX || "\\.(\\d+)[.-]",
};

// Entwicklungs-Schalter: ohne Eintrag in der .env ausgeschaltet. Eingeschaltet schreiben sie jede
// SQL-Anweisung bzw. Debug-Ausgaben (auch mit Einsatzinhalten) ins Log und zeigen Fehlerdetails an.
app_cfg.development = {
  dev_log: (process.env.DEV_LOG ?? "false") === "true",
  dev_sqlite: (process.env.DEV_SQLITE ?? "false") === "true",
};

app_cfg.log = {
  // Strukturiertes Log (JSON-Zeilen, Elastic Common Schema) z.B. für Filebeat/Elasticsearch, leer = aus
  json_file: process.env.LOG_JSON_FILE || "",
  // Intervall in Sekunden für Kennzahlen (Speicher, Event-Loop, Clients) im JSON-Log, 0 = aus
  metrics_interval: Number(process.env.LOG_METRICS_INTERVAL ?? 60),
};

app_cfg.public = {
  url: process.env.PUBLIC_URL || "https://waip.nix.nix",
  app_name: process.env.APP_NAME || "Wachalarm IP-Web",
  app_info: process.env.APP_INFO ?? "(Development Version)",
  company: process.env.COMPANY || "Netzwerk 112",
  // "tile" fuer Tile-Server, "wms" fuer WMS-Server (Backup: Tile-Server)
  map_service: {
    type: process.env.MAP_SERVICE_TYPE || "wms",
    tile_url: process.env.MAP_TILE_URL || "https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png",
    wms_url: process.env.MAP_WMS_URL || "",
    wms_layers: process.env.MAP_WMS_LAYERS || "OSM-WMS",
    wms_format: process.env.MAP_WMS_FORMAT || "image/png",
    wms_transparent: (process.env.MAP_WMS_TRANSPARENT ?? "true") === "true",
    wms_version: process.env.MAP_WMS_VERSION || "1.1.1",
  },
  ext_imprint: (process.env.EXT_IMPRINT ?? "false") === "true",
  url_imprint: process.env.URL_IMPRINT || "https://www.nix.nix/impressium",
  ext_privacy: (process.env.EXT_PRIVACY ?? "false") === "true",
  url_privacy: process.env.URL_PRIVACY || "https://www.nix.nix/datenschutz",
  show_login: (process.env.SHOW_LOGIN ?? "true") === "true",
  // Domains, gegen die der Alarmmonitor-Client periodisch prueft, ob eine unzulaessige
  // Netzkopplung (Internet-Zugriff aus dem eigentlich isolierten Netz) vorliegt.
  netzkopplung_check_urls: (process.env.NETZKOPPLUNG_CHECK_URLS || "https://www.google.com/favicon.ico,https://www.heise.de/favicon.ico")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
};

app_cfg.osrm = {
  enabled: (process.env.OSRM_ENABLED ?? "false") === "true",
  host: process.env.OSRM_HOST || "localhost",
  port: Number(process.env.OSRM_PORT) || 5000,
};

app_cfg.tts = {
  provider: process.env.TTS_PROVIDER || "local",
  piper_host: process.env.PIPER_HOST || "localhost",
  piper_port: Number(process.env.PIPER_PORT) || 10200,
  piper_voice: process.env.PIPER_VOICE || "de_DE-thorsten_emotional-medium",
};

// Standby-Widgets (Wetter, Unwetterwarnungen, Kalender, Ticker) – Daten holt nur der Server, die Monitore
// brauchen keinen Internetzugang
app_cfg.widgets = {
  // selbst gehostetes Bright Sky (DWD-Daten), leer = Wetter aus
  brightsky_url: (process.env.WIDGET_BRIGHTSKY_URL || "").replace(/\/+$/, ""),
  // aktuelles Wetter je Monitor alle x Minuten (Startzeitpunkt je Monitor zufällig verteilt)
  weather_interval: Number(process.env.WIDGET_WEATHER_INTERVAL) || 30,
  // Unwetterwarnungen alle x Minuten prüfen, Änderungen gehen sofort an alle Monitore
  alert_interval: Number(process.env.WIDGET_ALERT_INTERVAL) || 5,
  // Daten älter als x Minuten werden auf dem Monitor ausgeblendet
  max_age: Number(process.env.WIDGET_MAX_AGE) || 180,
  // Kalender-Dienst (eigener Docker): holt und wertet Termin- und Ticker-Kalender aus, leer = beides aus
  kalender_url: (process.env.WIDGET_KALENDER_URL || "").replace(/\/+$/, ""),
  kalender_token: process.env.WIDGET_KALENDER_TOKEN || "",
  // höchstens x Termine im Standby
  ical_max: Number(process.env.WIDGET_ICAL_MAX) || 4,
  // Herkunft (Leitstelle/Kreis) vor den Ticker-Meldungen anzeigen
  ticker_quelle: (process.env.WIDGET_TICKER_QUELLE ?? "true") === "true",
  zeitzone: process.env.WIDGET_TIMEZONE || "Europe/Berlin",
  // Wetter, Unwetterwarnungen und Waldbrandgefahr auf allen Monitoren zeigen, auch ohne Anmeldung
  // (z.B. öffentliche Installation ohne Login); einzelne Monitore lassen sich mit ?wetter=off ausnehmen
  wetter_standard: (process.env.WIDGET_WETTER_STANDARD ?? "false") === "true",
  // Waldbrandgefahrenstufen als JSON (Waldbrand-Dienst im Bright-Sky-Compose), leer = aus
  waldbrand_url: process.env.WIDGET_WALDBRAND_URL || "",
  // Waldbrandgefahr erst ab dieser Stufe (1–5) auf dem Monitor anzeigen
  waldbrand_ab_stufe: Math.min(5, Math.max(1, Number(process.env.WIDGET_WALDBRAND_AB_STUFE) || 3)),
};

// Anmeldung über Keycloak (OpenID Connect), auch mehrere Server/Realms: OIDC_PROVIDER=kms,lk und je ID
// die Einstellungen OIDC_<ID>_… (ID in Großbuchstaben). Die ID dient der Verknüpfung der Konten und darf
// später nicht mehr geändert werden. Unvollständige Einträge werden beim Start mit Warnung übersprungen.
app_cfg.oidc = (process.env.OIDC_PROVIDER || "")
  .split(",")
  .map((id) => id.trim().toLowerCase())
  .filter((id, i, alle) => id && alle.indexOf(id) === i)
  .map((id) => {
    if (!/^[a-z0-9_]+$/.test(id)) {
      console.warn(`START - OIDC_PROVIDER: ungültige ID '${id}' (erlaubt: a-z, 0-9, _), wird ignoriert.`);
      return null;
    }
    const env = (name, standard = "") => (process.env[`OIDC_${id.toUpperCase()}_${name}`] ?? standard).trim();
    const provider = {
      id: id,
      // Beschriftung des Buttons auf der Login-Seite
      name: env("NAME", "Keycloak"),
      text: env("TEXT", "Mit Ihrem zentralen Benutzerkonto"),
      // z.B. https://sso.example.de/realms/feuerwehr
      issuer: env("ISSUER").replace(/\/+$/, ""),
      client_id: env("CLIENT_ID"),
      client_secret: env("CLIENT_SECRET"),
      scope: env("SCOPE", "openid profile"),
      // Client-Rolle, ohne die keine Anmeldung möglich ist
      rolle: env("ROLLE", "wachalarm_login"),
      // Claim mit den Wachen-Rechten (Gruppen-Attribut), z.B. ["5201", "66"]
      claim_wachen: env("CLAIM_WACHEN", "wachalarm_wache"),
      // beim Abmelden auch die Keycloak-Sitzung beenden
      logout: env("LOGOUT", "true") === "true",
      // feste Höchstdauer der Anmeldung, danach neu anmelden (Rechte aus Keycloak werden dabei aktualisiert)
      session_stunden: Number(env("SESSION_STUNDEN", "12")) || 12,
      callback_url: `${app_cfg.public.url.replace(/\/+$/, "")}/login/oidc/${id}/callback`,
    };
    const fehlt = ["issuer", "client_id", "client_secret"].filter((k) => !provider[k]);
    if (fehlt.length > 0) {
      console.warn(`START - Keycloak '${id}': ${fehlt.map((k) => `OIDC_${id.toUpperCase()}_${k.toUpperCase()}`).join(", ")} fehlt, Anmeldung über '${id}' ist deaktiviert.`);
      return null;
    }
    return provider;
  })
  .filter(Boolean);

// für die Login-Seite und die Benutzerverwaltung (ohne Zugangsdaten)
app_cfg.public.oidc_anmeldung = app_cfg.oidc.map((p) => ({ id: p.id, name: p.name, text: p.text }));

module.exports = app_cfg;
