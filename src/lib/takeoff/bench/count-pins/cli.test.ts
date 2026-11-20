import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

let checkout: string;
beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), "count-pins-cli-test-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.name=Count bench test", "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "Fixture");
  writeFileSync(join(checkout, "uncommitted.txt"), "local work");
});
afterAll(() => {
  if (checkout) rmSync(checkout, { recursive: true, force: true });
});

function cli(...args: string[]) {
  return spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx",
    resolve("scripts/run-takeoff-count-pins-bench.ts"), "--methods", "label", ...args,
  ], {
    encoding: "utf8",
    env: { ...process.env, GIT_DIR: join(checkout, ".git"), GIT_WORK_TREE: checkout },
  });
}

it("refuses a dirty checkout before writing a receipt without an explicit opt-in", () => {
  const result = cli();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--allow-dirty");
}, 15_000);

it("marks an explicitly allowed dirty receipt as non-reproducible", () => {
  const result = cli("--allow-dirty");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).configuration).toMatchObject({ dirty: true, reproducible: false });
}, 15_000);
