import { z } from "zod";

import type { TakeoffPdfChunk } from "@/lib/takeoff/chunking";
import type { Poste, PosteQualifiers } from "@/lib/takeoff/poste-list";
import { promptLine } from "@/lib/takeoff/prompt-text";

/**
 * The exchange of the second measuring order (lot 4): one plan read against the affaire's sealed list of items
 * (« postes »). For every call the server builds a bounded manifest, one fragment of the plan's PDF and one batch of
 * items, and the model answers every item of the batch: measured, uncertain or not found, with the pages it searched,
 * its reason and its localized evidence, also without a quantity. The model is never given an identifier of the
 * database, a price, a reference quantity of the DPGF or a quantity of the estimate: its items are named by opaque keys
 * of the request (`P0001`…), mapped back by the server. Every answer is checked against the call that asked it before
 * anything else reads it (`validatePosteExchangeOutput`); a missing answer, a foreign key, a page outside the fragment or
 * a page left unsearched stops the plan's analysis with an explicit error, never a silent « not found ».
 */
export const POSTE_EXCHANGE_SCHEMA_VERSION = "v3";
export const POSTE_EXCHANGE_PROMPT_VERSION = "takeoff-c-postes-v2";

/**
 * The bounds of one call. A batch holds at most `itemsPerCall` items and `batchBytes` of their entries (an item longer than
 * that is asked alone, whole: what tells two items apart is never cut); an answer at most `observationsPerAnswer`
 * observations (about one per page of a fragment) and the whole answer at most `observationsPerCall`; the texts are short
 * (the evidence and the reason are one sentence). `pages` is the most pages a fragment can hold (the tenant's PDF page
 * limit). A quantity is admitted when it is positive and below 10⁹ at the stored precision (`takeoff_items.quantity`, three
 * decimals), the precision its reading keeps. Starting values, to measure on the bench before the second order is
 * activated.
 */
export const POSTE_EXCHANGE_LIMITS = {
  itemsPerCall: 40,
  batchBytes: 64 * 1024,
  pages: 200,
  basisChars: 120,
  unitChars: 32,
  evidenceChars: 160,
  reasonChars: 160,
  observationsPerAnswer: 16,
  observationsPerCall: 160,
  unlistedFindings: 20,
  designationChars: 160,
  warnings: 20,
  warningChars: 300,
  /** A quantity read on a plan stays below this: a larger figure is not a reading. */
  quantity: 1_000_000_000,
  quantityDecimals: 3,
} as const;

/**
 * A quantity at the stored precision, rounded half up on its decimal writing (as the database rounds the number it is
 * given): 1.2345 is 1.235, 0.0000004 is 0.
 */
export function posteStoredQuantity(value: number) {
  const shift = (written: number, by: number) => {
    const [mantissa, exponent = "0"] = String(written).split("e");
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };
  return shift(Math.round(shift(value, POSTE_EXCHANGE_LIMITS.quantityDecimals)), -POSTE_EXCHANGE_LIMITS.quantityDecimals);
}

/**
 * A confidence at the stored precision (four decimals, as takeoff_items.confidence keeps it, numeric(5,4)): its text, as
 * JSON and the database write it, is never longer than « 0.0001 ».
 */
