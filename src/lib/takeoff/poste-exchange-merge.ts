import {
  PosteExchangeRefusal,
  posteStoredConfidence,
  posteStoredQuantity,
  type PosteAnswerOutcome,
  type PosteExchangeCall,
  type PosteExchangeOutput,
  type PosteModelReason,
  type PosteObservationMethod,
} from "@/lib/takeoff/poste-exchange";
import { TAKEOFF_ITEM_ANSWER_LIMITS } from "@/lib/takeoff/item-answer-limits";
import type { PosteQualifiers } from "@/lib/takeoff/poste-list";
import {
  listEntryBytes, PUBLISHED_ANSWER_FRAME_MAX_BYTES, publishedObservationMaxBytes, publishedReason,
} from "@/lib/takeoff/poste-publication-size";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { haveComparableQuantities } from "@/lib/takeoff/quantity-compatibility";
import { MEASUREMENT_UNITS, normalizeMeasurementUnit } from "@/lib/units/normalize";

/**
 * From the validated answers of a plan's calls to one answer per requested item on that plan (lot 4): pages mapped back
 * to the plan's original pages, fragments merged (each page counted by its owner fragment only), the vector reading
 * attached to the items it measures, then every answer checked again against the plan before anything publishes it.
 */

/** Why the worker changed or confirmed an answer after the model's reading. */
export const POSTE_MERGE_REASONS = ["UNIT_MISMATCH", "NON_INTEGER_COUNT", "READINGS_DISAGREE", "PAGES_UNREADABLE", "VECTOR_ONLY",
  "DUPLICATE_READING", "SAME_OBJECT_UNCLEAR", "BASIS_MISMATCH", "BASIS_UNSTATED",
  "FIGURE_UNUSABLE", "CANDIDATE_PARTIAL",
  // A total or a candidate value beyond what the publication stores (TAKEOFF_ITEM_ANSWER_LIMITS.value): not a measure.
  "QUANTITY_OUT_OF_RANGE",
  // Vector readings this item matches beyond what one answer holds: kept as the result's own, never attached to it.
  "VECTOR_READINGS_UNATTACHED"] as const;
// The publisher can add one hypothesis reason to an answer measured by the merge, which has none of the merge reasons.
export const POSTE_PUBLICATION_REASONS = ["QUANTITY_ESTIMATED", "NOT_OBSERVABLE"] as const;
export const POSTE_WORKER_REASONS = [...POSTE_MERGE_REASONS, ...POSTE_PUBLICATION_REASONS] as const;
type PosteMergeReason = (typeof POSTE_MERGE_REASONS)[number];
export type PosteWorkerReason = (typeof POSTE_WORKER_REASONS)[number];

export const POSTE_CANDIDATE_REASON_TEXT = {
  READINGS_DISAGREE: "Indice chiffré sur un chevauchement sans confirmation.",
  VECTOR_ONLY: "Tracé vectoriel commun à plusieurs postes.",
} as const;

/** The existing reservation per answer: the bounded explanations fit in it without reducing admission or vector coverage. */
export const POSTE_WORKER_REASONS_RESERVED_BYTES = 13 * listEntryBytes(94);
export type PosteReasonCode = PosteModelReason | PosteWorkerReason;

/** The key of the checks made on the merged plan, where no single call is at fault. */
export const POSTE_MERGED_CHUNK = "plan";

/**
 * contribution: a positive quantity of a measured reading on a page its fragment owns, counted in a measured answer's total
 * (an answer that is not measured has none: its positive readings are candidates);
 * candidate: an indication (a page, a candidate value) that is not a measure; alternative: another reading of an object
 * already read (a reading the model declared of an object it already observed, an overlap page read by the fragment that
 * does not own it, the vector reading of an object the model measured): kept, never added.
 */
export type PosteObservationRole = "contribution" | "candidate" | "alternative";

export type PosteReadingObservation = {
  /** The plan's original page, 1-based. */
  page: number;
  evidence: string;
  method: PosteObservationMethod | "vector_reading";
  /** At the stored precision (four decimals), as it publishes. */
  confidence: number;
  /** At the stored precision (three decimals), as it publishes. */
  quantity: number | null;
  /** The value the model wrote, before its rounding (a whole number is checked on it); none for the vector reading. */
  quantityAsRead: number | null;
  unit: string | null;
  measurementBasis: string | null;
  /** The model's declaration (none for the vector reading): a distinct object or zone, or another reading of one. */
  countsAs: "distinct" | "same_object" | null;
  /** The model says the measure is on the item's requested basis. */
  basisAsRequested: boolean;
  role: PosteObservationRole;
  source: "model" | "vector";
  /** The call it came from (`f1-b2`); null for the vector reading. */
  chunkId: string | null;
  /** The vector reading's own reference on its page, for a vector observation. */
  vectorKey: string | null;
};

