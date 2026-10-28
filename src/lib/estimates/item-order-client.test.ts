import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteEstimateItem, moveEstimateItem, reorderEstimateItems } from "@/lib/estimates/client";

const versionId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const sectionId = "33333333-3333-4333-8333-333333333333";
const version = { id: versionId, updated_at: "2026-10-28T12:00:00.123456Z", content_revision: 9 };
const move = {
  item_id: itemId, from_parent_id: null, to_parent_id: sectionId,
  ordered_source_ids: [], ordered_target_ids: [itemId],
};
function respond(data: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("ordering confirmations", () => {
  it("returns the deletion receipt and its exact subtree", async () => {
    respond({ deleted_id: sectionId, deleted_ids: [sectionId, itemId], version });
    await expect(deleteEstimateItem(versionId, sectionId)).resolves.toEqual({ versionToken: version, deletedIds: [sectionId, itemId] });
  });
  it.each([[itemId], [sectionId, sectionId]])("rejects an inconsistent deleted subtree: %j", async (...ids) => {
    const fetch = respond({ deleted_id: sectionId, deleted_ids: ids, version });
    await expect(deleteEstimateItem(versionId, sectionId)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns the precise reorder receipt to the document owner", async () => {
    respond({ parent_id: null, ordered_ids: [itemId], updated_count: 1, version });
    await expect(reorderEstimateItems(versionId, null, [itemId])).resolves.toEqual({ versionToken: version });
  });
  it("returns the move receipt to the document owner", async () => {
    respond({ ...move, updated_count: 1, version });
    await expect(moveEstimateItem(versionId, move)).resolves.toEqual({ versionToken: version });
  });
  it.each([
    { version: { ...version, id: sectionId } },
    { version: undefined },
    { updated_count: 2 },
    { ordered_ids: [sectionId] },
    { parent_id: sectionId },
  ])("rejects an inconsistent reorder without a second write: %j", async (patch) => {
    const fetch = respond({ parent_id: null, ordered_ids: [itemId], updated_count: 1, version, ...patch });
    await expect(reorderEstimateItems(versionId, null, [itemId])).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects a move to a different parent", async () => {
    respond({ ...move, from_parent_id: sectionId, to_parent_id: null, updated_count: 1, version });
    await expect(moveEstimateItem(versionId, move)).rejects.toThrow();
  });
});