export function posteStoredConfidence(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** How an observation counts: a distinct object or zone, or another reading of one already observed on its page. */
export const POSTE_OBSERVATION_COUNTS = ["distinct", "same_object"] as const;

/** How the model read an observation; the worker adds `vector_reading` for the vector reading of the original PDF. */
export const POSTE_OBSERVATION_METHODS = ["symbol_count", "table_reading", "annotation", "scaled_measure", "other"] as const;
export type PosteObservationMethod = (typeof POSTE_OBSERVATION_METHODS)[number];

/** Why an answer is uncertain, as the model may say it. */
export const POSTE_UNCERTAIN_REASONS = [
  "AMBIGUOUS_INDICATION", "PARTIAL_QUANTITY", "CONTRADICTORY_EVIDENCE", "SCALE_UNKNOWN", "UNIT_OR_BASIS_UNCLEAR",
  "QUALIFIER_UNREADABLE", "ESTIMATE", "OTHER",
] as const;
/** Why an answer is « not found »: every page of the fragment was searched without any indication. */
export const POSTE_NOT_FOUND_REASONS = ["NO_INDICATION"] as const;
export type PosteModelReason = (typeof POSTE_UNCERTAIN_REASONS)[number] | (typeof POSTE_NOT_FOUND_REASONS)[number];

export const POSTE_ANSWER_OUTCOMES = ["measured", "uncertain", "not_found"] as const;
export type PosteAnswerOutcome = (typeof POSTE_ANSWER_OUTCOMES)[number];

const L = POSTE_EXCHANGE_LIMITS;
const page = z.number().int().min(1).max(L.pages);
/** Pages, each listed once. */
const pages = (min = 0) => z.array(page).min(min).max(L.pages)
  .refine((values) => new Set(values).size === values.length, { message: "Chaque page n’est citée qu’une fois." });
/**
 * A text on one line (control characters become spaces, a lone surrogate the replacement character: what its JSON writes
 * in at most three bytes a character), then bounded.
 */
const text = (max: number) => z.string().transform((value) => value.toWellFormed().replace(/[\p{Cc}\s]+/gu, " ").trim())
  .pipe(z.string().min(1).max(max));
const confidence = z.number().finite().min(0).max(1);
const itemKey = z.string().regex(/^P\d{4,5}$/);
/**
 * A quantity as the model wrote it (a whole number is checked on it), admitted when it is positive and below the bound at
 * the stored precision: a figure that rounds to nothing is not a measure. Its reading rounds it (`posteStoredQuantity`).
 */
const quantity = z.number().finite().refine((value) => {
  const stored = posteStoredQuantity(value);
  return stored > 0 && stored < L.quantity;
}, { message: `Une quantité est positive et inférieure à ${L.quantity} à trois décimales.` });
/**
 * What an observation counts (a distinct object or zone, or another reading of one already observed: only distinct ones
 * add up), and whether it is on the item's requested basis (when the item names one).
 */
const counting = { counts_as: z.enum(POSTE_OBSERVATION_COUNTS), basis_as_requested: z.boolean() };

/** An observation of a measured answer: a page of the fragment, a positive quantity and its unit. */
const measuredObservation = z.object({
  page, evidence: text(L.evidenceChars), method: z.enum(POSTE_OBSERVATION_METHODS), confidence,
  quantity, unit: text(L.unitChars), measurement_basis: text(L.basisChars).nullable(), ...counting,
}).strict();
/** An indication locates an obstacle or a figure. The worker only keeps figures with both fields. */
const indication = measuredObservation.extend({ quantity: quantity.nullable().default(null), unit: text(L.unitChars).nullable().default(null) });

export const PosteExchangeAnswerSchema = z.discriminatedUnion("outcome", [
  z.object({
    post_id: itemKey, outcome: z.literal("measured"), searched_pages: pages(1),
    reason_code: z.null(), reason_text: z.null(),
    observations: z.array(measuredObservation).min(1).max(L.observationsPerAnswer),
  }).strict(),
  z.object({
    post_id: itemKey, outcome: z.literal("uncertain"), searched_pages: pages(),
    reason_code: z.enum(POSTE_UNCERTAIN_REASONS), reason_text: text(L.reasonChars),
    observations: z.array(indication).max(L.observationsPerAnswer),
  }).strict(),
  z.object({
    post_id: itemKey, outcome: z.literal("not_found"), searched_pages: pages(1),
    reason_code: z.enum(POSTE_NOT_FOUND_REASONS), reason_text: text(L.reasonChars),
    observations: z.array(indication).max(0),
  }).strict(),
]);

/** The model's answer to one call: one response per requested item, the pages it could not read, and what it saw outside the list. */
export const PosteExchangeOutputSchema = z.object({
  schema_version: z.literal(POSTE_EXCHANGE_SCHEMA_VERSION),
  prompt_version: z.literal(POSTE_EXCHANGE_PROMPT_VERSION),
  chunk_id: z.string().regex(/^f\d{1,3}-b\d{1,4}$/),
  responses: z.array(PosteExchangeAnswerSchema).max(L.itemsPerCall),
  unreadable_pages: pages(),
  unlisted_findings: z.array(z.object({
    page, designation: text(L.designationChars), evidence: text(L.evidenceChars),
  }).strict()).max(L.unlistedFindings),
  warnings: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), message: text(L.warningChars),
    severity: z.enum(["info", "warning", "error"]),
  }).strict()).max(L.warnings),
}).strict().superRefine((output, context) => {
  const observations = output.responses.reduce((sum, response) => sum + response.observations.length, 0);
  if (observations > L.observationsPerCall) {
    context.addIssue({ code: "custom", path: ["responses"],
      message: `Au plus ${L.observationsPerCall} observations par réponse (${observations} reçues).` });
  }
});

