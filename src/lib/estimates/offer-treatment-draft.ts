import {
  OFFER_RESERVE_TEXT_MAX_LENGTH,
  OFFER_TREATMENT_NOTE_MAX_LENGTH,
  buildOfferReserveSentence,
  effectiveOfferTreatment,
  expectsExclusionReason,
  isOfferReserveWritten,
  normalizeOfferTreatmentText,
  offerTreatmentKindForStatus,
  readOfferTreatment,
  type OfferExclusionReasonCode,
  type OfferReserveBasis,
  type OfferTreatment,
} from "@/lib/estimates/offer-treatment";
import { OFFER_TREATMENT_MAX_DECISIONS, type SetOfferTreatmentsInput } from "@/lib/estimates/offer-treatment-plan";
import { readTakeoffProvision } from "@/lib/estimates/takeoff-provision";
import { ESTIMATE_V3_STATUS_DOCUMENT_LABELS } from "@/lib/estimates/v3-document-presentation";

/**
 * TI-682: what the « Motifs et réserves » window edits, apart from React. The window shows one row per line, keeps
 * what the estimator types, and sends only the lines whose decision changed.
 */
export type OfferTreatmentDraftItem = {
  id: string;
  parent_id?: string | null;
  item_type?: string | null;
  title?: string | null;
  pricing_status?: unknown;
  source_metadata?: unknown;
};

export type OfferTreatmentDraftRow = {
  id: string;
  title: string;
  /** Title of the section that holds the line, to tell two lines of the same title apart. */
  sectionTitle: string | null;
  statusLabel: string;
  /** « Non chiffrée »; a line left out of the price (Inclus, Pour mémoire, Hors lot, Sans objet); a priced line. */
  group: "not_priced" | "exclusion" | "priced";
  /** False for a priced line with nothing to show: it enters the window when the estimator picks it. */
  listed: boolean;
  /** « Hors lot » and « Sans objet »: the send control asks for their reason. */
  reasonExpected: boolean;
  hasTakeoffProvision: boolean;
  /** The decision that holds for the line as it is now. */
  stored: OfferTreatment | null;
  /** A reserve written when the line was priced or unpriced: its sentence may still be in the offer text. */
  staleReserve: boolean;
  /** The reserve holds, but the offer text lost its sentence or names a former title of the line: saving writes it again. */
  reserveToRewrite: boolean;
  unreadable: boolean;
};

export type OfferTreatmentDraftValue = {
  reasonCode: OfferExclusionReasonCode | "";
  note: string;
  reserveText: string;
};

const STATUS_LABELS: Readonly<Record<string, string>> = ESTIMATE_V3_STATUS_DOCUMENT_LABELS;

/** `limitsText` is « Précisions et limites de prestation » as the editor holds it when the window opens. */
export function buildOfferTreatmentRows(
  items: readonly OfferTreatmentDraftItem[],
  limitsText: string | null | undefined,
): OfferTreatmentDraftRow[] {
  const titles = new Map(items.map((entry) => [entry.id, entry.title ?? null]));
  const rows: OfferTreatmentDraftRow[] = [];
  for (const entry of items) {
    if (entry.item_type !== "line") continue;
    const status = typeof entry.pricing_status === "string" && entry.pricing_status in STATUS_LABELS
      ? entry.pricing_status : "priced";
    const group = status === "not_priced" ? "not_priced"
      : offerTreatmentKindForStatus(status) === "internal_exclusion" ? "exclusion" : "priced";
    const read = readOfferTreatment(entry.source_metadata);
    const stored = effectiveOfferTreatment(entry.source_metadata, status);
    const hasTakeoffProvision = readTakeoffProvision(entry.source_metadata) !== null;
    const unreadable = read.state === "unreadable";
    rows.push({
      id: entry.id,
      title: normalizeOfferTreatmentText(entry.title ?? "") || "Sans titre",
      sectionTitle: (entry.parent_id ? normalizeOfferTreatmentText(titles.get(entry.parent_id) ?? "") : "") || null,
      statusLabel: STATUS_LABELS[status],
      group,
      listed: group !== "priced" || stored !== null || hasTakeoffProvision || unreadable,
      reasonExpected: expectsExclusionReason(status),
      hasTakeoffProvision,
      stored,
      staleReserve: group === "exclusion" && read.state === "read" && read.treatment.kind === "offer_reserve",
      reserveToRewrite: stored?.kind === "offer_reserve" && (!isOfferReserveWritten(limitsText, stored.sentence)
        || stored.sentence !== buildOfferReserveSentence(entry.title, stored.text)),
      unreadable,
    });
  }
  return rows;
}

