import { z } from "zod";

import { noteLength, noteText } from "@/lib/takeoff/rules/acceptance-note";
import type { EstimateLinePricingStatus } from "@/lib/units/normalize";

// TI-682, lot C (D11, D25): the internal reason of an exclusion. A necessary service the estimator did not price
// (« Non chiffrée ») and then classified with a status the client reads (« Inclus », « Pour mémoire », « Hors lot »,
// « Sans objet ») records why, for the estimator's colleagues only. The client never reads it: it is not in the client
// contract, the seal, the PDF, the portal, the DPGF or standard workbooks or the purchase order; only the internal CSV.
// The database (migration *_estimate_line_status_reason.sql) refuses the same values; these rules let the
// editor and the route refuse them first, with a message the user reads.
// The codes are provisional (pending the owner's agreement, like the takeoff categories): kept equal to the SQL list.

export const ESTIMATE_STATUS_REASON_CODES = {
  other_trade: "Autre lot ou corps d'état",
  client_supplied: "Fourni ou réalisé par le maître d'ouvrage ou le client",
  included_elsewhere: "Compris dans une autre ligne",
  not_required_after_check: "Sans objet après vérification",
  dpgf_memory_item: "Pour mémoire selon le DPGF",
  other: "Autre motif (à préciser)",
} as const;

export type EstimateStatusReasonCode = keyof typeof ESTIMATE_STATUS_REASON_CODES;

export const ESTIMATE_STATUS_REASON_CODE_VALUES = Object.keys(ESTIMATE_STATUS_REASON_CODES) as [
  EstimateStatusReasonCode, ...EstimateStatusReasonCode[],
];

/** The statuses that exclude a line from the price while the client reads them; only these carry a reason. */
export const ESTIMATE_EXCLUDED_PRICING_STATUSES = ["included", "for_memory", "out_of_scope", "not_applicable"] as const;

export type EstimateExcludedPricingStatus = (typeof ESTIMATE_EXCLUDED_PRICING_STATUSES)[number];

/** The note, in code points without the ASCII blanks at its ends, as the takeoff notes are measured. */
export const STATUS_REASON_NOTE = { min: 10, max: 500 } as const;

/** A raw note's bound in a request, before its business bounds (a body never carries an unbounded text). */
const REQUEST_NOTE_MAX = 2000;

export const STATUS_REASON_MESSAGES = {
  note: `La précision du motif tient en ${STATUS_REASON_NOTE.min} à ${STATUS_REASON_NOTE.max} caractères.`,
  otherNote: `Le motif « Autre » se précise en ${STATUS_REASON_NOTE.min} à ${STATUS_REASON_NOTE.max} caractères.`,
} as const;

/** The reason as stored: a code of the list and a note, trimmed, or null. */
export type EstimateStatusReason = { code: EstimateStatusReasonCode; note: string | null };

export function isEstimateExcludedPricingStatus(value: unknown): value is EstimateExcludedPricingStatus {
  return typeof value === "string" && (ESTIMATE_EXCLUDED_PRICING_STATUSES as readonly string[]).includes(value);
}

/** Why the reason cannot be saved (the database's checks, in its order), or null. */
export function statusReasonError(reason: { code: string; note?: string | null }): string | null {
  const length = noteLength(reason.note ?? "");
  if (reason.code === "other" && length === 0) return STATUS_REASON_MESSAGES.otherNote;
  if (length > 0 && (length < STATUS_REASON_NOTE.min || length > STATUS_REASON_NOTE.max)) {
    return reason.code === "other" ? STATUS_REASON_MESSAGES.otherNote : STATUS_REASON_MESSAGES.note;
  }
  return null;
}

/** The reason as written: its note without the blanks at its ends, null when nothing is left. */
export function normalizeStatusReason(reason: { code: EstimateStatusReasonCode; note?: string | null }): EstimateStatusReason {
  const note = noteText(reason.note ?? "");
  return { code: reason.code, note: note === "" ? null : note };
}

/**
 * What a client writes: a code of the list and an optional note; null clears the reason. Parsed as stored: the note
 * trimmed, null when empty, as the database stores it (the request canonicalizer, batch-request.ts, does the same).
 */
export const estimateStatusReasonInputSchema = z.strictObject({
  code: z.enum(ESTIMATE_STATUS_REASON_CODE_VALUES),
  note: z.string().max(REQUEST_NOTE_MAX).nullable().optional().meta({
    description: `Précision interne, sans les blancs des deux bouts : ${STATUS_REASON_NOTE.min} à ${STATUS_REASON_NOTE.max} `
      + "caractères quand elle est donnée, obligatoire pour le code other.",
  }),
}).superRefine((reason, context) => {
  const message = statusReasonError(reason);
  if (message) context.addIssue({ code: "custom", message, path: ["note"] });
}).transform(normalizeStatusReason).meta({
  description: "Motif interne d'une ligne exclue du prix (TI-682) : jamais transmis au client. Moteur 3 seulement, "
    + "sur une ligne Inclus, Pour mémoire, Hors lot ou Sans objet.",
});

