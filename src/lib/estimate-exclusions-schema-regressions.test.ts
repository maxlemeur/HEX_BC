import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("estimate exclusions schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260715235315_add_estimate_exclusions.sql"
    ),
    "utf8"
  );

  it("adds a bounded exclusions field to estimate versions", () => {
    expect(migrationSql).toMatch(
      /add column if not exists exclusions text;/
    );
    expect(migrationSql).toMatch(
      /check \(exclusions is null or char_length\(exclusions\) <= 5000\)/
    );
  });

  it("keeps exclusions immutable after a version leaves draft status", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.guard_estimate_version_exclusions_readonly\(\)/
    );
    expect(migrationSql).toMatch(
      /old\.status <> 'draft'[\s\S]*new\.exclusions is distinct from old\.exclusions/
    );
    expect(migrationSql).toMatch(
      /before update of exclusions on public\.estimate_versions/
    );
  });
});
