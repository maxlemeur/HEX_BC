import { z } from "zod";

import { ESTIMATE_LINE_PRICING_STATUSES, type EstimateLinePricingStatus } from "@/lib/units/normalize";

/**
 * TI-682 (D12, Q2, Q4): what the estimator decided for a line that is not an ordinary priced line.
 *
 * - `internal_exclusion`: why a prestation is left out of the price (« Hors lot », « Sans objet », « Inclus »,
 *   « Pour mémoire »). The client reads the status; the reason stays internal.
 * - `offer_reserve`: an explicit reserve written in the offer, on a line left « Non chiffrée » or on a priced line whose
 *   quantity is provisional. It is only allowed on a stated basis: a private estimate, or a consultation whose rules
 *   declare the quantities indicative. In a public tender without that statement, the question goes to the buyer.
 *
 * The choice is stored on the line under source_metadata.offer_treatment, outside the takeoff provision marker
 * (takeoff-provision.ts, H18). A reserve is written in the offer as one sentence of the version's « Précisions et
 * limites de prestation » text, which the frozen client contract, the seal, the PDF and the portal already carry:
 * the sentence the client reads is kept with the reserve, and the send control checks that the text still holds it.
 * Pure module: the SQL twin of the shape is public.estimate_offer_treatment_valid.
 */
export const OFFER_TREATMENT_KEY = "offer_treatment";

export const OFFER_EXCLUSION_REASON_CODES = [
  "other_lot", "client_supplied", "outside_consultation", "covered_elsewhere", "not_applicable", "other",
] as const;
export type OfferExclusionReasonCode = (typeof OFFER_EXCLUSION_REASON_CODES)[number];

export const OFFER_EXCLUSION_REASON_LABELS: Readonly<Record<OfferExclusionReasonCode, string>> = {
  other_lot: "À la charge d’un autre lot",
  client_supplied: "Fourni ou réalisé par le client",
  outside_consultation: "Hors périmètre de la consultation",
  covered_elsewhere: "Compris dans une autre ligne du devis",
  not_applicable: "Sans objet sur ce projet",
  other: "Autre motif",
};

export const OFFER_RESERVE_BASES = ["private_estimate", "indicative_quantities"] as const;
export type OfferReserveBasis = (typeof OFFER_RESERVE_BASES)[number];

export const OFFER_RESERVE_BASIS_LABELS: Readonly<Record<OfferReserveBasis, string>> = {
  private_estimate: "Devis privé",
  indicative_quantities: "Quantités déclarées indicatives par le règlement de consultation",
};

export const OFFER_TREATMENT_NOTE_MAX_LENGTH = 500;
export const OFFER_RESERVE_TEXT_MAX_LENGTH = 500;
/** A sentence is « Réserve — « title » : text » ; the title is cut so that it always fits. */
export const OFFER_RESERVE_SENTENCE_MAX_LENGTH = 800;
const OFFER_RESERVE_TITLE_MAX_LENGTH = 200;
/** Same ceiling as estimate_versions.exclusions (estimate_versions_exclusions_length_check). */
export const OFFER_LIMITS_TEXT_MAX_LENGTH = 5000;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
const singleLine = (max: number) => z.string().min(1).max(max)
  .refine((value) => value === normalizeOfferTreatmentText(value), "text");

const exclusionSchema = z.object({
  version: z.literal(1),
  kind: z.literal("internal_exclusion"),
  reason_code: z.enum(OFFER_EXCLUSION_REASON_CODES),
  note: singleLine(OFFER_TREATMENT_NOTE_MAX_LENGTH).nullable(),
  decided_by: uuid,
  decided_at: isoInstant,
}).strict().refine((value) => value.reason_code !== "other" || value.note !== null, "note");

const reserveSchema = z.object({
  version: z.literal(1),
  kind: z.literal("offer_reserve"),
  basis: z.enum(OFFER_RESERVE_BASES),
  text: singleLine(OFFER_RESERVE_TEXT_MAX_LENGTH),
  sentence: singleLine(OFFER_RESERVE_SENTENCE_MAX_LENGTH),
  decided_by: uuid,
  decided_at: isoInstant,
}).strict();

export const offerTreatmentSchema = z.union([exclusionSchema, reserveSchema]);

