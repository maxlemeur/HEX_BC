import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("affaire favorites schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260310113000_affaire_favorites.sql",
    ),
    "utf8",
  );

  it("creates the user favorite projects table with strict uniqueness", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.user_favorite_projects/,
    );
    expect(migrationSql).toMatch(
      /unique \(tenant_id, user_id, project_id\)/,
    );
    expect(migrationSql).toMatch(
      /references public\.estimate_projects\(id\) on delete cascade/,
    );
  });

  it("enforces user-scoped RLS on favorite projects", () => {
    expect(migrationSql).toMatch(
      /alter table if exists public\.user_favorite_projects force row level security;/,
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select favorite projects"/,
    );
    expect(migrationSql).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(
      /tenant_id = \(select public\.current_tenant_id\(\)\)/,
    );
  });

  it("extends the affaires RPC contract with favorites support", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.list_affaires_page\([\s\S]*p_favorites_only boolean default false/,
    );
    expect(migrationSql).toMatch(/is_favorite boolean/);
    expect(migrationSql).toMatch(
      /create or replace function public\.get_affaires_counters\([\s\S]*p_favorites_only boolean default false/,
    );
  });
});