export type PosteReason = { code: PosteReasonCode; by: "model" | "worker"; text: string | null; chunkId: string | null };

/** The answer of one item on one plan, ready to publish: one per requested item, also without any quantity. */
export type PostePlanAnswer = {
  itemId: string;
  outcome: PosteAnswerOutcome;
  reasons: PosteReason[];
  /** Original pages searched for the item, and those its reading could not read: together, the plan's whole scope. */
  searchedPages: number[];
  unreadablePages: number[];
  observations: PosteReadingObservation[];
  /** Measured only: the sum of its contributions, in their one unit. */
  quantity: { value: number; unit: string } | null;
  /** Uncertain only: the value its readings suggest, when they suggest one in one unit; never a measure. */
  candidate: { value: number; unit: string } | null;
};

/** One validated call, its pages mapped to the plan's original pages. */
export type PosteFragmentReading = {
  chunkId: string;
  ordinal: number;
  /** The items the call asked (its batch). */
  requestedItemIds: string[];
  /** Original pages the call answers for, and those it read as context only. */
  ownedPages: number[];
  contextPages: number[];
  unreadablePages: number[];
  answers: Array<{
    itemId: string;
    outcome: PosteAnswerOutcome;
    reasonCode: PosteModelReason | null;
    reasonText: string | null;
    unusableFigure?: true;
    searchedPages: number[];
    observations: Array<{
      page: number; evidence: string; method: PosteObservationMethod; confidence: number;
      quantity: number | null; quantityAsRead: number | null; unit: string | null; measurementBasis: string | null;
      countsAs: "distinct" | "same_object"; basisAsRequested: boolean;
    }>;
  }>;
  unlistedFindings: Array<{ page: number; designation: string; evidence: string }>;
  warnings: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
};

/** An item as the merge reads it: what decides its unit, its basis and the vector readings it may receive. */
export type PosteReadingItem = {
  id: string; label: string; expectedUnit: string | null; measurementBasis: string | null; qualifiers: PosteQualifiers;
};

/** A quantity of the vector reading of one of the plan's original pages (vectors/items.ts), as the merge reads it. */
export type PosteVectorReading = {
  key: string;
  page: number;
  kind: "network" | "insulation" | "surface";
  /** A surface's room, as printed in it (vectors/persistence.ts); none for a network. */
  room: string | null;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number;
  evidence: string;
};

export type PostePlanReading = {
  answers: PostePlanAnswer[];
  unlistedFindings: Array<{ page: number; designation: string; evidence: string; chunkId: string }>;
  warnings: Array<{ code: string; message: string; severity: "info" | "warning" | "error"; chunkId: string }>;
  /** Vector readings no requested item matches: kept as the result's own observations, never attached to an item. */
  unattachedVectorReadings: string[];
};

/**
 * A validated answer, its keys mapped to the items and its pages to the plan's original pages, each quantity at the stored
 * precision (the value as read kept beside it).
 */
export function remapPosteFragmentReading(call: PosteExchangeCall, output: PosteExchangeOutput,
  originalPageOf: (pdfPage: number) => number): PosteFragmentReading {
  const offset = call.fragment.startPage - 1;
  const original = (localPage: number) => originalPageOf(offset + localPage);
  const owned = new Set(call.manifest.page_scope.owned_pages);
  return {
    chunkId: call.manifest.chunk_id,
    ordinal: call.ordinal,
    requestedItemIds: [...call.itemIdByKey.values()],
    ownedPages: call.manifest.page_scope.owned_pages.map(original),
    contextPages: call.manifest.page_scope.pages.filter((value) => !owned.has(value)).map(original),
    unreadablePages: output.unreadable_pages.map(original),
    answers: output.responses.map((response) => {
      const itemId = call.itemIdByKey.get(response.post_id);
      if (!itemId) throw new PosteExchangeRefusal("FOREIGN_ITEM", { chunkId: call.manifest.chunk_id, keys: [response.post_id] });
      const observations = response.observations.map((entry) => {
        const figure = entry.unit !== null ? entry.quantity : null;
        return {
          page: original(entry.page), evidence: entry.evidence, method: entry.method, confidence: posteStoredConfidence(entry.confidence),
          quantity: figure === null ? null : posteStoredQuantity(figure), quantityAsRead: figure,
          unit: figure === null ? null : entry.unit, measurementBasis: entry.measurement_basis,
          countsAs: entry.counts_as, basisAsRequested: entry.basis_as_requested,
        };
      });
      const unusable = response.outcome === "uncertain" && (response.observations.some(({ quantity, unit }) => (quantity === null) !== (unit === null))
        || (response.reason_code === "PARTIAL_QUANTITY" && !observations.some(({ quantity }) => quantity !== null)));
      return {
        itemId, outcome: response.outcome, reasonCode: response.reason_code, reasonText: response.reason_text,
        searchedPages: response.searched_pages.map(original), observations,
        ...(unusable ? { unusableFigure: true as const } : {}),
      };
    }),
    unlistedFindings: output.unlisted_findings.map((finding) => ({ ...finding, page: original(finding.page) })),
    warnings: output.warnings.map((warning) => ({ ...warning })),
  };
}