export type PosteExchangeAnswer = z.infer<typeof PosteExchangeAnswerSchema>;
export type PosteExchangeOutput = z.infer<typeof PosteExchangeOutputSchema>;

/** An item as the model receives it: its opaque key, never its identifier, its reference quantity or a price. */
export type PosteExchangeRequestedItem = {
  post_id: string;
  label: string;
  expected_unit: string | null;
  measurement_basis: string | null;
  qualifiers: PosteQualifiers;
  section: string[];
};

/** What one call asks, as the prompt carries it (internal field names, never the screen's words). */
export type PosteExchangeManifest = {
  schema_version: typeof POSTE_EXCHANGE_SCHEMA_VERSION;
  prompt_version: typeof POSTE_EXCHANGE_PROMPT_VERSION;
  /** The sealed list's revision number: what the request asks, never its identifier. */
  list_revision: number;
  chunk_id: string;
  /** Pages of the attached PDF, numbered from 1: all of them, those the call answers for, and those read as context. */
  page_scope: { pages: number[]; owned_pages: number[]; context_pages: number[] };
  requested_posts: PosteExchangeRequestedItem[];
};

/** One call of a plan's reading, as the server keeps it: what it sends, and how its answer maps back. */
export type PosteExchangeCall = {
  manifest: PosteExchangeManifest;
  /** 1-based, fragments first then batches: the call's place in the plan's reading. */
  ordinal: number;
  /** The fragment of the plan's PDF it attaches (pages of that PDF, 1-based). */
  fragment: TakeoffPdfChunk;
  /** The pages of that PDF the call answers for (each page has one owner fragment). */
  ownedPages: number[];
  /** The item each opaque key names. */
  itemIdByKey: ReadonlyMap<string, string>;
};

export type PosteExchangeRefusalCode =
  | "INVALID_OUTPUT" | "OUTPUT_VERSION" | "OUTPUT_TOO_LARGE" | "FOREIGN_ITEM" | "DUPLICATE_ANSWER" | "MISSING_ANSWER"
  | "PAGE_OUTSIDE_SLICE" | "UNPROCESSED_PAGES";

/** An answer that cannot be published: the plan's analysis stops with it, nothing of the call is kept. */
export class PosteExchangeRefusal extends Error {
  constructor(readonly code: PosteExchangeRefusalCode, readonly details: { chunkId: string; keys?: string[]; pages?: number[] }) {
    super(describePosteExchangeRefusal(code, details));
    this.name = "PosteExchangeRefusal";
  }
}

/** The opaque key of the item at `position` (0-based) of a request's items. */
export function posteExchangeKey(position: number) {
  return `P${String(position + 1).padStart(4, "0")}`;
}

/** The key of a call: its fragment and its batch, 1-based. */
export function posteExchangeChunkId(fragmentIndex: number, batchIndex: number) {
  return `f${fragmentIndex + 1}-b${batchIndex + 1}`;
}

/** Never cut: a stored text goes whole (its own bounds are the list's), only put on one line. */
const whole = (value: string | null | undefined, fallback = "") => promptLine(value, Number.MAX_SAFE_INTEGER, fallback);

