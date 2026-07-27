import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260727112139_revoke_trigger_function_api_execute.sql"
  ),
  "utf8"
);

const internalTriggerFunctions = [
  "public.assign_portal_tokens_tenant_id()",
  "public.enforce_estimate_document_canonical_path()",
  "public.enforce_plan_set_resource_budget()",
  "public.enforce_takeoff_apply_security()",
  "public.enforce_takeoff_item_mutation_before_apply()",
];

describe("trigger function execute privilege regressions", () => {
  it("removes every API role from internal trigger functions", () => {
    for (const signature of internalTriggerFunctions) {
      expect(migrationSql).toContain(
        `revoke execute on function ${signature}\n` +
          "  from public, anon, authenticated, service_role;"
      );
    }
  });

  it("preserves trigger bindings and callable business RPCs", () => {
    expect(migrationSql).not.toMatch(/\bdrop\s+(?:function|trigger)\b/i);
    expect(migrationSql).not.toContain(
      "public.acquire_estimate_ai_generation_lease"
    );
    expect(migrationSql).not.toContain("public.decide_estimate_review_cycle");
    expect(migrationSql).not.toContain("public.can_view_profile");
  });
});
