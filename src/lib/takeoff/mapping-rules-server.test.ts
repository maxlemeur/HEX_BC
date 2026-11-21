import { describe, expect, it } from "vitest";

import { createSupabaseFake, POSTGREST_MAX_ROWS, servedRows } from "@/lib/takeoff/metre-m3.test-utils";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";

// Lot 2 M2, closing round (point 5): the active mapping rules a send's preview applies are read in full. Written before
// the fix: red on 9ed38ced (one response, cut at PostgREST's ceiling: the rules past it were never applied, while the
// send's stamp of the rules covers them all). Fictional rows only.
const TENANT = "10000000-0000-4000-8000-000000000001";

function rule(index: number) {
  return { id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`, tenant_id: TENANT,
    created_at: "2026-11-21T00:00:00Z", updated_at: "2026-11-21T00:00:00Z", created_by: null, name: `Règle fictive ${index}`,
    match_pattern: `Article ${index}`, match_type: "exact", action: "rename", action_params: { designation: `Article renommé ${index}` },
    priority: 1, is_active: true };
}

describe("listActiveTakeoffMappingRules", () => {
  it("reads the rules past the ceiling of one response", async () => {
    const rules = Array.from({ length: POSTGREST_MAX_ROWS + 1 }, (_, index) => rule(index + 1));
    const fake = createSupabaseFake({ tables: { takeoff_mapping_rules: (query) => servedRows(rules, query) } });

    const read = await listActiveTakeoffMappingRules({ supabase: fake.client as never, tenantId: TENANT });

    expect(read.map((entry) => entry.id)).toEqual(rules.map((entry) => entry.id));
  });
});
