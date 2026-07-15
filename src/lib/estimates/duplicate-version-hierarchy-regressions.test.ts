import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260715210520_fix_duplicate_estimate_hierarchy_order.sql"
  ),
  "utf8"
);

describe("duplicate estimate hierarchy regression", () => {
  it("duplicates parents before their descendants", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.duplicate_estimate_version\(/
    );
    expect(migrationSql).toMatch(
      /with recursive source_item_hierarchy as \([\s\S]*root\.parent_id is null[\s\S]*join source_item_hierarchy parent on parent\.id = child\.parent_id/
    );
    expect(migrationSql).toMatch(
      /from source_item_hierarchy hierarchy[\s\S]*order by hierarchy\.depth asc, src\.position asc, src\.id asc;/
    );
  });

  it("preserves source provenance and takeoff review carry-over", () => {
    expect(migrationSql).toMatch(
      /parent_version_id,[\s\S]*variant_label,[\s\S]*max_section_depth[\s\S]*source_version\.max_section_depth/
    );
    expect(migrationSql).toMatch(
      /source_provider,[\s\S]*source_job_id,[\s\S]*source_file_name,[\s\S]*source_page,[\s\S]*source_metadata/
    );
    expect(migrationSql).toMatch(
      /insert into public\.takeoff_version_links[\s\S]*insert into public\.takeoff_dpgf_review_decisions/
    );
  });
});
