import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseFake, filterValue, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { sealedMeasuringOrder } from "./item-list-seal-server";

const input = { tenantId: "tenant", projectId: "project", payerId: "payer", perPlan: true };
const none = () => ({ data: [], error: null, count: 0 });

describe("the measuring order a launch request seals", () => {
  // Lot 4: the list is answered plan by plan. Until one analysis per plan is active, a request is grouped and seals the free
  // extraction, whatever the second order's activation says: a grouped manifest never carries a list.
  it("seals the free extraction while one analysis per plan is not active, reading nothing", async () => {
    const fake = createSupabaseFake({});
    await expect(sealedMeasuringOrder(fake.client as never, { ...input, perPlan: false }))
      .resolves.toEqual({ order: { kind: "free_extraction", version: 1, list: null }, items: [] });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("seals the free extraction while the second order is not activated, reading nothing of the list", async () => {
    // Every table or function without a handler throws: the inactive path reads only the activation.
    const fake = createSupabaseFake({ rpc: { takeoff_item_list_order_is_active: () => ({ data: false, error: null }) } });
    await expect(sealedMeasuringOrder(fake.client as never, input))
      .resolves.toEqual({ order: { kind: "free_extraction", version: 1, list: null }, items: [] });
  });

  it("suspends the admission while the affaire's DPGF is to prepare", async () => {
    const fake = createSupabaseFake({
      rpc: { takeoff_item_list_order_is_active: () => ({ data: true, error: null }) },
      tables: { dpgf_imports: none, affaire_intake_documents: () => ({ data: [{ id: "doc" }], error: null }) },
    });
    await expect(sealedMeasuringOrder(fake.client as never, input)).resolves.toEqual({ blocked: "ITEM_LIST_TO_PREPARE" });
  });

  it("records the first list on the payer's behalf, then seals the stored revision it reads back", async () => {
    const revisions: Array<Record<string, unknown>> = [];
    const entries: Array<Record<string, unknown>> = [];
    const fake = createSupabaseFake({
      rpc: {
        takeoff_item_list_order_is_active: () => ({ data: true, error: null }),
        record_takeoff_list_revision: (args) => {
          const call = args as { p_actor: string; p_expected_revision: number; p_cause: string; p_entries: unknown[] };
          expect(call).toMatchObject({ p_actor: "payer", p_expected_revision: 0, p_cause: "initial" });
          revisions.push({ id: "revision-1", revision: 1, cause: "initial", sources: {}, item_count: call.p_entries.length,
            content_sha256: "a".repeat(64), created_by: "payer", created_at: "2026-11-21T00:00:00Z", tenant_id: "tenant",
            project_id: "project" });
          entries.push(...(call.p_entries as Array<Record<string, unknown>>).map((entry) => ({ ...entry, revision_id: "revision-1" })));
          return { data: [{ revision_id: "revision-1", revision: 1, content_sha256: "a".repeat(64), replayed: false }], error: null };
        },
      },
      tables: {
        dpgf_imports: none, affaire_intake_documents: none, takeoff_item_template_versions: none,
        takeoff_list_revisions: (query: FakeQuery) => servedRows(revisions, query),
        takeoff_list_revision_entries: (query: FakeQuery) => servedRows(entries.filter((entry) =>
          entry.revision_id === filterValue(query, "revision_id")), { ...query, filters: [] }),
        takeoff_list_item_sources: none,
      },
    });
    const sealed = await sealedMeasuringOrder(fake.client as never, input);
    expect(sealed).toMatchObject({ order: { kind: "item_list", version: 2,
      list: { revision_id: "revision-1", revision: 1, content_sha256: "a".repeat(64), item_count: 23 } } });
    // The items it sealed, in order, for the bounds of the admission.
    expect("items" in sealed && sealed.items.map((item) => item.id)).toEqual(entries.map((entry) => entry.item_id));
  });

  // Fix round, point 9: a revision with no item (a DPGF of structural rows only) asks nothing: the free extraction.
  it("seals the free extraction for a list without any item", async () => {
    const empty = { id: "revision-0", revision: 1, cause: "initial", sources: {}, item_count: 0, content_sha256: "b".repeat(64),
      created_by: "payer", created_at: "2026-11-21T00:00:00Z", intent_key: "k", tenant_id: "tenant", project_id: "project" };
    const fake = createSupabaseFake({
      rpc: { takeoff_item_list_order_is_active: () => ({ data: true, error: null }) },
      tables: {
        dpgf_imports: none, affaire_intake_documents: none, takeoff_item_template_versions: none,
        takeoff_list_revisions: (query: FakeQuery) => servedRows([empty], query),
        takeoff_list_revision_entries: none, takeoff_list_item_sources: none,
      },
    });
    await expect(sealedMeasuringOrder(fake.client as never, input)).resolves.toEqual({
      order: { kind: "free_extraction", version: 1, list: null }, items: [] });
  });
});
