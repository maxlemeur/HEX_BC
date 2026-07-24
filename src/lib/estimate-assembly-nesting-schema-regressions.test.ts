import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260722132425_nested_estimate_assemblies.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("nested estimate assembly schema regressions", () => {
  it("stores live child references under tenant-scoped RLS", () => {
    expect(sql).toMatch(/create table public\.estimate_assembly_members/i);
    expect(sql).toMatch(
      /child_assembly_id uuid not null[\s\S]*on delete restrict/i
    );
    expect(sql).toMatch(
      /alter table public\.estimate_assembly_members enable row level security/i
    );
    expect(sql).toMatch(/public\.is_tenant_member\(tenant_id\)/i);
  });

  it("blocks cycles and graph paths deeper than two nested levels", () => {
    expect(sql).toMatch(/composition would create a cycle/i);
    expect(sql).toMatch(/ancestor_depth \+ 1 \+ descendant_depth > 2/i);
    expect(sql).toMatch(/not member\.child_assembly_id = any\(descendants\.path\)/i);
  });

  it("rolls child costs and labor up with their quantities", () => {
    expect(sql).toMatch(/round\(member\.quantity \* child\.ds_cents\)/i);
    expect(sql).toMatch(
      /member\.quantity \* coalesce\(child\.avg_time_hours, 0\)/i
    );
    expect(sql).toMatch(/propagate_estimate_assembly_rollup/i);
  });

  it("materializes a deep estimate snapshot with cascading quantities", () => {
    expect(sql).toMatch(/materialize_estimate_assembly_tree/i);
    expect(sql).toMatch(
      /default_quantity, 1\) \* p_quantity_multiplier/i
    );
    expect(sql).toMatch(/h_mo, 0\) \* p_quantity_multiplier/i);
    expect(sql).toMatch(
      /p_quantity_multiplier \* assembly_member\.quantity/i
    );
    expect(sql).toMatch(/p_depth \+ 1/i);
  });

  it("keeps all database functions invoker-scoped with explicit grants", () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(
      /revoke execute on function public\.insert_estimate_assembly_into_version[\s\S]*from public, anon/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.replace_estimate_assembly_contents[\s\S]*to authenticated/i
    );
  });
});

