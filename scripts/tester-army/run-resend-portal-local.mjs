import { spawn } from "node:child_process";
import path from "node:path";

// One autonomous profile owns fixtures, stack, collector, build, evidence and cleanup.
// No account, fixed port or long-running developer stack is needed by this alias.
const mode = process.argv[2];
const selection = process.argv[3] ?? "all";
const selectors = { all: null, RSA: "^RSA\\s", RSR: "^RSR\\s", "RS[AR]": "^RS[AR]\\s",
  incidents: "^(?:EI[RUT]|RS[XC])\\s" };
if (!["--list", "--execute"].includes(mode) || !Object.hasOwn(selectors, selection) || process.argv.length > 4) {
  throw new Error("Use --list|--execute [all|RSA|RSR|RS[AR]|incidents].");
}
const args = ["--import", "tsx", path.resolve("scripts/run-tester-army-ci.ts"), "calc-v3", "--phase", "resend-portal",
  ...(selectors[selection] ? ["--grep", selectors[selection]] : [])];
if (mode === "--list") {
  // This is a declaration, not SDK collection or execution evidence.
  console.log(JSON.stringify({ phase: "resend-portal", selection, status: "declared-not-executed",
    cases: ["RSA", "RSR", "EIR", "EIT", "EIU", "RSX", "RSC"].filter((id) => !selectors[selection] || new RegExp(selectors[selection]).test(`${id} `)),
    command: [process.execPath, ...args] }, null, 2));
} else {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  const interrupt = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT"); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(signal ? 130 : code ?? 1));
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
