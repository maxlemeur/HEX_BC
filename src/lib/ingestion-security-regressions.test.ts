import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260713134332_harden_ingestion_audit_boundaries.sql"
  ),
  "utf8"
);

describe("ingestion and audit database security boundaries", () => {
  it("keeps DPGF reads available while requiring a writer role for mutations", () => {
    expect(migrationSql).toMatch(
      /create policy "Tenant users can select own dpgf imports"[\s\S]*?for select/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant writers can insert own dpgf imports"[\s\S]*?array\['admin'::public\.tenant_role, 'engineer'::public\.tenant_role\]/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant writers can insert own dpgf raw rows"[\s\S]*?has_tenant_role/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant writers can upload own dpgf imports"[\s\S]*?current_tenant_id\(\)[\s\S]*?'engineer'::public\.tenant_role/
    );
  });

  it("makes intake events append-only through policy, privilege, and trigger layers", () => {
    expect(migrationSql).toMatch(
      /create trigger guard_affaire_intake_events_immutable[\s\S]*?before update or delete/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Current tenant can update affaire intake events"/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Current tenant can delete affaire intake events"/
    );
    expect(migrationSql).toMatch(
      /revoke update, delete on public\.affaire_intake_events from authenticated/
    );
    expect(migrationSql).toMatch(/AFFAIRE_INTAKE_EVENTS_IMMUTABLE/);
  });

  it("forces register updates through an atomic audited RPC", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.update_affaire_register_entry_with_event/
    );
    expect(migrationSql).toMatch(/security definer[\s\S]*?set search_path = ''/);
    expect(migrationSql).toMatch(/AFFAIRE_REGISTER_SERVICE_ROLE_REQUIRED/);
    expect(migrationSql).toMatch(
      /from public, anon, authenticated;[\s\S]*?to service_role;/
    );
    expect(migrationSql).toMatch(/AFFAIRE_REGISTER_PATCH_FIELD_FORBIDDEN/);
    expect(migrationSql).toMatch(/AFFAIRE_REGISTER_PATCH_EMPTY/);
    expect(migrationSql).toMatch(
      /update public\.affaire_register_entries[\s\S]*?insert into public\.affaire_register_events/
    );
    expect(migrationSql).toMatch(
      /jsonb_build_object\('_entry_state', to_jsonb\(current_entry\)\)/
    );
    expect(migrationSql).toMatch(
      /jsonb_build_object\('_entry_state', to_jsonb\(updated_entry\)\)/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Current tenant can update affaire register entries"/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Current tenant can delete affaire register entries"/
    );
    expect(migrationSql).toMatch(
      /revoke update, delete on public\.affaire_register_entries from authenticated/
    );
  });
});
