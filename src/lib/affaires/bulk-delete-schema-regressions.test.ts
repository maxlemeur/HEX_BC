import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260730143415_secure_bulk_delete_draft_affaires.sql",
  ),
  "utf8",
);
const controlledActionsMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260801153247_support_archive_and_controlled_draft_deletion.sql",
  ),
  "utf8",
);const triggerPrivilegeMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260801153600_revoke_controlled_delete_trigger_execute.sql",
  ),
  "utf8",
);

describe("secure bulk affaire deletion schema", () => {
  it("keeps authorization, tenant scope, draft validation, and row locking in SQL", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain(
      "array['admin'::public.tenant_role, 'engineer'::public.tenant_role]"
    );
    expect(migration).toContain("p.tenant_id = p_tenant_id");
    expect(migration).toContain("for update");
    expect(migration).toContain("v.status <> 'draft'");
    expect(migration).toContain("p.id = locked_project_id");
  });

  it("limits batches and exposes per-affaire partial outcomes", () => {
    expect(migration).toContain("cardinality(p_project_ids) > 100");
    expect(migration).toContain("outcome := 'deleted'");
    expect(migration).toContain("outcome := 'not_found'");
    expect(migration).toContain("outcome := 'not_eligible'");
    expect(migration).toContain("outcome := 'failed'");
  });

  it("keeps immutable journals protected outside the controlled cascade", () => {
    expect(controlledActionsMigration).toContain(
      "current_setting('app.bulk_delete_draft_affaires', true) = 'on'",
    );
    expect(controlledActionsMigration).toContain("pg_trigger_depth() > 1");
    expect(controlledActionsMigration).toContain(
      "raise exception using message = 'AFFAIRE_INTAKE_EVENTS_IMMUTABLE'",
    );
    expect(controlledActionsMigration).toContain(
      "raise exception using message = 'AFFAIRE_REGISTER_EVENTS_IMMUTABLE'",
    );
    expect(controlledActionsMigration).toContain(
      "set_config('app.bulk_delete_draft_affaires', 'on', true)",
    );
    expect(controlledActionsMigration).toContain(
      "set_config('app.bulk_delete_draft_affaires', 'off', true)",
    );
  });

  it("adds a tenant-scoped draft-only archive path that preserves project history", () => {
    expect(controlledActionsMigration).toContain(
      "function public.bulk_archive_draft_affaires",
    );
    expect(controlledActionsMigration).toContain("security invoker");
    expect(controlledActionsMigration).toContain("p.tenant_id = p_tenant_id");
    expect(controlledActionsMigration).toContain("for update");
    expect(controlledActionsMigration).toContain("v.status <> 'draft'");
    expect(controlledActionsMigration).toContain("set is_archived = true");
    expect(controlledActionsMigration).toContain("outcome := 'archived'");
    expect(controlledActionsMigration).toContain(
      "grant execute on function public.bulk_archive_draft_affaires(uuid, uuid[]) to authenticated",
    );
  });
  it("keeps internal trigger functions unavailable to Data API roles", () => {
    expect(triggerPrivilegeMigration).toContain(
      "revoke execute on function public.prevent_affaire_intake_event_mutation()",
    );
    expect(triggerPrivilegeMigration).toContain(
      "revoke execute on function public.prevent_affaire_register_event_mutation()",
    );
    expect(triggerPrivilegeMigration).toContain(
      "from public, anon, authenticated, service_role",
    );
  });});