export type OfferInternalExclusion = z.infer<typeof exclusionSchema>;
export type OfferReserve = z.infer<typeof reserveSchema>;
export type OfferTreatment = OfferInternalExclusion | OfferReserve;

/** One line, single spaces: what a note, a reserve text and a sentence are stored and compared as. */
export function normalizeOfferTreatmentText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type OfferTreatmentRead =
  | { state: "none" }
  /** A key that cannot be read is never a valid decision: the line counts as undecided, and the screens say so. */
  | { state: "unreadable" }
  | { state: "read"; treatment: OfferTreatment };

/** The stored decision of a line, whatever its present status. */
export function readOfferTreatment(sourceMetadata: unknown): OfferTreatmentRead {
  if (!isRecord(sourceMetadata)) return { state: "none" };
  const stored = sourceMetadata[OFFER_TREATMENT_KEY];
  if (stored === undefined || stored === null) return { state: "none" };
  const parsed = offerTreatmentSchema.safeParse(stored);
  return parsed.success ? { state: "read", treatment: parsed.data } : { state: "unreadable" };
}

const EXCLUSION_STATUSES: ReadonlySet<EstimateLinePricingStatus> =
  new Set(["included", "for_memory", "out_of_scope", "not_applicable"]);
const RESERVE_STATUSES: ReadonlySet<EstimateLinePricingStatus> = new Set(["priced", "not_priced"]);
/** The two statuses that take a prestation out of the offer: their reason is asked for before sending. */
const REASON_EXPECTED_STATUSES: ReadonlySet<EstimateLinePricingStatus> = new Set(["out_of_scope", "not_applicable"]);

function statusOf(value: unknown): EstimateLinePricingStatus {
  return (ESTIMATE_LINE_PRICING_STATUSES as readonly unknown[]).includes(value)
    ? value as EstimateLinePricingStatus : "priced";
}

/** Which decision a line of this status can carry: a reason when it is left out of the price, a reserve otherwise. */
export function offerTreatmentKindForStatus(pricingStatus: unknown): OfferTreatment["kind"] {
  return EXCLUSION_STATUSES.has(statusOf(pricingStatus)) ? "internal_exclusion" : "offer_reserve";
}

/** True for « Hors lot » and « Sans objet »: the send control lists such a line while it has no internal reason. */
export function expectsExclusionReason(pricingStatus: unknown): boolean {
  return REASON_EXPECTED_STATUSES.has(statusOf(pricingStatus));
}

/**
 * The decision that holds for the line as it is now. A reason kept from an earlier status does not apply to a line
 * priced since, nor a reserve to a line classified since: it stays stored and holds again if the status comes back.
 */
export function effectiveOfferTreatment(sourceMetadata: unknown, pricingStatus: unknown): OfferTreatment | null {
  const read = readOfferTreatment(sourceMetadata);
  if (read.state !== "read") return null;
  const status = statusOf(pricingStatus);
  if (read.treatment.kind === "internal_exclusion") return EXCLUSION_STATUSES.has(status) ? read.treatment : null;
  return RESERVE_STATUSES.has(status) ? read.treatment : null;
}

/** The sentence a reserve writes in the offer. The line is named by its title: the client contract numbers sections only. */
export function buildOfferReserveSentence(title: string | null | undefined, text: string): string {
  const cleanTitle = normalizeOfferTreatmentText((title ?? "").replace(/[«»]/gu, " ")) || "Sans titre";
  const shortTitle = cleanTitle.length > OFFER_RESERVE_TITLE_MAX_LENGTH
    ? `${cleanTitle.slice(0, OFFER_RESERVE_TITLE_MAX_LENGTH - 1).trimEnd()}…` : cleanTitle;
  return `Réserve — « ${shortTitle} » : ${normalizeOfferTreatmentText(text)}`;
}

const RESERVE_SENTENCE_PREFIX = "Réserve — « ";

function limitsLines(limitsText: string | null | undefined): string[] {
  return (limitsText ?? "").replace(/\r\n?/gu, "\n").split("\n");
}

/** True when the offer text still holds the sentence, alone on its line. */
export function isOfferReserveWritten(limitsText: string | null | undefined, sentence: string): boolean {
  return limitsLines(limitsText).some((line) => normalizeOfferTreatmentText(line) === sentence);
}

/**
 * The offer text after reserves changed: the sentences of withdrawn or reworded reserves are taken out where they
 * still stand alone on a line, and each new sentence is added once, on its own line, after the estimator's own text.
 * Nothing else is touched. Null for an empty text, as the version stores it.
 */
