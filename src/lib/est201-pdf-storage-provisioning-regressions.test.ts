import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260718155244_restore_estimate_documents_storage.sql"
  ),
  "utf8"
);

describe("EST-201 PDF storage provisioning regressions", () => {
  it("restores a private PDF-only bucket with the expected size limit", () => {
    expect(migrationSql).toMatch(/insert into storage\.buckets/);
    expect(migrationSql).toMatch(/'estimate-documents'/);
    expect(migrationSql).toMatch(/false,\s*20971520,\s*array\['application\/pdf'\]/);
    expect(migrationSql).toMatch(/on conflict \(id\) do update/);
  });

  it("preserves all policies required by PDF upserts and cleanup", () => {
    expect(migrationSql).toMatch(
      /create policy "Tenant users can view estimate documents storage"[\s\S]*for select/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant users can insert estimate documents storage"[\s\S]*for insert/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant users can update estimate documents storage"[\s\S]*for update[\s\S]*with check/
    );
    expect(migrationSql).toMatch(
      /create policy "Tenant admins can delete estimate documents storage"[\s\S]*for delete/
    );
  });

  it("binds every object to the canonical tenant, project, and version path", () => {
    expect(migrationSql).toMatch(
      /v\.tenant_id::text = coalesce\(\(storage\.foldername\(storage\.objects\.name\)\)\[1\], ''\)/
    );
    expect(migrationSql).toMatch(
      /p\.id::text = coalesce\(\(storage\.foldername\(storage\.objects\.name\)\)\[2\], ''\)/
    );
    expect(migrationSql).toMatch(
      /storage\.filename\(storage\.objects\.name\) = \(v\.id::text \|\| '\.pdf'\)/
    );
    expect(migrationSql).toMatch(/p\.tenant_id = v\.tenant_id/);
  });
});
