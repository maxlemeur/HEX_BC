import { describe, expect, it } from "vitest";

import {
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
});
