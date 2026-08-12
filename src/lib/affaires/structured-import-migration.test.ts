import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260802175032_structured_dpgf_import_hierarchy.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const permissionMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260808204122_revoke_structured_dpgf_import_anon_execute.sql",
);
const permissionMigration = readFileSync(permissionMigrationPath, "utf8");
const governanceMigrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260812032857_govern_estimate_calc_engine_v2.sql",
);
const governanceMigration = readFileSync(governanceMigrationPath, "utf8");

describe("structured DPGF import migration", () => {
  it("keeps the existing RPC signature and defaults legacy entries to lines", () => {
    expect(migration).toMatch(
      /create or replace function public\.create_estimate_version_from_import_lines\([\s\S]*p_lines jsonb[\s\S]*\)/,
    );
    expect(migration).toContain("if v_item_type is null then");
    expect(migration).toContain("v_item_type := 'line';");
  });

  it("parents source levels below the import root and lines below the deepest section", () => {
    expect(migration).toContain("v_parent_id := v_root_section_id;");
    expect(migration).toContain("v_parent_id := v_level_one_section_id;");
    expect(migration).toMatch(
      /v_parent_id := coalesce\([\s\S]*v_level_two_section_id,[\s\S]*v_level_one_section_id,[\s\S]*v_root_section_id[\s\S]*\);/,
    );
    expect(migration).toContain(
      "A level 2 section requires a preceding level 1 section",
    );
  });

  it("counts and totals only lines while persisting DPGF provenance", () => {
    expect(migration).toContain("v_inserted_count := v_inserted_count + 1;");
    expect(migration).toContain("and i.item_type = 'line';");
    expect(migration).toContain("'dpgf'");
    expect(migration).toContain("v_import.filename");
    expect(migration).toContain("source_metadata");
    expect(migration).toContain("source_page");
  });

  it("retires the historical authenticated RPC grant behind the canonical facade", () => {
    expect(permissionMigration).toMatch(
      /revoke execute on function public\.create_estimate_version_from_import_lines\(\s*uuid,\s*uuid,\s*text,\s*text,\s*jsonb\s*\) from public, anon;/,
    );
    expect(permissionMigration).toMatch(
      /grant execute on function public\.create_estimate_version_from_import_lines\(\s*uuid,\s*uuid,\s*text,\s*text,\s*jsonb\s*\) to authenticated;/,
    );
    expect(governanceMigration).toMatch(
      /revoke all on function public\.create_estimate_version_from_import_lines\(\s*uuid,\s*uuid,\s*text,\s*text,\s*jsonb\s*\) from public, anon, authenticated;/,
    );
    expect(governanceMigration).toMatch(
      /revoke all on function public\.persist_estimate_creation_atomic\(\s*uuid,\s*uuid,\s*uuid,\s*jsonb,\s*jsonb,\s*jsonb,\s*uuid\s*\) from public, anon, authenticated;/,
    );
    expect(governanceMigration).toMatch(
      /grant execute on function public\.persist_estimate_creation_atomic\(\s*uuid,\s*uuid,\s*uuid,\s*jsonb,\s*jsonb,\s*jsonb,\s*uuid\s*\) to service_role;/,
    );
  });
});
