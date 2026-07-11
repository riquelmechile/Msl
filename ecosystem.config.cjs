const path = require("node:path");

const appDir = process.env.MSL_APP_DIR || __dirname;
const dataDir = process.env.MSL_DATA_DIR || "/home/sebastian/msl-data";
const logDir = process.env.MSL_LOG_DIR || path.join(dataDir, "logs");
const webHost = process.env.HOSTNAME || "127.0.0.1";
const webPort = process.env.PORT || "3000";

module.exports = {
  apps: [
    {
      name: "msl-telegram-bot",
      cwd: appDir,
      script: "scripts/start-bot.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      error_file: path.join(logDir, "telegram-bot.error.log"),
      out_file: path.join(logDir, "telegram-bot.out.log"),
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "msl-web",
      cwd: path.join(appDir, "apps/web"),
      script: path.join(appDir, "node_modules/next/dist/bin/next"),
      args: `start --hostname ${webHost} --port ${webPort}`,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      error_file: path.join(logDir, "web.error.log"),
      out_file: path.join(logDir, "web.out.log"),
      env: {
        NODE_ENV: "production",
        HOSTNAME: webHost,
        PORT: webPort,
      },
    },
    {
      name: "msl-worker-ingestion",
      cwd: appDir,
      script: "scripts/start-worker-ingestion.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      error_file: path.join(logDir, "worker-ingestion.error.log"),
      out_file: path.join(logDir, "worker-ingestion.out.log"),
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "msl-agent-daemons",
      cwd: appDir,
      script: "scripts/start-agent-daemons.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
      error_file: path.join(logDir, "agent-daemons.error.log"),
      out_file: path.join(logDir, "agent-daemons.out.log"),
      env: {
        NODE_ENV: "production",
        MSL_ECONOMIC_INGESTION_ENABLED: process.env.MSL_ECONOMIC_INGESTION_ENABLED ?? "false",
      },
    },
  ],
};
