/**
 * The list of items (« postes ») of an affaire as a stored fact (migration 20261121180813_takeoff_item_lists.sql): the
 * conversion between an immutable revision and its stored entries, the revision proposed when the affaire's sources
 * change, and an item added by hand. The identity rule is the core's (`poste-list.ts`): an origin keeps its item.
 */
import {
  comparePosteRevisions,
  createPosteRevision,
  digestPosteRevision,
  findPosteContinuities,
  posteOriginKey,
  type Poste,
  type PosteDraft,
  type PosteListScope,
  type PosteOrigin,
  type PosteQualifiers,
  type PosteRevision,
  type PosteSection,
} from "./poste-list";

/** An entry as the database stores it and returns it (the write function's contract). */
export type StoredItemListEntry = {
  item_id: string;
  source_key: string;
  label: string;
  expected_unit: string | null;
  measurement_basis: string | null;
  qualifiers: PosteQualifiers;
  sections: PosteSection[];
  synonyms: string[];
  origin: PosteOrigin;
  reference_quantity: number | null;
};

/** Where an item added by hand goes when the operator names no section of the list. */
export const ITEM_LIST_ADDED_SECTION: PosteSection = { id: "postes-ajoutes", title: "Postes ajoutés", order: 1_000_000 };

/** Bounds of the stored list, the database's own (its table checks and its write function). */
export const ITEM_LIST_LIMITS = { items: 10_000, label: 4_000, unit: 32, basis: 300, qualifier: 120 } as const;

function normalized(draft: PosteDraft): PosteDraft {
  return {
    label: draft.label,
    expectedUnit: draft.expectedUnit,
    measurementBasis: draft.measurementBasis,
    qualifiers: draft.qualifiers ?? {},
    sections: draft.sections.map(({ id, title, order }) => ({ id, title, order })),
    synonyms: draft.synonyms ?? [],
    origin: draft.origin,
    referenceQuantity: draft.referenceQuantity,
  };
}

function asDraft({ id: _id, ...draft }: Poste): PosteDraft {
  return normalized(draft);
}

export function posteFromStoredEntry(entry: StoredItemListEntry): Poste {
  return {
    id: entry.item_id,
    label: entry.label,
    expectedUnit: entry.expected_unit,
    measurementBasis: entry.measurement_basis,
    qualifiers: entry.qualifiers ?? {},
    sections: (entry.sections ?? []).map(({ id, title, order }) => ({ id, title, order })),
    synonyms: entry.synonyms ?? [],
    origin: entry.origin,
    referenceQuantity: entry.reference_quantity === null ? null : Number(entry.reference_quantity),
  };
}

export function itemListEntries(revision: Pick<PosteRevision, "items">): StoredItemListEntry[] {
  return revision.items.map((item) => ({
    item_id: item.id,
    source_key: posteOriginKey(item.origin),
    label: item.label,
    expected_unit: item.expectedUnit,
    measurement_basis: item.measurementBasis,
    qualifiers: item.qualifiers ?? {},
    sections: item.sections.map(({ id, title, order }) => ({ id, title, order })),
    synonyms: [...(item.synonyms ?? [])],
    origin: item.origin,
    reference_quantity: item.referenceQuantity,
  }));
}

/**
 * A stored revision as the core reads it: its entries in order and the aliases the registry holds (origins an operator
 * accepted as an existing item), so that a proposal keeps every identity the affaire already gave.
 */
export function storedItemListRevision(scope: PosteListScope, stored: {
  revision: number;
  entries: readonly StoredItemListEntry[];
  aliases: Readonly<Record<string, string>>;
}): PosteRevision {
  const items = stored.entries.map(posteFromStoredEntry);
  const aliases = Object.keys(stored.aliases).length ? { acceptedSources: { ...stored.aliases } } : {};
  return { scope: { ...scope }, revision: stored.revision, digest: digestPosteRevision(scope, items, aliases.acceptedSources),
    items, ...aliases };
}

/**
 * The items added by hand keep their place: each goes back after the item that preceded it in the current list when
 * that item is still there, otherwise at the end. A change of the sources never moves or drops an addition.
 */
function withCarriedAdditions(sources: readonly PosteDraft[], current: PosteRevision | null): PosteDraft[] {
  const drafts = sources.map(normalized);
  if (!current) return drafts;
  const keys = drafts.map(({ origin }) => posteOriginKey(origin));
  const after = new Map<string, PosteDraft[]>();
  const trailing: PosteDraft[] = [];
  let anchor: string | null = null;
  for (const item of current.items) {
    if (item.origin.kind !== "manual") {
      anchor = posteOriginKey(item.origin);
      continue;
    }
    const target = anchor !== null && keys.includes(anchor) ? after.get(anchor) ?? [] : null;
    if (target && anchor !== null) {
      target.push(asDraft(item));
      after.set(anchor, target);
    } else {
      trailing.push(asDraft(item));
    }
  }
  return [...drafts.flatMap((draft, index) => [draft, ...(after.get(keys[index]) ?? [])]), ...trailing];
}

