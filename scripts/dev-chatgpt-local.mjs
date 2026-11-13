import { spawn } from "node:child_process";

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
  stdio: "inherit",
  env: { ...process.env, MERGEONE_CHATGPT_LOCAL: "1" },
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on("exit", (code, signal) => {
  console.error(`Local Next process exited at ${new Date().toISOString()}: exitCode=${code}, signal=${signal}, requested=${stopping}`);
  process.exitCode = code ?? 1;
});
child.on("error", () => { process.exitCode = 1; });
