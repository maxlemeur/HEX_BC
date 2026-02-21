import { describe, expect, it } from "vitest";

import {
  applyBufferedUpdatesToItems,
  rehydrateBufferedUpdates,
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";

describe("bulk-buffer helpers", () => {
  it("deduplicates updates by item id while merging payloads", () => {
    const buffer = new Map<string, Record<string, unknown>>();

    upsertBufferedUpdate(buffer, "item-1", { title: "A" });
    upsertBufferedUpdate(buffer, "item-2", { title: "B" });
    upsertBufferedUpdate(buffer, "item-1", { quantity: 3 });

    const serialized = serializeBufferedUpdates(buffer);
    expect(serialized).toHaveLength(2);
    expect(serialized[0]).toEqual({
      id: "item-1",
      updates: { title: "A", quantity: 3 },
    });
    expect(serialized[1]).toEqual({
      id: "item-2",
      updates: { title: "B" },
    });
  });

  it("triggers immediate flush at threshold 100", () => {
    expect(shouldFlushBufferedUpdates(99, 100)).toBe(false);
    expect(shouldFlushBufferedUpdates(100, 100)).toBe(true);
    expect(shouldFlushBufferedUpdates(101, 100)).toBe(true);
  });

  it("applies buffered updates to in-memory items", () => {
    const items = [
      { id: "item-1", title: "Ancien titre", quantity: 1 },
      { id: "item-2", title: "Ligne intacte", quantity: 3 },
    ];

    const merged = applyBufferedUpdatesToItems(items, [
      { id: "item-1", updates: { title: "Titre restaure", quantity: 5 } },
    ]);

    expect(merged).toEqual([
      { id: "item-1", title: "Titre restaure", quantity: 5 },
      { id: "item-2", title: "Ligne intacte", quantity: 3 },
    ]);
  });

  it("rehydrates autosave draft into buffer and item state", () => {
    const initialItems = [{ id: "item-1", title: "Serveur", quantity: 1 }];
    const pending = new Map<string, Record<string, unknown>>();

    pending.set("stale-item", { title: "obsolete" });

    const result = rehydrateBufferedUpdates(
      initialItems,
      [{ id: "item-1", updates: { title: "Local", quantity: 7 } }],
      pending
    );

    expect(result.pendingUpdateCount).toBe(1);
    expect(result.hasPendingUpdates).toBe(true);
    expect(Array.from(pending.keys())).toEqual(["item-1"]);
    expect(result.mergedItems).toEqual([
      { id: "item-1", title: "Local", quantity: 7 },
    ]);
  });
});
