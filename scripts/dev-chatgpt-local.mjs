import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";
import { parseDevArguments, supabaseDevEnvironment } from "./dev-supabase-env.mjs";

const fastWindowMs = 15_000;
const fastCompileThreshold = 12;
const fastRenderThreshold = 8;
const hostedRenderThreshold = 20;
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

function replaceTurbopackCache(cacheParent, cacheDir, expected) {
  const hasCache = Boolean(lstatSync(cacheDir, { throwIfNoEntry: false }));
  const hasCachedData = hasCache && readdirSync(cacheDir).some((entry) => entry !== cacheStampName);
  mkdirSync(cacheParent, { recursive: true });
  const staging = mkdtempSync(join(cacheParent, ".mergeone-cache-"));
  const replacement = join(staging, "replacement");
  const previousCache = join(staging, "previous");
  let preservePrevious = false;
  try {
    // Prepare the stamp before moving the old cache out of the way.
    mkdirSync(replacement);
    writeFileSync(join(replacement, cacheStampName), expected);
    if (hasCache) renameSync(cacheDir, previousCache);
    try {
      renameSync(replacement, cacheDir);
    } catch (error) {
      if (hasCache) {
        try {
          renameSync(previousCache, cacheDir);
        } catch (restoreError) {
          preservePrevious = true;
          throw new Error(`The previous cache could not be restored and is saved at ${previousCache}.`, { cause: restoreError });
        }
      }
      throw error;
    }
  } finally {
    if (!preservePrevious) rmSync(staging, { recursive: true, force: true });
  }
  if (hasCachedData) {
    console.log("Discarding the Turbopack dev cache because its checkout, lockfile or Supabase target changed, or its state could not be verified.");
  }
}

async function prepareTurbopackCache(target) {
  let commit;
  try {
    commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    throw new Error("Git could not identify this checkout.", { cause: error });
  }
  const lockfile = createHash("sha256").update(readFileSync("package-lock.json")).digest("hex");
  const expected = `${JSON.stringify({ version: 2, commit, lockfile, target })}\n`;
  const devDir = join(".next", "dev");
  const cacheParent = join(devDir, "cache");
  const cacheDir = join(cacheParent, "turbopack");
  const stampPath = join(cacheDir, cacheStampName);
  for (const path of [".next", devDir, cacheParent, cacheDir]) {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry && !entry.isDirectory()) throw new Error(`Expected a local cache directory at ${path}.`);
  }
  if (cacheStampMatches(stampPath, expected)) return true;

  // Take the same lock as Next before removing anything a live server may be using.
  const require = createRequire(import.meta.url);
  let Lockfile;
  try {
    const { loadBindings } = require("next/dist/build/swc/index.js");
    ({ Lockfile } = require("next/dist/build/lockfile.js"));
    if ((await loadBindings()).isWasm || typeof Lockfile?.tryAcquire !== "function") {
      throw new Error("Next does not provide a native lock.");
    }
  } catch (error) {
    throw new Error("Next's development lock is unavailable.", { cause: error });
  }
  mkdirSync(devDir, { recursive: true });
  const lock = Lockfile.tryAcquire(join(devDir, "lock"), false);
  if (lock === undefined) return false;
  if (typeof lock?.unlockSync !== "function") throw new Error("Next's development lock is unavailable.");
  try {
    if (!cacheStampMatches(stampPath, expected)) {
      replaceTurbopackCache(cacheParent, cacheDir, expected);
    }
  } finally {
    lock.unlockSync();
  }
  return true;
}

function renderedPage(text) {
  // Next reports application-code timing for renders and some route handlers.
  // Its output does not distinguish a page's RSC refresh from a full document.
  const pathname = /^GET (\/[^?\s]*)(?:\?\S*)? \d{3} in \d.*\bapplication-code:/.exec(text)?.[1];
  if (!pathname || /^\/(?:api|_next|assets)(?:\/|$)/.test(pathname)) return;
  if (extname(pathname.replace(/\/$/, ""))) return;
  return pathname;
}

export function createReloadLoopMonitor({ hosted = false } = {}) {
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
    if (hosted && pathname && fastCounts.get(pathname) >= hostedRenderThreshold) {
      return { pathname, count: fastCounts.get(pathname), windowMs: fastWindowMs };
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

export async function startDevServer({ chatgpt = false } = {}) {
  let forwarded, mode, hostnames, backend, informational;
  try {
    ({ forwarded, mode, hostnames } = parseDevArguments(process.argv.slice(2)));
    informational = forwarded.length === 1 && ["--help", "-h", "--version", "-v"].includes(forwarded[0]);
    if (!informational) backend = supabaseDevEnvironment(mode, hostnames, process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const usesDefaultDevCache = !informational && process.env.E2E_ARMY !== "1" && !forwarded.includes("--webpack");
  if (usesDefaultDevCache) {
    try {
      const lockfile = lstatSync("package-lock.json", { throwIfNoEntry: false });
      if (lockfile && !lockfile.isFile()) throw new Error("Could not read package-lock.json.");
      const target = createHash("sha256").update(JSON.stringify([
        mode, backend.NEXT_PUBLIC_SUPABASE_URL, backend.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ])).digest("hex");
      if (lockfile && !(await prepareTurbopackCache(target))) {
        console.error("Could not prepare the Turbopack dev cache. Next is already running in this checkout.");
        process.exitCode = 1;
        return;
      }
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).split(/\r?\n/, 1)[0].replace(/\.+$/, "");
      console.warn(`Could not prepare the Turbopack dev cache. ${reason}. Starting Next.`);
    }
  }
  if (!informational) console.log(`Supabase target: ${mode}`);
  if (mode === "production-full" && !informational) console.log("This server holds production's service rights.");
  const child = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev",
    ...(hostnames.length ? [] : ["--hostname", "127.0.0.1"]),
    ...forwarded,
  ], {
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, ...(chatgpt ? { MERGEONE_CHATGPT_LOCAL: "1" } : {}), ...backend },
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
  const observeLine = createReloadLoopMonitor({ hosted: mode !== "local" });
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

if (import.meta.main) await startDevServer({ chatgpt: true });
