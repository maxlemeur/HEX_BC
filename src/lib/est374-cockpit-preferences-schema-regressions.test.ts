import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-374 cockpit preferences schema regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260310100000_est374_cockpit_command_preferences.sql",
    ),
    "utf8",
  );

  it("creates the cockpit command preferences table with strict uniqueness", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.cockpit_command_preferences/,
    );
    expect(migrationSql).toMatch(
      /unique \(tenant_id, user_id, project_id, action_id\)/,
    );
    expect(migrationSql).toMatch(/is_hidden boolean not null default false/);
    expect(migrationSql).toMatch(/is_pinned boolean not null default false/);
  });

  it("indexes preferences by project and visibility state", () => {
    expect(migrationSql).toMatch(
      /create index if not exists cockpit_command_preferences_project_user_idx/,
    );
    expect(migrationSql).toMatch(
      /create index if not exists cockpit_command_preferences_visible_idx/,
    );
  });

  it("enforces strict user-scoped RLS policies", () => {
    expect(migrationSql).toMatch(
      /alter table if exists public\.cockpit_command_preferences force row level security;/,
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select cockpit command preferences"/,
    );
    expect(migrationSql).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(
      /tenant_id = \(select public\.current_tenant_id\(\)\)/,
    );
  });
});
