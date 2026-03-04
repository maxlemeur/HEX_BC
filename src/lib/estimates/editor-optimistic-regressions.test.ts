import { describe, expect, it } from "vitest";

import {
  markTempItemsRemoved,
  reconcileCreatedItemWithLocalDraft,
  rollbackRemovedTempItems,
} from "@/lib/estimates/editor-optimistic";

describe("estimate editor optimistic regressions", () => {
  it("preserves in-progress local draft values when replacing temp item with created item", () => {
    const created = {
      id: "real-1",
      title: "Server title",
      aid: null,
      description: null,
    };
    const queuedPatch = {
      title: "Persisted title",
      aid: "A-42",
    };
    const localDraftPatch = {
      title: "Draft title",
      description: "Typing before create resolves",
    };

    const reconciled = reconcileCreatedItemWithLocalDraft(
      created,
      localDraftPatch,
      queuedPatch
    );

    expect(reconciled.title).toBe("Draft title");
    expect(reconciled.description).toBe("Typing before create resolves");
    expect(reconciled.aid).toBe("A-42");
    expect(reconciled._optimistic).toBe(false);
    expect(reconciled._pendingCreate).toBe(false);
  });

  it("restores removed temp markers and queued patches when delete fails", () => {
    const removedTempItemIds = new Set<string>();
    const queuedPatchesByTempId = new Map<string, { title: string }>([
      ["temp-1", { title: "queued one" }],
      ["temp-2", { title: "queued two" }],
      ["other", { title: "keep me" }],
    ]);
    const removedTempIds = ["temp-1", "temp-2", "temp-missing"];

    const snapshot = markTempItemsRemoved(
      removedTempIds,
      removedTempItemIds,
      queuedPatchesByTempId
    );

    expect(removedTempItemIds.has("temp-1")).toBe(true);
    expect(removedTempItemIds.has("temp-2")).toBe(true);
    expect(removedTempItemIds.has("temp-missing")).toBe(true);
    expect(queuedPatchesByTempId.has("temp-1")).toBe(false);
    expect(queuedPatchesByTempId.has("temp-2")).toBe(false);
    expect(queuedPatchesByTempId.get("other")).toEqual({ title: "keep me" });

    rollbackRemovedTempItems(
      removedTempIds,
      snapshot,
      removedTempItemIds,
      queuedPatchesByTempId
    );

    expect(removedTempItemIds.has("temp-1")).toBe(false);
    expect(removedTempItemIds.has("temp-2")).toBe(false);
    expect(removedTempItemIds.has("temp-missing")).toBe(false);
    expect(queuedPatchesByTempId.get("temp-1")).toEqual({ title: "queued one" });
    expect(queuedPatchesByTempId.get("temp-2")).toEqual({ title: "queued two" });
    expect(queuedPatchesByTempId.has("temp-missing")).toBe(false);
    expect(queuedPatchesByTempId.get("other")).toEqual({ title: "keep me" });
  });
});