/** Two readings of a length or a surface agree within this share (the gap the DPGF comparison also tolerates). */
const AGREEMENT = 0.01;
const unitsOf = (...dimensions: string[]) => new Set(MEASUREMENT_UNITS.filter((unit) => dimensions.includes(unit.dimension))
  .map((unit) => unit.code));
const COUNT_UNITS = unitsOf("count");
const TOLERANT_UNITS = unitsOf("length", "area");
const unitCode = (unit: string | null) => normalizeMeasurementUnit(unit).unitCode;
/** A length or a surface agrees within 1 %; every other unit (pieces, volumes, masses, sets…) exactly. */
const agree = (left: number, right: number, unit: string | null) => TOLERANT_UNITS.has(unit ?? "")
  ? Math.abs(left - right) <= AGREEMENT * Math.max(Math.abs(left), Math.abs(right)) + 1e-9 : left === right;
const sum = (values: readonly number[]) => posteStoredQuantity(values.reduce((total, value) => total + value, 0));
const sorted = (values: Iterable<number>) => [...new Set(values)].sort((left, right) => left - right);
/** A text compared without case, accents, punctuation or repeated spaces. */
const folded = (value: string) => value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The one unit of these observations' quantities, or null when they have none or several. */
function oneUnitTotal(observations: readonly PosteReadingObservation[]) {
  const counted = observations.filter((entry) => entry.quantity !== null);
  const units = new Set(counted.map((entry) => unitCode(entry.unit)));
  const [unit] = [...units];
  if (!counted.length || units.size !== 1 || !unit) return null;
  return { value: sum(counted.map((entry) => entry.quantity!)), unit };
}

/**
 * The item a vector reading measures: a network or its insulation of the same network, material and size as the item's
 * own words, in a length; a room's surface whose name the item's label holds, in an area.
 */
function vectorMatches(item: PosteReadingItem, reading: PosteVectorReading) {
  if (!item.expectedUnit) return false;
  if (reading.kind === "surface") {
    const room = reading.room ? folded(reading.room) : "";
    return unitCode(item.expectedUnit) === "m2" && room.length > 0 && ` ${folded(item.label)} `.includes(` ${room} `);
  }
  const words = [item.label, item.qualifiers.network, item.qualifiers.material, item.qualifiers.diameter].filter(Boolean).join(" ");
  return haveComparableQuantities({ designation: words, unit: item.expectedUnit, quantity: 1 },
    { designation: reading.designation, unit: reading.unit, quantity: reading.quantity });
}

type Draft = {
  item: PosteReadingItem;
  outcome: PosteAnswerOutcome;
  modelReasons: PosteReason[];
  workerReasons: PosteReason[];
  observations: PosteReadingObservation[];
  searched: Set<number>;
  unreadable: Set<number>;
};

/** A reason of the worker, once per code on an answer (the first call that gave it). */
function flag(draft: Draft, code: PosteMergeReason, chunkId: string | null = null) {
  if (!draft.workerReasons.some((reason) => reason.code === code)) draft.workerReasons.push({ code, by: "worker", text: null, chunkId });
}

function explainCandidate(draft: Draft, code: keyof typeof POSTE_CANDIDATE_REASON_TEXT, chunkId: string | null) {
  const reason = draft.workerReasons.find((entry) => entry.code === code);
  if (reason) Object.assign(reason, { text: POSTE_CANDIDATE_REASON_TEXT[code], chunkId });
  else draft.workerReasons.push({ code, by: "worker", text: POSTE_CANDIDATE_REASON_TEXT[code], chunkId });
}

/**
 * A reason of the model, once per code and text on an answer: the fragments of a plan repeat the same reason (« nothing on
 * these pages »); the first fragment that gave it is kept. An answer then holds at most one reason per fragment and one
 * per code of the worker, within what the publication stores (POSTE_READING_MAX_FRAGMENTS).
 */
