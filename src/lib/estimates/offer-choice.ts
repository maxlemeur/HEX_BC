import { z } from "zod";

import { noteLength, noteText } from "@/lib/takeoff/rules/acceptance-note";
import { ESTIMATE_LINE_PRICING_STATUSES, type EstimateLinePricingStatus } from "@/lib/units/normalize";

// TI-682, lot C, PR 4 (D10, D25, D28, D29): the written reserve in the offer. A « Non chiffrée » line leaves unpriced,
// and the offer says so in writing: an administrator declares the reserve on the line, with what it rests on. The tool
// records that basis; it does not verify it (there is no contract type in the tool, D29).
// The client reads « Non chiffrée » on the line and the « Précisions et limites de prestation » text, both already in
// client contract 2 and sealed. The basis, the code and the note never reach it: not the client contract, the seal,
// the PDF, the portal, the DPGF or standard workbooks, the purchase order; only the internal CSV.
// The database (migration *_estimate_line_offer_choice.sql, public.estimate_offer_choice_valid) refuses the same
// values; these rules let the editor and the route refuse them first. Codes and bases are provisional (pending the
// owner's agreement): kept equal to the SQL lists. Only the kind « reserve » exists; the provisional quantity (PR 5)
// widens the union below and the SQL function, nothing else.

/** The line status each kind of choice belongs to (the database clears a choice whose line leaves it). */
export const ESTIMATE_OFFER_CHOICE_LINE_STATUS = {
  reserve: "not_priced",
} as const satisfies Record<string, EstimateLinePricingStatus>;

export type EstimateOfferChoiceKind = keyof typeof ESTIMATE_OFFER_CHOICE_LINE_STATUS;

export const ESTIMATE_OFFER_RESERVE_BASES = {
  private_estimate: "Devis privé (hors marché public)",
  indicative_quantities: "Quantités indicatives selon le règlement de la consultation",
} as const;

export type EstimateOfferReserveBasis = keyof typeof ESTIMATE_OFFER_RESERVE_BASES;

export const ESTIMATE_OFFER_RESERVE_BASIS_VALUES = Object.keys(ESTIMATE_OFFER_RESERVE_BASES) as [
  EstimateOfferReserveBasis, ...EstimateOfferReserveBasis[],
];

export const ESTIMATE_OFFER_RESERVE_CODES = {
  quantity_not_determinable: "Quantité impossible à établir sur les pièces",
  pending_survey: "À chiffrer après relevé",
  pending_buyer_answer: "Question posée à l'acheteur",
  other: "Autre motif (à préciser)",
} as const;

export type EstimateOfferReserveCode = keyof typeof ESTIMATE_OFFER_RESERVE_CODES;

export const ESTIMATE_OFFER_RESERVE_CODE_VALUES = Object.keys(ESTIMATE_OFFER_RESERVE_CODES) as [
  EstimateOfferReserveCode, ...EstimateOfferReserveCode[],
];

/** The note, in code points without the ASCII blanks at its ends, as the takeoff notes are measured. */
export const OFFER_CHOICE_NOTE = { min: 10, max: 500 } as const;

/** A raw note's bound in a request, before its business bounds. */
const REQUEST_NOTE_MAX = 2000;

/**
 * Shown when the reserve is declared (provisional wording, D28). The tool cannot tell a private estimate from a public
 * lump-sum contract: the administrator's declaration is the only basis it records.
 */
export const OFFER_RESERVE_WARNING =
  "En marché public à prix global et forfaitaire, une réserve peut rendre l'offre irrégulière. Ne la déclarez que pour "
  + "un devis privé, ou si le règlement de la consultation déclare les quantités indicatives ; sinon, posez la question "
  + "à l'acheteur.";

export const OFFER_CHOICE_MESSAGES = {
  note: `La précision tient en ${OFFER_CHOICE_NOTE.min} à ${OFFER_CHOICE_NOTE.max} caractères.`,
  otherNote: `Le motif « Autre » se précise en ${OFFER_CHOICE_NOTE.min} à ${OFFER_CHOICE_NOTE.max} caractères.`,
  indicativeNote: "Des quantités indicatives se justifient par la référence de l'article du règlement de la consultation "
    + `(${OFFER_CHOICE_NOTE.min} à ${OFFER_CHOICE_NOTE.max} caractères).`,
} as const;

