import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createReloadLoopMonitor } from "../../scripts/dev-chatgpt-local.mjs";

const launch = promisify(execFile);
const launcher = fileURLToPath(new URL("../../scripts/dev-chatgpt-local.mjs", import.meta.url));

const localEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon",
  SUPABASE_SERVICE_ROLE_KEY: "",
  E2E_ARMY: "",
};

const hostedSettings = [
  "NEXT_PUBLIC_SUPABASE_URL=https://project-fixture.supabase.co",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-public-production",
  "SUPABASE_SERVICE_ROLE_KEY=fixture-service-production",
].join("\n");
const productionConfigFile = ".env.supabase.production.local";

async function launchWithNextOutput(output: string, waitForSignal: boolean, args: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), "mergeone-dev-chatgpt-"));
  try {
    const nextDir = join(cwd, "node_modules/next/dist/bin");
    await mkdir(nextDir, { recursive: true });
    await writeFile(join(cwd, ".env.local"), hostedSettings);
    await writeFile(join(cwd, productionConfigFile), hostedSettings);
    await writeFile(join(nextDir, "next"), `
      process.on("SIGTERM", () => {
        console.log("Next received SIGTERM");
        process.exitCode = 0;
        clearInterval(keepAlive);
      });
      const keepAlive = ${waitForSignal} ? setInterval(() => {}, 5000) : undefined;
      const output = ${JSON.stringify(output)};
      const boundary = output.indexOf("Compiled") + 4;
      process.stdout.write(output.slice(0, boundary));
      setTimeout(() => process.stdout.write(output.slice(boundary)), 30);
    `);
    try {
      const result = await launch(process.execPath, [launcher, ...args], { cwd, env: localEnv, timeout: 3000 });
      return { ...result, code: 0 };
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number | null };
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const compile = "✓ \u001b[32mCompiled in 36ms\u001b[39m\n";
const request = (path: string) => ` GET ${path} 200 in 105ms (application-code: 100ms)\n`;

describe("dev:chatgpt reload-loop guard", () => {
  it("stops Next with a nonzero status and explains a burst of compiles and repeated page requests", async () => {
    const output = compile.repeat(12) + Array.from({ length: 8 }, (_, i) => request(`/fictional-page?tab=${i}`)).join("");
    const result = await launchWithNextOutput(output, true);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Next received SIGTERM");
    expect(result.stderr).toContain("Possible reload loop");
    expect(result.stderr).toContain("Stopping Next");
    expect(result.stderr).toContain("/fictional-page");
    expect(result.stderr).toContain("8 times");
    expect(result.stderr).not.toContain("?tab=");
  });

  it.each([
    "/api/affaires/analysis-progress",
    "/_next/static/chunks/example.js",
    "/assets/static-example",
    "/templates/example.xlsx",
  ])("allows repeated GETs to %s during an HMR compile burst", async (pathname) => {
    const result = await launchWithNextOutput((compile + request(pathname)).repeat(12), false);

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("reload loop");
  });

  it("reports the portal page without printing its access token", async () => {
    const result = await launchWithNextOutput(compile.repeat(12) + request("/portal/fictional-token").repeat(8), true);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("/portal/[token] 8 times");
    expect(result.stderr).not.toContain("fictional-token");
  });

  it("allows ordinary recompiles and repeated page requests by themselves", async () => {
    const traffic = request("/fictional-page").repeat(12);
    const compilesAcrossPages = Array.from({ length: 12 }, (_, i) => compile + request(`/page-${i}`)).join("");
    const result = await launchWithNextOutput(traffic, false);
    const recompiles = await launchWithNextOutput(compilesAcrossPages, false);

    expect(result.code).toBe(0);
    expect(recompiles.code).toBe(0);
    expect(result.stdout).toContain(traffic);
    expect(recompiles.stdout).toContain(compilesAcrossPages);
    expect(result.stderr + recompiles.stderr).not.toContain("reload loop");
  });

  it("catches a render every 1.25 seconds in the original fast window", () => {
    const observe = createReloadLoopMonitor();
    for (let i = 0; i < 11; i++) {
      expect(observe(compile, i * 1_250)).toBeUndefined();
      expect(observe(request("/dashboard"), i * 1_250 + 10)).toBeUndefined();
    }
    expect(observe(compile, 13_750)).toEqual({ pathname: "/dashboard", count: 11, windowMs: 15_000 });
  });

  it("stops a hosted page flood even without compile lines", () => {
    const observe = createReloadLoopMonitor({ hosted: true });
    for (let i = 0; i < 19; i++) {
      expect(observe(request("/dashboard/affaires"), i * 160)).toBeUndefined();
    }
    expect(observe(request("/dashboard/affaires"), 19 * 160)).toEqual({
      pathname: "/dashboard/affaires", count: 20, windowMs: 15_000,
    });
  });

  it.each(["production", "production-full"])("stops the %s launcher after twenty hosted renders without a compile", async (target) => {
    const result = await launchWithNextOutput(request("/dashboard/affaires").repeat(20), true, [`--supabase=${target}`]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Next received SIGTERM");
    expect(result.stderr).toContain("Possible reload loop. Next rendered /dashboard/affaires 20 times");
  });

  it("catches six paired renders thirty seconds apart, even with slow responses", () => {
    const observe = createReloadLoopMonitor();
    for (let i = 0; i < 5; i++) {
      expect(observe(compile, i * 30_000)).toBeUndefined();
      expect(observe(request("/dashboard"), i * 30_000 + 29_000)).toBeUndefined();
      expect(observe(request("/dashboard"), i * 30_000 + 29_500)).toBeUndefined();
    }
    expect(observe(compile, 150_000)).toBeUndefined();
    expect(observe(request("/dashboard"), 179_000)).toEqual({
      pathname: "/dashboard", count: 6, windowMs: 165_000,
    });
  });

  it("requires a sustained series with fresh compiles for the slow window", () => {
    const tooBrief = createReloadLoopMonitor();
    const tooSparse = createReloadLoopMonitor();
    const missingCompile = createReloadLoopMonitor();
    for (let i = 0; i < 6; i++) {
      tooBrief(compile, i * 1_000);
      tooSparse(compile, i * 35_000);
      if (i !== 3) missingCompile(compile, i * 30_000);
      expect(tooBrief(request("/dashboard"), i * 1_000 + 10)).toBeUndefined();
      expect(tooSparse(request("/dashboard"), i * 35_000 + 10)).toBeUndefined();
      expect(missingCompile(request("/dashboard"), i * 30_000 + 10)).toBeUndefined();
    }
  });
});

const cacheRelativePath = ".next/dev/cache/turbopack";
const stampName = ".mergeone-chatgpt-state.json";

function cacheNotices(stderr: string) {
  return stderr.trim().split("\n").filter((line) => !line.startsWith("Local Next process exited at "));
}

async function withCacheFixture(run: (fixture: {
  cwd: string;
  cacheDir: string;
  start: (preload?: string, args?: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
  commit: () => Promise<unknown>;
}) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "mergeone-dev-cache-"));
  const git = (args: string[]) => launch("git", args, { cwd });
  const commit = () => git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
    "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "Fixture commit"]);
  const cacheDir = join(cwd, cacheRelativePath);
  try {
    await git(["init", "-q"]);
    await commit();
    await writeFile(join(cwd, "package-lock.json"), "{}\n");
    const nextDir = join(cwd, "node_modules/next/dist/bin");
    await mkdir(nextDir, { recursive: true });
    await writeFile(join(nextDir, "next"), `
      const fs = require("node:fs");
      const cache = ${JSON.stringify(cacheRelativePath)};
      const entry = cache + "/fixture-entry";
      console.log(fs.existsSync(entry) ? "warm cache" : "cold cache");
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(entry, "fixture cache");
    `);
    const start = (preload?: string, args: string[] = [], env = localEnv) => launch(process.execPath, [
      ...(preload ? ["--require", preload] : []), launcher, ...args,
    ], { cwd, env, timeout: 3500 });
    await run({ cwd, cacheDir, start, commit });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("dev:chatgpt Turbopack cache reuse", () => {
  it("records the state on first start without announcing a discard", async () => {
    await withCacheFixture(async ({ cacheDir, start }) => {
      const first = await start();
      expect(first.stdout).toContain("cold cache");
      expect(first.stderr + first.stdout).not.toContain("Discarding");
      await expect(readFile(join(cacheDir, stampName), "utf8")).resolves.toBeTruthy();
    });
  });

  it("keeps a matching cache on restart and after an ordinary source edit", async () => {
    await withCacheFixture(async ({ cwd, start }) => {
      await start();
      expect((await start()).stdout).toContain("warm cache");
      await writeFile(join(cwd, "example.ts"), "export const value = 2;\n");
      expect((await start()).stdout).toContain("warm cache");
    });
  });

  it("discards only the dev Turbopack cache when Git HEAD changes", async () => {
    await withCacheFixture(async ({ cwd, start, commit }) => {
      await start();
      const outside = [".next/dev/static", ".next/cache/turbopack"];
      for (const path of outside) {
        await mkdir(join(cwd, path), { recursive: true });
        await writeFile(join(cwd, path, "keep"), "untouched");
      }
      await commit();
      const after = await start();
      expect(after.stdout).toContain("cold cache");
      expect(after.stderr + after.stdout).toContain("Discarding");
      for (const path of outside) {
        await expect(readFile(join(cwd, path, "keep"), "utf8")).resolves.toBe("untouched");
      }
      expect((await start()).stdout).toContain("warm cache");
    });
  });

  it("does not reuse a Turbopack cache across Supabase targets", async () => {
    await withCacheFixture(async ({ cacheDir, start }) => {
      await start();
      const hosted = {
        ...localEnv,
        NEXT_PUBLIC_SUPABASE_URL: "https://project-fixture.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-public-production",
      };
      const args = ["--supabase=production"];
      expect((await start(undefined, args, hosted)).stdout).toContain("cold cache");
      expect((await readFile(join(cacheDir, stampName), "utf8"))).not.toContain(hosted.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      expect((await start(undefined, args, hosted)).stdout).toContain("warm cache");
      expect((await start()).stdout).toContain("cold cache");
    });
  });

  it("keeps a separate Turbopack cache stamp for each of the three targets", async () => {
    await withCacheFixture(async ({ cwd, cacheDir, start }) => {
      await writeFile(join(cwd, ".env.local"), hostedSettings);
      await writeFile(join(cwd, productionConfigFile), hostedSettings);
      const stamps = new Set();
      for (const args of [[], ["--supabase=production"], ["--supabase=production-full"]]) {
        expect((await start(undefined, args)).stdout).toContain("cold cache");
        const stamp = await readFile(join(cacheDir, stampName), "utf8");
        expect(stamp).not.toContain("fixture-service-production");
        stamps.add(stamp);
        expect((await start(undefined, args)).stdout).toContain("warm cache");
      }
      expect(stamps.size).toBe(3);
      expect((await start()).stdout).toContain("cold cache");
    });
  });

  it("discards the cache when only the lockfile changes", async () => {
    await withCacheFixture(async ({ cwd, start }) => {
      await start();
      await writeFile(join(cwd, "package-lock.json"), '{"lockfileVersion":3}\n');
      expect((await start()).stdout).toContain("cold cache");
    });
  });

  it.each(["missing", "unreadable"])("discards an existing cache with a %s stamp", async (stamp) => {
    await withCacheFixture(async ({ cacheDir, start }) => {
      await start();
      const path = join(cacheDir, stampName);
      if (stamp === "missing") await rm(path, { force: true });
      else await writeFile(path, "truncated");
      expect((await start()).stdout).toContain("cold cache");
    });
  });

  it("blocks startup when another process holds Next's development lock", async () => {
    await withCacheFixture(async ({ cwd, cacheDir, start, commit }) => {
      await start();
      await commit();
      const require = createRequire(import.meta.url);
      const { loadBindings } = require("next/dist/build/swc/index.js");
      const { Lockfile } = require("next/dist/build/lockfile.js");
      await loadBindings();
      const lock = Lockfile.tryAcquire(join(cwd, ".next/dev/lock"), false);
      expect(lock).toBeDefined();
      try {
        await expect(start()).rejects.toMatchObject({
          code: 1,
          stdout: "",
          stderr: expect.stringContaining("Next is already running in this checkout."),
        });
        await expect(readFile(join(cacheDir, "fixture-entry"), "utf8")).resolves.toBe("fixture cache");
      } finally {
        lock?.unlockSync();
      }
    });
  });

  it("starts with the existing cache when Git cannot identify the checkout", async () => {
    await withCacheFixture(async ({ cwd, start }) => {
      await start();
      await rm(join(cwd, ".git"), { recursive: true });
      const result = await start();
      expect(result.stdout).toContain("warm cache");
      expect(cacheNotices(result.stderr)).toEqual(["Could not prepare the Turbopack dev cache. Git could not identify this checkout. Starting Next."]);
    });
  });

  it.each(["swc/index.js", "lockfile.js"])("starts without discarding when Next's %s is unavailable", async (file) => {
    await withCacheFixture(async ({ cwd, start, commit }) => {
      await start();
      await commit();
      const preload = join(cwd, "missing-next-internal.cjs");
      await writeFile(preload, `
        require("node:module").registerHooks({
          resolve(specifier, context, nextResolve) {
            if (specifier === ${JSON.stringify("next/dist/build/" + file)}) {
              throw new Error("Fixture missing Next internal");
            }
            return nextResolve(specifier, context);
          }
        });
      `);
      const result = await start(preload);
      expect(result.stdout).toContain("warm cache");
      expect(cacheNotices(result.stderr)).toEqual(["Could not prepare the Turbopack dev cache. Next's development lock is unavailable. Starting Next."]);
    });
  });

  it.each([
    ["reading the lockfile", "readFileSync", "String(path) === 'package-lock.json'"],
    ["writing the stamp", "writeFileSync", "String(path).endsWith(" + JSON.stringify(stampName) + ")"],
    ["installing the replacement", "renameSync", "String(args[0]) === " + JSON.stringify(cacheRelativePath)],
  ])("starts with the old cache intact when %s fails", async (_, method, matches) => {
    await withCacheFixture(async ({ cwd, cacheDir, start, commit }) => {
      await start();
      await commit();
      const stamp = join(cacheDir, stampName);
      const previousStamp = await readFile(stamp, "utf8");
      const preload = join(cwd, "cache-io-error.cjs");
      await writeFile(preload, `
        const fs = require("node:fs");
        const original = fs.${method};
        let injected = false;
        fs.${method} = (path, ...args) => {
          if (!injected && (${matches})) {
            injected = true;
            throw new Error("Fixture cache I/O failure");
          }
          return original(path, ...args);
        };
        require("node:module").syncBuiltinESMExports();
      `);
      const result = await start(preload);
      expect(result.stdout).toContain("warm cache");
      expect(cacheNotices(result.stderr)).toEqual(["Could not prepare the Turbopack dev cache. Fixture cache I/O failure. Starting Next."]);
      await expect(readFile(stamp, "utf8")).resolves.toBe(previousStamp);
    });
  });
});
