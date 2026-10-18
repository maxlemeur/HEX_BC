// Shared launcher for every production `next build`: npm run build (local,
// Vercel, verify:production / Quality Gate). It runs `next build <args>` with
// the current Node, without a shell, from the repository root, so the command
// is the same on Windows, macOS, Linux, CI and Vercel. Its environment comes
// from withNextBuildHeap(): NODE_OPTIONS is the only channel that gives Next's
// TypeScript CLI child (tsc) a heap limit; next-build-env.mjs explains why.
//
// The build starts as soon as this file runs. Other scripts import the helpers
// from next-build-env.mjs, never this file.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isLocalProductionBuild, NEXT_BUILD_HEAP_MB, oldSpaceLimitMib, withNextBuildHeap } from "./next-build-env.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relayedSignals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];
const args = process.argv.slice(2);
const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");

const callerLimit = oldSpaceLimitMib(process.env.NODE_OPTIONS);
const environment = withNextBuildHeap(process.env);
if (callerLimit !== undefined && !(callerLimit >= NEXT_BUILD_HEAP_MB)) {
  console.warn(`[next-build] raised NODE_OPTIONS heap from ${Math.floor(callerLimit)} to ${NEXT_BUILD_HEAP_MB} MiB`);
}
const limit = environment.NODE_OPTIONS.split(" ").filter((word) => /^"?--max[-_]old[-_]space[-_]size/u.test(word));
console.log(`[next-build] next build ${args.join(" ")} with NODE_OPTIONS ${limit.join(" ")}`.replace(/\s+/gu, " "));

// A local build takes one of the user's native places (CI, Vercel and --help
// never do; docs/testing/local-native-stack-tooling.md). Only a full house
// stops it; a guard that cannot load lets the build run.
let place;
if (isLocalProductionBuild(process.env, args)) {
  try {
    const { acquireBuildPlace } = await import("../src/test/native-stack-guard.ts");
    place = await acquireBuildPlace(process.env, args);
  } catch (error) {
    if (error?.name === "NativeStackLimitError") {
      console.error(`[next-build] ${error.message}`);
      // A wait cancelled by Ctrl+C or SIGTERM ends by that signal, like a build would.
      // The exit right after keeps the build from starting if delivery lags.
      if (error.signal && process.platform !== "win32") process.kill(process.pid, error.signal);
      process.exit(error.signal ? 128 + (os.constants.signals[error.signal] ?? 0) : 1);
    }
    console.warn(`[next-build] native place not reserved (${error?.message ?? error}); building anyway`);
  }
}

const child = spawn(process.execPath, [nextCli, "build", ...args], {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit",
});
// A terminal already delivers Ctrl+C to the child (POSIX process group,
// shared Windows console). Relaying matters for a signal sent to this process
// alone, such as a CI timeout; Windows has no such signal and child.kill()
// there would terminate the build abruptly, so the launcher only waits.
const relay = (signal) => {
  if (process.platform !== "win32") child.kill(signal);
};
const release = () => {
  for (const signal of relayedSignals) process.off(signal, relay);
  place?.release();
};
for (const signal of relayedSignals) process.on(signal, relay);
child.on("error", (error) => {
  release();
  console.error(`[next-build] cannot start next build: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  release();
  if (signal === null) {
    process.exitCode = code ?? 1;
    return;
  }
  // Same status as a shell would report; a relayed signal is re-raised so
  // the caller sees this launcher end the way the build did.
  process.exitCode = 128 + (os.constants.signals[signal] ?? 0);
  if (process.platform !== "win32" && relayedSignals.includes(signal)) process.kill(process.pid, signal);
});
