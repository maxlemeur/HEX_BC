import { createHash } from "node:crypto";
import { stripAccents } from "@/lib/text/fold";

export type PosteListScope = Readonly<{ tenantId: string; projectId: string }>;

export type PosteSection = Readonly<{ id: string; title: string; order: number }>;
export type PosteQualifiers = Readonly<{
  network?: string;
  material?: string;
  diameter?: string;
  convention?: string;
  scope?: string;
}>;

export type DpgfPosteOrigin = Readonly<{
  kind: "dpgf";
  importId: string;
  mappingId: string;
  rawRowId: string;
  mappedRowId: string;
  rowIndex: number;
  sheetName: string | null;
  /** The row in the imported table (from the first row of the range read): « ligne du tableau ». */
  sourceRowNumber: number | null;
  /** The worksheet's own row, for an import that recorded where its table starts; null otherwise. */
  sheetRowNumber?: number | null;
  sourcePage: number | null;
  tableIndex: number | null;
  documentId: string | null;
  reference: string | null;
  sourceUnit: string | null;
  /**
   * A digest of the row's notes, never their text: the notes of an import may say what its readers must not read (a
   * negotiated price); the digest still tells two rows apart for a continuity.
   */
  measurementNotesDigest: string | null;
  factsDigest: string;
}>;

export type PosteOrigin = DpgfPosteOrigin | Readonly<{
  kind: "template";
  templateId: string;
  version: number;
  /** The tenant's published version the line was read from; absent for the definition shipped with the application. */
  publicationId?: string;
  familyId: string;
  lineId: string;
}> | Readonly<{
  kind: "manual";
  intentId: string;
  addedBy: string;
  addedAt: string;
  addedInRevision: number;
}>;

export type PosteDefinition = Readonly<{
  label: string;
  expectedUnit: string | null;
  measurementBasis: string | null;
  qualifiers: PosteQualifiers;
  sections: readonly PosteSection[];
  synonyms?: readonly string[];
}>;

export type PosteDraft = PosteDefinition & Readonly<{
  origin: PosteOrigin;
  referenceQuantity: number | null;
}>;

export type Poste = PosteDraft & Readonly<{ id: string }>;
export type PosteRevision = Readonly<{
  scope: PosteListScope;
  revision: number;
  digest: string;
  items: readonly Poste[];
  /** Accepted source aliases, including those whose items are absent in this revision. */
  acceptedSources?: Readonly<Record<string, string>>;
}>;

type Continuity = Readonly<{ previousItemId: string; nextItemId: string }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a < b ? -1 : Number(a > b))
    .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry))
    .join(",") + "}";
}

export function digestPosteFacts(facts: unknown): string {
  return createHash("sha256").update(canonical(facts)).digest("hex");
}

/** The key of an item's origin in its affaire: what the database's registry keeps unique (migration A). */
export function posteOriginKey(origin: PosteOrigin): string {
  return sourceKey(origin);
}

function sourceKey(origin: PosteOrigin): string {
  switch (origin.kind) {
    case "dpgf": return canonical(["dpgf", origin.importId, origin.rawRowId]);
    case "template": return canonical(["template", origin.templateId, origin.lineId]);
    case "manual": return canonical(["manual", origin.intentId]);
  }
}