/** A stored reason, as read back: null when it is absent or not of the expected shape. */
export function readEstimateStatusReason(value: unknown): EstimateStatusReason | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !(record.code in ESTIMATE_STATUS_REASON_CODES)) return null;
  const note = typeof record.note === "string" ? record.note : null;
  if (statusReasonError({ code: record.code, note }) !== null) return null;
  return normalizeStatusReason({ code: record.code as EstimateStatusReasonCode, note });
}

/** The stored column, of the shape its CHECK constraint guarantees (estimate_status_reason_valid). */
export const estimateStatusReasonSchema = z.strictObject({
  code: z.enum(ESTIMATE_STATUS_REASON_CODE_VALUES),
  note: z.string().nullable(),
});

type StatusReasonLine = {
  item_type?: string | null;
  pricing_status?: EstimateLinePricingStatus | string | null;
  was_not_priced?: boolean | null;
  status_reason?: unknown;
};

/**
 * A necessary service the estimator did not price and then excluded (D11): the line was « Non chiffrée » in this
 * version and now carries a status the client reads. Lines created or imported directly with such a status are not
 * concerned (a DPGF's « PM », a copied line).
 */
export function isExcludedAfterNotPriced(line: StatusReasonLine): boolean {
  return line.item_type !== "section" && line.was_not_priced === true && isEstimateExcludedPricingStatus(line.pricing_status);
}

/** The send gate's rule (`excluded_without_reason`): such a line without a readable reason. */
export function requiresStatusReason(line: StatusReasonLine): boolean {
  return isExcludedAfterNotPriced(line) && readEstimateStatusReason(line.status_reason) === null;
}

/**
 * The editor asks for the reason when the status it writes excludes a line that is, or was, « Non chiffrée ». It
 * only asks: the change is saved either way (a paste or a bulk entry never fails on a line), and the send waits.
 */
export function asksStatusReason(line: StatusReasonLine, nextStatus: string): boolean {
  return isEstimateExcludedPricingStatus(nextStatus)
    && (line.was_not_priced === true || line.pricing_status === "not_priced");
}

/** Two stored reasons are the same when their code and note are (jsonb equality, as the database compares them). */
export function sameStatusReason(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (typeof left !== "object" || typeof right !== "object") return left === right;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * The line the editor keeps after a status change, as the database leaves it
 * (private.track_estimate_item_status_reason): « was not priced » never goes back to false once the line has been
 * « Non chiffrée »; a reason leaves with the excluded statuses.
 * « Was not priced » follows the last saved line (`saved`): the autosave merges the changes made within its delay into
 * one write, and the database compares that write with the stored line, not with the statuses shown in between (priced,
 * then « Non chiffrée », then « Hors lot » before the save is priced → out_of_scope there). `null`: a line not saved yet,
 * whose creation carries only its status. The reason leaves against the line as shown (`shown`), so a pending reason is
 * never written with a status that cannot carry it.
 */
export function applyStatusReasonRules<T extends StatusReasonLine>(
  shown: StatusReasonLine,
  next: T,
  saved: StatusReasonLine | null = shown,
): T {
  const nextStatus = next.pricing_status ?? "priced";
  const wasNotPriced = saved === null
    ? nextStatus === "not_priced"
    : saved.was_not_priced === true
      || (nextStatus !== (saved.pricing_status ?? "priced")
        && (saved.pricing_status === "not_priced" || nextStatus === "not_priced"));
  const leaves = nextStatus !== (shown.pricing_status ?? "priced") && !isEstimateExcludedPricingStatus(next.pricing_status)
    && sameStatusReason(next.status_reason, shown.status_reason);
  if (wasNotPriced === (next.was_not_priced === true) && !(leaves && next.status_reason != null)) return next;
  return { ...next, was_not_priced: wasNotPriced, ...(leaves ? { status_reason: null } : {}) };
}

/** The reason in one internal cell (CSV « Motif interne »): its label, then its note. */
export function formatStatusReason(value: unknown): string {
  const reason = readEstimateStatusReason(value);
  if (!reason) return "";
  const label = ESTIMATE_STATUS_REASON_CODES[reason.code];
  return reason.note ? `${label} : ${reason.note}` : label;
}
