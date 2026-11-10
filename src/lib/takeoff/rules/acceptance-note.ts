// The written note of an acceptance (V, verification.ts) and the justification of a forced line (force-reasons.ts),
// measured as the database measures them. No zod here: the guard panel and the apply wizard use it in the browser.

export const ACCEPTANCE_NOTE = { min: 10, max: 500 } as const;

/** The refusal of a forced line's justification that is not such a note (TI-686 D10: the route and the request schema). */
export const JUSTIFICATION_MESSAGE = `Une justification de ${ACCEPTANCE_NOTE.min} à ${ACCEPTANCE_NOTE.max} caractères est obligatoire.`;

const NOTE_BLANKS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/**
 * A note as stored and measured: without the ASCII blanks at its ends, the class the trigger removes
 * (regexp_replace '^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$'). Not String.prototype.trim, which also removes Unicode blanks.
 */
export function noteText(text: string) {
  return text.replace(NOTE_BLANKS, "");
}

/** Its length in code points, as char_length counts it (not in UTF-16 units). */
export function noteLength(text: string) {
  return [...noteText(text)].length;
}

/** A note of 10 to 500 code points once its blanks are trimmed (shared with the override's justifications, TI-686 D10). */
export function validNote(text: string) {
  const length = noteLength(text);
  return length >= ACCEPTANCE_NOTE.min && length <= ACCEPTANCE_NOTE.max;
}
