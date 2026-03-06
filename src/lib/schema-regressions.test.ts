import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("schema regressions", () => {
  const schemaSql = readSql("supabase/schema.sql");
  const planSetsStorageCompatMigrationSql = readSql(
    "supabase/migrations/20260305134000_v3_006_plan_sets_scope_storage_compat.sql"
  );
  const takeoffDpgfLinksMigrationSql = readSql(
    "supabase/migrations/20260306130000_v3_010_takeoff_dpgf_links.sql"
  );
  const takeoffDpgfReviewDecisionsMigrationSql = readSql(
    "supabase/migrations/20260306153000_v3_010_takeoff_review_decisions_and_multi_links.sql"
  );

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
    expect(schemaSql).toMatch(/expected_version_updated_at timestamptz/);
    expect(schemaSql).toMatch(/and ev\.updated_at = expected_version_updated_at[\s\S]*for update;/);
    expect(schemaSql).toMatch(/perform item\.id[\s\S]*for update;/);
    expect(schemaSql).toMatch(/if locked_count <> expected_count then[\s\S]*STALE_BULK_UPDATE_ITEMS/);
  });

  it("defines move_estimate_item RPC with authenticated execute grant", () => {
    expect(schemaSql).toMatch(/create or replace function public\.move_estimate_item\(/);
    expect(schemaSql).toMatch(/ordered_source_item_ids uuid\[\]/);
    expect(schemaSql).toMatch(/ordered_target_item_ids uuid\[\]/);
    expect(schemaSql).toMatch(/grant execute on function public\.move_estimate_item\(/);
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

  it("creates a default tenant membership when a user signs up", () => {
    expect(schemaSql).toMatch(/create or replace function public\.handle_new_user\(\)/);
    expect(schemaSql).toMatch(
      /insert into public\.tenant_memberships[\s\S]*default_tenant_id[\s\S]*new\.id/
    );
  });

  it("uses jwt-based admin checks and prevents authenticated profile role escalation", () => {
    expect(schemaSql).toMatch(/create or replace function public\.is_admin_user\(\)/);
    expect(schemaSql).toMatch(/auth\.jwt\(\) -> 'app_metadata'/);
    expect(schemaSql).toMatch(/create or replace function public\.guard_profile_role_update\(\)/);
    expect(schemaSql).toMatch(/create trigger guard_profile_role_update/);
  });

  it("reads audit estimate version id safely in shared tenant trigger", () => {
    expect(schemaSql).toMatch(/create or replace function public\.assign_tenant_id\(\)/);
    expect(schemaSql).toMatch(/elsif tg_table_name = 'audit_logs' then/);
    expect(schemaSql).toMatch(/to_jsonb\(new\)->>'estimate_version_id'/);
  });

  it("keeps plan-files storage policies compatible with project-only plan sets", () => {
    const policySections = [
      "create policy \"Tenant members can view plan files storage\"",
      "create policy \"Tenant members can insert plan files storage\"",
      "create policy \"Tenant members can update plan files storage\"",
      "create policy \"Tenant members can delete plan files storage\"",
    ].map((policyMarker) => {
      const sectionStart = planSetsStorageCompatMigrationSql.indexOf(policyMarker);
      expect(sectionStart).toBeGreaterThanOrEqual(0);

      const nextSectionStart = planSetsStorageCompatMigrationSql.indexOf(
        "create policy \"",
        sectionStart + policyMarker.length
      );

      return planSetsStorageCompatMigrationSql.slice(
        sectionStart,
        nextSectionStart === -1 ? undefined : nextSectionStart
      );
    });

    for (const section of policySections) {
      expect(section).toContain(
        "can_access_takeoff_project(ps.project_id, ps.tenant_id)"
      );
      expect(section).toContain(
        "can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id)"
      );
    }
  });

  it("keeps takeoff DPGF link writes behind the version/job scope guard", () => {
    expect(takeoffDpgfLinksMigrationSql).toMatch(
      /create policy "Current tenant can update takeoff dpgf links"[\s\S]*takeoff_version_links/
    );
    expect(takeoffDpgfLinksMigrationSql).toMatch(
      /create policy "Current tenant can delete takeoff dpgf links"[\s\S]*takeoff_version_links/
    );
  });

  it("defines the transactional DPGF manual-link RPC for authenticated callers", () => {
    expect(takeoffDpgfLinksMigrationSql).toMatch(
      /create or replace function public\.save_takeoff_dpgf_manual_link\(/
    );
    expect(takeoffDpgfLinksMigrationSql).toMatch(
      /grant execute on function public\.save_takeoff_dpgf_manual_link\(uuid, uuid, uuid, uuid, uuid\)/
    );
  });

  it("defines the multi-link DPGF RPC and review decision storage", () => {
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /create or replace function public\.save_takeoff_dpgf_manual_links\(/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /grant execute on function public\.save_takeoff_dpgf_manual_links\(uuid, uuid, uuid, uuid\[\], uuid\)/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /create table if not exists public\.takeoff_dpgf_review_decisions/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /create index if not exists takeoff_dpgf_review_decisions_reference_idx/
    );
  });

  it("keeps duplicate_estimate_version aligned with source tracking and review carry-over", () => {
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /insert into public\.estimate_items[\s\S]*source_provider[\s\S]*source_file_name[\s\S]*source_page/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /create temporary table _estimate_item_map/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /insert into public\.takeoff_version_links[\s\S]*target_version_id[\s\S]*new_version_id[\s\S]*insert into public\.takeoff_dpgf_review_decisions/
    );
    expect(takeoffDpgfReviewDecisionsMigrationSql).toMatch(
      /insert into public\.takeoff_dpgf_review_decisions[\s\S]*carried_over_from_version_id[\s\S]*carried_over_at/
    );
  });
});
