import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";

const entry = "scripts/run-takeoff-count-pins-bench.ts";
let root: string;
let checkout: string;
let foreign: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function commit(cwd: string, label: string) {
  git(cwd, "-c", "user.name=Count bench test", "-c", "user.email=bench@example.invalid", "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", label);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "count-pins-cli-test-"));
  checkout = join(root, "checkout");
  foreign = join(root, "foreign");
  mkdirSync(join(checkout, "scripts"), { recursive: true });
  mkdirSync(foreign);
  git(checkout, "init", "-q");
  git(foreign, "init", "-q");
  copyFileSync(resolve(entry), join(checkout, entry));
  for (const name of ["src", "node_modules", "tsconfig.json"]) symlinkSync(resolve(name), join(checkout, name));
  git(checkout, "add", "-f", "--", entry, "src", "node_modules", "tsconfig.json");
  commit(checkout, "CLI fixture");
  commit(foreign, "Foreign fixture");
  writeFileSync(join(checkout, "uncommitted.ts"), "export const unpublished = true;");
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function cli(args: string[] = [], override: Record<string, string> = {}) {
  return spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx",
    join(checkout, entry), "--methods", "label", ...args,
  ], {
    cwd: checkout,
    encoding: "utf8",
    env: { ...process.env, ...override },
  });
}

it("refuses a dirty checkout before writing a receipt without an explicit opt-in", () => {
  const result = cli();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--allow-dirty");
}, 15_000);

it("marks an explicitly allowed dirty receipt as non-reproducible", () => {
  const result = cli(["--allow-dirty"]);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).configuration).toMatchObject({ dirty: true, reproducible: false });
}, 15_000);

it("names the script checkout even when inherited Git variables name another clean checkout", () => {
  const result = cli(["--allow-dirty"], { GIT_DIR: join(foreign, ".git"), GIT_WORK_TREE: foreign });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).configuration).toMatchObject({
    revision: git(checkout, "rev-parse", "HEAD"), dirty: true, reproducible: false,
  });
}, 15_000);

it("rejects untracked source even when Git configuration hides untracked files", () => {
  git(checkout, "config", "status.showUntrackedFiles", "no");
  try {
    const result = cli();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--allow-dirty");
  } finally {
    git(checkout, "config", "--unset", "status.showUntrackedFiles");
  }
}, 15_000);