/**
 * A requested item as the model reads it: its texts whole and on one line (what tells two items apart is never cut),
 * nothing else of the stored entry.
 */
export function posteExchangeRequestedItem(key: string, item: Poste): PosteExchangeRequestedItem {
  const qualifiers = Object.fromEntries(Object.entries(item.qualifiers ?? {})
    .map(([name, value]) => [name, whole(value)])
    .filter(([, value]) => value)) as PosteQualifiers;
  return {
    post_id: key,
    label: whole(item.label, "(sans libellé)"),
    expected_unit: whole(item.expectedUnit) || null,
    measurement_basis: whole(item.measurementBasis) || null,
    qualifiers,
    section: item.sections.map((section) => whole(section.title)).filter(Boolean),
  };
}

/**
 * The batches of a plan's items, in the list's order: at most `itemsPerCall` items and `batchBytes` of their entries each;
 * an item longer than that is asked alone. The admission's bounds count the same batches.
 */
export function planPosteBatches<T extends Poste>(items: readonly T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 2;
  items.forEach((item, position) => {
    const size = Buffer.byteLength(JSON.stringify(posteExchangeRequestedItem(posteExchangeKey(position), item)), "utf8") + 1;
    if (current.length && (current.length >= L.itemsPerCall || bytes + size > L.batchBytes)) {
      batches.push(current);
      current = [];
      bytes = 2;
    }
    current.push(item);
    bytes += size;
  });
  if (current.length) batches.push(current);
  return batches;
}

const range = (first: number, last: number) =>
  Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => first + offset);

/**
 * The calls of one plan's reading: every fragment of its PDF crossed with every batch of the requested items, in the
 * list's order. Each fragment answers for the pages it owns (`ownedPages`, from `ownedChunkPages`) and reads the others
 * as context; each item keeps one opaque key over all the calls of the plan.
 */
export function planPosteExchangeCalls(input: {
  listRevision: number;
  items: readonly Poste[];
  fragments: readonly TakeoffPdfChunk[];
  ownedPages: readonly (readonly number[])[];
}): PosteExchangeCall[] {
  if (input.items.length === 0) throw new Error("A reading against the list needs at least one item.");
  if (input.fragments.length === 0 || input.fragments.length !== input.ownedPages.length) {
    throw new Error("Each fragment of the plan needs its owned pages.");
  }
  let position = 0;
  const batches = planPosteBatches(input.items).map((batch) => batch.map((item) => ({ key: posteExchangeKey(position++), item })));
  const calls: PosteExchangeCall[] = [];
  input.fragments.forEach((fragment, fragmentIndex) => {
    const offset = fragment.startPage - 1;
    const local = range(1, fragment.endPage - fragment.startPage + 1);
    const owned = input.ownedPages[fragmentIndex].map((value) => value - offset);
    const ownedSet = new Set(owned);
    batches.forEach((batch, batchIndex) => {
      calls.push({
        ordinal: calls.length + 1,
        fragment: { ...fragment },
        ownedPages: [...input.ownedPages[fragmentIndex]],
        itemIdByKey: new Map(batch.map(({ key, item }) => [key, item.id])),
        manifest: {
          schema_version: POSTE_EXCHANGE_SCHEMA_VERSION,
          prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
          list_revision: input.listRevision,
          chunk_id: posteExchangeChunkId(fragmentIndex, batchIndex),
          page_scope: { pages: local, owned_pages: owned, context_pages: local.filter((value) => !ownedSet.has(value)) },
          requested_posts: batch.map(({ key, item }) => posteExchangeRequestedItem(key, item)),
        },
      });
    });
  });
  return calls;
}

/** The longest of these codes: its JSON is the longest. */
const longest = <T extends string>(values: readonly T[]) => values.reduce((left, right) => right.length > left.length ? right : left);

