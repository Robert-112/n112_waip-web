module.exports = {
  apps: [{
    name: "n112_waip-web",
    script: "./index.js",
    autorestart: true,
    restart_delay: 2000,
    combine_logs: true,
    watch: true,
    ignore_watch: ["database.*","sessions*","node_modules","public","\\.git"],
    log_file: "~/log/n112_waip-web.log"
  }]
}
