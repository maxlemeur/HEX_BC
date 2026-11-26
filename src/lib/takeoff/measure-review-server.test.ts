import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { DETAIL_PROJECT, DETAIL_READINGS, ITEMS, PLAN_RDC, fixtureMeasureReview } from "./item-detail.test-fixtures";
import { readMeasureReview } from "./measure-review-server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));

it.each([
  { reason: "quantity_choice", pairRevision: 1, pairKind: null, effective: false },
  { reason: "sent", pairRevision: 1, pairKind: "accepted", effective: true },
  { reason: "sent", pairRevision: 2, pairKind: "accepted", effective: false },
])("reads an effective pair behind $reason (revision $pairRevision, decision $pairKind)", async ({
  reason, pairRevision, pairKind, effective,
}) => {
  const answer = DETAIL_READINGS.find(row => row.itemId === ITEMS.basin && row.planKey === PLAN_RDC)!.answer!.answerId;
  const tenant = "77777777-7777-4777-8777-777777777777";
  const saved = { quantity: 3, unit: "u", individual: true };
  const supabase = createClient("https://example.test", "test-anon", { global: { fetch: async (input, init) => {
    switch (new URL(String(input)).pathname.split("/").at(-1)) {
      case "read_takeoff_measure_review":
        return Response.json({ ...fixtureMeasureReview(answer), reason, rows_to_justify: [] });
      case "takeoff_item_review_events":
        return Response.json([{ command_id: "retain", after: saved }]);
      case "takeoff_item_answer_decisions":
        return Response.json([{ command_id: "retain", kind: "accepted", revision: 1 }]);
      case "read_takeoff_item_table":
        expect(JSON.parse(String(init?.body))).toMatchObject({ p_tenant_id: tenant, p_project_id: DETAIL_PROJECT,
          p_item_ids: [ITEMS.basin], p_plan_logical_id: PLAN_RDC, p_limit: 1 });
        return Response.json([{ item_id: ITEMS.basin, readings: [{ plan_logical_id: PLAN_RDC, answer: { answer_id: answer },
          decision_revision: pairRevision, decision: pairKind ? { kind: pairKind, revision: pairRevision } : null }] }]);
      default: throw new Error("Unexpected measure review request");
    }
  } } });
  vi.mocked(requireAffaireAccess).mockResolvedValue({ context: { tenantId: tenant, supabase } } as never);
  expect(await readMeasureReview(DETAIL_PROJECT, answer)).toMatchObject({
    reason, previously_retained: true, effective_decision: effective ? "accepted" : null,
    retained: effective ? { quantity: 3, unit: "u" } : null,
  });
});
