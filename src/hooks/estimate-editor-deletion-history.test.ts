import { describe, expect, it, vi } from "vitest";

import { createEstimateDeletionRestorer } from "@/hooks/estimate-editor-deletion-history";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

describe("deletion restoration acknowledgement", () => {
  it("keeps undo unapplied after a rejected order and retries only ordering", async () => {
    const data = createEstimateEditorResponseFixture();
    const original = data.items[0];
    const recreated = { ...original, id: "55555555-5555-4555-8555-555555555555" };
    const recreateItemsFromSnapshots = vi.fn().mockResolvedValue({
      idMap: new Map([[original.id, recreated.id]]), createdItems: [recreated],
    });
    const applySiblingOrder = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (_versionId: string, remainingParents: Map<string | null, string[]>) => { remainingParents.clear(); });
    const restorer = createEstimateDeletionRestorer({
      versionId: data.version.id, snapshots: [original],
      siblingOrderByParent: new Map([[null, [original.id]]]), itemId: original.id,
      plural: false, isCurrentVersion: () => true, recreateItemsFromSnapshots,
      applySiblingOrder, setItems: vi.fn(), onRestored: vi.fn(),
    });
    expect(await restorer.undo()).toBe(false);
    expect(await restorer.undo()).toBeUndefined();
    expect(recreateItemsFromSnapshots).toHaveBeenCalledTimes(1);
    expect(applySiblingOrder).toHaveBeenCalledTimes(2);
  });
});
