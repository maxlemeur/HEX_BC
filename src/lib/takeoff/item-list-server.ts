import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { ApiError, conflict, forbidden, internalError, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@/types/database";
import {
  ITEM_LIST_LIMITS,
  itemListEntries,
  proposeItemListRevision,
  storedItemListRevision,
  withAddedItem,
  type ItemListContinuity,
  type StoredItemListEntry,
} from "./item-list";
import { resolveItemListSources, type ItemListSourceState } from "./item-list-sources-server";
import type { DpgfPosteProjection } from "./poste-list-dpgf";
import type { DpgfPosteOrigin, Poste, PosteListScope, PosteOrigin, PosteQualifiers, PosteRevision } from "./poste-list";
import { asRecord } from "@/lib/value-guards";

type Client = SupabaseClient<Database>;

export type StoredItemListRevisionRow = {
  id: string; revision: number; cause: "initial" | "proposal" | "item_added"; sources: Json; item_count: number;
  content_sha256: string; created_by: string; created_at: string; intent_key: string;
};

export type StoredItemList = {
  row: StoredItemListRevisionRow;
  revision: PosteRevision;
  history: StoredItemListRevisionRow[];
  continuities: Array<{ source_key: string; item_id: string; accepted_in_revision: number; accepted_by: string; accepted_at: string }>;
  /** Every origin key the affaire's registry holds: a key already known is never offered as a new continuity. */
  registeredKeys: Set<string>;
};

const PAGE = 1000;

/** Every row of an ordered read, page by page, checked against its exact count (a write meanwhile refuses the read). */
async function readOrdered<Row>(query: (from: number, to: number) => PromiseLike<{
  data: Row[] | null; error: unknown; count: number | null;
}>): Promise<Row[]> {
  const rows: Row[] = [];
  let expected: number | null = null;
  while (expected === null || rows.length < expected) {
    const { data, error, count } = await query(rows.length, rows.length + PAGE - 1);
    if (error) throw mapSupabaseError(error as Parameters<typeof mapSupabaseError>[0], "Impossible de lire la liste des postes.");
    if (count === null || (expected !== null && count !== expected)) {
      throw internalError("La liste des postes a changé pendant sa lecture : rechargez la page.");
    }
    expected = count;
    rows.push(...(data ?? []));
    if (!data?.length) break;
  }
  if (rows.length !== expected) throw internalError("La liste des postes a changé pendant sa lecture : rechargez la page.");
  return rows;
}

/** The latest stored revision of an affaire's list, read with the client given (a member's session reads it under RLS). */
export async function readStoredItemList(client: Client, scope: PosteListScope): Promise<StoredItemList | null> {
  const { data: history, error } = await client.from("takeoff_list_revisions")
    .select("id, revision, cause, sources, item_count, content_sha256, created_by, created_at, intent_key")
    .eq("tenant_id", scope.tenantId).eq("project_id", scope.projectId).order("revision", { ascending: false }).limit(20);
  if (error) throw mapSupabaseError(error, "Impossible de lire la liste des postes.");
  const [row] = (history ?? []) as StoredItemListRevisionRow[];
  if (!row) return null;
  const [entries, continuities] = await Promise.all([
    readOrdered<StoredItemListEntry>((from, to) => client.from("takeoff_list_revision_entries")
      .select("item_id, source_key, label, expected_unit, measurement_basis, qualifiers, sections, synonyms, origin, reference_quantity",
        { count: "exact" })
      .eq("revision_id", row.id).order("position").range(from, to) as never),
    readOrdered<StoredItemList["continuities"][number] & { kind: "origin" | "continuity" }>((from, to) =>
      client.from("takeoff_list_item_sources")
        .select("source_key, item_id, kind, accepted_in_revision, accepted_by, accepted_at", { count: "exact" })
        .eq("tenant_id", scope.tenantId).eq("project_id", scope.projectId).order("source_key").range(from, to) as never),
  ]);
  if (entries.length !== row.item_count) throw internalError("La liste des postes enregistrée est incomplète.");
  const accepted = continuities.filter(({ kind }) => kind === "continuity")
    .map(({ source_key, item_id, accepted_in_revision, accepted_by, accepted_at }) =>
      ({ source_key, item_id, accepted_in_revision, accepted_by, accepted_at }));
  const aliases = Object.fromEntries(accepted.map(({ source_key, item_id }) => [source_key, item_id]));
  return {
    row, history: (history ?? []) as StoredItemListRevisionRow[], continuities: accepted,
    registeredKeys: new Set(continuities.map(({ source_key }) => source_key)),
    revision: storedItemListRevision(scope, { revision: row.revision, entries, aliases }),
  };
}

/** The reasons a row of the DPGF was left out of the list as its structure, never as a reading of its content. */
const STRUCTURAL_EXCLUSIONS = new Set(["footer", "ignored", "parameters", "header", "empty", "unreadable_designation"]);

/**
 * What a revision says it was made from: identifiers, states and row positions only, never a row's content. The
 * structure decisions applied and the rows left out (with their reason) are copied, so that the revision still says
 * why a row is not an item once the import or its mapping is gone.
 */
export function sourcesSummary(sources: ItemListSourceState): Json {
  switch (sources.kind) {
    case "dpgf": {
      const applied = sources.decisions.status === "applied" ? sources.decisions : null;
      return { kind: "dpgf", importId: sources.importId, mappingId: sources.mappingId,
        decisions: sources.decisions.status,
        ...(applied ? { confirmationId: applied.confirmationId, confirmedAt: applied.confirmedAt } : {}),
        structure: {
          decisions: (applied?.decisions ?? []).map(({ rowIndex, kind, level }) => ({ rowIndex, kind, level })),
          // Where each row left out is, by position only, for a reader to find it once the import is gone.
          exclusions: sources.projection.issues.flatMap(({ rowIndex, reason, sourceRowNumber, sheetRowNumber, sourcePage }) =>
            rowIndex !== null && STRUCTURAL_EXCLUSIONS.has(reason)
              ? [{ rowIndex, reason, sourceRowNumber: sourceRowNumber ?? null, sheetRowNumber: sheetRowNumber ?? null,
                sourcePage: sourcePage ?? null }]
              : []),
        } };
    }
    case "template": return { kind: "template", templateKey: sources.template.key, version: sources.template.version,
      publicationId: sources.template.publicationId };
    case "prepare": return { kind: "pending", reason: sources.reason };
    case "choose": return { kind: "pending", reason: "several_dpgf" };
  }
}

function sourceDrafts(sources: ItemListSourceState) {
  return sources.kind === "dpgf" || sources.kind === "template" ? sources.drafts : null;
}

async function memberNames(client: Client, ids: Iterable<string>) {
  const people = [...new Set(ids)].filter(Boolean);
  const names: Record<string, string> = {};
  if (!people.length) return names;
  const { data, error } = await client.from("profiles").select("id, full_name").in("id", people);
  if (error) throw mapSupabaseError(error, "Impossible de lire les auteurs de la liste des postes.");
  for (const profile of data ?? []) if (profile.full_name?.trim()) names[profile.id] = profile.full_name.trim();
  return names;
}

/** An item as its readers receive it: without the digests that are the server's own (an import's notes among them). */
export type ItemListViewPoste = Omit<Poste, "origin"> & {
  origin: Exclude<PosteOrigin, { kind: "dpgf" }> | Omit<DpgfPosteOrigin, "measurementNotesDigest" | "factsDigest">;
};

function forReaders(item: Poste): ItemListViewPoste {
  if (item.origin.kind !== "dpgf") return item as ItemListViewPoste;
  const { measurementNotesDigest: _notes, factsDigest: _facts, ...origin } = item.origin;
  void _notes;
  void _facts;
  return { ...item, origin };
}

/** Why a revision left rows of its DPGF out: its own facts, which remain once the import or its mapping is gone. */
export type ItemListRevisionOmissions = {
  decisions: number;
  exclusions: Array<{ rowIndex: number; reason: string; sourceRowNumber: number | null; sheetRowNumber: number | null;
    sourcePage: number | null }>;
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function revisionOmissions(sources: Json): ItemListRevisionOmissions | null {
  const record = asRecord(sources);
  const structure = asRecord(record?.structure);
  if (record?.kind !== "dpgf" || !structure) return null;
  return {
    decisions: Array.isArray(structure.decisions) ? structure.decisions.length : 0,
    exclusions: (Array.isArray(structure.exclusions) ? structure.exclusions : []).flatMap((entry) => {
      const exclusion = asRecord(entry);
      return exclusion && typeof exclusion.rowIndex === "number" && typeof exclusion.reason === "string"
        ? [{ rowIndex: exclusion.rowIndex, reason: exclusion.reason, sourceRowNumber: positiveInteger(exclusion.sourceRowNumber),
          sheetRowNumber: positiveInteger(exclusion.sheetRowNumber), sourcePage: positiveInteger(exclusion.sourcePage) }]
        : [];
    }),
  };
}

export type ItemListProposalView = {
  cause: "initial" | "proposal";
  basedOnRevision: number;
  digest: string;
  items: ItemListViewPoste[];
  added: ItemListViewPoste[];
  removed: ItemListViewPoste[];
  changes: Array<{ previous: ItemListViewPoste; current: ItemListViewPoste; moved: boolean; measurementChanged: boolean;
    referenceChanged: boolean; targetChanged: boolean }>;
  continuities: Array<{ previousItemId: string; nextItemId: string; ambiguous: boolean }>;
};

type ProjectionView = Pick<DpgfPosteProjection, "counts" | "issues">;

export type AffaireItemListView = {
  projectId: string;
  canWrite: boolean;
  current: (Omit<StoredItemListRevisionRow, "sources" | "intent_key"> & { items: ItemListViewPoste[];
    omissions: ItemListRevisionOmissions | null }) | null;
  history: Array<Omit<StoredItemListRevisionRow, "sources" | "content_sha256" | "intent_key">
    & { omissions: ItemListRevisionOmissions | null }>;
  continuities: StoredItemList["continuities"];
  // The projection's counts and row reasons only: its items are the proposal's, sent without the server's digests.
  sources: Extract<ItemListSourceState, { kind: "choose" }>
    | (Omit<Extract<ItemListSourceState, { kind: "prepare" }>, "projection"> & { projection: ProjectionView | null })
    | (Omit<Extract<ItemListSourceState, { kind: "dpgf" }>, "drafts" | "projection"> & { projection: ProjectionView })
    | { kind: "template"; template: { key: string; version: number; publicationId: string | null; publishedAt: string | null;
      publishedBy: string | null; title: string } };
  proposal: ItemListProposalView | null;
  names: Record<string, string>;
};

/** A revision as its readers see it: never its sources' identifiers, but the rows it left out and why. */
function revisionView(row: StoredItemListRevisionRow) {
  return { id: row.id, revision: row.revision, cause: row.cause, item_count: row.item_count, created_by: row.created_by,
    created_at: row.created_at, omissions: revisionOmissions(row.sources) };
}

function proposalView(proposal: ReturnType<typeof proposeItemListRevision>, basedOnRevision: number): ItemListProposalView {
  return {
    cause: proposal.cause, basedOnRevision, digest: proposal.candidate.digest, items: proposal.candidate.items.map(forReaders),
    added: proposal.comparison.added.map(forReaders), removed: proposal.comparison.removed.map(forReaders),
    changes: proposal.comparison.changes.filter((change) => change.moved || change.measurementChanged || change.referenceChanged
      || change.targetChanged).map(({ previous, current, moved, measurementChanged, referenceChanged, targetChanged }) =>
      ({ previous: forReaders(previous), current: forReaders(current), moved, measurementChanged, referenceChanged,
        targetChanged })),
    continuities: proposal.comparison.continuities,
  };
}

/**
 * The list of an affaire for any of its readers: the stored revision, its history and the decisions about its sources
 * (the import and its confirmation, the template version, the continuities an operator accepted), and the revision
 * the sources propose now, never applied on its own.
 */
export async function loadAffaireItemList(projectId: string): Promise<AffaireItemListView> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const scope = { tenantId: context.tenantId, projectId: project.id };
  const service = createServiceRoleClient();
  const [sources, stored, mayWrite] = await Promise.all([
    resolveItemListSources(scope, service),
    readStoredItemList(context.supabase as unknown as Client, scope),
    service.rpc("takeoff_item_list_may_write", { p_tenant_id: scope.tenantId, p_project_id: scope.projectId,
      p_actor: context.userId }),
  ]);
  if (mayWrite.error) throw mapSupabaseError(mayWrite.error, "Impossible de vérifier les droits sur la liste des postes.");
  const drafts = sourceDrafts(sources);
  const proposal = drafts ? proposeItemListRevision({ scope, current: stored?.revision ?? null, sourceDrafts: drafts,
    registeredKeys: stored?.registeredKeys }) : null;
  const authors = [
    ...(stored?.history.map(({ created_by }) => created_by) ?? []),
    ...(stored?.continuities.map(({ accepted_by }) => accepted_by) ?? []),
    ...(stored?.revision.items.flatMap(({ origin }) => origin.kind === "manual" ? [origin.addedBy] : []) ?? []),
    ...(sources.kind === "template" && sources.template.publishedBy ? [sources.template.publishedBy] : []),
  ];
  const view: AffaireItemListView["sources"] = sources.kind === "dpgf"
    ? { kind: "dpgf", importId: sources.importId, mappingId: sources.mappingId, filename: sources.filename,
      sourceFormat: sources.sourceFormat, decisions: sources.decisions,
      projection: { counts: sources.projection.counts, issues: sources.projection.issues } }
    : sources.kind === "template"
      ? { kind: "template", template: { key: sources.template.key, version: sources.template.version,
        publicationId: sources.template.publicationId, publishedAt: sources.template.publishedAt,
        publishedBy: sources.template.publishedBy, title: sources.template.definition.title } }
      : sources.kind === "prepare"
        ? { ...sources, projection: sources.projection
          ? { counts: sources.projection.counts, issues: sources.projection.issues } : null }
        : sources;
  return {
    projectId: project.id,
    canWrite: mayWrite.data === true,
    current: stored ? { ...revisionView(stored.row), content_sha256: stored.row.content_sha256,
      items: stored.revision.items.map(forReaders) } : null,
    history: stored?.history.map(revisionView) ?? [],
    continuities: stored?.continuities ?? [],
    sources: view,
    proposal: proposal?.changed ? proposalView(proposal, stored?.row.revision ?? 0) : null,
    names: await memberNames(context.supabase as unknown as Client, authors),
  };
}

/**
 * One line for the takeoff page of an affaire that already has an estimate: the stored revision only, read under the
 * member's session; its sources and the proposal are read when the whole list is opened.
 */
export async function loadAffaireItemListSummary(projectId: string) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data, error } = await context.supabase.from("takeoff_list_revisions").select("revision, item_count")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).order("revision", { ascending: false }).limit(1);
  if (error) throw mapSupabaseError(error, "Impossible de lire la liste des postes.");
  const [latest] = (data ?? []) as Array<{ revision: number; item_count: number }>;
  return { projectId: project.id, revision: latest?.revision ?? null, itemCount: latest?.item_count ?? null };
}

