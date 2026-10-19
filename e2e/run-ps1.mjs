#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

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

function parseEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  return parsed;
}

function loadDefaultEnvFiles() {
  const files = [".env", ".env.local"];

  for (const relPath of files) {
    const absolutePath = path.resolve(process.cwd(), relPath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const values = parseEnvFile(absolutePath);
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadDefaultEnvFiles();

const shellCandidates =
  process.platform === "win32"
    ? ["pwsh.exe", "powershell.exe", "pwsh", "powershell"]
    : ["pwsh", "powershell"];

// Some retained journeys return after printing "PASS (skipped ...)" when a
// required fixture or transport fails. Their zero exit is incomplete evidence,
// even if run-all.ps1 subsequently prints its own PASS. Keep output streaming,
// and inspect both streams across chunk boundaries without retaining the log.
function runPowerShell(shellName, shellArgs) {
  return new Promise((resolve) => {
    const child = spawn(shellName, shellArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });
    let incomplete = false;
    let cancelled = false;
    const interrupt = () => { cancelled = true; child.kill("SIGINT"); };
    const terminate = () => { cancelled = true; child.kill("SIGTERM"); };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const removeHandlers = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    const forward = (destination) => {
      let tail = "";
      return (chunk) => {
        destination.write(chunk);
        const text = tail + chunk.toString("utf8");
        if (/\bPASS\s*\(\s*skipped\b/iu.test(stripVTControlCharacters(text))) incomplete = true;
        tail = text.slice(-128);
      };
    };
    child.stdout.on("data", forward(process.stdout));
    child.stderr.on("data", forward(process.stderr));
    child.once("error", (error) => { removeHandlers(); resolve({ error }); });
    child.once("close", (status) => { removeHandlers(); resolve({ status, incomplete, cancelled }); });
  });
}

let runtimeError = null;
let executed = false;

for (const shellName of shellCandidates) {
  const shellArgs = ["-NoProfile"];
  if (process.platform === "win32") {
    shellArgs.push("-ExecutionPolicy", "Bypass");
  }
  shellArgs.push("-File", scriptPath, ...scriptArgs);

  const run = await runPowerShell(shellName, shellArgs);

  if (run.error) {
    if (run.error.code === "ENOENT") {
      continue;
    }

    runtimeError = run.error;
    break;
  }

  if (run.cancelled) {
    process.exitCode = 130;
  } else if (run.incomplete && run.status === 0) {
    console.error("Legacy E2E run is incomplete: a journey reported PASS (skipped ...); required coverage was not executed.");
    process.exitCode = 1;
  } else {
    process.exitCode = run.status ?? 1;
  }
  executed = true;
  break;
}

if (!executed && runtimeError) {
  console.error(`Failed to run PowerShell script "${scriptPathArg}": ${runtimeError.message}`);
  process.exitCode = 1;
} else if (!executed) {
  console.error("No PowerShell runtime found in PATH. Install PowerShell 7 (`pwsh`) to run E2E scripts.");
  process.exitCode = 1;
}
