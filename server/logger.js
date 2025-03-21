module.exports = (sql, app_cfg) => {
  // Module laden
  require("console-stamp")(console, {
    pattern: "yyyy-mm-dd HH:MM:ss.l",
  });

  // Funktion für besseres console.log
  log = function (type, message) {
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
        if (app_cfg.global.development) {
          console.debug(message);
        }
        break;
      default:
        console.log(message);
        break;
    }
  };

  return {
    log: log,
  };
};
