import { z } from "zod";

import { noteLength, noteText } from "@/lib/takeoff/rules/verification";

// What an entered quantity rests on (TI-686 D12): a quantity the plan cannot show (rule non_observable) is entered when
// its author attests it with one category, and a note an hypothesis requires (what is assumed, what remains to
// confirm). A bare edit of the quantity enters nothing. The database (migration
// 20261110094501_takeoff_quantity_entry_category.sql) refuses the same values; the route refuses them first, with a
// message the review shows, since a refusal of the database reaches the user as a generic error.
// The categories are provisional (H6, pending the owner's agreement): data kept equal to the database's check.

export const QUANTITY_ENTRY_CATEGORIES = {
  site_survey: "Relevé chantier",
  other_drawing: "Autre plan ou coupe",
  dpgf_cctp: "DPGF ou CCTP",
  written_confirmation: "Confirmation écrite",
  documented_calculation: "Calcul documenté",
  hypothesis: "Hypothèse",
} as const;

export type QuantityEntryCategory = keyof typeof QUANTITY_ENTRY_CATEGORIES;

/** The note of an hypothesis, in code points without the blanks at its ends (as the acceptance notes are measured). */
export const HYPOTHESIS_NOTE = { min: 10, max: 500 } as const;
/** Any other category's note, optional. */
export const QUANTITY_ENTRY_NOTE_MAX = 500;

/** A raw note's bound in the request, before its business bounds (a body never carries an unbounded text). */
const REQUEST_NOTE_MAX = 2000;

export const QUANTITY_ENTRY_MESSAGES = {
  hypothesisNote: `Une hypothèse doit dire ce qui est supposé (${HYPOTHESIS_NOTE.min} à ${HYPOTHESIS_NOTE.max} caractères).`,
  noteTooLong: `Ce qui fonde la quantité tient en ${QUANTITY_ENTRY_NOTE_MAX} caractères au plus.`,
} as const;

/** What a client writes with the quantity it attests; the author and the time are the server's. */
export const quantityEntrySchema = z.object({
  category: z.enum(Object.keys(QUANTITY_ENTRY_CATEGORIES) as [QuantityEntryCategory, ...QuantityEntryCategory[]]),
  note: z.string().max(REQUEST_NOTE_MAX).meta({ description: `Ce qui fonde la quantité : obligatoire pour hypothesis `
    + `(${HYPOTHESIS_NOTE.min} à ${HYPOTHESIS_NOTE.max} caractères), ${QUANTITY_ENTRY_NOTE_MAX} au plus sinon ; `
    + "sans les blancs des deux bouts." }).optional(),
}).strict();

export type QuantityEntry = z.infer<typeof quantityEntrySchema>;

/** Why the entry cannot be saved (the database's checks, in its order), or null. */
export function quantityEntryError(entry: QuantityEntry): string | null {
  const length = noteLength(entry.note ?? "");
  if (entry.category === "hypothesis" && (length < HYPOTHESIS_NOTE.min || length > HYPOTHESIS_NOTE.max)) {
    return QUANTITY_ENTRY_MESSAGES.hypothesisNote;
  }
  if (length > QUANTITY_ENTRY_NOTE_MAX) return QUANTITY_ENTRY_MESSAGES.noteTooLong;
  return null;
}

/** The note as stored: without the blanks at its ends, null when nothing is left. */
export function quantityEntryNote(entry: QuantityEntry): string | null {
  const text = noteText(entry.note ?? "");
  return text === "" ? null : text;
}

/** « Relevé chantier — Fiche … », as the review shows an entered quantity; a category the list no longer has as stored. */
export function quantityEntryLabel(category: string, note: string | null | undefined) {
  const label = (QUANTITY_ENTRY_CATEGORIES as Record<string, string>)[category] ?? category;
  return note ? `${label} — ${note}` : label;
}
