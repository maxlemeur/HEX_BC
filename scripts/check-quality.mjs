#!/usr/bin/env node
// Local quality gate: `npm run check:quality`, so `npm run verify:pr` and the
// first half of `npm run check:release`.
//
// The checks run in three parallel lanes, in order inside a lane. Every check
// always runs, whatever the others return: one pass shows every problem. The
// gate exits with the code of the first red check, in lane order.
//
// A green check prints one line; a red one prints its whole output. Pass
// --verbose to print every output.
//
// The lanes balance wall-clock time on a few cores: the Node Vitest project is
// the longest check and runs alone, typecheck follows the short static checks,
// lint shares its lane with the short suites.
//
// Guarded by src/test/ci-guardrails.test.ts: every check exactly once, a red
// check never hidden by, nor hiding, another one.
import { spawn } from "node:child_process";

const LANES = [
  {
    name: "static",
    commands: [
      "audit:dependencies", "audit:signatures", "check:repository-hygiene", "check:database-types",
      "check:architecture", "validate-openapi", "typecheck",
    ],
  },
  { name: "lint", commands: ["lint", "check:army-recipes", "test:ci:jsdom", "test:critical-coverage"] },
  { name: "node", commands: ["test:ci:node"] },
];

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((arg) => arg !== "--verbose");
if (unknown.length) {
  console.error(`check:quality : argument inconnu ${unknown.join(" ")} (--verbose).`);
  process.exit(2);
}
const verbose = args.has("--verbose");

const running = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of running) child.kill(signal);
    process.exit(130);
  });
}

/** Runs one npm script and resolves with its exit code, merged output and duration. */
function run(command) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const chunks = [];
    const child = spawn("npm", ["run", command], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    running.add(child);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const done = (code, extra = "") => {
      running.delete(child);
      resolve({ command, code, output: `${Buffer.concat(chunks).toString("utf8")}${extra}`, seconds: (Date.now() - startedAt) / 1000 });
    };
    child.on("error", (error) => done(1, `${error.message}\n`));
    child.on("close", (code, signal) => done(code ?? 1, signal ? `Interrompu par ${signal}.\n` : ""));
  });
}

async function runLane(lane) {
  const results = [];
  for (const command of lane.commands) {
    const result = await run(command);
    results.push(result);
    const status = result.code === 0 ? "ok" : `échec (code ${result.code})`;
    // Vitest's own count, kept on the line of a green suite: the figure a report quotes.
    const tests = /^\s*Tests\s+(.+)$/mu.exec(result.output)?.[1].trim();
    console.log(`check:quality [${lane.name}] ${command} : ${status}, ${result.seconds.toFixed(1)} s${tests ? `, tests ${tests}` : ""}`);
    if (result.code !== 0 || verbose) process.stdout.write(result.output.endsWith("\n") || !result.output ? result.output : `${result.output}\n`);
  }
  return results;
}

const startedAt = Date.now();
const results = (await Promise.all(LANES.map(runLane))).flat();
const red = results.filter((result) => result.code !== 0);
const total = LANES.reduce((count, lane) => count + lane.commands.length, 0);
const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
if (red.length === 0) {
  console.log(`check:quality : ${total} contrôles au vert en ${seconds} s.`);
} else {
  for (const result of red) console.log(`check:quality : échec : ${result.command} (code ${result.code})`);
  console.log(`check:quality : ${red.length} échec(s) sur ${total} contrôles, ${seconds} s.`);
  process.exitCode = red[0].code;
}
