import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("EST-433 duplicate version provenance regressions", () => {
  const migrationSql = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "supabase/migrations/20260310113000_est433_duplicate_version_source_metadata_fix.sql"
    ),
    "utf8"
  );

  it("adds source metadata to estimate items when older databases are missing the column", () => {
    expect(migrationSql).toMatch(
      /alter table if exists public\.estimate_items[\s\S]*add column if not exists source_metadata jsonb not null default '\{\}'::jsonb;/
    );
  });

  it("keeps duplicate_estimate_version aligned with explanation provenance fields", () => {
    expect(migrationSql).toMatch(
      /create or replace function public\.duplicate_estimate_version\(/
    );
    expect(migrationSql).toMatch(/source_version_id uuid/);
    expect(migrationSql).toMatch(
      /insert into public\.estimate_items \([\s\S]*source_provider[\s\S]*source_job_id[\s\S]*source_file_name[\s\S]*source_page[\s\S]*source_metadata[\s\S]*line_total_ht_cents/
    );
    expect(migrationSql).toMatch(
      /select[\s\S]*src\.source_provider,[\s\S]*src\.source_job_id,[\s\S]*src\.source_file_name,[\s\S]*src\.source_page,[\s\S]*coalesce\(src\.source_metadata, '\{\}'::jsonb\)/
    );
    expect(migrationSql).toMatch(
      /where src\.version_id = duplicate_estimate_version\.source_version_id/
    );
  });

  it("preserves the existing takeoff carry-over inserts while copying richer line provenance", () => {
    expect(migrationSql).toMatch(
      /insert into public\.takeoff_version_links \([\s\S]*target_version_id[\s\S]*new_version_id/
    );
    expect(migrationSql).toMatch(
      /insert into public\.takeoff_dpgf_review_decisions \([\s\S]*carried_over_from_version_id[\s\S]*carried_over_at/
    );
  });
});
