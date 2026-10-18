// Isolation regression for the pre-merge migration restamp tool
// (scripts/supabase-migration-restamp.ts, supabase/README.md §3). No E2E
// journey reaches it: it is developer tooling acting on a Git checkout, and a
// defect only surfaces when a pull request is about to merge. Ways it can fail,
// each pinned below:
// 1. it renames a deployed migration (present on the base ref) or a file the
//    branch does not add (missing, untracked, outside supabase/migrations);
// 2. the new timestamp is not strictly newer than the base newest, or lies past
//    the guard's future skew, so the Git guard still refuses the migration;
// 3. several restamped files lose their relative order, or a restamped file
//    jumps over (or collides with) another migration the branch adds;
// 4. the manifest keeps the old key, misses the new one, changes the hash of
//    unchanged content or diverges from what `supabase:manifest:add` writes;
//    an entry already missing or stale before the rename is silently blessed;
// 5. a migration that embeds its own name keeps the stale name, or the manifest
//    keeps the hash of its old content;
// 6. a reference to the old name or timestamp stays behind, or the rewrite
//    alters anything else: a longer digit run, line endings, non-UTF-8 bytes,
//    an untracked file, a deployed migration;
// 7. a migration that a shared-Supabase report records by file name (an
//    application) is renamed, so that record no longer names a repository file;
// 8. a refusal found late leaves the tree half restamped, or a dry run writes;
// 9. the tool reports success while the Git guard (pull_request against the
//    base) or the manifest validation fails.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSupabaseMigrationGitGuard } from "@/test/supabase-migration-git-guard";
import {
  planMigrationRestampTimestamps,
  runSupabaseMigrationRestamp,
  runSupabaseMigrationRestampCli,
} from "@/test/supabase-migration-restamp";
import { computeSupabaseMigrationHashes } from "@/test/supabase-migrations";

const TOMBSTONE = "20260718014058_protect_takeoff_replace_with_recovery.sql";
const EXISTING = "20260808204122_existing.sql";
const FIRST = "20260809100000_first_table.sql";
const NOW = new Date("2026-08-10T13:00:00Z");
const FIXTURE_TIMEOUT_MS = 60_000;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function git(rootDirectory: string, ...args: string[]) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.autocrlf=false",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Restamp Harness",
      "-c",
      "user.email=harness@example.invalid",
      ...args,
    ],
    { cwd: rootDirectory, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function write(rootDirectory: string, relativePath: string, contents: string | Buffer) {
  const target = path.join(rootDirectory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function read(rootDirectory: string, relativePath: string) {
  return fs.readFileSync(path.join(rootDirectory, ...relativePath.split("/")));
}

// The exact serialization of `npm run supabase:manifest:add`.
function serializeManifest(migrations: Record<string, string>) {
  const sorted = Object.fromEntries(
    Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))
  );
  return `${JSON.stringify({ algorithm: "sha256", migrations: sorted }, null, 2)}\n`;
}

function writeManifest(rootDirectory: string) {
  write(
    rootDirectory,
    "supabase/migrations.manifest.json",
    serializeManifest(computeSupabaseMigrationHashes(rootDirectory))
  );
}

function readManifest(rootDirectory: string) {
  return JSON.parse(
    read(rootDirectory, "supabase/migrations.manifest.json").toString("utf8")
  ) as { migrations: Record<string, string> };
}

function commitAll(rootDirectory: string, message: string) {
  git(rootDirectory, "add", "-A");
  git(rootDirectory, "commit", "-q", "--no-verify", "-m", message);
}

function status(rootDirectory: string) {
  return git(rootDirectory, "status", "--porcelain=v1", "--untracked-files=all");
}

function writeAll(rootDirectory: string, files: Record<string, string | Buffer>) {
  for (const [relativePath, contents] of Object.entries(files)) {
    write(rootDirectory, relativePath, contents);
  }
}

// main holds the deployed history; feature forks from it and adds migrations;
// main may then move on, as it does while a pull request waits.
function createRepository(input: {
  base?: Record<string, string>;
  branch: Record<string, string | Buffer>;
  mainAfterFork?: Record<string, string>;
  untracked?: Record<string, string>;
}) {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "supabase-restamp-"));
  temporaryDirectories.push(rootDirectory);
  git(rootDirectory, "init", "-q", "--initial-branch=main");
  writeAll(rootDirectory, {
    "supabase/config.toml": "[db.seed]\nenabled = false\n",
    [`supabase/migrations/${TOMBSTONE}`]: "",
    [`supabase/migrations/${EXISTING}`]: "select 1;\n",
    ...input.base,
  });
  writeManifest(rootDirectory);
  commitAll(rootDirectory, "base");

  git(rootDirectory, "checkout", "-q", "-b", "feature");
  writeAll(rootDirectory, input.branch);
  writeManifest(rootDirectory);
  commitAll(rootDirectory, "feature");

  if (input.mainAfterFork) {
    git(rootDirectory, "checkout", "-q", "main");
    writeAll(rootDirectory, input.mainAfterFork);
    writeManifest(rootDirectory);
    commitAll(rootDirectory, "main moves on");
    git(rootDirectory, "checkout", "-q", "feature");
  }
  writeAll(rootDirectory, input.untracked ?? {});
  return rootDirectory;
}