export type ItemListContinuity = { previousItemId: string; nextItemId: string };

export type ItemListProposal = {
  cause: "initial" | "proposal";
  /** False when the sources give the stored list again: nothing to propose. */
  changed: boolean;
  candidate: PosteRevision;
  comparison: ReturnType<typeof comparePosteRevisions>;
  /** The accepted continuities as the database registers them: the new origin's key, the existing item. */
  continuities: Array<{ sourceKey: string; itemId: string }>;
};

/**
 * The revision the affaire's sources give now, against its stored list: the source items in their order, the
 * additions by hand where they were, the identities kept. Continuities are only candidates until an operator accepts
 * them (`continuities`): each accepted pair must be one this comparison proposed, else the proposal is refused.
 * An addition by hand may be proposed as the same item as a new source row; accepted, the row takes its identity.
 */
export function proposeItemListRevision(input: {
  scope: PosteListScope;
  current: PosteRevision | null;
  sourceDrafts: readonly PosteDraft[];
  continuities?: readonly ItemListContinuity[];
}): ItemListProposal {
  const { scope, current } = input;
  const drafts = withCarriedAdditions(input.sourceDrafts, current);
  const base = createPosteRevision(scope, drafts, current ?? undefined);
  const comparison: ItemListProposal["comparison"] = current
    ? comparePosteRevisions(current, base)
    : { added: [...base.items], removed: [], changes: [], continuities: [] };
  const carried = current ? base.items.filter(({ origin }) => origin.kind === "manual") : [];
  const added = comparison.added.filter(({ origin }) => origin.kind !== "manual");
  const candidates = current ? findPosteContinuities([...comparison.removed, ...carried], added) : [];
  const proposed = { ...comparison, continuities: candidates };
  const accepted = input.continuities ?? [];
  if (!accepted.length) {
    return { cause: current ? "proposal" : "initial", changed: !current || base.digest !== current.digest,
      candidate: base, comparison: proposed, continuities: [] };
  }

  const offered = new Set(candidates.map(({ previousItemId, nextItemId }) => `${previousItemId}:${nextItemId}`));
  if (accepted.some(({ previousItemId, nextItemId }) => !offered.has(`${previousItemId}:${nextItemId}`))) {
    throw new Error("Le rapprochement de postes n'est plus valide.");
  }
  // An addition accepted as a source row leaves the list as an addition: the row carries its identity from now on.
  const absorbed = new Set(accepted.map(({ previousItemId }) => previousItemId));
  const remaining = drafts.filter((draft, index) => {
    const item = base.items[index];
    return !(draft.origin.kind === "manual" && item && absorbed.has(item.id));
  });
  const candidate = createPosteRevision(scope, remaining, current ?? undefined, accepted);
  const byId = new Map(base.items.map((item) => [item.id, item]));
  return {
    cause: current ? "proposal" : "initial",
    changed: true,
    candidate,
    comparison: proposed,
    continuities: accepted.map(({ previousItemId, nextItemId }) => ({
      sourceKey: posteOriginKey(byId.get(nextItemId)!.origin), itemId: previousItemId,
    })),
  };
}

export type ItemListAddition = {
  intentId: string;
  addedBy: string;
  addedAt: string;
  label: string;
  expectedUnit: string | null;
  measurementBasis: string | null;
  qualifiers: PosteQualifiers;
  /** The section path of an existing item to file it with, or null for « Postes ajoutés ». */
  sectionPath: readonly PosteSection[] | null;
};

const sameSections = (left: readonly PosteSection[], right: readonly PosteSection[]) =>
  left.length === right.length && left.every((section, index) => section.id === right[index].id);

/** The current list and one item added by hand, after the last item of its section (or at the end). */
export function withAddedItem(current: PosteRevision, addition: ItemListAddition): PosteRevision {
  const sections = addition.sectionPath ? addition.sectionPath.map(({ id, title, order }) => ({ id, title, order }))
    : [ITEM_LIST_ADDED_SECTION];
  const draft: PosteDraft = normalized({
    label: addition.label,
    expectedUnit: addition.expectedUnit,
    measurementBasis: addition.measurementBasis,
    qualifiers: addition.qualifiers,
    sections,
    synonyms: [],
    referenceQuantity: null,
    origin: { kind: "manual", intentId: addition.intentId, addedBy: addition.addedBy, addedAt: addition.addedAt,
      addedInRevision: current.revision + 1 },
  });
  const drafts = current.items.map(asDraft);
  const lastOfSection = current.items.findLastIndex((item) => sameSections(item.sections, sections));
  drafts.splice(lastOfSection < 0 ? drafts.length : lastOfSection + 1, 0, draft);
  const next = createPosteRevision(current.scope, drafts, current);
  return { ...next, revision: current.revision + 1 };
}
