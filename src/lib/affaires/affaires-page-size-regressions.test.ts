import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260801153601_expand_affaires_page_to_1000.sql",
  ),
  "utf8",
);

describe("1,000-affaire page schema", () => {
  it("raises only the page look-ahead limit and preserves keyset security", () => {
    expect(migration).toContain(
      "v_limit integer := greatest(1, least(coalesce(p_limit, 20), 1001));",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "p_tenant_id is distinct from public.current_tenant_id()",
    );
    expect(migration).toContain("p_cursor_project_id");
    expect(migration).toContain("limit v_limit");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
  });
});