function addModelReason(draft: Draft, reason: PosteReason) {
  if (!draft.modelReasons.some((entry) => entry.code === reason.code && entry.text === reason.text)) draft.modelReasons.push(reason);
}

/** A total or a candidate value beyond what the publication stores is not a measure. */
const beyondDomain = (total: { value: number } | null) => total !== null && total.value > TAKEOFF_ITEM_ANSWER_LIMITS.value;
const mergedRefusal = (code: "MISSING_ANSWER" | "PAGE_OUTSIDE_SLICE" | "UNPROCESSED_PAGES", extra: { keys?: string[]; pages?: number[] }) =>
  new PosteExchangeRefusal(code, { chunkId: POSTE_MERGED_CHUNK, ...extra });

/**
 * One item's readings over the calls that asked it (one per fragment of the plan, in its batch): each page counted by its
 * owner fragment, a disagreement on an overlap page kept.
 */
function mergeItem(item: PosteReadingItem, allFragments: readonly PosteFragmentReading[]): Draft {
  const draft: Draft = { item, outcome: "not_found", modelReasons: [], workerReasons: [], observations: [], searched: new Set(),
    unreadable: new Set() };
  const fragments = allFragments.filter((fragment) => fragment.requestedItemIds.includes(item.id));
  // One call per fragment asks an item (its batch): two would read the same pages twice.
  if (new Set(fragments.map((fragment) => fragment.ownedPages.join(","))).size !== fragments.length) {
    throw new Error("An item is asked twice on the same fragment.");
  }
  if (!fragments.length) throw mergedRefusal("MISSING_ANSWER", { keys: [item.id] });
  const ownerOf = new Map<number, string>();
  for (const fragment of fragments) for (const value of fragment.ownedPages) ownerOf.set(value, fragment.chunkId);
  let uncertain = false;
  for (const fragment of fragments) {
    const answer = fragment.answers.find((entry) => entry.itemId === item.id);
    if (!answer) throw mergedRefusal("MISSING_ANSWER", { keys: [item.id] });
    const owned = new Set(fragment.ownedPages);
    answer.searchedPages.filter((value) => owned.has(value)).forEach((value) => draft.searched.add(value));
    fragment.unreadablePages.filter((value) => owned.has(value)).forEach((value) => draft.unreadable.add(value));
    if (answer.outcome === "uncertain") uncertain = true;
    if (answer.unusableFigure) flag(draft, "FIGURE_UNUSABLE", fragment.chunkId);
    if (answer.outcome === "uncertain" || answer.outcome === "not_found") {
      addModelReason(draft, { code: answer.reasonCode!, by: "model", text: answer.reasonText, chunkId: fragment.chunkId });
    }
    for (const entry of answer.observations) {
      // Only a distinct object of a measured reading, on a page its fragment owns, counts; another reading of an object
      // already observed, or of an overlap page, is an alternative.
      const role: PosteObservationRole = !owned.has(entry.page) ? "alternative"
        : answer.outcome !== "measured" ? "candidate" : entry.countsAs === "distinct" ? "contribution" : "alternative";
      draft.observations.push({ ...entry, role, source: "model", chunkId: fragment.chunkId, vectorKey: null });
    }
  }
  if (uncertain) draft.outcome = "uncertain";
  else if (draft.observations.some((entry) => entry.role === "contribution")) draft.outcome = "measured";

  // A reading declared of an object already observed repeats exactly one distinct reading of its page, and agrees with it.
  for (const repeat of draft.observations.filter((entry) => entry.countsAs === "same_object" && entry.role === "alternative"
    && ownerOf.get(entry.page) === entry.chunkId)) {
    const repeated = draft.observations.filter((entry) => entry.role === "contribution" && entry.page === repeat.page
      && entry.chunkId === repeat.chunkId);
    if (repeated.length !== 1) flag(draft, "SAME_OBJECT_UNCLEAR", repeat.chunkId);
    else if (repeat.quantity !== null && (unitCode(repeat.unit) !== unitCode(repeated[0].unit)
      || !agree(repeated[0].quantity!, repeat.quantity, unitCode(repeat.unit)))) flag(draft, "READINGS_DISAGREE", repeat.chunkId);
  }
  // Two distinct readings of one page that nothing tells apart (same evidence, same quantity): never added.
  const seen = new Set<string>();
  for (const entry of draft.observations.filter((observation) => observation.role === "contribution")) {
    const key = `${entry.chunkId}|${entry.page}|${folded(entry.evidence)}|${entry.quantity}|${unitCode(entry.unit)}`;
    if (seen.has(key)) flag(draft, "DUPLICATE_READING", entry.chunkId);
    seen.add(key);
  }

  // An overlap page read by a fragment that does not own it: what it reads on the page must match what the owner reads
  // there (the page's total against the page's total, the distinct readings of each), else both are kept and the
  // answer is uncertain.
  const contexts = new Map<string, PosteReadingObservation[]>();
  for (const entry of draft.observations) {
    if (ownerOf.get(entry.page) === entry.chunkId) continue;
    const key = `${entry.chunkId}|${entry.page}`;
    contexts.set(key, [...(contexts.get(key) ?? []), entry]);
  }
  const pageTotal = (readings: readonly PosteReadingObservation[]) => oneUnitTotal(readings.filter((entry) => entry.countsAs !== "same_object"));
  for (const readings of contexts.values()) {
    const { page, chunkId } = readings[0];
    const ownerReadings = draft.observations.filter((entry) => entry.page === page && entry.chunkId === ownerOf.get(page));
    const contextTotal = pageTotal(readings);
    const ownerTotal = pageTotal(ownerReadings);
    const quantified = readings.some((entry) => entry.quantity !== null);
    const differs = !ownerReadings.length || (quantified && (!contextTotal || !ownerTotal || ownerTotal.unit !== contextTotal.unit
      || !agree(ownerTotal.value, contextTotal.value, ownerTotal.unit)));
    if (differs) flag(draft, "READINGS_DISAGREE", chunkId);
  }
  return draft;
}

