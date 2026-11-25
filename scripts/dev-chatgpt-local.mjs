import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";

const reloadWindowMs = 15_000;
const compileThreshold = 12;
const requestThreshold = 8;

// Bind to loopback unless the caller passes --hostname or -H. That opt-out is
// explicit. A production build never enables the personal integration.
const forwarded = process.argv.slice(2);
const explicitHostname = forwarded.some((arg) =>
  arg === "--hostname" || arg.startsWith("--hostname=") || arg === "-H" || (arg.startsWith("-H") && arg.length > 2));
const child = spawn(process.execPath, [
  "node_modules/next/dist/bin/next", "dev",
  ...(explicitHostname ? [] : ["--hostname", "127.0.0.1"]),
  ...forwarded,
], {
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, MERGEONE_CHATGPT_LOCAL: "1" },
});

let stopReason;
function stop(signal, reason) {
  if (stopReason) return;
  stopReason = reason;
  child.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal, "signal"));
}

child.stdout.pipe(process.stdout, { end: false });
const activity = [];
const counts = new Map();
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  if (stopReason) return;
  const text = stripVTControlCharacters(line).trimStart();
  // Turbopack logs "Compiled in" for HMR events. Pair it with repeated GETs to
  // one pathname so ordinary editing or reloads alone do not stop the server.
  const compiled = /^✓?\s*Compiled in \d/.test(text);
  const pathname = /^GET (\/[^?\s]*)(?:\?\S*)? \d{3} in \d/.exec(text)?.[1];
  if (!compiled && !pathname) return;

  const time = performance.now();
  activity.push({ time, pathname });
  counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
  while (activity[0].time < time - reloadWindowMs) {
    const { pathname: expired } = activity.shift();
    const count = counts.get(expired) - 1;
    if (count > 0) counts.set(expired, count);
    else counts.delete(expired);
  }
  if ((counts.get(undefined) ?? 0) < compileThreshold) return;
  for (const [path, count] of counts) {
    if (path === undefined || count < requestThreshold) continue;
    console.error("Possible reload loop. Next kept compiling and serving the same page. Stopping Next to prevent repeated database requests.");
    stop("SIGTERM", "reload-loop");
    break;
  }
});

child.on("close", (code, signal) => {
  console.error(`Local Next process exited at ${new Date().toISOString()}: exitCode=${code}, signal=${signal}, requested=${stopReason === "signal"}`);
  process.exitCode = stopReason === "reload-loop" ? 1 : code ?? 1;
});
child.on("error", () => { process.exitCode = 1; });