/** What an administrator declares for a reserve; the server adds its author and time. */
export type EstimateOfferReserveInput = {
  kind: "reserve";
  basis: EstimateOfferReserveBasis;
  code: EstimateOfferReserveCode;
  note: string | null;
};

export type EstimateOfferChoiceInput = EstimateOfferReserveInput;

/** The choice as stored. */
export type EstimateOfferChoice = EstimateOfferChoiceInput & { decided_by: string; decided_at: string };

/** Why the choice cannot be saved (the database's checks, in its order), or null. */
export function offerChoiceError(choice: { basis: string; code: string; note?: string | null }): string | null {
  const length = noteLength(choice.note ?? "");
  if (length === 0) {
    if (choice.code === "other") return OFFER_CHOICE_MESSAGES.otherNote;
    if (choice.basis === "indicative_quantities") return OFFER_CHOICE_MESSAGES.indicativeNote;
    return null;
  }
  if (length < OFFER_CHOICE_NOTE.min || length > OFFER_CHOICE_NOTE.max) {
    if (choice.code === "other") return OFFER_CHOICE_MESSAGES.otherNote;
    return choice.basis === "indicative_quantities" ? OFFER_CHOICE_MESSAGES.indicativeNote : OFFER_CHOICE_MESSAGES.note;
  }
  return null;
}

function normalizeOfferChoice<T extends { note?: string | null }>(choice: T): T & { note: string | null } {
  const note = noteText(choice.note ?? "");
  return { ...choice, note: note === "" ? null : note };
}

const reserveInputSchema = z.strictObject({
  kind: z.literal("reserve"),
  basis: z.enum(ESTIMATE_OFFER_RESERVE_BASIS_VALUES).meta({
    description: "Ce qui fonde la réserve, déclaré par l'administrateur (l'outil ne le vérifie pas).",
  }),
  code: z.enum(ESTIMATE_OFFER_RESERVE_CODE_VALUES),
  note: z.string().max(REQUEST_NOTE_MAX).nullable().optional().meta({
    description: `Précision interne, sans les blancs des deux bouts : ${OFFER_CHOICE_NOTE.min} à ${OFFER_CHOICE_NOTE.max} `
      + "caractères quand elle est donnée ; obligatoire pour le code other et pour la base indicative_quantities "
      + "(référence de l'article du règlement de la consultation).",
  }),
});

/**
 * What the administration route accepts: the kind, the basis, the code and an optional note. Parsed as stored (note
 * trimmed, null when empty). The author and the time are the server's.
 */