export function initialOfferTreatmentValues(rows: readonly OfferTreatmentDraftRow[]): Record<string, OfferTreatmentDraftValue> {
  return Object.fromEntries(rows.map((row) => [row.id, {
    reasonCode: row.stored?.kind === "internal_exclusion" ? row.stored.reason_code : "",
    note: row.stored?.kind === "internal_exclusion" ? row.stored.note ?? "" : "",
    reserveText: row.stored?.kind === "offer_reserve" ? row.stored.text : "",
  }]));
}

/** The one basis the reserves of the estimate rest on, when they agree; empty to be chosen otherwise. */
export function initialOfferReserveBasis(rows: readonly OfferTreatmentDraftRow[]): OfferReserveBasis | "" {
  const bases = new Set(rows.flatMap((row) => row.stored?.kind === "offer_reserve" ? [row.stored.basis] : []));
  return bases.size === 1 ? [...bases][0] : "";
}

export type OfferTreatmentDraftDecisions =
  /** `decisions` holds what one save sends, 500 lines at most; `remaining` counts the changed lines left for the next. */
  | { ok: true; decisions: SetOfferTreatmentsInput["decisions"]; remaining: number }
  | { ok: false; message: string; field: "basis" | "note" | "text"; itemId?: string };

export function buildOfferTreatmentDecisions(input: {
  rows: readonly OfferTreatmentDraftRow[];
  values: Readonly<Record<string, OfferTreatmentDraftValue>>;
  basis: OfferReserveBasis | "";
}): OfferTreatmentDraftDecisions {
  const decisions: SetOfferTreatmentsInput["decisions"] = [];
  /** Lines whose save changes the offer text: a reserve written, reworded or withdrawn. */
  const offerTextIds = new Set<string>();
  for (const row of input.rows) {
    const value = input.values[row.id];
    if (!value) continue;
    // A decision the window cannot show (unreadable, or a reserve kept from an earlier status) is replaced or
    // withdrawn; a reserve the offer text lost is written again even when its words did not change.
    const mustRewrite = row.unreadable || row.staleReserve || row.reserveToRewrite;
    if (row.group !== "exclusion" || row.staleReserve) offerTextIds.add(row.id);
    if (row.group === "exclusion") {
      const note = normalizeOfferTreatmentText(value.note) || null;
      if (value.reasonCode === "") {
        if (row.stored !== null || mustRewrite) decisions.push({ item_id: row.id, decision: null });
        continue;
      }
      if (value.reasonCode === "other" && note === null) {
        return { ok: false, field: "note", itemId: row.id, message: `Précisez le motif « Autre motif » de « ${row.title} ».` };
      }
      if ((note?.length ?? 0) > OFFER_TREATMENT_NOTE_MAX_LENGTH) {
        return { ok: false, field: "note", itemId: row.id, message: `La précision du motif de « ${row.title} » dépasse 500 caractères.` };
      }
      const same = row.stored?.kind === "internal_exclusion" && row.stored.reason_code === value.reasonCode
        && row.stored.note === note;
      if (!same || mustRewrite) {
        decisions.push({ item_id: row.id, decision: { kind: "internal_exclusion", reason_code: value.reasonCode, note } });
      }
      continue;
    }
    const text = normalizeOfferTreatmentText(value.reserveText);
    if (text === "") {
      if (row.stored !== null || mustRewrite) decisions.push({ item_id: row.id, decision: null });
      continue;
    }
    if (text.length > OFFER_RESERVE_TEXT_MAX_LENGTH) {
      return { ok: false, field: "text", itemId: row.id, message: `La réserve de « ${row.title} » dépasse 500 caractères.` };
    }
    if (input.basis === "") {
      return { ok: false, field: "basis", message: "Choisissez la base des réserves avant d’enregistrer une réserve." };
    }
    const same = row.stored?.kind === "offer_reserve" && row.stored.basis === input.basis && row.stored.text === text
      && row.stored.sentence === buildOfferReserveSentence(row.title, text);
    if (!same || mustRewrite) {
      decisions.push({ item_id: row.id, decision: { kind: "offer_reserve", basis: input.basis, text } });
    }
  }
  if (decisions.length <= OFFER_TREATMENT_MAX_DECISIONS) return { ok: true, decisions, remaining: 0 };
  // Beyond one save's worth, the reserves leave first: they share one basis and one offer text, so they stay together.
  const ordered = [...decisions.filter((entry) => offerTextIds.has(entry.item_id)),
    ...decisions.filter((entry) => !offerTextIds.has(entry.item_id))];
  return { ok: true, decisions: ordered.slice(0, OFFER_TREATMENT_MAX_DECISIONS),
    remaining: ordered.length - OFFER_TREATMENT_MAX_DECISIONS };
}
