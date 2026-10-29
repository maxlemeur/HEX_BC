import { describe, expect, it } from "vitest";

import {
  inspectSupabaseMigrations,
  parseUtcMigrationTimestamp,
  parseSupabaseMigrationList,
  validateAppliedMigrationRows,
} from "@/test/supabase-migrations";

describe("Supabase migration history regressions", () => {
  it("keeps the complete migration and seed contract reproducible", () => {
    const inventory = inspectSupabaseMigrations();

    expect(inventory.files.length).toBeGreaterThan(0);
    expect(new Set(inventory.versions).size).toBe(inventory.versions.length);
    expect(inventory.errors).toEqual([]);
  });

  it("parses only real UTC migration timestamps", () => {
    expect(parseUtcMigrationTimestamp("20260811185118")?.toISOString()).toBe(
      "2026-08-11T18:51:18.000Z"
    );
    expect(parseUtcMigrationTimestamp("20260230010101")).toBeNull();
    expect(parseUtcMigrationTimestamp("99991231235959")?.getUTCFullYear()).toBe(
      9999
    );
    expect(
      inspectSupabaseMigrations(
        process.cwd(),
        new Date("2026-01-01T00:00:00.000Z")
      ).errors
    ).toContain(
      "migration timestamp is too far in the future: 20260811185118_restore_authenticated_estimate_privileges.sql"
    );
  });

  it("parses CLI migration output and rejects missing applied versions", () => {
    const output = `
      LOCAL          | REMOTE         | TIME (UTC)
      ---------------|----------------|---------------------
      001            | 001            |
      20260304       |                |
      20260808204122 | 20260808204122 | 2026-08-08 20:41:22
    `;
    const rows = parseSupabaseMigrationList(output);

    expect(rows).toEqual([
      { local: "001", remote: "001" },
      { local: "20260304", remote: undefined },
      { local: "20260808204122", remote: "20260808204122" },
    ]);
    // Since CLI 2.119 the date-only legacy versions are recorded like any other:
    // an unrecorded one now means the migration did not run.
    expect(
      validateAppliedMigrationRows(
        ["001", "20260304", "20260808204122"],
        rows
      )
    ).toContain("migration is not applied locally: 20260304");
    const applied = rows.map((row) => ({ ...row, remote: row.local }));
    expect(
      validateAppliedMigrationRows(
        ["001", "20260304", "20260808204122"],
        applied
      )
    ).toEqual([]);
    expect(
      validateAppliedMigrationRows(
        ["001", "20260304", "20260808204122"],
        applied.slice(0, 2)
      )
    ).toContain(
      "applied migration inventory mismatch: expected 3, received 2"
    );
    // The CLI lists versions in version order ("20260222" before
    // "20260222001500"); the repository inventory follows file names.
    expect(
      validateAppliedMigrationRows(
        ["20260222001500", "20260222"],
        [
          { local: "20260222", remote: "20260222" },
          { local: "20260222001500", remote: "20260222001500" },
        ]
      )
    ).toEqual([]);
    expect(parseSupabaseMigrationList("unexpected output\r\nwithout rows")).toEqual(
      []
    );
    expect(
      parseSupabaseMigrationList(
        [
          JSON.stringify({
            migrations: [
              { local: "001", remote: "001", time: "001" },
              {
                local: "20260808204122",
                remote: "20260808204122",
                time: "2026-08-08 20:41:22",
              },
            ],
          }),
          "Connecting to local database...",
        ].join("\n")
      )
    ).toEqual([
      { local: "001", remote: "001" },
      { local: "20260808204122", remote: "20260808204122" },
    ]);
    expect(
      parseSupabaseMigrationList(
        "  `20260808204122` │ `20260808204122` │ `2026-08-08 20:41:22`"
      )
    ).toEqual([
      { local: "20260808204122", remote: "20260808204122" },
    ]);
  });
});