export const estimateOfferChoiceInputSchema = z.discriminatedUnion("kind", [reserveInputSchema])
  .superRefine((choice, context) => {
    const message = offerChoiceError(choice);
    if (message) context.addIssue({ code: "custom", message, path: ["note"] });
  })
  .transform((choice): EstimateOfferChoiceInput => normalizeOfferChoice(choice))
  .meta({
    description: "Réserve écrite dans l'offre (TI-682) : une ligne « Non chiffrée » d'une v3 brouillon part non chiffrée, "
      + "le texte « Précisions et limites de prestation » le dit. Base, code et note restent internes.",
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored column, of the shape its CHECK constraint guarantees (estimate_offer_choice_valid). */
export const estimateOfferChoiceSchema = z.strictObject({
  kind: z.literal("reserve"),
  basis: z.enum(ESTIMATE_OFFER_RESERVE_BASIS_VALUES),
  code: z.enum(ESTIMATE_OFFER_RESERVE_CODE_VALUES),
  note: z.string().nullable(),
  decided_by: z.string().regex(UUID),
  decided_at: z.string().min(1),
});

/** The answer of the administration route: the line's choice and the new version token. */
export const estimateOfferChoiceReceiptSchema = z.strictObject({
  item: z.strictObject({
    id: z.string().uuid(),
    version_id: z.string().uuid(),
    pricing_status: z.enum(ESTIMATE_LINE_PRICING_STATUSES),
    offer_choice: estimateOfferChoiceSchema.nullable(),
  }),
  version: z.strictObject({
    id: z.string().uuid(),
    updated_at: z.string().min(1),
    content_revision: z.number().int().nonnegative(),
  }),
});

export type EstimateOfferChoiceReceipt = z.infer<typeof estimateOfferChoiceReceiptSchema>;

/** A stored choice, as read back: null when it is absent or not of the expected shape. */
export function readEstimateOfferChoice(value: unknown): EstimateOfferChoice | null {
  const parsed = estimateOfferChoiceSchema.safeParse(value);
  if (!parsed.success || offerChoiceError(parsed.data) !== null) return null;
  return { ...parsed.data, note: normalizeOfferChoice(parsed.data).note };
}

type OfferChoiceLine = {
  item_type?: string | null;
  pricing_status?: EstimateLinePricingStatus | string | null;
  offer_choice?: unknown;
};

/** The reserve a line leaves with: a readable reserve on a « Non chiffrée » line, else null (still to classify). */
export function readOfferReserve(line: OfferChoiceLine): EstimateOfferChoice | null {
  if (line.item_type === "section" || line.pricing_status !== ESTIMATE_OFFER_CHOICE_LINE_STATUS.reserve) return null;
  const choice = readEstimateOfferChoice(line.offer_choice);
  return choice?.kind === "reserve" ? choice : null;
}

/**
 * The line as the database leaves it after a status change (private.clear_estimate_item_offer_choice): a choice whose
 * line status no longer fits it is cleared, an unchanged status keeps it. Coming back to « Non chiffrée » never brings
 * a reserve back.
 */
export function applyOfferChoiceRules<T extends OfferChoiceLine>(previous: OfferChoiceLine, next: T): T {
  if (next.offer_choice == null || (next.pricing_status ?? "priced") === (previous.pricing_status ?? "priced")) return next;
  const choice = readEstimateOfferChoice(next.offer_choice);
  if (choice && ESTIMATE_OFFER_CHOICE_LINE_STATUS[choice.kind] === next.pricing_status) return next;
  return { ...next, offer_choice: null };
}

/**
 * Whether the « Précisions et limites de prestation » text says anything: something left once the blanks and the
 * invisible format characters (zero-width spaces, joiners) are removed. Not whether it says the right thing (D28,
 * decision 6): the line itself prints « Non chiffrée ».
 */
export function hasOfferLimitsText(exclusions: string | null | undefined): boolean {
  return (exclusions ?? "").replace(/[\s\p{Cf}]+/gu, "").length > 0;
}

export const OFFER_RESERVE_PARAGRAPH_INTRO = "Les prestations suivantes ne sont pas chiffrées dans la présente offre :";

/** The editable paragraph listing the reserved lines, by their titles. */
export function buildOfferReserveParagraph(titles: readonly string[]): string {
  const lines = titles.map((title) => title.trim()).filter((title) => title.length > 0);
  return [OFFER_RESERVE_PARAGRAPH_INTRO, ...lines.map((title) => `- ${title}`)].join("\n");
}

/** The limits text with the paragraph appended after what is already written (never replacing it). */
export function appendOfferReserveParagraph(exclusions: string | null | undefined, titles: readonly string[]): string {
  const paragraph = buildOfferReserveParagraph(titles);
  const current = (exclusions ?? "").trimEnd();
  return current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
}

/** The reserve's basis and reason in one line, for the issuer (send window) and the internal CSV. */
export function describeOfferChoice(choice: EstimateOfferChoice): string {
  const basis = ESTIMATE_OFFER_RESERVE_BASES[choice.basis];
  const code = ESTIMATE_OFFER_RESERVE_CODES[choice.code];
  return choice.note ? `${basis} — ${code} : ${choice.note}` : `${basis} — ${code}`;
}

/** CSV « Réserve dans l'offre »: the reserve of a « Non chiffrée » line, empty otherwise. */
export function formatOfferChoice(line: OfferChoiceLine): string {
  const reserve = readOfferReserve(line);
  return reserve ? `Réserve — ${describeOfferChoice(reserve)}` : "";
}
