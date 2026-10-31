import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFixtureDataset,
  FAKE_PLAN_PATH,
  type FixtureDataset,
} from "@/lib/takeoff/bench/bench-dataset.test-utils";

// The npm script is what the dataset owner runs: a wrong exit code (0 on a broken
// dataset, 1 on a usage mistake) would make the check useless in a shell or CI.
const command = path.resolve("scripts/check-takeoff-bench.ts");

function runCheck(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", command, ...args], {
      cwd: path.resolve("."),
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test" },
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const watchdog = setTimeout(() => {
      child.kill();
      reject(new Error("takeoff:bench:check exceeded its deadline."));
    }, 20_000);
    child.on("error", (error) => { clearTimeout(watchdog); reject(error); });
    child.on("close", (code) => { clearTimeout(watchdog); resolve({ code, stdout, stderr }); });
  });
}

let dataset: FixtureDataset;

beforeEach(async () => {
  dataset = await createFixtureDataset();
});

afterEach(async () => {
  await dataset.cleanup();
});

describe("takeoff:bench:check command", () => {
  it("exits 0 on a consistent dataset and 1 once a byte changes", { timeout: 40_000 }, async () => {
    const passed = await runCheck(["--dataset", dataset.root]);
    expect(passed.code, passed.stderr).toBe(0);
    expect(passed.stdout).toMatch(/passed.*9 documents.*6 binaries/);

    const bytes = await readFile(FAKE_PLAN_PATH);
    bytes[200] ^= 0x01;
    await dataset.replaceRaw("a-plan-01", bytes);
    const failed = await runCheck([`--dataset=${dataset.root}`]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain("raw/a-plan-01.pdf: SHA-256");
    expect(failed.stderr).toMatch(/1 error/);
  });

  it.each([
    [[]],
    [["--dataset"]],
    [["--dataset", "a", "--dataset", "b"]],
    [["--unknown"]],
    [["--dataset", path.join(os.tmpdir(), "takeoff-bench-missing-fixture-directory")]],
  ])("exits 2 on a usage error %j", { timeout: 20_000 }, async (args) => {
    const result = await runCheck(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Usage|not a directory/);
  });
});
