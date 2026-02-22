import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSql(filePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("EST-201 PDF RLS regressions", () => {
  const migrationSql = readSql(
    "supabase/migrations/20260222121000_est201_pdf_policy_hardening.sql"
  );

  it("scopes estimate_documents writes to project owner or tenant admin", () => {
    expect(migrationSql).toMatch(/create policy "Users can update estimate documents"/);
    expect(migrationSql).toMatch(/join public\.estimate_projects p on p\.id = v\.project_id/);
    expect(migrationSql).toMatch(/p\.user_id = \(select auth\.uid\(\)\)/);
    expect(migrationSql).toMatch(
      /public\.has_tenant_role\(v\.tenant_id, array\['admin'::public\.tenant_role\]\)/
    );
  });

  it("requires storage object path to match tenant\/project\/version ownership", () => {
    expect(migrationSql).toMatch(/create policy "Tenant users can update estimate documents storage"/);
    expect(migrationSql).toMatch(
      /v\.tenant_id::text = coalesce\(\(storage\.foldername\(name\)\)\[1\], ''\)/
    );
    expect(migrationSql).toMatch(
      /p\.id::text = coalesce\(\(storage\.foldername\(name\)\)\[2\], ''\)/
    );
    expect(migrationSql).toMatch(/storage\.filename\(name\) = \(v\.id::text \|\| '\.pdf'\)/);
    expect(migrationSql).toMatch(/p\.user_id = \(select auth\.uid\(\)\)/);
  });
});
