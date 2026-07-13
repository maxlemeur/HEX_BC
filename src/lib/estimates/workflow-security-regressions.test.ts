import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql"
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");

describe("estimate workflow security migration", () => {
  it("blocks authenticated callers from choosing status, seal, or content revision", () => {
    expect(migrationSql).toMatch(
      /new\.status is distinct from old\.status[\s\S]*new\.seal_hash is distinct from old\.seal_hash[\s\S]*current_user <> 'service_role'/
    );
    expect(migrationSql).toContain(
      "message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW'"
    );
    expect(migrationSql).toContain(
      "message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED'"
    );
  });

  it("moves the status change and trusted event into one service-role command", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.transition_estimate_version_status\([\s\S]*update public\.estimate_versions[\s\S]*perform public\.log_estimate_version_event/
    );
    expect(migrationSql).toMatch(
      /revoke execute on function public\.transition_estimate_version_status\([\s\S]*from public, anon, authenticated;/
    );
    expect(migrationSql).toMatch(
      /grant execute on function public\.transition_estimate_version_status\([\s\S]*to service_role;/
    );
    expect(migrationSql).toContain("message = 'ESTIMATE_VERSION_CONFLICT'");
  });

  it("advances revisions for every material version and item mutation", () => {
    expect(migrationSql).toContain(
      "new.content_revision := old.content_revision + 1;"
    );
    expect(migrationSql).toMatch(
      /create trigger bump_estimate_content_revision_from_item[\s\S]*after insert or update or delete on public\.estimate_items/
    );
    expect(migrationSql).toContain(
      "set content_revision = version.content_revision + 1"
    );
    expect(migrationSql).toContain(
      "else array[old.version_id, new.version_id]"
    );
    expect(migrationSql).toContain(
      "order by candidate.version_id"
    );
  });

  it("captures, locks, and compares the reviewed revision before approving", () => {
    expect(migrationSql).toContain(
      "new.requested_content_revision := current_content_revision;"
    );
    expect(migrationSql).toMatch(
      /select version\.content_revision[\s\S]*for update;[\s\S]*current_content_revision <> cycle_row\.requested_content_revision[\s\S]*message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE'/
    );
    expect(migrationSql).toContain(
      "approved_content_revision = case"
    );
  });

  it("removes direct approval updates and exposes only role-checked decision commands", () => {
    expect(migrationSql).toMatch(
      /drop policy if exists "Tenant approvers can decide estimate approvals"[\s\S]*on public\.estimate_approvals;/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.decide_estimate_review_cycle\([\s\S]*security definer[\s\S]*public\.has_tenant_role\([\s\S]*'director'/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.decide_estimate_approval\([\s\S]*security definer[\s\S]*public\.has_tenant_role\([\s\S]*'director'/
    );
  });

  it("restricts approval creation and commits the decision event in the cycle RPC", () => {
    expect(migrationSql).toMatch(
      /create policy "Tenant writers can create estimate approvals"[\s\S]*'admin'::public\.tenant_role, 'engineer'::public\.tenant_role[\s\S]*version\.status = 'draft'/
    );
    expect(migrationSql).toMatch(
      /create or replace function public\.decide_estimate_review_cycle\([\s\S]*perform public\.log_estimate_version_event\([\s\S]*'approval_decided'[\s\S]*return next;/
    );
  });

  it("commits legacy approval and audit without requiring a review cycle", () => {
    const legacyRpc = migrationSql.slice(
      migrationSql.indexOf(
        "create or replace function public.decide_estimate_approval("
      ),
      migrationSql.indexOf(
        "revoke execute on function public.decide_estimate_approval("
      )
    );

    expect(legacyRpc).toMatch(
      /update public\.estimate_approvals[\s\S]*update public\.estimate_review_cycles[\s\S]*perform public\.log_estimate_version_event\([\s\S]*'approval_decided'[\s\S]*return decided_approval;/
    );
    expect(legacyRpc).toMatch(
      /if cycle_row\.id is not null[\s\S]*requested_content_revision is null[\s\S]*message = 'ESTIMATE_REVIEW_SNAPSHOT_STALE'/
    );
    expect(legacyRpc).toMatch(
      /if cycle_row\.id is not null and remaining_pending_count = 0 then[\s\S]*update public\.estimate_review_cycles/
    );
    expect(legacyRpc).not.toContain("ESTIMATE_REVIEW_CYCLE_NOT_FOUND");
    expect(legacyRpc).not.toMatch(/exception\s+when/i);
    expect(migrationSql).toMatch(
      /grant execute on function public\.decide_estimate_approval\([\s\S]*to authenticated;/
    );
  });
});
