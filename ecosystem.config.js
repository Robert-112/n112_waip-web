module.exports = {
  apps: [{
    name: "waip",
    script: "./index.js",
    autorestart: true,
    restart_delay: 2000,
    combine_logs: true,
    watch: true,
    ignore_watch: ["database.*","sessions*","node_modules","public","\\.git"],
    log_file: "~/log/waip_v2.log"
  }]
}
