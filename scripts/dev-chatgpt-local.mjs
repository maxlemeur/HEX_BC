import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";

const fastWindowMs = 15_000;
const fastCompileThreshold = 12;
const fastRenderThreshold = 8;
const slowWindowMs = 165_000;
const slowRenderThreshold = 6;
const compileToRenderMs = 45_000;
const cacheStampName = ".mergeone-chatgpt-state.json";

function cacheStampMatches(path, expected) {
  try {
    return lstatSync(path).isFile() && readFileSync(path, "utf8") === expected;
  } catch {
    return false;
  }
}

async function prepareTurbopackCache() {
  const commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { encoding: "utf8" }).trim();
  const lockfile = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
  const expected = `${JSON.stringify({ version: 1, commit, lockfile })}\n`;
  const devDir = join(".next", "dev");
  const cacheParent = join(devDir, "cache");
  const cacheDir = join(cacheParent, "turbopack");
  const stampPath = join(cacheDir, cacheStampName);
  for (const path of [".next", devDir, cacheParent, cacheDir]) {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry && !entry.isDirectory()) throw new Error(`Expected a local cache directory at ${path}.`);
  }
  if (cacheStampMatches(stampPath, expected)) return;

  // Take the same lock as Next before removing anything a live server may be using.
  mkdirSync(devDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const { loadBindings } = require("next/dist/build/swc/index.js");
  if ((await loadBindings()).isWasm) return;
  const { Lockfile } = require("next/dist/build/lockfile.js");
  const lock = Lockfile.tryAcquire(join(devDir, "lock"), false);
  if (!lock) throw new Error("Next is already running in this checkout.");
  try {
    if (cacheStampMatches(stampPath, expected)) return;
    if (lstatSync(cacheDir, { throwIfNoEntry: false })) {
      const hasCachedData = readdirSync(cacheDir).some((entry) => entry !== cacheStampName);
      rmSync(cacheDir, { recursive: true, force: true });
      if (hasCachedData) {
        console.log("Discarding the Turbopack dev cache because its checkout or lockfile changed, or its state could not be verified.");
      }
    }
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(stampPath, expected);
  } finally {
    lock.unlockSync();
  }
}

function renderedPage(text) {
  // Next reports application-code timing for renders and some route handlers.
  // Its output does not distinguish a page's RSC refresh from a full document.
  const pathname = /^GET (\/[^?\s]*)(?:\?\S*)? \d{3} in \d.*\bapplication-code:/.exec(text)?.[1];
  if (!pathname || /^\/(?:api|_next|assets)(?:\/|$)/.test(pathname)) return;
  if (extname(pathname.replace(/\/$/, ""))) return;
  return pathname;
}

export function createReloadLoopMonitor() {
  const fastActivity = [];
  const fastCounts = new Map();
  const slowActivity = new Map();
  let lastCompileAt = -Infinity;
  let nextCleanupAt = 0;

  return (line, time = performance.now()) => {
    const text = stripVTControlCharacters(line).trimStart();
    const compiled = /^✓?\s*Compiled in \d/.test(text);
    const pathname = renderedPage(text);
    if (!compiled && !pathname) return;

    fastActivity.push({ time, pathname });
    fastCounts.set(pathname, (fastCounts.get(pathname) ?? 0) + 1);
    while (fastActivity[0].time < time - fastWindowMs) {
      const { pathname: expired } = fastActivity.shift();
      const count = fastCounts.get(expired) - 1;
      if (count > 0) fastCounts.set(expired, count);
      else fastCounts.delete(expired);
    }
    if ((fastCounts.get(undefined) ?? 0) >= fastCompileThreshold) {
      for (const [path, count] of fastCounts) {
        if (path !== undefined && count >= fastRenderThreshold) {
          return { pathname: path, count, windowMs: fastWindowMs };
        }
      }
    }

    if (compiled) {
      lastCompileAt = time;
      return;
    }

    if (time >= nextCleanupAt) {
      for (const [path, activity] of slowActivity) {
        if (activity.lastRenderAt < time - slowWindowMs) slowActivity.delete(path);
      }
      nextCleanupAt = time + slowWindowMs;
    }

    const activity = slowActivity.get(pathname) ?? { lastRenderAt: -Infinity, pairedRenders: [] };
    const paired = lastCompileAt > activity.lastRenderAt && time - lastCompileAt <= compileToRenderMs;
    activity.lastRenderAt = time;
    slowActivity.set(pathname, activity);
    if (!paired) return;

    // Each counted render needs a fresh compile, even when other requests to
    // this page complete between reloads.
    const renders = activity.pairedRenders;
    renders.push(time);
    while (renders[0] < time - slowWindowMs) renders.shift();
    if (renders.length >= slowRenderThreshold && time - renders[0] >= fastWindowMs) {
      return { pathname, count: renders.length, windowMs: slowWindowMs };
    }
  };
}

async function startDevServer() {
  // Bind to loopback unless the caller passes --hostname or -H. That opt-out is
  // explicit. A production build never enables the personal integration.
  const forwarded = process.argv.slice(2);
  const usesDefaultDevCache = process.env.E2E_ARMY !== "1" &&
    !forwarded.some((arg) => ["--webpack", "--help", "-h", "--version", "-v"].includes(arg));
  if (usesDefaultDevCache && lstatSync("package-lock.json", { throwIfNoEntry: false })?.isFile()) {
    try {
      await prepareTurbopackCache();
    } catch (error) {
      console.error(`Could not prepare the Turbopack dev cache. ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }
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
  const observeLine = createReloadLoopMonitor();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (stopReason) return;
    const loop = observeLine(line);
    if (!loop) return;
    const page = loop.pathname.replace(/^\/portal\/[^/]+/, "/portal/[token]");
    console.error(`Possible reload loop. Next rendered ${page} ${loop.count} times in the last ${loop.windowMs / 1000} seconds. Stopping Next to prevent repeated database requests.`);
    stop("SIGTERM", "reload-loop");
  });

  child.on("close", (code, signal) => {
    console.error(`Local Next process exited at ${new Date().toISOString()}: exitCode=${code}, signal=${signal}, requested=${stopReason === "signal"}`);
    process.exitCode = stopReason === "reload-loop" ? 1 : code ?? 1;
  });
  child.on("error", () => { process.exitCode = 1; });
}

if (import.meta.main) await startDevServer();
