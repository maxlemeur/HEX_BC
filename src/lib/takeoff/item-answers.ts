import { isTakeoffUnitState, type TakeoffUnitState } from "@/lib/takeoff/launch-request-coverage";
import { asFiniteNumber, asRecord } from "@/lib/value-guards";

/**
 * The stored answers of the items of a sealed list on a plan (lot 4, migration 20261122080845_takeoff_item_answers.sql):
 * what the readers of the affaire read back, and the codes the worker's publication (public.publish_takeoff_item_answers)
 * refuses with. The database is the one judge of a publication (its coverage, each outcome's rule, each observation's
 * role); this module only names its codes and reads its answers.
 */

export const TAKEOFF_ITEM_ANSWER_OUTCOMES = ["measured", "uncertain", "not_found"] as const;
export type TakeoffItemAnswerOutcome = (typeof TAKEOFF_ITEM_ANSWER_OUTCOMES)[number];

/**
 * contribution: a positive quantity of a measured answer, counted in its total (the only role that is a countable
 * takeoff_items row); candidate: an indication (a page, a candidate value); alternative: another reading of an object
 * already read, never added.
 */
export const TAKEOFF_ITEM_OBSERVATION_ROLES = ["contribution", "candidate", "alternative"] as const;
export type TakeoffItemObservationRole = (typeof TAKEOFF_ITEM_OBSERVATION_ROLES)[number];

/**
 * An item's state on the affaire from its readings (the database decides it, lot 4 section 3.2): to_measure: no plan was
 * asked about it; reading: a plan asked is still queued or read; failed: no plan asked answered; incomplete: some did;
 * at full coverage, uncertain when one answer is, measured when one answer is, not_found otherwise.
 */
export const TAKEOFF_ITEM_READING_STATES = ["to_measure", "reading", "incomplete", "failed", "measured", "uncertain",
  "not_found"] as const;
export type TakeoffItemReadingState = (typeof TAKEOFF_ITEM_READING_STATES)[number];

/** The refusals of the publication (public.publish_takeoff_item_answers), by their own code: each writes nothing. */
export const TAKEOFF_ITEM_ANSWERS_REFUSALS = [
  "TAKEOFF_ANSWERS_INVALID",
  "TAKEOFF_ANSWERS_LEASE_INVALID",
  "TAKEOFF_ANSWERS_ALREADY_PUBLISHED",
  "TAKEOFF_ANSWERS_ORDER_INVALID",
  "TAKEOFF_ANSWERS_SCOPE_UNKNOWN",
  "TAKEOFF_ANSWERS_UNIT_PAGES_MISMATCH",
  "TAKEOFF_ANSWERS_ITEM_MISSING",
  "TAKEOFF_ANSWERS_ITEM_FOREIGN",
  "TAKEOFF_ANSWERS_ITEM_DUPLICATE",
  "TAKEOFF_ANSWERS_PAGE_OUTSIDE",
  "TAKEOFF_ANSWERS_COVERAGE_INCOMPLETE",
  "TAKEOFF_ANSWERS_MEASURED_INVALID",
  "TAKEOFF_ANSWERS_NOT_FOUND_INVALID",
  "TAKEOFF_ANSWERS_UNCERTAIN_INVALID",
  "TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID",
  "TAKEOFF_ANSWERS_OBSERVATION_INVALID",
  /** At the commit: the first order's end of a job whose request sealed a list, without its publication. */
  "TAKEOFF_ANSWERS_REQUIRED",
] as const;
export type TakeoffItemAnswersRefusal = (typeof TAKEOFF_ITEM_ANSWERS_REFUSALS)[number];

/** The refusal a database error names, when it is one of the publication's own. */
export function takeoffItemAnswersRefusal(message: string | null | undefined): TakeoffItemAnswersRefusal | null {
  const code = message?.trim() ?? "";
  return (TAKEOFF_ITEM_ANSWERS_REFUSALS as readonly string[]).includes(code) ? code as TakeoffItemAnswersRefusal : null;
}

// What the readers read back.

export type TakeoffItemAnswerObservation = {
  observationId: string;
  ordinal: number;
  role: TakeoffItemObservationRole;
  source: "model" | "vector";
  page: number;
  quantity: number | null;
  unit: string | null;
  measurementBasis: string | null;
  evidence: string;
  confidence: number;
  method: string;
  chunkId: string | null;
  /** A vector observation's row (an excluded takeoff_items row of the vector reading, with its geometry and page). */
  vectorItemId: string | null;
  /** A contribution's takeoff_items row: what a review corrects, and what its rules, hypothesis and checks read. */
  takeoffItemId: string | null;
  /** A total for its page (lot 4); located occurrences come with lot 5. */
  occurrenceCoverage: "page_total";
};

export type TakeoffItemAnswer = {
  answerId: string;
  jobId: string;
  itemId: string;
  listRevisionId: string;
  plan: { fileId: string; logicalId: string; generation: string | null };
  outcome: TakeoffItemAnswerOutcome;
  quantity: { value: number; unit: string } | null;
  candidate: { value: number; unit: string } | null;
  searchedPages: number[];
  unreadablePages: number[];
  reasons: Array<{ code: string; by: "model" | "worker"; text: string | null; chunkId: string | null }>;
  /** The primary reason (the first one). */
  reasonCode: string | null;
  reasonText: string | null;
  /** The digest of the raw answer: compared as is, it never changes (a later reading is another answer). */
  revision: string;
  /** The place of this reading among the readings of its item on its plan, from 1; the greatest is the current one. */
  readingRevision: number;
  replacesAnswerId: string | null;
  publishedAt: string;
  observations: TakeoffItemAnswerObservation[];
};

