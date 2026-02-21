#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const [, , scriptPathArg, ...scriptArgs] = process.argv;

if (!scriptPathArg) {
  console.error("Usage: node e2e/run-ps1.mjs <script.ps1> [args...]");
  process.exit(1);
}

const scriptPath = path.resolve(process.cwd(), scriptPathArg);
if (!existsSync(scriptPath)) {
  console.error(`PowerShell script not found: ${scriptPathArg}`);
  process.exit(1);
}

const shellCandidates =
  process.platform === "win32"
    ? ["pwsh.exe", "powershell.exe", "pwsh", "powershell"]
    : ["pwsh", "powershell"];

let runtimeError = null;

for (const shellName of shellCandidates) {
  const shellArgs = ["-NoProfile"];
  if (process.platform === "win32") {
    shellArgs.push("-ExecutionPolicy", "Bypass");
  }
  shellArgs.push("-File", scriptPath, ...scriptArgs);

  const run = spawnSync(shellName, shellArgs, {
    stdio: "inherit",
    env: process.env,
  });

  if (run.error) {
    if (run.error.code === "ENOENT") {
      continue;
    }

    runtimeError = run.error;
    break;
  }

  process.exit(run.status ?? 1);
}

if (runtimeError) {
  console.error(`Failed to run PowerShell script \"${scriptPathArg}\": ${runtimeError.message}`);
  process.exit(1);
}

console.error("No PowerShell runtime found in PATH. Install PowerShell 7 (`pwsh`) to run E2E scripts.");
process.exit(1);
