import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260708120000_harden_devis_storage_policies.sql"
  ),
  "utf8"
);

describe("devis storage policy regressions", () => {
  it("drops the bucket-wide authenticated devis storage policies", () => {
    expect(migrationSql).toMatch(
      /drop policy if exists "Authenticated users can upload devis" on storage\.objects;/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Authenticated users can view devis" on storage\.objects;/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Authenticated users can update devis" on storage\.objects;/
    );
    expect(migrationSql).toMatch(
      /drop policy if exists "Authenticated users can delete devis" on storage\.objects;/
    );
  });

  it("limits authenticated storage access to purchase-order devis paths", () => {
    expect(migrationSql).toMatch(
      /create policy "Authorized users can upload purchase order devis"/
    );
    expect(migrationSql).toMatch(
      /create policy "Authorized users can view purchase order devis"/
    );
    expect(migrationSql).toMatch(
      /create policy "Authorized users can delete purchase order devis"/
    );
    expect(migrationSql).toMatch(
      /coalesce\(\(storage\.foldername\(objects\.name\)\)\[1\], ''\) = 'purchase-orders'/
    );
    expect(migrationSql).toMatch(
      /po\.id::text = coalesce\(\(storage\.foldername\(objects\.name\)\)\[2\], ''\)/
    );
    expect(migrationSql).toMatch(/pod\.storage_path = objects\.name/);
    expect(migrationSql).toMatch(/select public\.is_tenant_member\(po\.tenant_id\)/);
    expect(migrationSql).toMatch(
      /select public\.has_tenant_role\(po\.tenant_id, array\['admin'::public\.tenant_role\]\)/
    );
  });

  it("does not recreate authenticated update access to devis storage", () => {
    expect(migrationSql).not.toMatch(
      /create policy "[^"]+"[\s\S]*?for update[\s\S]*?to authenticated/
    );
  });
});