/**
 * A vector reading the publication can store as an observation, and whose row the first order's end can write
 * (takeoff_items.quantity is numeric(12,3), its confidence numeric(5,4)): its quantity positive and within the rows' bound
 * at the stored precision, its confidence in [0, 1], its evidence and unit non-blank texts within the command's bounds that
 * the database can store. Any other is never an observation.
 */
function storableVectorReading(reading: PosteVectorReading) {
  const quantity = posteStoredQuantity(reading.quantity);
  const text = (value: string, chars: number) => value.trim().length > 0 && Array.from(value).length <= chars
    && Number.isFinite(jsonbTextBytes(value));
  return Number.isFinite(reading.quantity) && quantity > 0 && quantity <= TAKEOFF_ITEM_ANSWER_LIMITS.itemQuantity
    && Number.isFinite(reading.confidence) && reading.confidence >= 0 && reading.confidence <= 1
    && Number.isInteger(reading.page) && reading.page >= 1
    && text(reading.evidence, TAKEOFF_ITEM_ANSWER_LIMITS.evidenceChars) && text(reading.unit, TAKEOFF_ITEM_ANSWER_LIMITS.unitChars);
}

/**
 * The vector reading attached to the items it measures. A network's reading one item matches is compared with the model's
 * measure on its page (agreeing: kept as an alternative; differing, or alone where the model measured elsewhere: a
 * disagreement). A room's surface, matched by the room's name only, never changes a measure (a wall tiling of the kitchen
 * is not its floor): attached to a measured answer as an alternative for the reviewer. Where the model found nothing,
 * either is an indication to check. A reading several items match is a candidate of each. Never added to a measure, never
 * a measure on its own: marks on a plan stay proposals until a bench qualifies them. A reading is attached while the
 * answer holds fewer than the observations the publication stores of an answer, and while the answers stay within the
 * bytes it stores of them all (`budget`, what the answers without their vector readings leave at most); a reading the
 * publication cannot store is never attached. One left out of an answer stays the result's own when no answer took it,
 * and the answers it matches say so (`VECTOR_READINGS_UNATTACHED`, which makes them uncertain).
 */