export function posteSourceId(scope: PosteListScope, origin: PosteOrigin): string {
  const hex = digestPosteFacts(["takeoff-poste-v1", scope.tenantId, scope.projectId, sourceKey(origin)]);
  // UUIDv8, with an application namespace, RFC variant and 122 bits from SHA-256.
  const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function assertSameScope(left: PosteListScope, right: PosteListScope) {
  if (left.tenantId !== right.tenantId || left.projectId !== right.projectId) {
    throw new Error("Les révisions doivent appartenir à la même affaire.");
  }
}

export function createPosteRevision(
  scope: PosteListScope,
  drafts: readonly PosteDraft[],
  previous?: PosteRevision,
  accepted: readonly Continuity[] = [],
): PosteRevision {
  if (previous) assertSameScope(scope, previous.scope);
  const previousIds = new Set(previous?.items.map(({ id }) => id));
  const previousBySource = new Map(previous?.items.map((item) => [sourceKey(item.origin), item.id]));
  const acceptedSources = new Map(Object.entries(previous?.acceptedSources ?? {}));
  const itemsBySource = new Map<string, Poste>();
  for (const draft of drafts) {
    const key = sourceKey(draft.origin);
    const item = {
      ...structuredClone(draft),
      id: acceptedSources.get(key) ?? previousBySource.get(key) ?? posteSourceId(scope, draft.origin),
    };
    const existing = itemsBySource.get(key);
    if (existing && canonical(existing) !== canonical(item)) {
      throw new Error("Une origine de poste a plusieurs définitions.");
    }
    itemsBySource.set(key, item);
  }

  const items = [...itemsBySource.values()];
  const nextIds = new Set(items.map(({ id }) => id));
  if (nextIds.size !== items.length) {
    throw new Error("Deux origines revendiquent le même poste. Le rapprochement doit être résolu.");
  }

  const reassigned = new Map<string, string>();
  const assignedPreviousIds = new Set<string>();
  for (const { previousItemId, nextItemId } of accepted) {
    if (!previousIds.has(previousItemId) || !nextIds.has(nextItemId) ||
      nextIds.has(previousItemId) || previousIds.has(nextItemId) ||
      reassigned.has(nextItemId) || assignedPreviousIds.has(previousItemId)) {
      throw new Error("Le rapprochement de postes n'est plus valide.");
    }
    reassigned.set(nextItemId, previousItemId);
    assignedPreviousIds.add(previousItemId);
  }

  const resolvedItems = items.map((item) => {
    const id = reassigned.get(item.id);
    if (!id) return item;
    acceptedSources.set(sourceKey(item.origin), id);
    return { ...item, id };
  });
  const aliases = acceptedSources.size ? { acceptedSources: Object.fromEntries(acceptedSources) } : {};
  const digest = digestPosteRevision(scope, resolvedItems, aliases.acceptedSources);
  return {
    scope: { ...scope },
    revision: previous ? previous.revision + Number(previous.digest !== digest) : 1,
    digest,
    items: resolvedItems,
    ...aliases,
  };
}

/** The digest of a revision's facts: its scope, its items in order and its accepted source aliases. */
export function digestPosteRevision(
  scope: PosteListScope, items: readonly Poste[], acceptedSources?: Readonly<Record<string, string>>,
): string {
  const aliases = acceptedSources && Object.keys(acceptedSources).length ? { acceptedSources } : {};
  return digestPosteFacts({ contract: 1, scope, items, ...aliases });
}

function textKey(text: string) {
  return stripAccents(text).toLowerCase().trim().replace(/\s+/g, " ");
}

function measureKey(item: Poste) {
  const source = item.origin.kind === "dpgf" ? item.origin : null;
  return [
    item.expectedUnit ?? (source?.sourceUnit ? textKey(source.sourceUnit) : null),
    item.measurementBasis, item.qualifiers, source?.measurementNotesDigest ?? null,
  ];
}

function labelKey(item: Poste) {
  return canonical([textKey(item.label), measureKey(item)]);
}

function referenceKey(item: Poste) {
  if (item.origin.kind !== "dpgf" || !item.origin.reference || !item.expectedUnit) return null;
  return canonical([
    textKey(item.origin.reference), item.sections.map(({ title }) => textKey(title)), measureKey(item),
  ]);
}

function addCandidate(index: Map<string, Poste[]>, key: string, item: Poste) {
  const candidates = index.get(key);
  if (candidates) candidates.push(item);
  else index.set(key, [item]);
}

/** Items of a previous list an operator may confirm as the same item as an added one (never applied on their own). */
export function findPosteContinuities(removed: readonly Poste[], added: readonly Poste[]) {
  return findContinuities(removed, added);
}

function findContinuities(removed: readonly Poste[], added: readonly Poste[]) {
  const byLabel = new Map<string, Poste[]>();
  const nonDpgfByLabel = new Map<string, Poste[]>();
  const dpgfByReference = new Map<string, Poste[]>();
  for (const item of removed) {
    if (!item.expectedUnit) continue;
    const label = labelKey(item);
    addCandidate(byLabel, label, item);
    if (item.origin.kind !== "dpgf") addCandidate(nonDpgfByLabel, label, item);
    const reference = referenceKey(item);
    if (reference) addCandidate(dpgfByReference, reference, item);
  }

  const matches: Continuity[] = [];
  const previousCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  for (const item of added) {
    if (!item.expectedUnit) continue;
    const label = labelKey(item);
    const reference = referenceKey(item);
    const candidates = item.origin.kind === "dpgf"
      ? [...(nonDpgfByLabel.get(label) ?? []), ...(reference ? dpgfByReference.get(reference) ?? [] : [])]
      : byLabel.get(label) ?? [];
    for (const previous of candidates) {
      matches.push({ previousItemId: previous.id, nextItemId: item.id });
      previousCounts.set(previous.id, (previousCounts.get(previous.id) ?? 0) + 1);
      nextCounts.set(item.id, (nextCounts.get(item.id) ?? 0) + 1);
    }
  }
  return matches.map((match) => ({
    ...match,
    ambiguous: previousCounts.get(match.previousItemId)! > 1 || nextCounts.get(match.nextItemId)! > 1,
  }));
}

export function comparePosteRevisions(previous: PosteRevision, next: PosteRevision) {
  assertSameScope(previous.scope, next.scope);
  const previousById = new Map(previous.items.map((item, index) => [item.id, { item, index }]));
  const nextIds = new Set(next.items.map(({ id }) => id));
  const removed = previous.items.filter(({ id }) => !nextIds.has(id));
  const added = next.items.filter(({ id }) => !previousById.has(id));
  const changes = next.items.flatMap((item, index) => {
    const before = previousById.get(item.id);
    if (!before) return [];
    const old = before.item;
    const referenceChanged = old.referenceQuantity !== item.referenceQuantity;
    const measurementChanged = canonical([textKey(old.label), measureKey(old)]) !==
      canonical([textKey(item.label), measureKey(item)]);
    const targetChanged = old.label !== item.label || canonical(old.sections) !== canonical(item.sections) ||
      sourceKey(old.origin) !== sourceKey(item.origin) ||
      (old.origin.kind === "dpgf" && item.origin.kind === "dpgf" && old.origin.reference !== item.origin.reference);
    return [{
      previous: old, current: item, moved: before.index !== index, measurementChanged, referenceChanged, targetChanged,
      provenanceChanged: canonical(old.origin) !== canonical(item.origin),
    }];
  });
  return { added, removed, changes, continuities: findContinuities(removed, added) };
}
