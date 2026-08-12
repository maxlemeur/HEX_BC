import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811231238_durable_workflow_recovery.sql"
  ),
  "utf8"
);
const intakeServerSource = readFileSync(
  resolve(process.cwd(), "src/lib/affaires/intake-server.ts"),
  "utf8"
);

describe("durable workflow schema regression", () => {
  it("adds paired leases without rewriting the workflow tables", () => {
    expect(migrationSql).toMatch(
      /alter table public\.takeoff_jobs[\s\S]*processing_lease_token uuid[\s\S]*processing_lease_expires_at timestamptz/i
    );
    expect(migrationSql).toMatch(
      /alter table public\.affaire_intake_uploads[\s\S]*processing_lease_token uuid[\s\S]*processing_lease_expires_at timestamptz/i
    );
    expect(migrationSql).toMatch(/processing_lease_pair_check/gi);
  });

  it("serializes intake claims and gates them on an active tenant", () => {
    const claimBody = migrationSql.match(
      /create or replace function public\.claim_affaire_intake_upload[\s\S]*?\$\$;/i
    )?.[0];

    expect(claimBody).toMatch(/for update/i);
    expect(claimBody).toMatch(/tenant_row\.is_active/i);
    expect(claimBody).toMatch(/processing_lease_token = p_lease_token/i);
    expect(claimBody).toMatch(/attempt_count = upload_row\.attempt_count \+ 1/i);
  });

  it("fences document mutations before processing and after any failed I/O", () => {
    const processorSource = intakeServerSource.match(
      /async function processClaimedAffaireIntakeUpload[\s\S]*?\n}\n\nexport async function processAffaireIntakeUpload/
    )?.[0];
    expect(processorSource).toBeDefined();

    const markProcessingIndex = processorSource!.indexOf(
      'classification_status: "processing"'
    );
    const documentCatchIndex = processorSource!.indexOf("} catch (error) {");
    const markFailedIndex = processorSource!.indexOf(
      'classification_status: "failed"',
      documentCatchIndex
    );

    expect(markProcessingIndex).toBeGreaterThan(-1);
    expect(
      processorSource!.lastIndexOf("await renewLease();", markProcessingIndex)
    ).toBeGreaterThan(-1);
    expect(documentCatchIndex).toBeGreaterThan(markProcessingIndex);
    expect(markFailedIndex).toBeGreaterThan(documentCatchIndex);
    const catchRenewIndex = processorSource!.indexOf(
      "await renewLease();",
      documentCatchIndex
    );
    expect(catchRenewIndex).toBeGreaterThan(documentCatchIndex);
    expect(catchRenewIndex).toBeLessThan(markFailedIndex);
  });

  it("rejects intake finalization after lease expiry or tenant suspension", () => {
    const finishBody = migrationSql.match(
      /create or replace function public\.finish_affaire_intake_upload_attempt[\s\S]*?\$\$;/i
    )?.[0];

    expect(finishBody).toMatch(/tenant_row\.is_active/i);
    expect(finishBody).toMatch(/processing_lease_token = p_lease_token/i);
    expect(finishBody).toMatch(/processing_lease_expires_at > p_now/i);
  });

  it("never auto-retries an expired synchronous takeoff provider outcome", () => {
    const recoveryBody = migrationSql.match(
      /create or replace function public\.recover_stale_takeoff_jobs[\s\S]*?\$\$;/i
    )?.[0];

    expect(recoveryBody).toMatch(/provider_batch_id is null/i);
    expect(recoveryBody).toMatch(/next_retry_at = null/i);
    expect(recoveryBody).toMatch(/TAKEOFF_WORKER_OUTCOME_UNKNOWN/);
    expect(recoveryBody).not.toMatch(/tenant_row\.is_active/i);
  });

  it("renews and fences both takeoff lease kinds", () => {
    expect(migrationSql).toMatch(/function public\.renew_takeoff_processing_lease[\s\S]*processing_lease_token = p_lease_token[\s\S]*processing_lease_expires_at > p_now/i);
    expect(migrationSql).toMatch(/function public\.renew_takeoff_batch_reconcile_lease[\s\S]*provider_reconcile_lease_token = p_lease_token[\s\S]*provider_reconcile_lease_expires_at > p_now/i);
    expect(migrationSql).toMatch(/function public\.persist_takeoff_provider_batch_snapshot_fenced[\s\S]*for update of job_row[\s\S]*return false/i);
  });

  it("lists only active-tenant work and keeps lifecycle RPCs service-role only", () => {
    const dueBody = migrationSql.match(
      /create or replace function public\.list_due_durable_workflows[\s\S]*?\$\$;/i
    )?.[0];

    expect(dueBody?.match(/tenant_row\.is_active/gi)).toHaveLength(2);
    expect(migrationSql).toMatch(
      /revoke all on function public\.claim_affaire_intake_upload[\s\S]*from public, anon, authenticated/i
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.list_due_durable_workflows[\s\S]*to service_role/i
    );
  });
});
