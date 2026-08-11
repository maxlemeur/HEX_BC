import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseGitNameStatus,
  runSupabaseMigrationGitGuard,
  validateSupabaseMigrationGitChanges,
} from "@/test/supabase-migration-git-guard";

const temporaryDirectories: string[] = [];

function createFixture() {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "supabase-git-guard-"));
  temporaryDirectories.push(rootDirectory);
  fs.mkdirSync(path.join(rootDirectory, "supabase", "migrations"), { recursive: true });
  return rootDirectory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("Supabase migration Git guard", () => {
  it("parses NUL-delimited modifications and renames", () => {
    expect(
      parseGitNameStatus(
        "M\0supabase/migrations/old.sql\0R100\0supabase/migrations/a.sql\0supabase/migrations/b.sql\0"
      )
    ).toEqual([
      { status: "M", path: "supabase/migrations/old.sql" },
      {
        status: "R100",
        previousPath: "supabase/migrations/a.sql",
        path: "supabase/migrations/b.sql",
      },
    ]);
    expect(() => parseGitNameStatus("M\0")).toThrow("Incomplete");
  });

  it("allows only canonical, appended migration files", () => {
    const rootDirectory = createFixture();
    const fileName = "20260811220000_append_only_guard.sql";
    fs.writeFileSync(
      path.join(rootDirectory, "supabase", "migrations", fileName),
      "select 1;\n",
      "utf8"
    );

    expect(
      validateSupabaseMigrationGitChanges({
        baseMigrationPaths: [
          "supabase/migrations/20260808204122_existing.sql",
        ],
        now: new Date("2026-08-11T22:05:00Z"),
        records: [
          { status: "A", path: `supabase/migrations/${fileName}` },
          { status: "M", path: "supabase/migrations.manifest.json" },
        ],
        rootDirectory,
      })
    ).toEqual([]);
  });

  it("rejects timestamps that could lock all future append-only migrations", () => {
    const rootDirectory = createFixture();
    const futureFile = "99991231235959_lock_history.sql";
    fs.writeFileSync(
      path.join(rootDirectory, "supabase", "migrations", futureFile),
      "select 1;\n",
      "utf8"
    );

    expect(
      validateSupabaseMigrationGitChanges({
        baseMigrationPaths: [
          "supabase/migrations/20260808204122_existing.sql",
        ],
        now: new Date("2026-08-11T22:05:00Z"),
        records: [
          { status: "A", path: `supabase/migrations/${futureFile}` },
        ],
        rootDirectory,
      })
    ).toContain(
      `new migration timestamp is too far in the future: supabase/migrations/${futureFile}`
    );
  });

  it("rejects edits, deletes, renames, subdirectories and backdated additions", () => {
    const rootDirectory = createFixture();
    const backdated = "20260801000000_backdated.sql";
    const nested = "supabase/migrations/nested/20260812000000_nested.sql";
    fs.writeFileSync(
      path.join(rootDirectory, "supabase", "migrations", backdated),
      "select 1;\n",
      "utf8"
    );

    const errors = validateSupabaseMigrationGitChanges({
      baseMigrationPaths: [
        "supabase/migrations/20260808204122_existing.sql",
      ],
      records: [
        { status: "M", path: "supabase/migrations/20260808204122_existing.sql" },
        { status: "D", path: "supabase/migrations/20260807000000_deleted.sql" },
        {
          status: "R100",
          previousPath: "supabase/migrations/20260806000000_old.sql",
          path: "supabase/migrations/20260812000000_renamed.sql",
        },
        { status: "A", path: `supabase/migrations/${backdated}` },
        { status: "A", path: nested },
      ],
      rootDirectory,
    });

    expect(errors.filter((error) => error.includes("immutable"))).toHaveLength(3);
    expect(errors).toContain(
      "new migration timestamp 20260801000000 must be newer than base 20260808204122"
    );
    expect(errors).toContain(`new migration must be a direct file: ${nested}`);
  });

  it("fails closed on invalid bases and uses the exact push base", () => {
    const rootDirectory = createFixture();
    expect(() =>
      runSupabaseMigrationGitGuard([], {
        environment: { MIGRATION_BASE_SHA: "0".repeat(40) },
        executeGit: () => ({ status: 0, stderr: "", stdout: "" }),
        rootDirectory,
      })
    ).toThrow("non-zero");

    const sha = "a".repeat(40);
    const commands: string[][] = [];
    expect(() =>
      runSupabaseMigrationGitGuard([], {
        environment: {
          MIGRATION_BASE_SHA: sha,
          MIGRATION_DIFF_MODE: "push",
        },
        executeGit: (args) => {
          commands.push(args);
          if (args[0] === "cat-file") {
            return { status: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "diff") {
            return {
              status: 0,
              stderr: "",
              stdout: `M\0supabase/migrations/20260808204122_existing.sql\0`,
            };
          }
          return { status: 0, stderr: "", stdout: "" };
        },
        rootDirectory,
      })
    ).toThrow("deployed migration is immutable");
    expect(commands.some((args) => args[0] === "merge-base")).toBe(false);
    expect(commands.find((args) => args[0] === "diff")).toContain(sha);
  });
});
