import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260718033950_scale_estimate_assembly_library.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("estimate assembly library schema regressions", () => {
  it("indexes server search across headers and components", () => {
    expect(sql).toMatch(/estimate_assemblies_tenant_search_trgm_idx/i);
    expect(sql).toMatch(/estimate_assembly_items_title_search_trgm_idx/i);
    expect(sql).toMatch(/coalesce\(a\.reference_code, ''\)/i);
    expect(sql).toMatch(/search_item\.title/i);
  });

  it("paginates with a deterministic id tie breaker and total count", () => {
    expect(sql).toMatch(/count\(\*\) over \(\)::bigint as total_count/i);
    expect(sql).toMatch(/offset \(greatest\(p_page, 1\) - 1\)/i);
    expect(sql).toMatch(/limit least\(greatest\(p_size, 1\), 100\)/i);
    expect(sql).toMatch(/p\.id asc;/i);
  });

  it("returns explicit comparable costs and duplicate signals", () => {
    expect(sql).toMatch(/material_cost_cents bigint/i);
    expect(sql).toMatch(/labor_cost_cents bigint/i);
    expect(sql).toMatch(/pose_only_cents bigint/i);
    expect(sql).toMatch(/stored_ds_delta_cents bigint/i);
    expect(sql).toMatch(/near_duplicate_count bigint/i);
    expect(sql).toMatch(/estimate_assembly_dedupe_key/i);
  });

  it("keeps preferences user-scoped and tenant-scoped under RLS", () => {
    expect(sql).toMatch(
      /alter table public\.user_estimate_assembly_preferences enable row level security/i
    );
    expect(sql).toMatch(/user_id = \(select auth\.uid\(\)\)/i);
    expect(sql).toMatch(/public\.is_tenant_member\(tenant_id\)/i);
    expect(sql).toMatch(/for update[\s\S]*using \([\s\S]*with check \(/i);
  });

  it("uses invoker functions and explicit Data API grants", () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(
      /grant select, insert, update, delete[\s\S]*to authenticated/i
    );
    expect(sql).toMatch(
      /revoke execute on function public\.estimate_assemblies_page[\s\S]*from public, anon/i
    );
  });
});
