import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260713135408_harden_portal_pdf_capabilities.sql"
  ),
  "utf8"
);

describe("portal and PDF database security regressions", () => {
  it("derives portal tenant scope from an existing parent version and fails closed", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.assign_portal_tokens_tenant_id\(\)/
    );
    expect(migrationSql).toMatch(/security definer/);
    expect(migrationSql).toMatch(/where ev\.id = new\.version_id/);
    expect(migrationSql).toMatch(/errcode = '23503'/);
    expect(migrationSql).toMatch(/new\.tenant_id := parent_tenant_id/);
    expect(migrationSql).toMatch(/message = 'portal capability parent is immutable'/);
    expect(migrationSql).toMatch(
      /new\.version_id is distinct from old\.version_id/
    );
  });

  it("limits the atomic portal decision command to service role and one sent version", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.claim_portal_estimate_decision/
    );
    expect(migrationSql).toMatch(/security invoker/);
    expect(migrationSql).toMatch(/current_user <> 'service_role'/);
    expect(migrationSql).toMatch(/for update/);
    expect(migrationSql).toMatch(/version_status <> 'sent'/);
    expect(migrationSql).toMatch(/and status = 'sent'/);
    expect(migrationSql).toMatch(/set status = 'expired'/);
    expect(migrationSql).toMatch(/perform public\.log_estimate_version_event/);
    expect(migrationSql).not.toMatch(/p_has_signature/);
    expect(migrationSql).not.toMatch(/'has_signature'/);
    expect(migrationSql).toMatch(/to service_role/);
    expect(migrationSql).toMatch(/from public, anon, authenticated/);
  });

  it("canonicalizes PDF metadata from the tenant, project, and version parent", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.enforce_estimate_document_canonical_path/
    );
    expect(migrationSql).toMatch(/new\.tenant_id := parent_tenant_id/);
    expect(migrationSql).toMatch(/parent_project_id::text/);
    expect(migrationSql).toMatch(/new\.version_id::text/);
    expect(migrationSql).toMatch(/'\.pdf'/);
    expect(migrationSql).toMatch(
      /drop trigger if exists set_estimate_documents_tenant_id/
    );
    expect(migrationSql).toMatch(
      /before insert or update on public\.estimate_documents/
    );
  });
});