function guardAgainstMain(rootDirectory: string) {
  const base = git(rootDirectory, "rev-parse", "main").trim();
  return () =>
    runSupabaseMigrationGitGuard(["--base", base, "--mode", "pull_request"], {
      environment: {},
      rootDirectory,
    });
}

describe("migration restamp timestamps", () => {
  const plan = planMigrationRestampTimestamps;

  it("starts at the current UTC second or just after the base newest, within the guard's skew", () => {
    const named = [FIRST];
    const at1230 = new Date("2026-08-10T12:30:00Z");
    expect(
      plan({ baseNewest: "20260810120000", named, now: at1230, otherBranchMigrations: [] })
    ).toEqual([{ from: FIRST, to: "20260810123000_first_table.sql" }]);
    // A base migration stamped a few minutes ahead of the clock, inside the skew.
    expect(
      plan({
        baseNewest: "20260810123500",
        named,
        now: at1230,
        otherBranchMigrations: [],
      })
    ).toEqual([{ from: FIRST, to: "20260810123501_first_table.sql" }]);
    expect(() =>
      plan({ baseNewest: "20260810124000", named, now: at1230, otherBranchMigrations: [] })
    ).toThrow("too far in the future");

    const pinned = { baseNewest: "20260810120000", named, now: at1230, otherBranchMigrations: [] };
    expect(plan({ ...pinned, at: "20260810123500" })).toEqual([
      { from: FIRST, to: "20260810123500_first_table.sql" },
    ]);
    expect(() => plan({ ...pinned, at: "20260810120000" })).toThrow(
      "must be newer than the base newest 20260810120000"
    );
    expect(() => plan({ ...pinned, at: "20260230120000" })).toThrow("valid UTC timestamp");
    expect(() => plan({ ...pinned, at: "20260810124001" })).toThrow("too far in the future");
  });

  it("keeps the order of several files and never jumps over or collides with another branch migration", () => {
    const input = {
      baseNewest: "20260810120000",
      now: new Date("2026-08-10T12:30:00Z"),
      otherBranchMigrations: ["20260810123500_already_newer.sql"],
    };
    expect(
      plan({
        ...input,
        named: ["20260809110000_b.sql", "20260809120000_c.sql", "20260809100000_a.sql"],
      })
    ).toEqual([
      { from: "20260809100000_a.sql", to: "20260810123000_a.sql" },
      { from: "20260809110000_b.sql", to: "20260810123001_b.sql" },
      { from: "20260809120000_c.sql", to: "20260810123002_c.sql" },
    ]);

    const between = "20260809105000_between.sql";
    expect(() =>
      plan({ ...input, named: ["20260809100000_a.sql"], otherBranchMigrations: [between] })
    ).toThrow(between);
    expect(
      plan({ ...input, named: ["20260809100000_a.sql", between], otherBranchMigrations: [] })
    ).toEqual([
      { from: "20260809100000_a.sql", to: "20260810123000_a.sql" },
      { from: between, to: "20260810123001_between.sql" },
    ]);
    expect(() =>
      plan({
        ...input,
        named: ["20260809100000_a.sql"],
        otherBranchMigrations: ["20260810123000_same_second.sql"],
      })
    ).toThrow("20260810123000_same_second.sql");
  });
});

