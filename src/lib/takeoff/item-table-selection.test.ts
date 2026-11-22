import { describe, expect, it } from "vitest";

import {
  emptyItemSelection,
  itemSelectionCounts,
  itemSelectionStorageKey,
  parseStoredItemSelection,
  selectedTargets,
  toggleItemSelection,
  withFrozenSelection,
  type SelectableLine,
} from "./item-table-selection";

const target = (itemId: string, revision = "1") => ({ itemId, entryRevision: 0,
  answers: [{ answerId: "00000000-0000-4000-8000-000000000001", answerRevision: revision, decisionRevision: 0 }] });
const line = (itemId: string, eligible: Partial<Record<string, boolean>> = {}): SelectableLine => ({
  itemId, label: `Poste ${itemId}`, targets: target(itemId),
  eligibility: { accept_measured: { eligible: eligible.accept_measured ?? false, reason: null },
    set_aside: { eligible: eligible.set_aside ?? true, reason: null }, reinstate: { eligible: false, reason: null },
    enter_quantity: { eligible: eligible.enter_quantity ?? false, reason: null }, include_entry: { eligible: false, reason: null },
    remeasure: { eligible: true, reason: null } },
});

describe("item table selection", () => {
  const affaire = { kind: "affaire" } as const;

  it("keeps the lines ticked on several pages, with the revisions seen when ticked", () => {
    let selection = emptyItemSelection(affaire);
    selection = toggleItemSelection(selection, line("a", { accept_measured: true }));
    selection = toggleItemSelection(selection, line("b"));
    expect(Object.keys(selection.items)).toEqual(["a", "b"]);
    expect(itemSelectionCounts(selection)).toMatchObject({ total: 2, accept_measured: 1, set_aside: 2 });
    selection = toggleItemSelection(selection, line("a"));
    expect(Object.keys(selection.items)).toEqual(["b"]);
  });

  it("does not take the revisions of a newer read silently: an explicit freeze refreshes them", () => {
    const selection = toggleItemSelection(emptyItemSelection(affaire), line("a"));
    expect(selectedTargets(selection)).toEqual([target("a")]);
    const refreshed = withFrozenSelection(selection, { items: [{ itemId: "a", label: "Poste a", target: target("a", "2"),
      eligible: ["set_aside"] }] });
    expect(selectedTargets(refreshed)).toEqual([target("a", "2")]);
    expect(itemSelectionCounts(refreshed)).toMatchObject({ total: 1, set_aside: 1, remeasure: 0 });
  });

  it("takes every result of a frozen filter, beyond the page shown", () => {
    const frozen = { items: ["a", "b", "c"].map((itemId, index) => ({ itemId, label: itemId.toUpperCase(), target: target(itemId),
      eligible: index < 2 ? ["accept_measured" as const, "set_aside" as const] : ["set_aside" as const, "enter_quantity" as const] })) };
    const selection = withFrozenSelection(emptyItemSelection(affaire), frozen);
    expect(Object.keys(selection.items)).toEqual(["a", "b", "c"]);
    expect(itemSelectionCounts(selection)).toMatchObject({ total: 3, accept_measured: 2, set_aside: 3, enter_quantity: 1 });
  });

  it("reads back a stored selection of the same scope only, and refuses anything malformed", () => {
    const selection = toggleItemSelection(emptyItemSelection(affaire), line("00000000-0000-4000-8000-00000000000a"));
    const stored = JSON.stringify(selection);
    expect(parseStoredItemSelection(stored, affaire)).toEqual(selection);
    expect(parseStoredItemSelection(stored, { kind: "plan", planKey: "plan-a" })).toBeNull();
    expect(parseStoredItemSelection("{\"version\":1}", affaire)).toBeNull();
    expect(parseStoredItemSelection("not json", affaire)).toBeNull();
    expect(itemSelectionStorageKey("tenant:member", "project")).toBe("mergeone:takeoff-item-selection:tenant:member:project");
  });
});
