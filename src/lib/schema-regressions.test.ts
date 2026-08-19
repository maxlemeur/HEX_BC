import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("schema regressions", () => {
  const schemaSql = readSql("supabase/schema.sql");
  const bulkUpdateEstimateItemsMigrationSql = readSql(
    "supabase/migrations/20260223113000_est033_aid_column.sql"
  );
  const moveEstimateItemMigrationSql = readSql(
    "supabase/migrations/20260304212000_est125_hierarchy_depth_compat_fix.sql"
  );
  const tenantBootstrapMigrationSql = readSql(
    "supabase/migrations/021_fix_bulk_update_tenant_bootstrap_and_admin_hardening_v2.sql"
  );
  const handleNewUserMigrationSql = readSql(
    "supabase/migrations/20260713132306_isolate_self_signup_tenants.sql"
  );
  const assignTenantIdMigrationSql = readSql(
    "supabase/migrations/20260222020000_est181_assign_tenant_id_audit_logs_guard.sql"
  );
  const planSetsStorageCompatMigrationSql = readSql(
    "supabase/migrations/20260305134000_v3_006_plan_sets_scope_storage_compat.sql"
  );
  const takeoffDpgfLinksMigrationSql = readSql(
    "supabase/migrations/20260306130000_v3_010_takeoff_dpgf_links.sql"
  );
  const takeoffDpgfReviewDecisionsMigrationSql = readSql(
    "supabase/migrations/20260306153000_v3_010_takeoff_review_decisions_and_multi_links.sql"
  );
  const estimateLineEvidenceMigrationSql = readSql(
    "supabase/migrations/20260306213000_est391_line_evidence_graph.sql"
  );
  const estimateRiskAlertsMigrationSql = readSql(
    "supabase/migrations/20260306232000_est393_takeoff_risk_radar.sql"
  );
  const takeoffPriceSuggestionsMigrationSql = readSql(
    "supabase/migrations/20260306235900_est392_takeoff_price_suggestions.sql"
  );
  const estimateExplanationsMigrationSql = readSql(
    "supabase/migrations/20260307143000_est394_estimate_explanations.sql"
  );
  const structureDraftAtomicApplyMigrationSql = readSql(
    "supabase/migrations/20260306200000_est382_structure_draft_atomic_apply_fix.sql"
  );

  it("does not contain drop table statements for tenants or tenant_memberships", () => {
    expect(schemaSql).not.toMatch(/drop\s+table/i);
    expect(schemaSql).not.toMatch(
      /drop\s+table\s+if\s+exists\s+public\.tenants/i
    );
    expect(schemaSql).not.toMatch(
      /drop\s+table\s+if\s+exists\s+public\.tenant_memberships/i
    );
  });

  it("guards bulk estimate updates with a stale lock-count check before writes", () => {
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(
      /create or replace function public\.bulk_update_estimate_items\(/
    );
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(/locked_count integer := 0;/);
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(/expected_version_updated_at timestamptz/);
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(
      /and ev\.updated_at = expected_version_updated_at[\s\S]*for update;/
    );
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(/perform item\.id[\s\S]*for update;/);
    expect(bulkUpdateEstimateItemsMigrationSql).toMatch(
      /if locked_count <> expected_count then[\s\S]*STALE_BULK_UPDATE_ITEMS/
    );
  });

  it("defines move_estimate_item RPC with authenticated execute grant", () => {
    expect(moveEstimateItemMigrationSql).toMatch(
      /create or replace function public\.move_estimate_item\(/
    );
    expect(moveEstimateItemMigrationSql).toMatch(/ordered_source_item_ids uuid\[\]/);
    expect(moveEstimateItemMigrationSql).toMatch(/ordered_target_item_ids uuid\[\]/);
    expect(moveEstimateItemMigrationSql).toMatch(
      /grant execute on function public\.move_estimate_item\(/
    );
  });

  it("supports tenant creator bootstrap for initial admin membership", () => {
    expect(tenantBootstrapMigrationSql).toMatch(
      /create or replace function public\.can_bootstrap_tenant_membership\(/
    );
    expect(tenantBootstrapMigrationSql).toMatch(
      /create policy "Authenticated can create tenants"[\s\S]*created_by = \(select auth\.uid\(\)\)/
    );
    expect(tenantBootstrapMigrationSql).toMatch(
      /create policy "Tenant admins can insert memberships"[\s\S]*can_bootstrap_tenant_membership\(tenant_id, user_id, role\)/
    );
  });

  it("creates a default tenant membership when a user signs up", () => {
    expect(handleNewUserMigrationSql).toMatch(
      /create or replace function public\.handle_new_user\(\)/
    );
    expect(handleNewUserMigrationSql).toMatch(
      /insert into public\.tenant_memberships[\s\S]*signup_tenant_id[\s\S]*new\.id/
    );
  });

  it("uses jwt-based admin checks and prevents authenticated profile role escalation", () => {
    expect(tenantBootstrapMigrationSql).toMatch(
      /create or replace function public\.is_admin_user\(\)/
    );
    expect(tenantBootstrapMigrationSql).toMatch(/auth\.jwt\(\) -> 'app_metadata'/);
    expect(tenantBootstrapMigrationSql).toMatch(
      /create or replace function public\.guard_profile_role_update\(\)/
    );
    expect(tenantBootstrapMigrationSql).toMatch(/create trigger guard_profile_role_update/);
  });

  it("reads audit estimate version id safely in shared tenant trigger", () => {
    expect(assignTenantIdMigrationSql).toMatch(
      /create or replace function public\.assign_tenant_id\(\)/
    );
    expect(assignTenantIdMigrationSql).toMatch(/elsif tg_table_name = 'audit_logs' then/);
    expect(assignTenantIdMigrationSql).toMatch(/to_jsonb\(new\)->>'estimate_version_id'/);
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

  it("defines persistent line evidences with partial indexes and strict RLS", () => {
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /create table if not exists public\.estimate_line_evidences/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /evidence_type in \('dpgf', 'takeoff', 'plan_zone', 'formula', 'price_source', 'comment'\)/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /create unique index if not exists estimate_line_evidences_active_fingerprint_idx[\s\S]*where invalidated_at is null/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /create index if not exists estimate_line_evidences_project_type_idx[\s\S]*where invalidated_at is null/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /alter table if exists public\.estimate_line_evidences force row level security;/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /create policy "Current tenant can select estimate line evidences"/
    );
    expect(estimateLineEvidenceMigrationSql).toMatch(
      /takeoff_version_links[\s\S]*can_access_takeoff_estimate_version/
    );
  });

  it("defines persistent takeoff risk alerts with active-identity and open-queue indexes", () => {
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /create table if not exists public\.estimate_risk_alerts/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /cause_code in \([\s\S]*'missing_proof'[\s\S]*'missing_piece'[\s\S]*\)/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /create unique index if not exists estimate_risk_alerts_active_identity_idx[\s\S]*where is_active/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /create index if not exists estimate_risk_alerts_open_queue_idx[\s\S]*where is_active and status = 'to_process'/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /add constraint estimate_risk_alerts_review_note_required_check/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /alter table if exists public\.estimate_risk_alerts force row level security;/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /create policy "Current tenant can select estimate risk alerts"/
    );
    expect(estimateRiskAlertsMigrationSql).toMatch(
      /takeoff_version_links[\s\S]*can_access_takeoff_estimate_version/
    );
  });

  it("defines persistent takeoff price suggestions with active snapshots and strict RLS", () => {
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /create table if not exists public\.takeoff_price_suggestions/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /status in \('pending', 'applied', 'kept_current', 'rejected'\)/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /create unique index if not exists takeoff_price_suggestions_active_line_idx[\s\S]*where superseded_at is null/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /create table if not exists public\.takeoff_price_suggestion_sources/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /source_kind in \('history', 'pricebook', 'similar_item', 'external_reference'\)/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /add constraint takeoff_price_suggestions_status_action_check/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /alter table if exists public\.takeoff_price_suggestions force row level security;/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /create policy "Current tenant can select takeoff price suggestions"/
    );
    expect(takeoffPriceSuggestionsMigrationSql).toMatch(
      /takeoff_version_links[\s\S]*can_access_takeoff_estimate_version/
    );
  });

  it("defines persistent estimate explanations with active identity snapshots and strict RLS", () => {
    expect(estimateExplanationsMigrationSql).toMatch(
      /create table if not exists public\.estimate_explanations/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /explanation_kind in \('price', 'delta'\)/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create unique index if not exists estimate_explanations_active_identity_idx[\s\S]*where superseded_at is null/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create unique index if not exists estimate_explanations_active_fingerprint_idx[\s\S]*where superseded_at is null/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create table if not exists public\.estimate_explanation_sources/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create index if not exists estimate_explanation_sources_explanation_rank_idx/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /alter table if exists public\.estimate_explanations force row level security;/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /alter table if exists public\.estimate_explanation_sources force row level security;/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create policy "Current tenant can select estimate explanations"/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /create policy "Current tenant can select estimate explanation sources"/
    );
    expect(estimateExplanationsMigrationSql).toMatch(
      /can_access_takeoff_estimate_version\(version_id, tenant_id\)/
    );
  });

  it("keeps structure draft apply transactional and supports level-4 draft nodes", () => {
    expect(structureDraftAtomicApplyMigrationSql).toMatch(
      /check \(hierarchy_level between 1 and 4\)/
    );
    expect(structureDraftAtomicApplyMigrationSql).toMatch(
      /create or replace function public\.apply_estimate_structure_draft\(/
    );
    expect(structureDraftAtomicApplyMigrationSql).toMatch(
      /from public\.estimate_structure_drafts d[\s\S]*for update;/
    );
    expect(structureDraftAtomicApplyMigrationSql).toMatch(
      /insert into public\.estimate_structure_draft_applications/
    );
    expect(structureDraftAtomicApplyMigrationSql).toMatch(
      /grant execute on function public\.apply_estimate_structure_draft\(/
    );
  });
});