/**
 * The bound of an answer to one call of `items` items on a fragment of `fragmentPages` pages, derived from the schema's own
 * limits: every text at its bound in three-byte characters (once read, a text holds no control character and no lone
 * surrogate, and « " » or « \\ » take two), every list full with each page once, every number and code at its longest
 * writing. An answer its call accepts (its own keys and pages only, each page once) is never larger. What the bounds of a
 * request are measured on.
 */
export function posteExchangeWorstCaseOutput(items: number, fragmentPages: number): PosteExchangeOutput {
  const long = (chars: number) => "€".repeat(chars);
  // The highest pages (three digits each), one per page of the fragment.
  const pagesList = range(L.pages - fragmentPages + 1, L.pages);
  // The longest writings of their ranges (a double writes at most 17 significant digits): a confidence in [0, 1], « 0.00000 »
  // and 17 digits (24 characters; an exponent writes at most 23); a quantity positive at three decimals (at least 0.0005),
  // 21 characters (« 0.000 » and 16 digits below 0.001, where two doubles are farther apart than 10⁻¹⁹; « 0.00 » and 17 above).
  const observation = { page: L.pages, evidence: long(L.evidenceChars), method: longest(POSTE_OBSERVATION_METHODS),
    confidence: 0.0000017333176667161978, quantity: 0.0007509328246261776, unit: long(L.unitChars), measurement_basis: long(L.basisChars),
    counts_as: longest(POSTE_OBSERVATION_COUNTS), basis_as_requested: false };
  let left = L.observationsPerCall;
  const responses = Array.from({ length: items }, () => {
    const count = Math.min(L.observationsPerAnswer, left);
    left -= count;
    return { post_id: "P99999", outcome: "uncertain" as const, searched_pages: pagesList,
      reason_code: longest(POSTE_UNCERTAIN_REASONS), reason_text: long(L.reasonChars),
      observations: Array.from({ length: count }, () => observation) };
  });
  return {
    schema_version: POSTE_EXCHANGE_SCHEMA_VERSION, prompt_version: POSTE_EXCHANGE_PROMPT_VERSION, chunk_id: "f999-b9999",
    responses, unreadable_pages: pagesList,
    unlisted_findings: Array.from({ length: L.unlistedFindings }, () => ({ page: L.pages, designation: long(L.designationChars),
      evidence: long(L.evidenceChars) })),
    warnings: Array.from({ length: L.warnings }, () => ({ code: `W${"9".repeat(63)}`, message: long(L.warningChars),
      severity: "warning" as const })),
  };
}

/** The most bytes the answer to one call can take (UTF-8 JSON), measured on `posteExchangeWorstCaseOutput`. */
export function posteExchangeOutputMaxBytes(items: number, fragmentPages: number) {
  return Buffer.byteLength(JSON.stringify(posteExchangeWorstCaseOutput(items, fragmentPages)), "utf8");
}

/**
 * Checks the answer of one call against the call (section 3.2 of the exchange contract): its version and key, one
 * response for each requested item and none other, every page inside the attached fragment, its size, and every page the
 * call owns either searched or declared unreadable for each item. Throws the first refusal; nothing of the call is used
 * then. The size is checked once keys and pages are the call's: an answer it accepts stays within the bound derived from
 * the schema, which is then a guard, never a limit a valid answer meets.
 */
