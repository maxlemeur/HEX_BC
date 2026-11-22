import { z } from "zod";

import { ITEM_REVIEW_GESTURES, type ItemReviewGesture, type ItemReviewTarget, type ItemTableScope } from "./item-table";
import { itemReviewTargetSchema, itemTableScopeSchema, type ItemSelectionResponse } from "./item-table-contracts";

/**
 * The selection of the table of items on the screen: the items a member ticked (on several pages) or every result of a
 * frozen filter, each with the revisions seen when it was taken and the gestures that applied to it then. A newer read
 * never changes those revisions on its own: a command names what the member saw, a stale one is refused by the server,
 * and an explicit freeze refreshes them. It belongs to one scope, and is kept for the tab across reloads.
 */

export type SelectableLine = {
  itemId: string;
  label: string;
  targets: ItemReviewTarget;
  eligibility: Record<ItemReviewGesture, { eligible: boolean; reason: string | null }>;
};

export type ItemSelection = {
  version: 1;
  scope: ItemTableScope;
  items: Record<string, { label: string; target: ItemReviewTarget; eligible: ItemReviewGesture[] }>;
};

const storedSchema = z.object({
  version: z.literal(1),
  scope: itemTableScopeSchema,
  items: z.record(z.string(), z.object({
    label: z.string(),
    target: itemReviewTargetSchema,
    eligible: z.array(z.enum(ITEM_REVIEW_GESTURES)),
  }).strict()),
}).strict();

export function emptyItemSelection(scope: ItemTableScope): ItemSelection {
  return { version: 1, scope, items: {} };
}

export function toggleItemSelection(selection: ItemSelection, line: SelectableLine, selected?: boolean): ItemSelection {
  const has = line.itemId in selection.items;
  const want = selected ?? !has;
  if (want === has) return selection;
  const items = { ...selection.items };
  if (want) {
    items[line.itemId] = { label: line.label, target: line.targets,
      eligible: ITEM_REVIEW_GESTURES.filter((gesture) => line.eligibility[gesture].eligible) };
  } else {
    delete items[line.itemId];
  }
  return { ...selection, items };
}

/** Every item of a frozen selection (a whole filter, or the selection's own items frozen again), as the server gave it. */
export function withFrozenSelection(selection: ItemSelection, frozen: Pick<ItemSelectionResponse, "items">): ItemSelection {
  return { version: 1, scope: selection.scope,
    items: Object.fromEntries(frozen.items.map(({ itemId, label, target, eligible }) => [itemId, { label, target, eligible }])) };
}

export function selectedTargets(selection: ItemSelection): ItemReviewTarget[] {
  return Object.values(selection.items).map(({ target }) => target);
}

/** The selection's size, and how many of its lines each gesture would write on (the server decides again at the command). */
export function itemSelectionCounts(selection: ItemSelection): { total: number } & Record<ItemReviewGesture, number> {
  const values = Object.values(selection.items);
  return {
    total: values.length,
    ...Object.fromEntries(ITEM_REVIEW_GESTURES.map((gesture) =>
      [gesture, values.filter(({ eligible }) => eligible.includes(gesture)).length])) as Record<ItemReviewGesture, number>,
  };
}

const sameScope = (left: ItemTableScope, right: ItemTableScope) =>
  left.kind === "affaire" ? right.kind === "affaire" : right.kind === "plan" && left.planKey === right.planKey;

/** A selection read back from the tab's storage: only for the scope shown, and only if it is well formed. */
export function parseStoredItemSelection(raw: string | null, scope: ItemTableScope): ItemSelection | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedSchema.safeParse(value);
  if (!parsed.success || !sameScope(parsed.data.scope, scope)) return null;
  return parsed.data;
}

export function itemSelectionStorageKey(viewerKey: string, projectId: string) {
  return `mergeone:takeoff-item-selection:${viewerKey}:${projectId}`;
}
