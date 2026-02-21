import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("schema regressions", () => {
  const schemaSql = readSql("supabase/schema.sql");

  it("drops tenant and catalogue tables in schema reset block", () => {
    expect(schemaSql).toMatch(/drop table if exists public\.tenants cascade;/);
    expect(schemaSql).toMatch(/drop table if exists public\.tenant_memberships cascade;/);
    expect(schemaSql).toMatch(/drop table if exists public\.supplier_pricebook cascade;/);
    expect(schemaSql).toMatch(/drop table if exists public\.material_indices cascade;/);
    expect(schemaSql).toMatch(/drop table if exists public\.dpgf_catalogue_links cascade;/);
  });

  it("guards bulk estimate updates with a stale lock-count check before writes", () => {
    expect(schemaSql).toMatch(/create or replace function public\.bulk_update_estimate_items\(/);
    expect(schemaSql).toMatch(/locked_count integer := 0;/);
    expect(schemaSql).toMatch(/perform item\.id[\s\S]*for update;/);
    expect(schemaSql).toMatch(/if locked_count <> expected_count then[\s\S]*STALE_BULK_UPDATE_ITEMS/);
  });

  it("supports tenant creator bootstrap for initial admin membership", () => {
    expect(schemaSql).toMatch(/create or replace function public\.can_bootstrap_tenant_membership\(/);
    expect(schemaSql).toMatch(
      /create policy "Authenticated can create tenants"[\s\S]*created_by = \(select auth\.uid\(\)\)/
    );
    expect(schemaSql).toMatch(
      /create policy "Tenant admins can insert memberships"[\s\S]*can_bootstrap_tenant_membership\(tenant_id, user_id, role\)/
    );
  });

  it("uses jwt-based admin checks and prevents authenticated profile role escalation", () => {
    expect(schemaSql).toMatch(/create or replace function public\.is_admin_user\(\)/);
    expect(schemaSql).toMatch(/auth\.jwt\(\) -> 'app_metadata'/);
    expect(schemaSql).toMatch(/create or replace function public\.guard_profile_role_update\(\)/);
    expect(schemaSql).toMatch(/create trigger guard_profile_role_update/);
  });
});