export function validatePosteExchangeOutput(call: PosteExchangeCall, output: PosteExchangeOutput): void {
  const chunkId = call.manifest.chunk_id;
  const refuse = (code: PosteExchangeRefusalCode, extra: { keys?: string[]; pages?: number[] } = {}): never => {
    throw new PosteExchangeRefusal(code, { chunkId, ...extra });
  };
  if (output.schema_version !== call.manifest.schema_version || output.prompt_version !== call.manifest.prompt_version
    || output.chunk_id !== chunkId) refuse("OUTPUT_VERSION");
  const requested = new Set(call.manifest.requested_posts.map((entry) => entry.post_id));
  const foreign = output.responses.map((response) => response.post_id).filter((key) => !requested.has(key));
  if (foreign.length) refuse("FOREIGN_ITEM", { keys: [...new Set(foreign)] });
  const answered = new Set<string>();
  const twice = new Set<string>();
  for (const response of output.responses) {
    if (answered.has(response.post_id)) twice.add(response.post_id);
    answered.add(response.post_id);
  }
  if (twice.size) refuse("DUPLICATE_ANSWER", { keys: [...twice] });
  const missing = [...requested].filter((key) => !answered.has(key));
  if (missing.length) refuse("MISSING_ANSWER", { keys: missing });

  const scope = new Set(call.manifest.page_scope.pages);
  const cited = [
    ...output.unreadable_pages, ...output.unlisted_findings.map((finding) => finding.page),
    ...output.responses.flatMap((response) => [...response.searched_pages, ...response.observations.map((entry) => entry.page)]),
  ];
  const outside = [...new Set(cited.filter((value) => !scope.has(value)))].sort((left, right) => left - right);
  if (outside.length) refuse("PAGE_OUTSIDE_SLICE", { pages: outside });
  const items = call.manifest.requested_posts.length;
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > posteExchangeOutputMaxBytes(items, call.manifest.page_scope.pages.length)) {
    refuse("OUTPUT_TOO_LARGE");
  }

  // Every page the call answers for is searched for each item, or declared unreadable for all of them: a page left out
  // would make an absence or a total stand for pages nobody read.
  const unreadable = new Set(output.unreadable_pages);
  const owned = call.manifest.page_scope.owned_pages.filter((value) => !unreadable.has(value));
  const unprocessedKeys: string[] = [];
  const unprocessedPages = new Set<number>();
  for (const response of output.responses) {
    const searched = new Set(response.searched_pages);
    const left = owned.filter((value) => !searched.has(value));
    if (!left.length) continue;
    unprocessedKeys.push(response.post_id);
    left.forEach((value) => unprocessedPages.add(value));
  }
  if (unprocessedKeys.length) {
    refuse("UNPROCESSED_PAGES", { keys: unprocessedKeys, pages: [...unprocessedPages].sort((left, right) => left - right) });
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/**
 * The refusal of an answer, in French, as the plan's analysis records it (the member reads « Extraction incomplète sur
 * ce document. », the public reason of its code). Pages are those of the attached fragment, keys the request's own.
 */
export function describePosteExchangeRefusal(code: PosteExchangeRefusalCode, details: { chunkId: string; keys?: string[]; pages?: number[] }) {
  const keys = details.keys?.length ?? 0;
  const pagesText = details.pages?.length ? ` (pages ${details.pages.join(", ")})` : "";
  const prefix = `Lecture du plan contre la liste des postes refusée, appel ${details.chunkId} : `;
  const suffix = " Relancez la lecture de ce plan.";
  switch (code) {
    case "INVALID_OUTPUT": return `${prefix}la réponse ne respecte pas le format attendu.${suffix}`;
    case "OUTPUT_VERSION": return `${prefix}la réponse ne correspond pas à la version ou à l’appel demandés.${suffix}`;
    case "OUTPUT_TOO_LARGE": return `${prefix}la réponse dépasse la taille admise.${suffix}`;
    case "FOREIGN_ITEM": return `${prefix}${plural(keys, "réponse porte", "réponses portent")} sur un poste qui n’était pas demandé.${suffix}`;
    case "DUPLICATE_ANSWER": return `${prefix}${plural(keys, "poste a", "postes ont")} reçu plusieurs réponses.${suffix}`;
    case "MISSING_ANSWER": return `${prefix}${plural(keys, "poste demandé", "postes demandés")} sans réponse : aucun n’est compté comme non trouvé.${suffix}`;
    case "PAGE_OUTSIDE_SLICE": return `${prefix}la réponse cite des pages hors du fragment lu${pagesText}.${suffix}`;
    case "UNPROCESSED_PAGES": return `${prefix}${keys > 1 ? `${keys} postes n’ont pas été cherchés` : "1 poste n’a pas été cherché"} sur toutes les pages${pagesText}.${suffix}`;
  }
}