describe("migration restamp on a Git checkout", () => {
  it(
    "renames added migrations after the base newest with their manifest entries and every reference",
    () => {
      const second = "20260809110000_second_table.sql";
      const newFirst = "20260810130000_first_table.sql";
      const newSecond = "20260810130001_second_table.sql";
      // Also added by the branch and already after the new timestamps: it keeps
      // its name, but it mentions the first migration.
      const third = "20260810140000_third_table.sql";
      const latin1 = Buffer.from([0xe9]);
      const rootDirectory = createRepository({
        branch: {
          [`supabase/migrations/${FIRST}`]: "create table public.first_table ();\n",
          [`supabase/migrations/${second}`]:
            `-- ${second}\r\ncreate table public.second_table ();\r\n`,
          [`supabase/migrations/${third}`]:
            `-- needs ${FIRST}\ncreate table public.third_table ();\n`,
          "docs/plan.md": Buffer.concat([
            Buffer.from(
              `First \`supabase/migrations/${FIRST}\`, second 20260809110000.\r\n` +
                "Keep 120260809100000 and 202608091100001 caf"
            ),
            latin1,
            Buffer.from("\r\n"),
          ]),
        },
        mainAfterFork: {
          "supabase/migrations/20260810120000_main_after_fork.sql": "select 3;\n",
        },
        untracked: { "notes.txt": "draft 20260809100000\n" },
      });
      const guard = guardAgainstMain(rootDirectory);
      expect(guard).toThrow("must be newer than base 20260810120000");
      const manifestBefore = readManifest(rootDirectory).migrations;
      const argv = [
        `supabase/migrations/${second}`,
        `supabase/migrations/${FIRST}`,
        "--base",
        "main",
        "--at",
        "20260810130000",
      ];
      const renames = [
        { from: FIRST, to: newFirst },
        { from: second, to: newSecond },
      ];
      const references = [
        "docs/plan.md",
        `supabase/migrations/${newSecond}`,
        `supabase/migrations/${third}`,
      ];

      const statusBefore = status(rootDirectory);
      expect(
        runSupabaseMigrationRestamp([...argv, "--dry-run"], { now: NOW, rootDirectory })
      ).toMatchObject({ checks: null, dryRun: true, ok: true, references, renames });
      expect(status(rootDirectory)).toBe(statusBefore);

      const result = runSupabaseMigrationRestamp(argv, { now: NOW, rootDirectory });
      expect(result).toMatchObject({
        base: { newest: "20260810120000", ref: "main" },
        checks: { guard: [], manifest: [] },
        dryRun: false,
        ok: true,
        references,
        renames,
      });
      expect(git(rootDirectory, "ls-files", "supabase/migrations").trim().split("\n")).toEqual(
        [TOMBSTONE, EXISTING, newFirst, newSecond, third].map(
          (name) => `supabase/migrations/${name}`
        )
      );

      const manifestAfter = readManifest(rootDirectory).migrations;
      expect(Object.keys(manifestAfter)).toEqual([TOMBSTONE, EXISTING, newFirst, newSecond, third]);
      expect(manifestAfter[newFirst]).toBe(manifestBefore[FIRST]);
      expect(manifestAfter[newSecond]).not.toBe(manifestBefore[second]);
      expect(manifestAfter[third]).not.toBe(manifestBefore[third]);
      expect(result.rehashed).toEqual([
        { name: newSecond, next: manifestAfter[newSecond], previous: manifestBefore[second] },
        { name: third, next: manifestAfter[third], previous: manifestBefore[third] },
      ]);
      expect(read(rootDirectory, "supabase/migrations.manifest.json").toString("utf8")).toBe(
        serializeManifest(computeSupabaseMigrationHashes(rootDirectory))
      );

      expect(read(rootDirectory, `supabase/migrations/${newSecond}`).toString("utf8")).toBe(
        `-- ${newSecond}\r\ncreate table public.second_table ();\r\n`
      );
      expect(read(rootDirectory, `supabase/migrations/${third}`).toString("utf8")).toBe(
        `-- needs ${newFirst}\ncreate table public.third_table ();\n`
      );
      expect(read(rootDirectory, "docs/plan.md")).toEqual(
        Buffer.concat([
          Buffer.from(
            `First \`supabase/migrations/${newFirst}\`, second 20260810130001.\r\n` +
              "Keep 120260809100000 and 202608091100001 caf"
          ),
          latin1,
          Buffer.from("\r\n"),
        ])
      );
      expect(read(rootDirectory, "notes.txt").toString("utf8")).toBe("draft 20260809100000\n");
      expect(guard).not.toThrow();
    },
    FIXTURE_TIMEOUT_MS
  );

  it(
    "refuses deployed, foreign or unrecorded migrations before changing anything",
    () => {
      const target = `supabase/migrations/${FIRST}`;
      const cases: Array<{
        base?: Record<string, string>;
        expected: string;
        name: string;
        prepare?: (rootDirectory: string) => void;
        target?: string;
      }> = [
        {
          expected: `${EXISTING} is a deployed migration on main`,
          name: "deployed",
          target: `supabase/migrations/${EXISTING}`,
        },
        {
          expected: "docs/plan.md is not a file directly under supabase/migrations",
          name: "outside the migrations directory",
          prepare: (rootDirectory) => {
            write(rootDirectory, "docs/plan.md", "plan\n");
            commitAll(rootDirectory, "plan");
          },
          target: "docs/plan.md",
        },
        {
          expected: "20260809120000_missing.sql does not exist",
          name: "missing",
          target: "supabase/migrations/20260809120000_missing.sql",
        },
        {
          expected: "20260809130000_untracked.sql is not tracked by Git",
          name: "untracked",
          prepare: (rootDirectory) =>
            write(rootDirectory, "supabase/migrations/20260809130000_untracked.sql", "select 4;\n"),
          target: "supabase/migrations/20260809130000_untracked.sql",
        },
        {
          expected: `${FIRST} is missing from supabase/migrations.manifest.json`,
          name: "absent from the manifest",
          prepare: (rootDirectory) => {
            const { migrations } = readManifest(rootDirectory);
            delete migrations[FIRST];
            write(rootDirectory, "supabase/migrations.manifest.json", serializeManifest(migrations));
            commitAll(rootDirectory, "drop entry");
          },
        },
        {
          expected: `${FIRST} does not match its supabase/migrations.manifest.json hash`,
          name: "stale in the manifest",
          prepare: (rootDirectory) => {
            write(rootDirectory, target, "create table public.first_table (id int);\n");
            commitAll(rootDirectory, "edit after manifest");
          },
        },
        {
          expected: `${FIRST} is recorded by name in docs/testing/shared-supabase-m9-2026-08-10.md`,
          name: "recorded by a shared-Supabase report",
          prepare: (rootDirectory) => {
            write(
              rootDirectory,
              "docs/testing/shared-supabase-m9-2026-08-10.md",
              `| \`${FIRST}\` | \`20260810101010\` | \`apply_migration\` |\n`
            );
            commitAll(rootDirectory, "report");
          },
        },
        {
          base: {
            "supabase/migrations/20260808210000_reserved_note.sql":
              "-- reserved for 20260809100000\nselect 2;\n",
          },
          expected:
            "deployed migration 20260808210000_reserved_note.sql mentions 20260809100000",
          name: "mentioned by a deployed migration",
        },
      ];

      for (const testCase of cases) {
        const rootDirectory = createRepository({
          base: testCase.base,
          branch: { [target]: "create table public.first_table ();\n" },
        });
        testCase.prepare?.(rootDirectory);
        const statusBefore = status(rootDirectory);
        const manifestBefore = read(rootDirectory, "supabase/migrations.manifest.json");
        const lines: string[] = [];

        const exitCode = runSupabaseMigrationRestampCli(
          [testCase.target ?? target, "--base", "main", "--at", "20260810130000"],
          { error: (line) => lines.push(line), log: (line) => lines.push(line), now: NOW, rootDirectory }
        );

        expect({ exitCode, name: testCase.name }).toEqual({ exitCode: 1, name: testCase.name });
        expect(lines.join("\n")).toContain(testCase.expected);
        expect(status(rootDirectory)).toBe(statusBefore);
        expect(read(rootDirectory, "supabase/migrations.manifest.json")).toEqual(manifestBefore);
      }
    },
    FIXTURE_TIMEOUT_MS
  );

  it(
    "exits non-zero when the Git guard or the manifest validation fails after the rename",
    () => {
      const rootDirectory = createRepository({
        branch: { [`supabase/migrations/${FIRST}`]: "create table public.first_table ();\n" },
      });
      // The branch also edits a deployed migration: unrelated to the restamp,
      // but the final checks must still report it rather than pass.
      write(rootDirectory, `supabase/migrations/${EXISTING}`, "select 10;\n");
      commitAll(rootDirectory, "edit a deployed migration");
      const lines: string[] = [];

      const exitCode = runSupabaseMigrationRestampCli(
        [`supabase/migrations/${FIRST}`, "--base", "main", "--at", "20260810130000"],
        { error: (line) => lines.push(line), log: (line) => lines.push(line), now: NOW, rootDirectory }
      );

      expect(exitCode).toBe(1);
      const output = lines.join("\n");
      expect(output).toContain(`${FIRST} -> 20260810130000_first_table.sql`);
      expect(output).toContain(`deployed migration is immutable (M): supabase/migrations/${EXISTING}`);
      expect(output).toContain(`deployed migration content changed: ${EXISTING}`);
    },
    FIXTURE_TIMEOUT_MS
  );
});
