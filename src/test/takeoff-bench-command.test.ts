import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixtureDataset, type FixtureDataset } from "@/lib/takeoff/bench/bench-dataset.test-utils";

// Ways `npm run takeoff:bench` (TI-660) could run when it must not, or report a
// stop with the wrong exit code, written before the code. Nothing here reaches
// ChatGPT: the last case runs in a directory without ChatGPT store.
// - the bench starts with CI or VERCEL set, even empty;
// - the npm script runs without the react-server condition, so the ChatGPT
//   modules (server-only) cannot load;
// - a missing owner, an --out that is not a directory or already holds a report,
//   or a dataset refusal exits 0 or 2 instead of 1, or writes a report;
// - `@/` resolves to another checkout's code than the script's: the reported
//   commit would not be the code measured;
// - without a ChatGPT account the bench calls nothing, exits 2 and still writes
//   its partial report (status incomplete, calls done and remaining) to --out only.
// Found in review, written before its fix:
// - stopped before the profile is read, the partial report claims every couple
//   is an override, the profile's own couple included.
// Found by the first real run, written before its fix:
// - the recorded command leaves out the working directory and the variables the
//   run needs (owner, TSX_TSCONFIG_PATH), and gives the script relative to its
//   own checkout: run from the canonical checkout, it would bench main's code.

const ROOT = path.resolve(".");
const OWNER = "fixture-user:fixture-tenant";

async function npmScript() {
  const scripts = (JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  const [node, ...args] = scripts["takeoff:bench"].split(" ");
  expect(node).toBe("node");
  return args;
}

function runBench(args: string[], options: { env?: Record<string, string>; cwd?: string } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    void npmScript().then((script) => {
      const cwd = options.cwd ?? ROOT;
      // From another directory, tsx is loaded from this checkout, as the canonical-checkout command does.
      const resolved = cwd === ROOT ? script
        : script.map((arg) => (arg === "tsx" ? pathToFileURL(path.join(ROOT, "node_modules/tsx/dist/loader.mjs")).href
          : arg.startsWith("scripts/") ? path.join(ROOT, arg) : arg));
      const child = spawn(process.execPath, [...resolved, ...args], {
        cwd,
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "test", ...options.env },
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      const watchdog = setTimeout(() => {
        child.kill();
        reject(new Error("takeoff:bench exceeded its deadline."));
      }, 30_000);
      child.on("error", (error) => { clearTimeout(watchdog); reject(error); });
      child.on("close", (code) => { clearTimeout(watchdog); resolve({ code, stdout, stderr }); });
    }, reject);
  });
}

let dataset: FixtureDataset;
let scratch: string;
let out: string;

beforeEach(async () => {
  dataset = await createFixtureDataset();
  scratch = await mkdtemp(path.join(os.tmpdir(), "takeoff-bench-command-"));
  out = await mkdtemp(path.join(os.tmpdir(), "takeoff-bench-run-"));
});

afterEach(async () => {
  await dataset.cleanup();
  await rm(scratch, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

function benchArgs(overrides: { out?: string; docs?: string } = {}) {
  return ["--dataset", dataset.root, "--docs", overrides.docs ?? "a-plan-01", "--models", "fixture-model", "--efforts", "auto",
    "--out", overrides.out ?? out];
}

describe("takeoff:bench command", () => {
  it.each<Record<string, string>>([{ CI: "true" }, { VERCEL: "" }])("refuses to start with %j", { timeout: 30_000 }, async (env) => {
    const result = await runBench(benchArgs(), { env: { ...env, TAKEOFF_BENCH_CHATGPT_OWNER: OWNER } });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/CI or VERCEL/);
    expect(await readdir(out)).toEqual([]);
  });

  it("exits 1 without writing a report on a usage, output or dataset error", { timeout: 60_000 }, async () => {
    const noOwner = await runBench(benchArgs());
    expect([noOwner.code, noOwner.stderr]).toEqual([1, expect.stringMatching(/TAKEOFF_BENCH_CHATGPT_OWNER/)]);
    const env = { TAKEOFF_BENCH_CHATGPT_OWNER: OWNER };
    const notDirectory = await runBench(benchArgs({ out: path.join(out, "missing") }), { env });
    expect([notDirectory.code, notDirectory.stderr]).toEqual([1, expect.stringMatching(/not a directory/)]);
    await rm(path.join(dataset.root, "raw"), { recursive: true });
    const refused = await runBench(benchArgs(), { env });
    expect([refused.code, refused.stderr]).toEqual([1, expect.stringMatching(/raw\/ is missing/)]);
    expect(await readdir(out)).toEqual([]);
    await writeFile(path.join(out, "report.json"), "{}\n");
    const existing = await runBench(benchArgs(), { env });
    expect([existing.code, existing.stderr]).toEqual([1, expect.stringMatching(/already exists/)]);
  });

  it("refuses to run when @/ would resolve to another checkout", { timeout: 30_000 }, async () => {
    const tsconfig = path.join(scratch, "tsconfig.json");
    await writeFile(tsconfig, JSON.stringify({ extends: path.join(ROOT, "tsconfig.json") }));
    const result = await runBench(benchArgs(), { env: { TAKEOFF_BENCH_CHATGPT_OWNER: OWNER, TSX_TSCONFIG_PATH: tsconfig } });
    expect([result.code, result.stderr]).toEqual([1, expect.stringMatching(/another checkout/)]);
  });

  it("exits 2 with a partial report and no call when no ChatGPT account is connected", { timeout: 30_000 }, async () => {
    const result = await runBench(benchArgs({ docs: "all" }), {
      cwd: scratch, env: { TAKEOFF_BENCH_CHATGPT_OWNER: OWNER, TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") },
    });
    expect(result.code, result.stderr).toBe(2);
    expect((await readdir(out)).sort()).toEqual(["report.json", "report.md"]);
    const report = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
    expect(report).toMatchObject({
      status: "incomplete", calls_done: 0, calls_planned: 4,
      stop: { kind: "provider", reason: "account_missing", calls_done: 0, calls_remaining: 4 },
      metadata: { node: process.version, dataset: { skipped: [{ id: "b-plan-01" }] }, profile: { model: null, unchanged: null } },
    });
    // No profile was read: the report claims no send mode for the requested couple.
    expect(report.couples).toEqual([expect.objectContaining({ model: "fixture-model", reasoning_effort: null, override: null })]);
    const markdown = await readFile(path.join(out, "report.md"), "utf8");
    expect(markdown).not.toMatch(/\((?:override|profil)\)/);
    // The command reruns as recorded: from its directory, with its variables and this checkout's script.
    const tsconfig = path.join(ROOT, "tsconfig.json");
    expect(report.metadata).toMatchObject({
      cwd: await realpath(scratch), env: { TAKEOFF_BENCH_CHATGPT_OWNER: OWNER, TSX_TSCONFIG_PATH: tsconfig },
    });
    expect(report.metadata.command).toContain(path.join(ROOT, "scripts/run-takeoff-provider-benchmark.ts"));
    expect(markdown).toContain(`cd ${await realpath(scratch)} && TAKEOFF_BENCH_CHATGPT_OWNER=${OWNER} TSX_TSCONFIG_PATH=${tsconfig} node `);
    expect(report.metadata.dataset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.metadata.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.metadata.dataset.documents.map((document: { id: string }) => document.id)).toEqual(["a-plan-01", "a-plan-02", "c-plan-01", "d-plan-01"]);
    // The store directory exists for the lock; no store file was written.
    expect(await readdir(path.join(scratch, ".private", "chatgpt-local"))).toEqual([]);
  });
});