export function rewriteOfferLimitsText(
  limitsText: string | null | undefined,
  changes: { remove: readonly string[]; add: readonly string[] },
): string | null {
  const removed = new Set(changes.remove);
  const kept = limitsLines(limitsText).filter((line) => !removed.has(normalizeOfferTreatmentText(line)));
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  const present = new Set(kept.map(normalizeOfferTreatmentText));
  for (const sentence of changes.add) {
    if (present.has(sentence)) continue;
    const last = kept.length > 0 ? normalizeOfferTreatmentText(kept[kept.length - 1]) : null;
    if (last !== null && !last.startsWith(RESERVE_SENTENCE_PREFIX)) kept.push("");
    kept.push(sentence);
    present.add(sentence);
  }
  const text = kept.join("\n").trim();
  return text.length > 0 ? text : null;
}

export type OfferTreatmentLine = {
  id: string;
  item_type?: string | null;
  title?: string | null;
  pricing_status?: unknown;
  source_metadata?: unknown;
};

export type OfferTreatmentReview = {
  /** « Non chiffrée » lines an offer reserve classifies: the basis is stated and the offer text holds the sentence. */
  reservedNotPricedIds: string[];
  /** « Hors lot » and « Sans objet » lines without an internal reason. */
  exclusionWithoutReasonIds: string[];
  /**
   * Lines to save again in « Motifs et réserves »: a reserve the offer text no longer holds, a stored decision that
   * cannot be read, or a reserve kept from an earlier status whose sentence the client would still read.
   */
  reserveToRewriteIds: string[];
  /** Every line under a reserve, when the reserves of the version do not rest on one basis; empty otherwise. */
  reserveBasisConflictIds: string[];
};

/**
 * What the send control reads (engine 3). A reserve only classifies a « Non chiffrée » line when the client will
 * read it: its sentence is in the offer text and every reserve of the version rests on the same basis, since one
 * estimate answers one consultation.
 */
export function reviewOfferTreatments(
  lines: readonly OfferTreatmentLine[],
  limitsText: string | null | undefined,
): OfferTreatmentReview {
  const review: OfferTreatmentReview = {
    reservedNotPricedIds: [], exclusionWithoutReasonIds: [], reserveToRewriteIds: [], reserveBasisConflictIds: [],
  };
  const reserved: { id: string; basis: OfferReserveBasis; written: boolean; notPriced: boolean }[] = [];
  const reservedSentences = new Set<string>();
  const stale: { id: string; sentence: string }[] = [];
  for (const line of lines) {
    if (line.item_type !== undefined && line.item_type !== null && line.item_type !== "line") continue;
    const status = statusOf(line.pricing_status);
    const read = readOfferTreatment(line.source_metadata);
    const treatment = effectiveOfferTreatment(line.source_metadata, status);
    if (REASON_EXPECTED_STATUSES.has(status) && treatment?.kind !== "internal_exclusion") {
      review.exclusionWithoutReasonIds.push(line.id);
    }
    if (read.state === "unreadable" && RESERVE_STATUSES.has(status)) review.reserveToRewriteIds.push(line.id);
    if (treatment?.kind !== "offer_reserve") {
      if (read.state === "read" && read.treatment.kind === "offer_reserve" && treatment === null) {
        stale.push({ id: line.id, sentence: read.treatment.sentence });
      }
      continue;
    }
    reservedSentences.add(treatment.sentence);
    const written = isOfferReserveWritten(limitsText, treatment.sentence);
    if (!written) review.reserveToRewriteIds.push(line.id);
    reserved.push({ id: line.id, basis: treatment.basis, written, notPriced: status === "not_priced" });
  }
  for (const entry of stale) {
    if (!reservedSentences.has(entry.sentence) && isOfferReserveWritten(limitsText, entry.sentence)) {
      review.reserveToRewriteIds.push(entry.id);
    }
  }
  const oneBasis = new Set(reserved.map((entry) => entry.basis)).size <= 1;
  if (!oneBasis) review.reserveBasisConflictIds = reserved.map((entry) => entry.id);
  review.reservedNotPricedIds = reserved
    .filter((entry) => entry.notPriced && entry.written && oneBasis).map((entry) => entry.id);
  return review;
}
