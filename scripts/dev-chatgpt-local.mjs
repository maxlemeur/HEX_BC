import { spawn } from "node:child_process";

// The explicit local entrypoint binds the listener to loopback. A deployed build
// cannot activate this personal integration via an environment variable alone.
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", ...process.argv.slice(2)], {
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
