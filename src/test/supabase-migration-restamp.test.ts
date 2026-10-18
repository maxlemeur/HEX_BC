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
//    an untracked file, a deployed migration; on a branch that has not merged
//    the base, the files the base added since the fork (deployed migrations
//    included) are never searched, so their references survive the restamp;
// 7. a migration that a shared-Supabase report records as applied is renamed,
//    so that record no longer names a repository file: by file name, by the
//    MCP apply_migration name (<timestamp>_<slug>, no .sql) or by a captured
//    schema_migrations row (version <timestamp>, name <slug>); or, the other
//    way, a report that only lists the bare timestamp as still to apply
//    blocks the restamp;
// 8. a refusal found late leaves the tree half restamped (for instance
//    another branch migration, not named, still at or below the base newest,
//    which only the final guard notices), or a dry run writes;
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
const TARGET = `supabase/migrations/${FIRST}`;
const NOW = new Date("2026-08-10T13:00:00Z");
const FIXTURE_TIMEOUT_MS = 60_000;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function runGitCommand(rootDirectory: string, args: string[]) {
  return spawnSync(
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
}

function git(rootDirectory: string, ...args: string[]) {
  const result = runGitCommand(rootDirectory, args);
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
// main may then move on, as it does while a pull request waits, and feature
// may merge it back, as the restamp workflow asks before running.
function createRepository(input: {
  base?: Record<string, string>;
  branch: Record<string, string | Buffer>;
  mainAfterFork?: Record<string, string>;
  mergeMain?: boolean;
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
  if (input.mergeMain) {
    // Both sides add manifest entries, so Git may stop on that file: rebuild
    // it from the merged migrations, as `supabase:manifest:add` would.
    const merge = runGitCommand(rootDirectory, ["merge", "-q", "--no-ff", "--no-commit", "main"]);
    if (merge.status !== 0 && merge.status !== 1) {
      throw new Error(`git merge main failed: ${merge.stderr}`);
    }
    writeManifest(rootDirectory);
    commitAll(rootDirectory, "merge main");
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

function commitReport(reportPath: string, contents: string) {
  return (rootDirectory: string) => {
    write(rootDirectory, reportPath, contents);
    commitAll(rootDirectory, "report");
  };
}

const MARKDOWN_REPORT = "docs/testing/shared-supabase-m9-2026-08-10.md";
const JSON_REPORT = "docs/testing/shared-supabase-m9-2026-08-10.json";

// Each case names FIRST (TARGET) unless it says otherwise.
const REFUSAL_CASES: Array<{
  base?: Record<string, string>;
  branch?: Record<string, string>;
  expected: string;
  mainAfterFork?: Record<string, string>;
  name: string;
  prepare?: (rootDirectory: string) => void;
  target?: string;
}> = [
  {
    expected: `${EXISTING} is a deployed migration on main`,
    name: "a deployed migration",
    target: `supabase/migrations/${EXISTING}`,
  },
  {
    expected: "docs/plan.md is not a file directly under supabase/migrations",
    name: "a file outside the migrations directory",
    prepare: (rootDirectory) => {
      write(rootDirectory, "docs/plan.md", "plan\n");
      commitAll(rootDirectory, "plan");
    },
    target: "docs/plan.md",
  },
  {
    expected: "20260809120000_missing.sql does not exist",
    name: "a missing migration",
    target: "supabase/migrations/20260809120000_missing.sql",
  },
  {
    expected: "20260809130000_untracked.sql is not tracked by Git",
    name: "an untracked migration",
    prepare: (rootDirectory) =>
      write(rootDirectory, "supabase/migrations/20260809130000_untracked.sql", "select 4;\n"),
    target: "supabase/migrations/20260809130000_untracked.sql",
  },
  {
    expected: `${FIRST} is missing from supabase/migrations.manifest.json`,
    name: "a migration absent from the manifest",
    prepare: (rootDirectory) => {
      const { migrations } = readManifest(rootDirectory);
      delete migrations[FIRST];
      write(rootDirectory, "supabase/migrations.manifest.json", serializeManifest(migrations));
      commitAll(rootDirectory, "drop entry");
    },
  },
  {
    expected: `${FIRST} does not match its supabase/migrations.manifest.json hash`,
    name: "a migration stale in the manifest",
    prepare: (rootDirectory) => {
      write(rootDirectory, TARGET, "create table public.first_table (id int);\n");
      commitAll(rootDirectory, "edit after manifest");
    },
  },
  {
    expected: `${FIRST} is recorded by name in ${MARKDOWN_REPORT}`,
    name: "applied by file name (shared report)",
    prepare: commitReport(
      MARKDOWN_REPORT,
      `| \`${FIRST}\` | \`20260810101010\` | \`apply_migration\` |\n`
    ),
  },
  {
    expected: `${FIRST} is recorded by name in ${JSON_REPORT}`,
    name: "applied by MCP name (shared report)",
    prepare: commitReport(
      JSON_REPORT,
      `${JSON.stringify(
        {
          application: {
            method: "apply_migration",
            name: "20260809100000_first_table",
            remoteVersion: "20260810101010",
          },
        },
        null,
        2
      )}\n`
    ),
  },
  {
    expected: `${FIRST} is recorded by name in ${MARKDOWN_REPORT}`,
    name: "applied by db push row (shared report)",
    prepare: commitReport(
      MARKDOWN_REPORT,
      "| version | name |\n|---|---|\n| 20260809100000 | first_table |\n"
    ),
  },
  {
    expected: `${FIRST} is recorded by name in ${JSON_REPORT}`,
    name: "applied by schema_migrations JSON",
    // The MCP list_migrations output is kept as an escaped JSON string.
    prepare: commitReport(
      JSON_REPORT,
      `${JSON.stringify(
        {
          migrations_after: {
            text: JSON.stringify({
              migrations: [
                { version: "20260808204122", name: "existing" },
                { version: "20260809100000", name: "first_table" },
              ],
            }),
          },
        },
        null,
        2
      )}\n`
    ),
  },
  {
    base: {
      "supabase/migrations/20260808210000_reserved_note.sql":
        "-- reserved for 20260809100000\nselect 2;\n",
    },
    expected: "deployed migration 20260808210000_reserved_note.sql mentions 20260809100000",
    name: "mentioned by a deployed migration",
  },
  {
    expected: "main is not merged into HEAD",
    // Files the base added since the fork cite the old timestamp; the
    // working tree does not have them yet.
    mainAfterFork: {
      "docs/status.md": "Pending: 20260809100000 (feature PR)\n",
      "supabase/migrations/20260810120000_main_after_fork.sql":
        "-- runs after 20260809100000_first_table.sql once it lands\nselect 3;\n",
    },
    name: "a branch that has not merged the base",
  },
  {
    base: { "supabase/migrations/20260809110000_base_newer.sql": "select 2;\n" },
    branch: {
      "supabase/migrations/20260809090000_zero_table.sql": "create table public.zero_table ();\n",
    },
    expected:
      "20260809090000_zero_table.sql is also added by this branch and is not newer than " +
      "the base newest 20260809110000",
    name: "another branch migration left too old",
  },
];

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
    ).toThrow(`would reorder or collide with ${between}`);
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

  it("refuses another branch migration that would stay at or below the base newest", () => {
    // Equal is not newer either: the Git guard would refuse it after the rename.
    expect(() =>
      plan({
        baseNewest: "20260810120000",
        named: ["20260810121000_after_base.sql"],
        now: new Date("2026-08-10T12:30:00Z"),
        otherBranchMigrations: ["20260810120000_same_as_base.sql"],
      })
    ).toThrow(
      "20260810120000_same_as_base.sql is also added by this branch and is not newer than " +
        "the base newest 20260810120000"
    );
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
      // A shared report that only lists the bare timestamp as still to apply
      // records no application: it is rewritten, not a reason to refuse.
      const pendingReport = "docs/testing/shared-supabase-m8-2026-08-09.md";
      const rootDirectory = createRepository({
        branch: {
          [pendingReport]: "Remaining after M8: M9 `20260809100000` (lot 9).\n",
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
        // Merged back into the branch, so the base's own files are searched too.
        mainAfterFork: {
          "docs/status.md": "Pending: 20260809100000 (feature PR)\n",
          "supabase/migrations/20260810120000_main_after_fork.sql": "select 3;\n",
        },
        mergeMain: true,
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
        "docs/status.md",
        pendingReport,
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
      const mainAfterFork = "20260810120000_main_after_fork.sql";
      expect(git(rootDirectory, "ls-files", "supabase/migrations").trim().split("\n")).toEqual(
        [TOMBSTONE, EXISTING, mainAfterFork, newFirst, newSecond, third].map(
          (name) => `supabase/migrations/${name}`
        )
      );

      const manifestAfter = readManifest(rootDirectory).migrations;
      expect(Object.keys(manifestAfter)).toEqual([
        TOMBSTONE,
        EXISTING,
        mainAfterFork,
        newFirst,
        newSecond,
        third,
      ]);
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
      expect(read(rootDirectory, "docs/status.md").toString("utf8")).toBe(
        "Pending: 20260810130000 (feature PR)\n"
      );
      expect(read(rootDirectory, pendingReport).toString("utf8")).toBe(
        "Remaining after M8: M9 `20260810130000` (lot 9).\n"
      );
      expect(read(rootDirectory, "notes.txt").toString("utf8")).toBe("draft 20260809100000\n");
      expect(guard).not.toThrow();
    },
    FIXTURE_TIMEOUT_MS
  );

  it.each(REFUSAL_CASES)(
    "refuses $name before changing anything",
    (testCase) => {
      const rootDirectory = createRepository({
        base: testCase.base,
        branch: { [TARGET]: "create table public.first_table ();\n", ...testCase.branch },
        mainAfterFork: testCase.mainAfterFork,
      });
      testCase.prepare?.(rootDirectory);
      const statusBefore = status(rootDirectory);
      const manifestBefore = read(rootDirectory, "supabase/migrations.manifest.json");
      const lines: string[] = [];

      const exitCode = runSupabaseMigrationRestampCli(
        [testCase.target ?? TARGET, "--base", "main", "--at", "20260810130000"],
        { error: (line) => lines.push(line), log: (line) => lines.push(line), now: NOW, rootDirectory }
      );

      expect(lines.join("\n")).toContain(testCase.expected);
      expect(exitCode).toBe(1);
      expect(status(rootDirectory)).toBe(statusBefore);
      expect(read(rootDirectory, "supabase/migrations.manifest.json")).toEqual(manifestBefore);
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