function attachVectorReadings(drafts: readonly Draft[], readings: readonly PosteVectorReading[], budget: { left: number }) {
  const unattached: string[] = [];
  const shared = new Set<string>();
  for (const reading of readings) {
    const matched = drafts.filter((draft) => vectorMatches(draft.item, reading));
    if (!storableVectorReading(reading)) {
      matched.forEach((draft) => flag(draft, "VECTOR_READINGS_UNATTACHED"));
      unattached.push(reading.key);
      continue;
    }
    if (matched.length > 1) shared.add(reading.key);
    const quantity = posteStoredQuantity(reading.quantity);
    let attached = false;
    for (const draft of matched) {
      const modelOnPage = draft.observations.filter((entry) => entry.source === "model" && entry.role === "contribution"
        && entry.page === reading.page);
      const modelTotal = oneUnitTotal(modelOnPage);
      const unique = matched.length === 1;
      const corroborates = unique && modelTotal !== null && modelTotal.unit === unitCode(reading.unit)
        && agree(modelTotal.value, quantity, modelTotal.unit);
      const observation: PosteReadingObservation = { page: reading.page, evidence: reading.evidence, method: "vector_reading",
        confidence: posteStoredConfidence(reading.confidence), quantity, quantityAsRead: null, unit: reading.unit, measurementBasis: null,
        countsAs: null, basisAsRequested: false, role: unique && draft.outcome === "measured" ? "alternative" : "candidate", source: "vector",
        chunkId: null, vectorKey: reading.key };
      const cost = listEntryBytes(publishedObservationMaxBytes(observation));
      if (draft.observations.length >= TAKEOFF_ITEM_ANSWER_LIMITS.observations || cost > budget.left) {
        flag(draft, "VECTOR_READINGS_UNATTACHED");
        continue;
      }
      budget.left -= cost;
      attached = true;
      draft.observations.push(observation);
      if (draft.outcome === "not_found") {
        draft.outcome = "uncertain";
        flag(draft, "VECTOR_ONLY");
      } else if (reading.kind !== "surface" && unique && draft.outcome === "measured" && !corroborates) {
        flag(draft, "READINGS_DISAGREE");
      }
    }
    if (!attached) unattached.push(reading.key);
  }
  return { unattached, shared };
}

/**
 * The most bytes a draft's answer takes in the publication without vector readings, whatever its end: its frame, every
 * reason the worker may add (one per code), the model's reasons, its pages and its observations at their longest.
 */
function publishedDraftMaxBytes(draft: Draft) {
  const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);
  return listEntryBytes(PUBLISHED_ANSWER_FRAME_MAX_BYTES) + POSTE_WORKER_REASONS_RESERVED_BYTES
    + total(draft.modelReasons.map((reason) => listEntryBytes(jsonbTextBytes(publishedReason(reason)))))
    + total([...draft.searched, ...draft.unreadable].map((page) => listEntryBytes(String(page).length)))
    + total(draft.observations.map((entry) => listEntryBytes(publishedObservationMaxBytes(entry))));
}

/** A measure has a basis; a count has none. */
const isMeasure = (entry: PosteReadingObservation) => !COUNT_UNITS.has(unitCode(entry.unit) ?? "");
/** A scaled measure that states no basis: the basis it was measured on is not known. */
const unstatedBasis = (entry: PosteReadingObservation) => entry.method === "scaled_measure" && !entry.measurementBasis;
/** A basis the reading states that is not the item's requested one (compared without case, accents or punctuation). */
const contradictsBasis = (item: PosteReadingItem, entry: PosteReadingObservation) => item.measurementBasis !== null
  && entry.measurementBasis !== null && folded(entry.measurementBasis) !== folded(item.measurementBasis);
/** On the item's requested basis: declared so, its stated basis (if any) the requested one, a scaled measure stating it. */
const onRequestedBasis = (item: PosteReadingItem, entry: PosteReadingObservation) => entry.basisAsRequested
  && !contradictsBasis(item, entry) && !unstatedBasis(entry);

/**
 * What makes a sum of measures mix bases (a count has none): a scaled measure that states none; on an item that names its
 * basis, a measure the model does not say is on it or whose stated basis is another; on an item that names none,
 * measures stated on two bases. What the model declares is trusted: two readings it declares distinct and on the
 * requested basis add up.
 */
function basisReason(item: PosteReadingItem, contributions: readonly PosteReadingObservation[]): PosteMergeReason | null {
  const measures = contributions.filter(isMeasure);
  if (!measures.length) return null;
  if (item.measurementBasis && measures.some((entry) => !entry.basisAsRequested || contradictsBasis(item, entry))) return "BASIS_MISMATCH";
  if (measures.some(unstatedBasis)) return "BASIS_UNSTATED";
  if (item.measurementBasis) return null;
  const stated = new Set(measures.flatMap((entry) => entry.measurementBasis ? [folded(entry.measurementBasis)] : []));
  return stated.size > 1 ? "BASIS_MISMATCH" : null;
}

/**
 * The model's readings an uncertain answer's candidate may add, never a sum its bases refused: its counts, and its
 * measures on one basis (on an item that names its basis, those on it; on an item that names none, those whose basis is
 * known, and none when they state two).
 */
function candidateReadings(item: PosteReadingItem, observations: readonly PosteReadingObservation[]) {
  const counts = observations.filter((entry) => !isMeasure(entry));
  const measures = observations.filter((entry) => isMeasure(entry)
    && (item.measurementBasis ? onRequestedBasis(item, entry) : !unstatedBasis(entry)));
  const stated = new Set(measures.flatMap((entry) => entry.measurementBasis ? [folded(entry.measurementBasis)] : []));
  return !item.measurementBasis && stated.size > 1 ? counts : [...counts, ...measures];
}

