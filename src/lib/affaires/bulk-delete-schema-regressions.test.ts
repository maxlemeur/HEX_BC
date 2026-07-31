import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730143415_secure_bulk_delete_draft_affaires.sql"
  ),
  "utf8"
);

describe("secure bulk affaire deletion schema", () => {
  it("keeps authorization, tenant scope, draft validation, and row locking in SQL", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "array['admin'::public.tenant_role, 'engineer'::public.tenant_role]"
    );
    expect(migration).toContain("p.tenant_id = p_tenant_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("v.status <> 'draft'");
    expect(migration).toContain("p.id = locked_project_id");
  });

  it("limits batches and exposes per-affaire partial outcomes", () => {
    expect(migration).toContain("cardinality(p_project_ids) > 100");
    expect(migration).toContain("outcome := 'deleted'");
    expect(migration).toContain("outcome := 'not_found'");
    expect(migration).toContain("outcome := 'not_eligible'");
    expect(migration).toContain("outcome := 'failed'");
  });
});