/** One plan's reading of one item: the latest job asked about it there, its unit's state, and the current answer. */
export type TakeoffItemPlanReading = {
  plan: { logicalId: string; fileId: string | null; name: string | null; generation: string | null };
  jobId: string;
  unitState: TakeoffUnitState;
  reading: "answered" | "in_flight" | "ended";
  answer: TakeoffItemAnswer | null;
};

export type TakeoffItemReadingLine = {
  itemId: string;
  /** Its place in the affaire's latest list revision, from 0. */
  position: number;
  state: TakeoffItemReadingState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  readings: TakeoffItemPlanReading[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(what: string): never {
  throw new TypeError(`Réponse de poste illisible : ${what}.`);
}
const id = (value: unknown, what: string) => typeof value === "string" && UUID.test(value) ? value : invalid(what);
const optionalId = (value: unknown, what: string) => value === null || value === undefined ? null : id(value, what);
const text = (value: unknown, what: string) => typeof value === "string" && value.length > 0 ? value : invalid(what);
const optionalText = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
const number = (value: unknown, what: string) => asFiniteNumber(value) ?? invalid(what);
const optionalNumber = (value: unknown, what: string) => value === null || value === undefined ? null : number(value, what);
const pages = (value: unknown, what: string) => Array.isArray(value) && value.every((page) => Number.isInteger(page) && page >= 1)
  ? value as number[] : invalid(what);
const oneOf = <T extends string>(values: readonly T[], value: unknown, what: string): T =>
  (values as readonly unknown[]).includes(value) ? value as T : invalid(what);

function value(quantity: unknown, unit: unknown, what: string) {
  if (quantity === null || quantity === undefined) return null;
  return { value: number(quantity, what), unit: text(unit, what) };
}

function observation(entry: unknown): TakeoffItemAnswerObservation {
  const row = asRecord(entry) ?? invalid("observation");
  return {
    observationId: id(row.observation_id, "identifiant d'observation"),
    ordinal: number(row.ordinal, "rang d'observation"),
    role: oneOf(TAKEOFF_ITEM_OBSERVATION_ROLES, row.role, "rôle d'observation"),
    source: oneOf(["model", "vector"] as const, row.source, "source d'observation"),
    page: number(row.page, "page d'observation"),
    quantity: optionalNumber(row.quantity, "quantité d'observation"),
    unit: optionalText(row.unit),
    measurementBasis: optionalText(row.measurement_basis),
    evidence: text(row.evidence, "preuve d'observation"),
    confidence: number(row.confidence, "confiance d'observation"),
    method: text(row.method, "méthode d'observation"),
    chunkId: optionalText(row.chunk_id),
    vectorItemId: optionalId(row.vector_item_id, "lecture vectorielle"),
    takeoffItemId: optionalId(row.takeoff_item_id, "ligne de l'observation"),
    occurrenceCoverage: oneOf(["page_total"] as const, row.occurrence_coverage, "couverture des occurrences"),
  };
}

/** An answer as the database's readers give it (private.takeoff_item_answer_document). */
export function parseTakeoffItemAnswer(document: unknown): TakeoffItemAnswer {
  const row = asRecord(document) ?? invalid("réponse");
  const reasons = Array.isArray(row.reasons) ? row.reasons.map((entry) => {
    const reason = asRecord(entry) ?? invalid("motif");
    return { code: text(reason.code, "code de motif"), by: oneOf(["model", "worker"] as const, reason.by, "auteur de motif"),
      text: optionalText(reason.text), chunkId: optionalText(reason.chunk_id) };
  }) : invalid("motifs");
  return {
    answerId: id(row.answer_id, "identifiant de réponse"),
    jobId: id(row.job_id, "analyse"),
    itemId: id(row.item_id, "poste"),
    listRevisionId: id(row.list_revision_id, "révision de liste"),
    plan: { fileId: id(row.plan_file_id, "plan"), logicalId: id(row.plan_logical_id, "identité du plan"),
      generation: optionalText(row.plan_generation) },
    outcome: oneOf(TAKEOFF_ITEM_ANSWER_OUTCOMES, row.outcome, "issue"),
    quantity: value(row.quantity, row.unit, "quantité"),
    candidate: value(row.candidate_quantity, row.candidate_unit, "valeur candidate"),
    searchedPages: pages(row.searched_pages, "pages cherchées"),
    unreadablePages: pages(row.unreadable_pages, "pages illisibles"),
    reasons,
    reasonCode: optionalText(row.reason_code),
    reasonText: optionalText(row.reason_text),
    revision: text(row.revision, "révision"),
    readingRevision: number(row.reading_revision, "rang de lecture"),
    replacesAnswerId: optionalId(row.replaces_answer_id, "réponse remplacée"),
    publishedAt: text(row.published_at, "date de publication"),
    observations: Array.isArray(row.observations) ? row.observations.map(observation) : invalid("observations"),
  };
}

/** One plan's reading of one item as public.read_takeoff_item_readings gives it. */
export function parseTakeoffItemPlanReading(document: unknown): TakeoffItemPlanReading {
  const row = asRecord(document) ?? invalid("lecture");
  return {
    plan: { logicalId: id(row.plan_logical_id, "identité du plan"), fileId: optionalId(row.plan_file_id, "plan"),
      name: optionalText(row.plan_name), generation: optionalText(row.plan_generation) },
    jobId: id(row.job_id, "analyse"),
    unitState: isTakeoffUnitState(row.unit_state) ? row.unit_state : invalid("état de l'analyse"),
    reading: oneOf(["answered", "in_flight", "ended"] as const, row.reading, "lecture"),
    answer: row.answer === null || row.answer === undefined ? null : parseTakeoffItemAnswer(row.answer),
  };
}