const candidateLocation = (entry: PosteReadingObservation) => `${entry.source}|${entry.page}|${folded(entry.evidence)}`;
const candidateKey = (entry: PosteReadingObservation) =>
  `${candidateLocation(entry)}|${entry.quantity}|${unitCode(entry.unit)}`;

/** The candidate value of an uncertain answer: each distinct reading once. */
function candidateTotal(observations: readonly PosteReadingObservation[]) {
  const once = new Map<string, PosteReadingObservation>();
  for (const entry of observations) {
    if (entry.countsAs === "same_object") continue;
    once.set(candidateKey(entry), entry);
  }
  return oneUnitTotal([...once.values()]);
}

function findCandidate(draft: Draft, sharedVectorReadings: ReadonlySet<string>) {
  const model = draft.observations.filter((entry) => entry.source === "model" && entry.quantity !== null);
  const owned = model.filter((entry) => entry.role !== "alternative");
  const vectors = draft.observations.filter((entry) => entry.source === "vector" && entry.role === "candidate");
  if (!owned.length && draft.workerReasons.some(({ code }) => code === "FIGURE_UNUSABLE")) return null;
  const shared = (entry: PosteReadingObservation) => sharedVectorReadings.has(entry.vectorKey ?? "");
  const distinct = owned.filter((entry) => entry.countsAs !== "same_object");
  const eligible = owned.length ? candidateReadings(draft.item, owned).filter((entry) => entry.countsAs !== "same_object")
    : vectors.filter((entry) => !shared(entry));
  const candidate = candidateTotal(eligible);

  if (beyondDomain(candidate)) {
    flag(draft, "QUANTITY_OUT_OF_RANGE");
    return null;
  }
  if (candidate) {
    const kept = new Set(eligible);
    const keptLocations = new Set(eligible.map(candidateLocation));
    const omitted = distinct.some((entry) => !kept.has(entry)) || (!owned.length && vectors.some(shared))
      || model.some((entry) => entry.role === "alternative" && entry.countsAs !== "same_object" && !keptLocations.has(candidateLocation(entry)));
    if (omitted) flag(draft, "CANDIDATE_PARTIAL");
    return candidate;
  }
  if (eligible.length) flag(draft, "UNIT_MISMATCH");
  else if (distinct.length) flag(draft, basisReason(draft.item, distinct) ?? "BASIS_MISMATCH");
  else if (owned.length) flag(draft, "SAME_OBJECT_UNCLEAR", owned[0].chunkId);
  else {
    const overlap = model.find((entry) => entry.countsAs !== "same_object");
    const repeated = model[0];
    if (overlap) explainCandidate(draft, "READINGS_DISAGREE", overlap.chunkId);
    else if (repeated) flag(draft, "SAME_OBJECT_UNCLEAR", repeated.chunkId);
    if (vectors.some(shared)) explainCandidate(draft, "VECTOR_ONLY", null);
  }
  return null;
}

/**
 * The answer of a draft: the unit, the basis and the coverage checked, its total or its candidate value (the model's
 * indications on one basis, else a vector reading only this item matches; a reading other items may claim suggests no
 * value). A total or a candidate value beyond what the publication stores is none: the answer is uncertain
 * (`QUANTITY_OUT_OF_RANGE`), without a value, its readings kept as candidates.
 */
function finalize(draft: Draft, sharedVectorReadings: ReadonlySet<string>): PostePlanAnswer {
  const contributions = draft.observations.filter((entry) => entry.role === "contribution");
  if (draft.outcome === "measured" || contributions.length) {
    const expected = unitCode(draft.item.expectedUnit);
    const units = new Set(contributions.map((entry) => unitCode(entry.unit)));
    const basis = basisReason(draft.item, contributions);
    if (units.has(null) || units.size > 1 || (expected !== null && [...units].some((unit) => unit !== expected))) {
      flag(draft, "UNIT_MISMATCH");
    } else if (contributions.some((entry) => !isMeasure(entry) && !Number.isInteger(entry.quantityAsRead ?? entry.quantity))) {
      flag(draft, "NON_INTEGER_COUNT");
    } else if (basis) {
      flag(draft, basis);
    }
  }
  if (draft.unreadable.size) flag(draft, "PAGES_UNREADABLE");
  if (draft.outcome === "measured" && beyondDomain(oneUnitTotal(contributions))) flag(draft, "QUANTITY_OUT_OF_RANGE");
  if (draft.workerReasons.length && draft.outcome !== "uncertain") draft.outcome = "uncertain";
  // Only a measured answer counts: the positive readings of any other answer are candidates, never contributions.
  if (draft.outcome !== "measured") {
    draft.observations = draft.observations.map((entry) => entry.role === "contribution" ? { ...entry, role: "candidate" } : entry);
  }
  const measured = draft.outcome === "measured" ? oneUnitTotal(contributions) : null;
  const candidate = draft.outcome === "uncertain" ? findCandidate(draft, sharedVectorReadings) : null;
  const reasons = draft.outcome === "not_found" ? draft.modelReasons
    : [...draft.modelReasons.filter((reason) => reason.code !== "NO_INDICATION"), ...draft.workerReasons];
  return {
    itemId: draft.item.id, outcome: draft.outcome, reasons, searchedPages: sorted(draft.searched), unreadablePages: sorted(draft.unreadable),
    observations: draft.observations, quantity: measured, candidate,
  };
}

