const fs = require("fs");
const net = require("net");
const path = require("path");
const { monitorEventLoopDelay } = require("perf_hooks");

module.exports = (sql, app_cfg) => {
  // Module laden
  require("console-stamp")(console, {
    pattern: "yyyy-mm-dd HH:MM:ss.l",
  });

  /* ########################################################### */
  /* ##### Strukturiertes Log (JSON, Elastic Common Schema) #### */
  /* ########################################################### */

  // Eine JSON-Zeile pro Ereignis, gedacht zum Einsammeln durch Filebeat. In die Datei gelangen nur
  // ausdrücklich erfasste Ereignisse (logger.event) sowie Warnungen und Fehler. Einfache Meldungen
  // ("log", "info", "debug") bleiben auf der Konsole, weil sie Einsatzinhalte enthalten können.
  const ECS_VERSION = "8.11.0";
  const MAX_MESSAGE_LENGTH = 2000;
  const json_file = app_cfg.log && app_cfg.log.json_file;
  let json_fd = null;
  let json_write_error_reported = false;

  if (json_file) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(json_file)), { recursive: true });
      // "a" (O_APPEND): jede Zeile landet am Dateiende, auch nach logrotate mit copytruncate
      json_fd = fs.openSync(json_file, "a", 0o640);
    } catch (error) {
      console.error(`JSON-Log ${json_file} kann nicht geöffnet werden, strukturiertes Logging ist deaktiviert: ${error.message}`);
    }
  }

  const truncate = (text) => {
    const str = String(text ?? "");
    return str.length > MAX_MESSAGE_LENGTH ? str.slice(0, MAX_MESSAGE_LENGTH) + " …[gekürzt]" : str;
  };

  // Synchron schreiben: die Ereignisse sind selten und klein, die Reihenfolge bleibt erhalten und
  // auch die letzte Zeile vor einem Absturz landet in der Datei. Fehler beim Schreiben dürfen die
  // Anwendung nie beeinträchtigen.
  const write_json = (doc) => {
    if (json_fd === null) return;
    try {
      fs.writeSync(json_fd, JSON.stringify(doc) + "\n");
    } catch (error) {
      if (!json_write_error_reported) {
        json_write_error_reported = true;
        console.error(`JSON-Log ${json_file} kann nicht geschrieben werden: ${error.message}`);
      }
    }
  };

  // IP-Adresse normalisieren (::ffff:-Präfix entfernen), ungültige Werte verwerfen
  const clean_ip = (ip) => {
    if (!ip) return null;
    let value = String(ip).trim();
    if (value.startsWith("::ffff:")) value = value.slice(7);
    return net.isIP(value) ? value : null;
  };

  const error_fields = (error) => {
    if (!error) return undefined;
    if (error instanceof Error) {
      return { message: truncate(error.message), type: error.name, stack_trace: truncate(error.stack) };
    }
    return { message: truncate(error) };
  };

  const as_array = (value) => (value === undefined || value === null ? undefined : Array.isArray(value) ? value : [value]);

  // Leere Werte entfernen, damit keine null-Felder in Elasticsearch landen
  const compact = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null || value === "") continue;
      const v = compact(value);
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out[key] = v;
    }
    return out;
  };

  const build_doc = (level, message, spec = {}) => {
    const ip = clean_ip(spec.client_ip);
    return compact({
      "@timestamp": new Date().toISOString(),
      message: truncate(message),
      log: { level: level, logger: "wachalarm" },
      ecs: { version: ECS_VERSION },
      service: { name: "wachalarm", type: "nodejs", version: app_cfg.public && app_cfg.public.version },
      process: { pid: process.pid },
      event: {
        kind: spec.kind || "event",
        dataset: "wachalarm",
        module: "wachalarm",
        action: spec.action,
        category: as_array(spec.category),
        type: as_array(spec.type),
        outcome: spec.outcome,
        reason: spec.reason,
        // ECS erwartet die Dauer in Nanosekunden
        duration: typeof spec.duration_ms === "number" ? Math.round(spec.duration_ms * 1e6) : undefined,
      },
      client: ip ? { ip: ip, address: ip } : spec.client_ip ? { address: String(spec.client_ip) } : undefined,
      user: spec.user ? { name: spec.user.name, id: spec.user.id != null ? String(spec.user.id) : undefined } : undefined,
      user_agent: spec.user_agent ? { original: truncate(spec.user_agent) } : undefined,
      url: spec.url_path ? { path: spec.url_path } : undefined,
      http: spec.http_method || spec.http_status
        ? { request: { method: spec.http_method }, response: { status_code: spec.http_status } }
        : undefined,
      error: error_fields(spec.error),
      wachalarm: spec.wachalarm,
    });
  };

  /* ########################## */
  /* ##### Konsolen-Logger #### */
  /* ########################## */

  // Ausgabe auf der Konsole bzw. in waip_log (unverändertes Verhalten)
  const console_out = (type, message) => {
    switch (type) {
      case "log":
        console.log(message);
        break;
      case "info":
        console.info(message);
        break;
      case "warn":
        console.warn(message);
        break;
      case "error":
        console.error(message);
        break;
      case "waip":
        console.info("DB-Log: " + message);
        sql.db_log(type, message);
        break;
      case "dbrd":
        console.log("DB-Log: " + message);
        sql.db_log(type, message);
        break;
      case "rmld":
        console.log("DB-Log: " + message);
        sql.db_log(type, message);
        break;
      case "debug":
        if (app_cfg.development.dev_log) {
          console.debug(message);
        }
        break;
      default:
        console.log(message);
        break;
    }
  };

  // Funktion für besseres console.log
  const log = (type, message) => {
    console_out(type, message);

    // Warnungen und Fehler zusätzlich strukturiert protokollieren
    if (type === "warn" || type === "error") {
      const is_error = message instanceof Error;
      write_json(
        build_doc(type, is_error ? message.message : message, {
          action: "anwendungsmeldung",
          error: is_error ? message : undefined,
        })
      );
    }
  };

  // Ein Ereignis strukturiert protokollieren. Felder von spec:
  //   level        "info" (Standard), "warn", "error", "critical"
  //   action       festes Kürzel, z.B. "login" oder "netzkopplung-pruefung"
  //   category     ECS-Kategorie(n): authentication, session, iam, configuration, network, web, process, api
  //   type         ECS-Typ(en): start, end, info, denied, allowed, change, creation, deletion, error
  //   outcome      "success" oder "failure"
  //   kind         "event" (Standard), "alert" (Verdachtsfall) oder "metric"
  //   reason       kurze Begründung, z.B. bei abgelehnten Anmeldungen
  //   duration_ms  Dauer in Millisekunden
  //   client_ip, user ({ name, id }), user_agent, url_path, http_method, http_status
  //   error        Error-Objekt oder Text
  //   wachalarm    anwendungsspezifische Felder (nur IDs, Nummern, Zähler – keine Einsatzinhalte!)
  //   db           Typ für die Log-Tabelle der Anwendung ("waip", "dbrd", "rmld"), optional
  const event = (message, spec = {}) => {
    const level = spec.level || "info";
    const console_type = level === "critical" ? "error" : level === "info" ? "log" : level;
    console_out(spec.db || console_type, message);
    write_json(build_doc(level, message, spec));
  };

  /* ################################# */
  /* ##### Hilfen für Aufrufer ####### */
  /* ################################# */

  // Client-IP eines HTTP-Requests (gleiche Reihenfolge wie bisher in routing.js)
  const remote_ip_from_req = (req) => {
    if (req.headers["x-real-ip"]) return req.headers["x-real-ip"];
    if (req.headers["x-forwarded-for"]) return req.headers["x-forwarded-for"].split(",")[0].trim();
    return req.socket && req.socket.remoteAddress;
  };

  const user_info = (user) => (user && user.user ? { name: user.user, id: user.id } : undefined);

  // Standardfelder aus einem Express-Request
  const from_req = (req) => ({
    client_ip: remote_ip_from_req(req),
    user: user_info(req.user),
    user_agent: req.headers["user-agent"],
    url_path: (req.originalUrl || req.url || "").split("?")[0],
    http_method: req.method,
  });

  // Standardfelder aus einem Socket.IO-Socket
  const from_socket = (socket, remote_ip) => ({
    client_ip:
      remote_ip ||
      (socket.handshake &&
        (socket.handshake.headers["x-real-ip"] ||
          (socket.handshake.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          socket.handshake.address)),
    user: user_info(socket.data && socket.data.user),
    user_agent: socket.handshake && socket.handshake.headers["user-agent"],
  });

  // Express-Middleware: HTTP-Antworten mit Fehlerstatus protokollieren (abgelehnte Zugriffe,
  // unbekannte Seiten z.B. durch Scanner, Serverfehler). Query-Strings werden nicht erfasst.
  const http_error_middleware = (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const status = res.statusCode;
      if (status < 400) return;
      const denied = status === 401 || status === 403;
      const level = status >= 500 ? "error" : denied ? "warn" : "info";
      const fields = from_req(req);
      write_json(
        build_doc(level, `HTTP ${status} für ${req.method} ${fields.url_path} von ${fields.client_ip}`, {
          ...fields,
          action: denied ? "zugriff-verweigert" : status >= 500 ? "http-serverfehler" : "http-fehler",
          category: "web",
          type: denied ? ["access", "denied"] : status >= 500 ? "error" : "info",
          outcome: "failure",
          http_status: status,
          duration_ms: Number(process.hrtime.bigint() - start) / 1e6,
        })
      );
    });
    next();
  };

  /* ######################################## */
  /* ##### Prozess-Ereignisse und Metriken ## */
  /* ######################################## */

  // Abstürze protokollieren, ohne das Standardverhalten (Prozessende, Neustart durch pm2) zu ändern
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    write_json(
      build_doc("critical", `Anwendung abgestürzt (${origin}): ${error && error.message}`, {
        action: "anwendung-absturz",
        category: "process",
        type: ["end", "error"],
        outcome: "failure",
        reason: origin,
        error: error,
      })
    );
  });

  // Beenden per Signal protokollieren und das Signal danach erneut auslösen,
  // damit sich der Prozess wie bisher beendet
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      write_json(
        build_doc("info", `Anwendung wird beendet (${signal}).`, {
          action: "anwendung-gestoppt",
          category: "process",
          type: "end",
          outcome: "success",
          reason: signal,
          duration_ms: process.uptime() * 1000,
        })
      );
      process.kill(process.pid, signal);
    });
  }

  // Periodische Kennzahlen zur Stabilität (Speicher, Event-Loop-Verzögerung, verbundene Clients)
  const start_metrics = (io) => {
    const interval_s = app_cfg.log ? app_cfg.log.metrics_interval : 0;
    if (json_fd === null || !interval_s || interval_s <= 0) return;

    // Die Messwerte enthalten die Auflösung des Messtimers, diese wird abgezogen
    const resolution_ms = 10;
    const loop_delay = monitorEventLoopDelay({ resolution: resolution_ms });
    loop_delay.enable();
    const delay_ms = (ns) => Math.max(0, Number((ns / 1e6 - resolution_ms).toFixed(2)));

    const timer = setInterval(() => {
      try {
        const mem = process.memoryUsage();
        const metriken = {
          sockets_waip: io.of("/waip").sockets.size,
          sockets_dbrd: io.of("/dbrd").sockets.size,
          speicher_rss_bytes: mem.rss,
          speicher_heap_bytes: mem.heapUsed,
          eventloop_verzoegerung_mittel_ms: delay_ms(loop_delay.mean),
          eventloop_verzoegerung_p99_ms: delay_ms(loop_delay.percentile(99)),
          eventloop_verzoegerung_max_ms: delay_ms(loop_delay.max),
          laufzeit_s: Math.floor(process.uptime()),
        };
        loop_delay.reset();
        write_json(
          build_doc("info", "Kennzahlen", {
            action: "kennzahlen",
            kind: "metric",
            category: "process",
            type: "info",
            wachalarm: { metriken: metriken },
          })
        );
      } catch (error) {
        console.error("Fehler beim Erfassen der Kennzahlen: " + error.message);
      }
    }, interval_s * 1000);
    timer.unref();
  };

  return {
    log: log,
    event: event,
    from_req: from_req,
    from_socket: from_socket,
    http_error_middleware: http_error_middleware,
    start_metrics: start_metrics,
  };
};
