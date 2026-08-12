import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const workflowSql = read(
  "supabase/migrations/20260713140444_harden_estimate_workflow_write_boundaries.sql"
);
const batchConflictSql = read(
  "supabase/migrations/20260722134411_fix_estimate_batch_conflict_sqlstate.sql"
);
const procurementSql = read(
  "supabase/migrations/20260713140454_harden_estimate_procurement_write_roles.sql"
);
const emailOutboxSql = read(
  "supabase/migrations/20260811231759_transactional_estimate_email_outbox.sql"
);
const emailSource = read("src/lib/email/send-estimate.ts");
const gatingSource = read("src/lib/estimates/gating.ts");
const csvSource = read("src/app/api/admin/anomaly-history/route.ts");
const serverSource = read("src/lib/estimates/server.ts");

describe("estimate workflow direct-write security", () => {
  it("keeps structure and V0 writes limited to admin/engineer roles", () => {
    expect(workflowSql).toMatch(
      /create policy "Users can insert estimate structure drafts"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
    expect(workflowSql).toMatch(
      /create policy "Users can insert version zero drafts"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
  });

  it("resolves V0 scope authoritatively and freezes its identity", () => {
    expect(workflowSql).toMatch(
      /create or replace function public\.assign_estimate_version_zero_draft_scope\(\)[\s\S]*security definer[\s\S]*set search_path = ''/
    );
    expect(workflowSql).toContain("ESTIMATE_VERSION_ZERO_VERSION_NOT_FOUND");
    expect(workflowSql).toMatch(
      /old\.version_id is distinct from new\.version_id[\s\S]*old\.created_at is distinct from new\.created_at/
    );
  });

  it("prevents lock rebinding and consumes each batch revision atomically", () => {
    expect(workflowSql).toMatch(
      /create trigger set_draft_locks_tenant_id[\s\S]*before insert or update on public\.draft_locks/
    );
    expect(workflowSql).toContain("DRAFT_LOCK_IDENTITY_IMMUTABLE");
    expect(workflowSql).toMatch(
      /create or replace function public\.claim_estimate_batch_revision\([\s\S]*update public\.estimate_versions[\s\S]*v\.updated_at = p_expected_updated_at/
    );
    expect(workflowSql).toContain("ESTIMATE_BATCH_REVISION_CONFLICT");
  });

  it("reports batch revision conflicts as non-transient HTTP conflicts", () => {
    expect(batchConflictSql).toMatch(
      /create or replace function public\.claim_estimate_batch_revision\([\s\S]*raise sqlstate 'PT409' using message = 'ESTIMATE_BATCH_REVISION_CONFLICT'/
    );
    expect(batchConflictSql).not.toMatch(/(?:errcode\s*=|raise sqlstate)\s*'40001'/);
    expect(batchConflictSql).toMatch(
      /revoke all on function public\.claim_estimate_batch_revision\(uuid, timestamptz\) from public;/
    );
    expect(batchConflictSql).toMatch(
      /grant execute on function public\.claim_estimate_batch_revision\(uuid, timestamptz\) to authenticated;/
    );
  });

  it("makes correction actions journal-only and generated snapshots append-only", () => {
    expect(workflowSql).toContain(
      'drop policy if exists "Estimate owners can update estimate review correction items"'
    );
    expect(workflowSql).toMatch(
      /grant execute on function public\.record_estimate_review_correction_action\([\s\S]*to authenticated;/
    );
    expect(workflowSql).toContain(
      'drop policy if exists "Users can update generated ouvrage work snapshots"'
    );
    expect(workflowSql).toContain(
      'drop policy if exists "Users can delete generated ouvrage work snapshots"'
    );
  });

  it("limits assemblies, purchase orders, their lines and devis storage writes", () => {
    expect(procurementSql).toMatch(
      /create policy "Tenant writers can insert estimate assemblies"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
    expect(procurementSql).toMatch(
      /create policy "Users can insert own purchase orders"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
    expect(procurementSql).toMatch(
      /create policy "Authorized users can insert purchase order devis"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
    expect(procurementSql).toMatch(
      /create policy "Authorized users can upload purchase order devis"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role/
    );
  });

  it("restricts estimate status transitions to writer roles (admin/engineer)", () => {
    expect(serverSource).toMatch(
      /export async function patchEstimateStatus\([\s\S]*?assertCanWriteEstimateWorkflows\(context\.tenantRole\)[\s\S]*?getVersionAccessOrThrow/
    );
  });

  it("forces email through the transactional outbox and immutable PDF boundary", () => {
    const activeDispatchIndex = emailSource.indexOf(
      "findActiveEstimateEmailDispatch({"
    );
    const reserveIndex = emailSource.indexOf("reserveEstimateEmailDispatch({");
    const preparePdfIndex = emailSource.indexOf("preparePdfForDispatch({");

    expect(activeDispatchIndex).toBeGreaterThan(-1);
    expect(reserveIndex).toBeGreaterThan(activeDispatchIndex);
    expect(preparePdfIndex).toBeGreaterThan(reserveIndex);
    expect(emailSource).toContain("getEstimateSendGating(input.versionId)");
    expect(emailSource).toContain("verifyEstimateSeal(input.versionId)");
    expect(emailSource).toContain(
      'if (!["draft", "sending"].includes(input.versionStatus))'
    );
    expect(emailSource).toContain("getEstimatePdfStatus(input.versionId)");
    expect(emailSource).toContain("generateEstimatePdfNow(input.versionId, {");
    expect(emailSource).not.toContain("patchEstimateStatus(");

    expect(emailOutboxSql).toMatch(
      /create or replace function public\.reserve_estimate_email_dispatch\([\s\S]*set status = 'sending'::public\.estimate_status/
    );
    expect(emailOutboxSql).toMatch(
      /create or replace function public\.complete_estimate_email_dispatch\([\s\S]*set status = 'sent'::public\.estimate_status/
    );
    expect(emailOutboxSql).toMatch(
      /revoke execute on function public\.complete_estimate_email_dispatch\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.complete_estimate_email_dispatch\([\s\S]*to service_role;/
    );
  });

  it("fails closed for unavailable hard rules and neutralizes CSV formulas", () => {
    expect(gatingSource).toMatch(
      /blockingUnavailableSignals[\s\S]*signal\.action !== "warn"[\s\S]*blockingFlags\.push/
    );
    expect(csvSource).toMatch(/\^\[\\t\\r\\n \]\*\[=\+\\-@\]/);
  });
});
