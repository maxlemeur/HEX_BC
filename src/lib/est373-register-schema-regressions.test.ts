import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("EST-373 affaire register schema regressions", () => {
  const migrationSql = readSql(
    "supabase/migrations/20260307000500_est373_affaire_register.sql"
  );

  it("creates persistent register entries and immutable audit events", () => {
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_register_entries/
    );
    expect(migrationSql).toMatch(
      /create table if not exists public\.affaire_register_events/
    );
    expect(migrationSql).toMatch(
      /kind in \('assumption', 'missing_piece'\)/
    );
    expect(migrationSql).toMatch(
      /status in \('open', 'validated', 'rejected', 'clarify_with_client'\)/
    );
    expect(migrationSql).toMatch(
      /event_type in \(\s*'created',\s*'synced',\s*'status_changed',\s*'deactivated',\s*'reactivated'/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.prevent_affaire_register_event_mutation/
    );
    expect(migrationSql).toMatch(
      /create trigger guard_affaire_register_events_immutable/
    );
  });

  it("enforces scope consistency and version-linked scope validation", () => {
    expect(migrationSql).toMatch(
      /constraint affaire_register_entries_scope_consistency_check/
    );
    expect(migrationSql).toMatch(
      /scope_type = 'project'[\s\S]*version_id is null[\s\S]*scope_id is null/
    );
    expect(migrationSql).toMatch(
      /scope_type in \('lot', 'line'\)[\s\S]*version_id is not null[\s\S]*scope_id is not null/
    );
    expect(migrationSql).toMatch(
      /scope_type = 'exception'[\s\S]*length\(btrim\(coalesce\(scope_ref, ''\)\)\) > 0/
    );
    expect(migrationSql).toMatch(
      /AFFAIRE_REGISTER_SCOPE_EXPECTED_LOT/
    );
    expect(migrationSql).toMatch(
      /AFFAIRE_REGISTER_SCOPE_EXPECTED_LINE/
    );
  });

  it("adds pagination, source, filter and critical-open indexes", () => {
    expect(migrationSql).toMatch(
      /create index if not exists affaire_register_entries_tenant_project_updated_at_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_register_entries_project_version_updated_at_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_register_entries_project_source_document_idx/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_register_entries_project_scope_status_severity_idx[\s\S]*where is_active/
    );
    expect(migrationSql).toMatch(
      /create index if not exists affaire_register_entries_active_critical_open_idx[\s\S]*where is_active and status = 'open' and severity = 'critical'/
    );
    expect(migrationSql).toMatch(
      /constraint affaire_register_entries_project_sync_key_key[\s\S]*unique \(project_id, sync_key\)/
    );
  });

  it("keeps read access broad for directors and write access strict for owner-admin flows", () => {
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_register_entries force row level security;/
    );
    expect(migrationSql).toMatch(
      /alter table if exists public\.affaire_register_events force row level security;/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire register entries"[\s\S]*can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can insert affaire register entries"[\s\S]*can_access_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can update affaire register entries"[\s\S]*can_access_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can select affaire register events"[\s\S]*can_read_affaire_intake_project/
    );
    expect(migrationSql).toMatch(
      /create policy "Current tenant can insert affaire register events"[\s\S]*can_access_affaire_intake_project/
    );
  });
});