/**
 * The answers of one plan from its validated calls: for each item, the readings of every fragment merged, its pages
 * counted by their owner fragment only, the vector reading attached, the unit and the plan's coverage checked; then
 * checked again as a whole (one answer per item, every page the plan's, every page searched or unreadable).
 */
export function mergePosteReadings(input: {
  items: readonly PosteReadingItem[];
  /** The plan's original pages the reading covers. */
  planPages: readonly number[];
  fragments: readonly PosteFragmentReading[];
  vectorReadings?: readonly PosteVectorReading[];
}): PostePlanReading {
  if (new Set(input.items.map((item) => item.id)).size !== input.items.length) throw new Error("An item is requested twice.");
  const drafts = input.items.map((item) => mergeItem(item, input.fragments));
  // Vector readings exist only for the plan's own pages; another page's reading is never this plan's. They take what the
  // answers without them leave of the bytes the publication stores (the brackets of the list included).
  const planPages = new Set(input.planPages);
  const budget = { left: TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes - 2 - drafts.reduce((sum, draft) => sum + publishedDraftMaxBytes(draft), 0) };
  const vectors = attachVectorReadings(drafts, (input.vectorReadings ?? []).filter((reading) => planPages.has(reading.page)), budget);
  const answers = drafts.map((draft) => finalize(draft, vectors.shared));
  assertExactPlanReading(answers, input.items, input.planPages);
  const findings = new Map<string, PostePlanReading["unlistedFindings"][number]>();
  const warnings = new Map<string, PostePlanReading["warnings"][number]>();
  for (const fragment of input.fragments) {
    for (const finding of fragment.unlistedFindings) {
      const key = `${finding.page}:${finding.designation.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (!findings.has(key)) findings.set(key, { ...finding, chunkId: fragment.chunkId });
    }
    for (const warning of fragment.warnings) {
      const key = `${warning.code}:${warning.message}`;
      if (!warnings.has(key)) warnings.set(key, { ...warning, chunkId: fragment.chunkId });
    }
  }
  return { answers, unlistedFindings: [...findings.values()], warnings: [...warnings.values()],
    unattachedVectorReadings: vectors.unattached };
}

/**
 * The checks of the exchange, again on the merged plan: one answer per requested item and no other, every page the
 * plan's, and for each item every page of the plan searched or unreadable. A fragment missing, a page mapped twice or
 * onto another plan stops the publication here.
 */
function assertExactPlanReading(answers: readonly PostePlanAnswer[], items: readonly PosteReadingItem[], planPages: readonly number[]) {
  const requested = new Set(items.map((item) => item.id));
  const answered = new Set(answers.map((answer) => answer.itemId));
  if (answers.length !== requested.size || answered.size !== answers.length || [...answered].some((id) => !requested.has(id))) {
    throw mergedRefusal("MISSING_ANSWER", { keys: [...requested].filter((id) => !answered.has(id)) });
  }
  const scope = new Set(planPages);
  const outside = sorted(answers.flatMap((answer) => [...answer.searchedPages, ...answer.unreadablePages,
    ...answer.observations.map((entry) => entry.page)]).filter((value) => !scope.has(value)));
  if (outside.length) throw mergedRefusal("PAGE_OUTSIDE_SLICE", { pages: outside });
  const keys: string[] = [];
  const pages = new Set<number>();
  for (const answer of answers) {
    const covered = new Set([...answer.searchedPages, ...answer.unreadablePages]);
    const left = planPages.filter((value) => !covered.has(value));
    if (!left.length) continue;
    keys.push(answer.itemId);
    left.forEach((value) => pages.add(value));
  }
  if (keys.length) throw mergedRefusal("UNPROCESSED_PAGES", { keys, pages: sorted(pages) });
}
