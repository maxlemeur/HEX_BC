import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260713132407_harden_takeoff_apply_and_storage.sql"
  ),
  "utf8"
);
const operatorMigrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260713140006_enforce_takeoff_operator_mutations.sql"
  ),
  "utf8"
);
const takeoffServerSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/takeoff/server.ts"),
  "utf8"
);

describe("takeoff apply and storage security regressions", () => {
  it("enforces the draft lock and Level C guard at the applied-state mutation", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.enforce_takeoff_apply_security\(\)/
    );
    expect(migrationSql).toMatch(/before update of status on public\.takeoff_jobs/);
    expect(migrationSql).toMatch(/new\.status = 'applied'/);
    expect(migrationSql).toMatch(/from public\.draft_locks dl/);
    expect(migrationSql).toMatch(/dl\.user_id = \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(/dl\.expires_at > statement_timestamp\(\)/);
    expect(migrationSql).toMatch(/'TAKEOFF_LOW_CONFIDENCE_THRESHOLD'/);
    expect(migrationSql).toMatch(/ti\.is_excluded = false/);
    expect(migrationSql).toMatch(/ti\.is_verified = false/);
    expect(migrationSql).toMatch(
      /ti\.confidence is null[\s\S]*?or ti\.confidence < low_confidence_threshold/
    );
    expect(migrationSql).toMatch(/raise exception 'TAKEOFF_APPLY_GUARD_FAILED'/);
  });

  it("accepts only an admin override with matching durable audit evidence", () => {
    expect(migrationSql).toMatch(
      /public\.has_tenant_role\([\s\S]*?array\['admin'::public\.tenant_role\]/
    );
    expect(migrationSql).toMatch(/al\.action = 'takeoff\.apply\.override'/);
    expect(migrationSql).toMatch(/al\.user_id = \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(/al\.record_id = new\.id/);
    expect(migrationSql).toMatch(/blocked_item_ids/);
    expect(migrationSql).toMatch(/blocked_items_count/);
    expect(migrationSql).toMatch(/justification/);
    expect(migrationSql).toMatch(/security definer/i);
    expect(migrationSql).toMatch(/caller_id uuid := \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(/set search_path = public, pg_temp/);
    expect(migrationSql).toMatch(
      /revoke all on function public\.enforce_takeoff_apply_security\(\) from public/
    );
    expect(migrationSql).toMatch(
      /alter table public\.takeoff_apply_override_consumptions force row level security/
    );
  });

  it("consumes an exact matching override audit in the apply transaction", () => {
    expect(migrationSql).toMatch(/takeoff_apply_override_consumptions/);
    expect(migrationSql).toMatch(/consumed\.audit_log_id = al\.id/);
    expect(migrationSql).toMatch(
      /blocked_items_count'\s*\)\s*::integer = blocked_items_count/
    );
    expect(migrationSql).toMatch(
      /insert into public\.takeoff_apply_override_consumptions/
    );
    expect(migrationSql).toMatch(/audit_log_id uuid primary key/);
    expect(migrationSql).toMatch(
      /job_id uuid not null references public\.takeoff_jobs\(id\) on delete restrict/
    );
    expect(migrationSql).toMatch(
      /estimate_version_id uuid not null\s+references public\.estimate_versions\(id\) on delete restrict/
    );
    expect(migrationSql).not.toMatch(
      /job_id uuid not null references public\.takeoff_jobs\(id\) on delete cascade/
    );
    expect(migrationSql).not.toMatch(
      /estimate_version_id uuid not null\s+references public\.estimate_versions\(id\) on delete cascade/
    );
  });

  it("serializes item mutations with apply and freezes items after apply", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.enforce_takeoff_item_mutation_before_apply\(\)/
    );
    expect(migrationSql).toMatch(
      /before insert or update or delete on public\.takeoff_items/
    );
    expect(migrationSql).toMatch(
      /hashtextextended\('takeoff-job:' \|\| target_job_id::text, 0\)/
    );
    expect(migrationSql).toMatch(
      /hashtextextended\('takeoff-job:' \|\| new\.id::text, 0\)/
    );
    expect(migrationSql).toMatch(
      /parent_status = 'applied'[\s\S]*?TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE/
    );
    expect(migrationSql).toMatch(/TAKEOFF_ITEM_JOB_IMMUTABLE/);
    expect(migrationSql).toMatch(
      /parent_tenant_id is null and tg_op = 'DELETE'[\s\S]*?return old/
    );
  });

  it("freezes takeoff job classification and provenance before apply", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.enforce_takeoff_job_identity_immutable\(\)/
    );
    expect(migrationSql).toMatch(
      /create trigger aaa_enforce_takeoff_job_identity_immutable/
    );
    for (const column of [
      "tenant_id",
      "estimate_version_id",
      "level",
      "source_file_name",
      "source_file_path",
      "source_file_type",
      "source_file_size_bytes",
      "schema_version",
      "created_by",
      "plan_set_id",
    ]) {
      expect(migrationSql).toContain(
        `new.${column} is distinct from old.${column}`
      );
    }
    expect(migrationSql).toMatch(/TAKEOFF_JOB_IDENTITY_IMMUTABLE/);
    expect(migrationSql).not.toContain(
      "new.processing_strategy is distinct from old.processing_strategy"
    );
    expect(migrationSql).not.toContain(
      "new.prompt_version is distinct from old.prompt_version"
    );
  });

  it("prevents authenticated Data API writes from rewinding retry state", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.enforce_takeoff_job_retry_state\(\)/
    );
    expect(migrationSql).toMatch(
      /create trigger aab_enforce_takeoff_job_retry_state/
    );
    expect(migrationSql).toMatch(
      /new\.retry_count < old\.retry_count[\s\S]*?TAKEOFF_RETRY_COUNT_REWIND_DENIED/
    );
    expect(migrationSql).toMatch(/TAKEOFF_JOB_STATUS_TRANSITION_DENIED/);
    expect(migrationSql).toMatch(/new\.completed_at := statement_timestamp\(\)/);
    expect(migrationSql).toMatch(/TAKEOFF_COMPLETED_AT_MUTATION_DENIED/);
    expect(migrationSql).toMatch(/TAKEOFF_NEXT_RETRY_AT_MUTATION_DENIED/);
  });

  it("binds every plan file to an immutable canonical Storage identity", () => {
    expect(operatorMigrationSql).toMatch(
      /create or replace function public\.enforce_plan_file_storage_identity\(\)/
    );
    expect(operatorMigrationSql).toMatch(
      /create trigger aaa_enforce_plan_file_storage_identity/
    );
    expect(operatorMigrationSql).toMatch(
      /new\.file_path is distinct from canonical_path/
    );
    expect(operatorMigrationSql).toMatch(/PLAN_FILE_STORAGE_PATH_INVALID/);
    for (const column of [
      "id",
      "tenant_id",
      "plan_set_id",
      "file_path",
      "file_name",
    ]) {
      expect(operatorMigrationSql).toContain(
        `new.${column} is distinct from old.${column}`
      );
    }
    expect(operatorMigrationSql).toMatch(
      /PLAN_FILE_STORAGE_IDENTITY_IMMUTABLE/
    );
  });

  it("scopes takeoff Storage SELECT to the exact accessible job source object", () => {
    expect(migrationSql).toMatch(
      /drop policy if exists "Tenant members can view takeoff files storage" on storage\.objects;/
    );
    expect(migrationSql).toMatch(
      /create policy "Authorized users can view takeoff files storage"/
    );
    expect(migrationSql).toMatch(/bucket_id = 'takeoff-files'/);
    expect(migrationSql).toMatch(
      /storage\.foldername\(objects\.name\)\)\[1\][\s\S]*?public\.current_tenant_id\(\)::text/
    );
    expect(migrationSql).toMatch(
      /storage\.foldername\(objects\.name\)\)\[2\][\s\S]*?::uuid/
    );
    expect(migrationSql).toMatch(/tj\.source_file_path = objects\.name/);
    expect(migrationSql).toMatch(
      /public\.can_access_takeoff_estimate_version\([\s\S]*?tj\.estimate_version_id,[\s\S]*?tj\.tenant_id[\s\S]*?\)/
    );
  });

  it("restricts direct takeoff Storage update and delete to the exact accessible job", () => {
    expect(operatorMigrationSql).toMatch(
      /create policy "Authorized operators can update takeoff storage"[\s\S]*?as restrictive/
    );
    expect(operatorMigrationSql).toMatch(
      /create policy "Authorized operators can delete takeoff storage"[\s\S]*?as restrictive/
    );
    expect(operatorMigrationSql).toMatch(/tj\.source_file_path = storage\.objects\.name/);
    expect(operatorMigrationSql).toMatch(
      /public\.can_access_takeoff_estimate_version\(tj\.estimate_version_id, tj\.tenant_id\)/
    );
    expect(operatorMigrationSql).toMatch(
      /array\['admin'::public\.tenant_role, 'engineer'::public\.tenant_role\]/
    );
  });

  it("uses an exact server-only rollback for uploads that predate their job row", () => {
    expect(takeoffServerSource).toMatch(
      /async function removeUploadedFileIfPresent[\s\S]*?createServiceRoleClient\(\)[\s\S]*?\.remove\(\[input\.storagePath\]\)/
    );
    expect(takeoffServerSource).toMatch(
      /const sourceFilePath = `\$\{tenantId\}\/\$\{jobId\}\/\$\{payloadFingerprint\}-\$\{sanitizeFilename/
    );
  });

  it("adds restrictive operator policies to every shared takeoff mutation table", () => {
    for (const table of [
      "takeoff_items",
      "takeoff_dpgf_links",
      "takeoff_dpgf_review_decisions",
      "takeoff_price_suggestions",
      "estimate_risk_alerts",
      "plan_sets",
      "plan_files",
    ]) {
      expect(operatorMigrationSql).toContain(`on public.${table}`);
    }
    expect(operatorMigrationSql).toMatch(
      /create policy "Authorized operators can delete plan storage"[\s\S]*?as restrictive/
    );
  });
});
