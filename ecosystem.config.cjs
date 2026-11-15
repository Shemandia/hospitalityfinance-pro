module.exports = {
  apps: [
    {
      name: "hfp-api",
      cwd: "./apps/api",
      script: "./dist/index.js",
      // Compiled workspace packages (their "production" export).
      node_args: "--conditions=production",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "4000"
      }
    },
    {
      name: "hfp-web",
      cwd: ".",
      script: "pnpm",
      args: "--filter @hfp/web start",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
        PORT: "3001"
      }
    },
    {
      name: "hfp-workers",
      cwd: "./apps/api",
      script: "./dist/jobs/worker-supervisor.js",
      // Compiled workspace packages (their "production" export).
      node_args: "--conditions=production",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
