import { expect, it } from "vitest";

import { readCockpitDecisionFingerprint } from "@/lib/cockpit/decision-freshness";

function fixture() {
  const rows: Record<string, Array<{ id: string; updated_at: string }>> = {
    estimate_projects: [{ id: "project-a", updated_at: "2026-10-29T10:00:00Z" }],
    tenant_memberships: [{ id: "membership-a", updated_at: "2026-10-29T10:00:00Z" }],
    affaire_intake_documents: [{ id: "document-a", updated_at: "2026-10-29T10:00:00Z" }],
  };
  const signals: AbortSignal[] = [];
  const filters: Array<{ table: string; key: string; value: string }> = [];
  const supabase = { from(table: string) {
    const builder = {
      select() { return builder; },
      eq(key: string, value: string) { filters.push({ table, key, value }); return builder; },
      abortSignal(signal: AbortSignal) { signals.push(signal); return builder; },
      order() { return builder; },
      async range() { const data = structuredClone(rows[table] ?? []); return { data, count: data.length, error: null }; },
    };
    return builder;
  } };
  return { rows, signals, filters, context: { supabase, tenantId: "tenant-a", userId: "owner-a" } };
}

it("reads fresh tenant-scoped stamps and detects document changes despite cached page data", async () => {
  const { rows, context, signals, filters } = fixture();
  const before = await readCockpitDecisionFingerprint(context as never, "project-a");
  rows.affaire_intake_documents[0].updated_at = "2026-10-29T10:00:01Z";
  const after = await readCockpitDecisionFingerprint(context as never, "project-a");
  expect(before).toMatch(/^[a-f0-9]{64}$/);
  expect(after).not.toBe(before);
  expect(new Set(signals).size).toBe(signals.length);
  expect(filters.filter((filter) => filter.key === "tenant_id").every((filter) => filter.value === "tenant-a")).toBe(true);
  expect(filters).toContainEqual({ table: "cockpit_command_preferences", key: "user_id", value: "owner-a" });
});

it("cannot validate advice after project access or membership disappears", async () => {
  const { rows, context } = fixture();
  rows.tenant_memberships = [];
  expect(await readCockpitDecisionFingerprint(context as never, "project-a")).toBeNull();
});
