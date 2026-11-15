/**
 * Runs the Next.js CLI (`dev` or `start`) on the port from PORT (HC-30).
 *
 * PORT comes from the environment or apps/web/.env.local (the package script
 * loads that file with --env-file-if-exists); the default is 3001. Next.js
 * itself reads .env.local only after it has chosen a port, so the port cannot
 * be left to Next.js.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";

const DEFAULT_PORT = "3001";
const port = process.env.PORT?.trim() || DEFAULT_PORT;
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  process.stderr.write(`PORT must be a port number (1-65535), not "${port}".\n`);
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, ...process.argv.slice(2), "--port", port], {
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  // Exit as the shell would for a process ended by a signal: 128 + its number.
  process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1));
});
