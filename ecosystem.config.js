// pm2-Konfiguration
// Im Betrieb ohne Dateiüberwachung: ein Neustart trennt kurz alle Alarmmonitore und lässt sie die Seite
// neu laden. Er soll nur auf ausdrücklichen Wunsch passieren (pm2 restart / reload), nicht bei jeder
// Dateiänderung (git pull, .env, Logdateien).
// Für die Entwicklung die Überwachung einschalten: PM2_WATCH=true pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: "n112_waip-web",
    script: "./index.js",
    autorestart: true,
    restart_delay: 2000,
    combine_logs: true,
    watch: process.env.PM2_WATCH === "true",
    ignore_watch: ["database.*","sessions*","node_modules","public","\\.git",".playwright-mcp","standby_seiten"],
    log_file: "~/log/n112_waip-web.log"
  }]
}
