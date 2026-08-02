import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260802001942_estimate_lock_page_leases.sql"
  ),
  "utf8"
);

describe("estimate draft lock page lease migration", () => {
  it("backfills and requires a page session identity", () => {
    expect(migrationSql).toMatch(
      /add column if not exists session_id uuid/i
    );
    expect(migrationSql).toMatch(
      /set session_id = gen_random_uuid\(\)\s+where session_id is null/i
    );
    expect(migrationSql).toMatch(
      /alter column session_id set not null/i
    );
    expect(migrationSql).not.toMatch(
      /alter column session_id set default/i
    );
  });

  it("keeps the page session immutable with the lock identity", () => {
    expect(migrationSql).toMatch(
      /old\.session_id is distinct from new\.session_id/i
    );
    expect(migrationSql).toMatch(/DRAFT_LOCK_IDENTITY_IMMUTABLE/i);
  });

  it("does not expose the security-definer trigger function", () => {
    expect(migrationSql).toMatch(
      /security definer\s+set search_path = ''/i
    );
    expect(migrationSql).toMatch(
      /revoke all on function public\.assign_draft_lock_tenant_id\(\) from authenticated/i
    );
  });
});
