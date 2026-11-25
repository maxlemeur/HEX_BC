import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createReloadLoopMonitor } from "../../scripts/dev-chatgpt-local.mjs";

const launch = promisify(execFile);
const launcher = fileURLToPath(new URL("../../scripts/dev-chatgpt-local.mjs", import.meta.url));

async function launchWithNextOutput(output: string, waitForSignal: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "mergeone-dev-chatgpt-"));
  try {
    const nextDir = join(cwd, "node_modules/next/dist/bin");
    await mkdir(nextDir, { recursive: true });
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
      const result = await launch(process.execPath, [launcher], { cwd, timeout: 3000 });
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

async function withCacheFixture(run: (fixture: {
  cwd: string;
  cacheDir: string;
  start: () => Promise<{ stdout: string; stderr: string }>;
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
    const start = () => launch(process.execPath, [launcher], { cwd, timeout: 3500 });
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
});
