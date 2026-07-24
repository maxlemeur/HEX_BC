import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("estimate calc engine version schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260724090000_estimate_calc_engine_version.sql"
    ),
    "utf8"
  );

  it("adds the calc engine version column idempotently, already backfilled to 1", () => {
    expect(migrationSql).toMatch(
      /add column if not exists calc_engine_version smallint not null default 1;/
    );
  });

  it("guards the column with an idempotent check constraint", () => {
    expect(migrationSql).toMatch(
      /drop constraint if exists estimate_versions_calc_engine_version_check;/
    );
    expect(migrationSql).toMatch(
      /add constraint estimate_versions_calc_engine_version_check\s+check \(calc_engine_version >= 1\);/
    );
  });

  it("documents the column semantics", () => {
    expect(migrationSql).toMatch(
      /comment on column public\.estimate_versions\.calc_engine_version is/
    );
  });

  it("backfills through the column default instead of an UPDATE", () => {
    // "add column ... not null default" remplit les lignes existantes depuis le
    // catalogue (PostgreSQL 11+) : aucun UPDATE, donc aucun trigger de ligne.
    expect(migrationSql).not.toMatch(/update public\.estimate_versions/);
    expect(migrationSql).not.toMatch(/set calc_engine_version =/);
  });

  it("never disables or re-enables the estimate version triggers", () => {
    expect(migrationSql).not.toMatch(/disable trigger/);
    expect(migrationSql).not.toMatch(/enable trigger/);
  });

  it("leaves the read-only guard function untouched", () => {
    expect(migrationSql).not.toMatch(
      /create or replace function public\.guard_estimate_versions_readonly/
    );
    expect(migrationSql).not.toMatch(/create trigger/);
  });
});