/** The refusals of the list's write function, by their own code: a fixed French answer, never the database's text. */
function listWriteFailure(error: { message?: string }): never {
  const message = error.message ?? "";
  if (message.includes("TAKEOFF_ITEM_LIST_INTENT_CONFLICT")) intentConflict();
  if (message.includes("TAKEOFF_ITEM_LIST_FORBIDDEN")) {
    throw forbidden("Seuls un administrateur de l’entreprise ou l’ingénieur propriétaire de l’affaire modifient sa liste de postes.");
  }
  if (message.includes("TAKEOFF_ITEM_LIST_STALE") || message.includes("TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT")) {
    throw conflict("La liste des postes a changé depuis votre lecture : rechargez-la.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  if (message.includes("TAKEOFF_ITEM_LIST_INVALID")) {
    throw unprocessableEntity("Ce poste n’est pas valide : vérifiez sa désignation et son unité.", undefined,
      "TAKEOFF_ITEM_LIST_INVALID");
  }
  throw internalError("Impossible d’enregistrer la liste des postes.");
}

type RecordInput = {
  scope: PosteListScope; actor: string; expectedRevision: number; intentKey: string;
  /** The server's digest of the gesture as the member asked it: the same key with another gesture is refused. */
  gestureSha256: string;
  cause: "initial" | "proposal" | "item_added"; sources: Json; revision: Pick<PosteRevision, "items">;
  continuities?: Array<{ sourceKey: string; itemId: string }>;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The digest of a whole gesture: what it read, what it chose and what it adds (selection, section, definition). */
export function itemListGestureDigest(gesture: Record<string, unknown>) {
  return createHash("sha256").update(`takeoff-item-list-gesture-v1:${canonicalJson(gesture)}`).digest("hex");
}

function acceptanceGesture(input: { expectedRevision: number; proposalDigest: string; continuities: ItemListContinuity[] }) {
  return itemListGestureDigest({ kind: "accept", expectedRevision: input.expectedRevision, proposalDigest: input.proposalDigest,
    continuities: input.continuities.map(({ previousItemId, nextItemId }) => [previousItemId, nextItemId]).sort() });
}

function additionGesture(input: ItemListAdditionInput) {
  return itemListGestureDigest({ kind: "add", expectedRevision: input.expectedRevision, label: input.label.trim(),
    expectedUnit: input.expectedUnit, measurementBasis: input.measurementBasis, qualifiers: input.qualifiers,
    sectionOfItemId: input.sectionOfItemId });
}

/** One recorded revision (the database checks the right, the expected revision and the identity rule under its lock). */
export async function recordItemListRevision(service: Client, input: RecordInput) {
  if (input.revision.items.length > ITEM_LIST_LIMITS.items) {
    throw unprocessableEntity("La liste dépasse 10 000 postes : elle ne peut pas être enregistrée.", undefined,
      "TAKEOFF_ITEM_LIST_INVALID");
  }
  // The table's own bounds, named before the database refuses them as a whole.
  const oversized = input.revision.items.find((item) => item.label.length > ITEM_LIST_LIMITS.label
    || Buffer.byteLength(JSON.stringify(item.origin), "utf8") > ITEM_LIST_LIMITS.originBytes);
  if (oversized) {
    throw unprocessableEntity(`Le poste « ${oversized.label.slice(0, 80)}${oversized.label.length > 80 ? "…" : ""} » dépasse la `
      + "taille d’une ligne de la liste (désignation ou notes de la DPGF trop longues) : raccourcissez-la dans la DPGF.",
    undefined, "TAKEOFF_ITEM_LIST_INVALID");
  }
  const { data, error } = await service.rpc("record_takeoff_list_revision", {
    p_tenant_id: input.scope.tenantId, p_project_id: input.scope.projectId, p_actor: input.actor,
    p_expected_revision: input.expectedRevision, p_intent_key: input.intentKey, p_gesture_sha256: input.gestureSha256,
    p_cause: input.cause, p_sources: input.sources,
    p_entries: itemListEntries(input.revision) as unknown as Json,
    p_continuities: (input.continuities ?? []).map(({ sourceKey, itemId }) => ({ source_key: sourceKey, item_id: itemId })),
  });
  if (error) listWriteFailure(error);
  const [recorded] = (data ?? []) as Array<{ revision_id: string; revision: number; content_sha256: string; replayed: boolean }>;
  if (!recorded) throw internalError("Impossible d’enregistrer la liste des postes.");
  return { revisionId: recorded.revision_id, revision: recorded.revision, contentSha256: recorded.content_sha256,
    replayed: recorded.replayed };
}

type Recorded = { revisionId: string; revision: number; contentSha256: string; replayed: boolean };

/** The revision a gesture's key recorded: its receipt when the gesture is the same, a conflict when it is another. */
async function recordedByIntent(client: Client, scope: PosteListScope, intentKey: string, gestureSha256: string) {
  const { data, error } = await client.from("takeoff_list_revisions").select("id, revision, content_sha256, gesture_sha256")
    .eq("tenant_id", scope.tenantId).eq("project_id", scope.projectId).eq("intent_key", intentKey).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire la liste des postes.");
  if (!data) return null;
  if (data.gesture_sha256 !== gestureSha256) intentConflict();
  return replay(data);
}

const replay = (row: { id: string; revision: number; content_sha256: string }): Recorded =>
  ({ revisionId: row.id, revision: row.revision, contentSha256: row.content_sha256, replayed: true });

function intentConflict(): never {
  throw conflict("Cette action a déjà été enregistrée avec un autre contenu : rechargez la liste des postes.", undefined,
    "TAKEOFF_ITEM_LIST_INTENT_CONFLICT");
}

/** The right to write, the database's rule, read before anything a gesture could learn or replay. */
async function requireListWriter(service: Client, scope: PosteListScope, actor: string) {
  const { data, error } = await service.rpc("takeoff_item_list_may_write", { p_tenant_id: scope.tenantId,
    p_project_id: scope.projectId, p_actor: actor });
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les droits sur la liste des postes.");
  if (data !== true) listWriteFailure({ message: "TAKEOFF_ITEM_LIST_FORBIDDEN" });
}

/** A stable key derived from a gesture's key, for the first list it records before its own change. */
function derivedIntent(intentKey: string, purpose: string) {
  const hex = createHash("sha256").update(`takeoff-item-list:${purpose}:${intentKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The first list of an affaire; another gesture that recorded one meanwhile wins, and its list is read. */
async function recordFirstList(service: Client, scope: PosteListScope, input: {
  actor: string; intentKey: string; sources: Json; revision: Pick<PosteRevision, "items">;
}): Promise<StoredItemList> {
  try {
    // The gesture of a first list is the list itself: a concurrent one from other sources is read, never replaced.
    await recordItemListRevision(service, { scope, actor: input.actor, expectedRevision: 0, intentKey: input.intentKey,
      gestureSha256: itemListGestureDigest({ kind: "initial", items: itemListEntries(input.revision) }),
      cause: "initial", sources: input.sources, revision: input.revision });
  } catch (error) {
    if (!(error instanceof ApiError)
      || (error.code !== "TAKEOFF_ITEM_LIST_STALE" && error.code !== "TAKEOFF_ITEM_LIST_INTENT_CONFLICT")) throw error;
  }
  const stored = await readStoredItemList(service, scope);
  if (!stored) throw internalError("Impossible d’enregistrer la liste des postes.");
  return stored;
}

/**
 * Accept the revision the sources propose, as the operator saw it (its digest, on the revision it read), with the
 * continuities they confirmed. The server recomputes it: a source changed since gives a conflict, nothing is written.
 */
export async function acceptItemListProposal(projectId: string, input: {
  expectedRevision: number; proposalDigest: string; intentKey: string; continuities: ItemListContinuity[];
}) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const scope = { tenantId: context.tenantId, projectId: project.id };
  const service = createServiceRoleClient();
  await requireListWriter(service, scope, context.userId);
  // The same gesture again (a lost answer, a double click): the revision it recorded, if it is that acceptance with
  // the same proposal and the same continuities chosen.
  const gestureSha256 = acceptanceGesture(input);
  const earlier = await recordedByIntent(service, scope, input.intentKey, gestureSha256);
  if (earlier) return earlier;
  const [sources, stored] = await Promise.all([resolveItemListSources(scope, service), readStoredItemList(service, scope)]);
  const drafts = sourceDrafts(sources);
  const current = stored?.revision ?? null;
  if ((stored?.row.revision ?? 0) !== input.expectedRevision || !drafts) {
    throw conflict("La liste des postes a changé depuis votre lecture : rechargez-la.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  const proposal = proposeItemListRevision({ scope, current, sourceDrafts: drafts, registeredKeys: stored?.registeredKeys });
  if (!proposal.changed || proposal.candidate.digest !== input.proposalDigest) {
    throw conflict("La révision proposée a changé depuis votre lecture : rechargez la liste.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  let accepted;
  try {
    accepted = proposeItemListRevision({ scope, current, sourceDrafts: drafts, continuities: input.continuities,
      registeredKeys: stored?.registeredKeys });
  } catch {
    throw conflict("Un rapprochement de postes n’est plus proposé : rechargez la liste.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  return recordItemListRevision(service, {
    scope, actor: context.userId, expectedRevision: input.expectedRevision, intentKey: input.intentKey, gestureSha256,
    cause: accepted.cause, sources: sourcesSummary(sources), revision: accepted.candidate, continuities: accepted.continuities,
  });
}

export type ItemListAdditionInput = {
  expectedRevision: number;
  intentKey: string;
  label: string;
  expectedUnit: string | null;
  measurementBasis: string | null;
  qualifiers: PosteQualifiers;
  /** An item of the list whose section the new item joins; none for « Postes ajoutés ». */
  sectionOfItemId: string | null;
};

/**
 * Add an item by hand, at any date: before an analysis, during it or after a first sending. Its author is the member
 * of the session; no quantity or price is asked. A double click replays the same gesture. Without a stored list yet,
 * the first list the sources give is recorded first (an affaire's first list is its instantiation, never a revision
 * applied in its place).
 */
export async function addItemListPoste(projectId: string, input: ItemListAdditionInput) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const scope = { tenantId: context.tenantId, projectId: project.id };
  const service = createServiceRoleClient();
  await requireListWriter(service, scope, context.userId);
  // The same gesture: the same definition in the same section on the revision it read; another one is a conflict.
  const gestureSha256 = additionGesture(input);
  const replayedAddition = () => recordedByIntent(service, scope, input.intentKey, gestureSha256);
  const earlier = await replayedAddition();
  if (earlier) return earlier;
  let stored = await readStoredItemList(service, scope);
  // A first list this same gesture recorded (a double click on an affaire without a list) is its own, not a change.
  const ownFirst = input.expectedRevision === 0 && stored?.history.some(({ intent_key }) =>
    intent_key === derivedIntent(input.intentKey, "initial"));
  if ((stored?.row.revision ?? 0) !== input.expectedRevision && !ownFirst) {
    throw conflict("La liste des postes a changé depuis votre lecture : rechargez-la.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  if (!stored) {
    const sources = await resolveItemListSources(scope, service);
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: sourceDrafts(sources) ?? [] });
    stored = await recordFirstList(service, scope, { actor: context.userId, intentKey: derivedIntent(input.intentKey, "initial"),
      sources: sourcesSummary(sources), revision: first.candidate });
  }
  const section = input.sectionOfItemId
    ? stored.revision.items.find(({ id }) => id === input.sectionOfItemId)?.sections ?? null : null;
  if (input.sectionOfItemId && !section) {
    throw conflict("La section choisie n’est plus dans la liste : rechargez-la.", undefined, "TAKEOFF_ITEM_LIST_STALE");
  }
  const next = withAddedItem(stored.revision, {
    intentId: input.intentKey, addedBy: context.userId, addedAt: new Date().toISOString(), label: input.label,
    expectedUnit: input.expectedUnit, measurementBasis: input.measurementBasis, qualifiers: input.qualifiers,
    sectionPath: section,
  });
  try {
    return await recordItemListRevision(service, {
      scope, actor: context.userId, expectedRevision: stored.row.revision, intentKey: input.intentKey, gestureSha256,
      cause: "item_added",
      sources: stored.row.sources, revision: next,
    });
  } catch (error) {
    // The same gesture recorded by a concurrent call (a double click): its revision is the answer.
    const concurrent = await replayedAddition();
    if (concurrent) return concurrent;
    throw error;
  }
}

/**
 * The list a launch request seals at admission (the second measuring order): the latest stored revision, the first
 * one recorded on the payer's behalf when the affaire has none yet. A DPGF to prepare or to choose suspends the
 * admission (the Mac of the mandate tries again). Nothing here pays or calls a model.
 */
export async function resolveSealableItemList(service: Client, input: { tenantId: string; projectId: string; payerId: string }) {
  const scope = { tenantId: input.tenantId, projectId: input.projectId };
  const sources = await resolveItemListSources(scope, service);
  const drafts = sourceDrafts(sources);
  if (!drafts) return { blocked: "ITEM_LIST_TO_PREPARE" as const, order: null };
  let stored = await readStoredItemList(service, scope);
  if (!stored) {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: drafts });
    stored = await recordFirstList(service, scope, { actor: input.payerId,
      intentKey: derivedIntent(input.projectId, "sealed-initial"), sources: sourcesSummary(sources), revision: first.candidate });
  }
  return {
    order: {
      kind: "item_list" as const, version: 2 as const,
      list: { revision_id: stored.row.id, revision: stored.row.revision, content_sha256: stored.row.content_sha256,
        item_count: stored.row.item_count },
    },
  };
}
