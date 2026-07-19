import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260719132414_estimate_reference_numbering.sql"
  ),
  "utf8"
).toLowerCase();

describe("estimate reference migration", () => {
  it("reserves one annual sequence atomically per tenant", () => {
    expect(migrationSql).toContain(
      "primary key (tenant_id, reference_year)"
    );
    expect(migrationSql).toContain(
      "on conflict (tenant_id, reference_year)"
    );
    expect(migrationSql).toContain(
      "last_value = counter.last_value + 1"
    );
  });

  it("keeps the counter private and the trigger function hardened", () => {
    expect(migrationSql).toContain(
      "alter table private.estimate_reference_counters enable row level security"
    );
    expect(migrationSql).toContain("security definer");
    expect(migrationSql).toContain("set search_path = ''");
    expect(migrationSql).toContain(
      "revoke execute on function private.assign_estimate_project_reference()"
    );
  });

  it("stores only the stable base reference on the estimate project", () => {
    expect(migrationSql).toContain("'^hex_d[0-9]{5}[a-z]{2}$'");
    expect(migrationSql).toContain("'hex_d'");
    expect(migrationSql).not.toContain("'_v1'");
  });
});
