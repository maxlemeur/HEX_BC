import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const originalMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260719132414_estimate_reference_numbering.sql"
  ),
  "utf8"
).toLowerCase();
const ambiguityFixMigrationSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260727040000_fix_estimate_reference_year_ambiguity.sql"
  ),
  "utf8"
).toLowerCase();

describe("estimate reference migration", () => {
  it("reserves one annual sequence atomically per tenant", () => {
    expect(originalMigrationSql).toContain(
      "primary key (tenant_id, reference_year)"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "on conflict on constraint estimate_reference_counters_pkey"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "last_value = counter.last_value + 1"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "where counter.last_value < 999"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "returning counter.last_value into sequence_value"
    );
  });

  it("keeps the counter private and the trigger function hardened", () => {
    expect(originalMigrationSql).toContain(
      "alter table private.estimate_reference_counters enable row level security"
    );
    expect(ambiguityFixMigrationSql).toContain("security definer");
    expect(ambiguityFixMigrationSql).toContain("set search_path = ''");
    expect(ambiguityFixMigrationSql).toContain(
      "revoke execute on function private.assign_estimate_project_reference()"
    );
    expect(originalMigrationSql).toContain(
      "create trigger zz_assign_estimate_project_reference"
    );
    expect(originalMigrationSql).toContain(
      "execute function private.assign_estimate_project_reference()"
    );
  });

  it("stores only the stable base reference on the estimate project", () => {
    expect(originalMigrationSql).toContain("'^hex_d[0-9]{5}[a-z]{2}$'");
    expect(ambiguityFixMigrationSql).toContain("'hex_d'");
    expect(ambiguityFixMigrationSql).not.toContain("'_v1'");
    expect(ambiguityFixMigrationSql).toContain(
      "lpad(mod(current_reference_year, 100)::text, 2, '0')"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "lpad(sequence_value::text, 3, '0')"
    );
    expect(ambiguityFixMigrationSql).toContain("author_initials");
  });

  it("removes the PL/pgSQL reference_year ambiguity without rewriting history", () => {
    expect(originalMigrationSql).toContain(
      "reference_year integer := extract(year from current_date)::integer"
    );
    expect(originalMigrationSql).toContain(
      "on conflict (tenant_id, reference_year)"
    );

    expect(ambiguityFixMigrationSql).toContain(
      "current_reference_year integer := extract(year from current_date)::integer"
    );
    expect(ambiguityFixMigrationSql).not.toMatch(
      /\breference_year integer :=/
    );
    expect(ambiguityFixMigrationSql).not.toContain(
      "on conflict (tenant_id, reference_year)"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "new.tenant_id,\n    current_reference_year,\n    1"
    );
  });

  it("preserves authentication and tenant-membership checks", () => {
    expect(ambiguityFixMigrationSql).toContain(
      "current_user_id uuid := (select auth.uid())"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "current_user_id <> new.user_id"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "from public.tenant_memberships membership"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "membership.tenant_id = new.tenant_id"
    );
    expect(ambiguityFixMigrationSql).toContain(
      "membership.user_id = current_user_id"
    );
  });
});
