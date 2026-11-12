import { MEASUREMENT_UNITS } from "@/lib/units/normalize";

// TI-682, lot C, PR 5: the « quantité provisionnelle » sentence of a priced line whose quantity rests on a takeoff
// hypothesis. An administrator declares what the quantity is established on and what will confirm it
// (estimate_items.offer_choice, kind « provisional_quantity », src/lib/estimates/offer-choice.ts); the tool writes the
// sentence from the line as it is now, the administrator inserts it in the « Précisions et limites de prestation » text,
// and the send gate (provisional_quantity_mention_missing) looks for it there. A new quantity, title or unit writes a
// new sentence: the offer is blocked until its text says it (wanted). The line itself prints as an ordinary priced line;
// no client contract, seal or amount changes.

/** What the quantity is established on, and what will confirm it: one line of 3 to 160 code points (SQL twin). */
export const PROVISIONAL_QUANTITY_TEXT = { min: 3, max: 160 } as const;

/**
 * The blanks a provisional text and the comparison reduce to one space: JavaScript's \s, written out so that
 * public.set_estimate_line_offer_choice reduces exactly the same characters.
 */
const BLANK_RUN = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu;

/** Characters a client text never carries: controls, invisible format characters (zero-width, bidi), separators. */
const FORBIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const PROVISIONAL_QUANTITY_MESSAGES = {
  establishedOn: `« Établie sur » tient sur une ligne, en ${PROVISIONAL_QUANTITY_TEXT.min} à ${PROVISIONAL_QUANTITY_TEXT.max} caractères.`,
  toConfirmBy: `« À confirmer selon » tient sur une ligne, en ${PROVISIONAL_QUANTITY_TEXT.min} à ${PROVISIONAL_QUANTITY_TEXT.max} caractères.`,
} as const;

/** The text on one line: every run of blanks (line breaks included) reduced to one space, trimmed. */
export function normalizeProvisionalText(value: string | null | undefined): string {
  return (value ?? "").replace(BLANK_RUN, " ").trim();
}

/**
 * Why a stored provisional text cannot be: not on one normalized line, out of bounds, or carrying an invisible or control
 * character (which the PDF cannot print and the comparison would miss). Null when it fits.
 */
export function provisionalTextError(value: string): string | null {
  if (value !== normalizeProvisionalText(value) || value.includes("  ") || /[^\S ]/u.test(value)) return "blanks";
  const length = [...value].length;
  if (length < PROVISIONAL_QUANTITY_TEXT.min || length > PROVISIONAL_QUANTITY_TEXT.max) return "length";
  return FORBIDDEN_CHARACTER.test(value) ? "character" : null;
}

const QUANTITY_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const UNIT_SYMBOL_BY_CODE = new Map(MEASUREMENT_UNITS.map((unit) => [unit.code, unit.symbol]));

/**
 * The quantity as the offer's PDF prints it (fr-FR, three decimals at most), its grouping spaces plain spaces as the
 * PDF's table writes them; null when the line has none.
 */
export function formatProvisionalQuantity(quantity: number | string | null | undefined): string | null {
  if (quantity === null || quantity === undefined || (typeof quantity === "string" && quantity.trim() === "")) return null;
  const value = Number(quantity);
  if (!Number.isFinite(value)) return null;
  return QUANTITY_FORMAT.format(value).replace(/[\u00a0\u202f]/g, " ");
}

export type ProvisionalQuantityLine = {
  title?: string | null;
  quantity?: number | string | null;
  unit_code?: string | null;
};

export type ProvisionalQuantityTexts = { established_on: string; to_confirm_by: string };

/**
 * « {Titre} : quantité provisionnelle de {Q} {unité}, établie sur {established_on}, à confirmer selon {to_confirm_by}. »
 * The unit is the symbol the offer prints (left out when the line has none); null without a quantity.
 */
export function composeProvisionalQuantityMention(
  line: ProvisionalQuantityLine,
  texts: ProvisionalQuantityTexts,
): string | null {
  const quantity = formatProvisionalQuantity(line.quantity);
  if (quantity === null) return null;
  const title = normalizeProvisionalText(line.title) || "Sans titre";
  const unitCode = line.unit_code?.trim() || null;
  const unit = unitCode === null ? null : (UNIT_SYMBOL_BY_CODE.get(unitCode) ?? unitCode);
  const amount = unit === null ? quantity : `${quantity} ${unit}`;
  return `${title} : quantité provisionnelle de ${amount}, établie sur ${normalizeProvisionalText(texts.established_on)}, `
    + `à confirmer selon ${normalizeProvisionalText(texts.to_confirm_by)}.`;
}

/** The limits text bound: what the settings API accepts (UTF-16 code units, stricter than the SQL check in code points). */
export const OFFER_LIMITS_MAX_LENGTH = 5000;

const LINE_BREAK = /[\n\r\v\f\u2028\u2029]/u;

/** The text as the comparison reads it: Unicode NFC, every run of blanks reduced to one space, trimmed. */
function comparable(text: string | null | undefined): string {
  return normalizeProvisionalText((text ?? "").normalize("NFC"));
}

/** The limits text as the search reads it: NFC, a run of blanks holding a line break as one line break, any other as one space. */
function comparableLines(text: string | null | undefined): string {
  return (text ?? "").normalize("NFC").replace(BLANK_RUN, (run) => (LINE_BREAK.test(run) ? "\n" : " ")).trim();
}

/**
 * Where a sentence may begin: the start of the text or of a line, or after a closing punctuation, a colon or a bullet
 * and a blank. « Gros Tube : quantité… » never holds the sentence of « Tube ».
 */
const SENTENCE_START = String.raw`(?:^|\n|[.;:!?»)•*\-–—] )`;

function sentencePattern(sentence: string): string {
  return sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\n]");
}

/** The spans of the limits text where the sentence is written, each from where it begins. */
function mentionSpans(text: string, sentence: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const pattern = new RegExp(`(${SENTENCE_START})(${sentencePattern(sentence)})`, "gu");
  for (const match of text.matchAll(pattern)) {
    const begin = (match.index ?? 0) + match[1].length;
    spans.push([begin, begin + match[2].length]);
  }
  return spans;
}

/** Whether the limits text contains the sentence where a sentence begins, whatever its blanks and line breaks. */
export function hasProvisionalQuantityMention(exclusions: string | null | undefined, mention: string): boolean {
  const sentence = comparable(mention);
  return sentence.length > 0 && mentionSpans(comparableLines(exclusions), sentence).length > 0;
}

/**
 * The « quantité provisionnelle de » sentences of the limits text that are none of the current mentions: an earlier
 * sentence left after the quantity, title or unit changed, or after the choice was withdrawn or cleared. The client
 * would read them.
 */
export function countStaleProvisionalQuantityMentions(
  exclusions: string | null | undefined,
  mentions: readonly string[],
): number {
  const text = comparableLines(exclusions);
  const covered = mentions.flatMap((mention) => {
    const sentence = comparable(mention);
    return sentence.length > 0 ? mentionSpans(text, sentence) : [];
  });
  let stale = 0;
  for (const match of text.matchAll(/quantité provisionnelle de/giu)) {
    const at = match.index ?? 0;
    if (!covered.some(([begin, end]) => at >= begin && at < end)) stale += 1;
  }
  return stale;
}

/** The limits text with the sentences it does not contain yet, appended after what is written (never replacing it). */
export function appendProvisionalQuantityMentions(exclusions: string | null | undefined, mentions: readonly string[]): string {
  return planProvisionalQuantityMentions(exclusions, mentions).text;
}

/**
 * The insertion of the missing sentences: the text it would write, the sentences it adds, and by how many characters
 * that text would exceed the limits text bound once trimmed as it is saved (0 when it fits). Nothing is truncated.
 */
export function planProvisionalQuantityMentions(exclusions: string | null | undefined, mentions: readonly string[]) {
  const current = (exclusions ?? "").trimEnd();
  const missing = [...new Set(mentions)].filter((mention) => !hasProvisionalQuantityMention(current, mention));
  const text = missing.length === 0 ? (exclusions ?? "")
    : current.length > 0 ? `${current}\n\n${missing.join("\n")}` : missing.join("\n");
  return { text, missing, overflow: Math.max(0, text.trim().length - OFFER_LIMITS_MAX_LENGTH) };
}

/**
 * What unblocks an offer whose limits text cannot receive its missing sentences; each is a real way out: a shorter
 * declaration writes a shorter sentence (the administrator declares again), a lighter text leaves room, and a line
 * whose declaration is withdrawn asks no sentence any more (it is only listed as an hypothesis).
 */
const OVERFLOW_WAYS_OUT = "Pour débloquer l'envoi : raccourcissez « Établie sur » et « À confirmer selon », ou le titre, des lignes "
  + "déclarées (bouton « Q. prov. ») ; allégez le reste des précisions, y compris une phrase devenue fausse ; ou retirez la "
  + "déclaration des lignes dont la phrase manque (elles repassent en simple avertissement).";

function characters(count: number) {
  return `${count} caractère${count > 1 ? "s" : ""}`;
}

/** The message of a missing room: in the settings before an insertion, or in the send window and its refusal. */
export function provisionalMentionsOverflowMessage(missingCharacters: number, context: "insert" | "send"): string {
  return context === "insert"
    ? `Les mentions à écrire ne tiennent pas dans les ${OFFER_LIMITS_MAX_LENGTH} caractères des précisions : il manque `
      + `${characters(missingCharacters)}. Rien n'est inséré. ${OVERFLOW_WAYS_OUT}`
    : `Le texte « Précisions et limites de prestation » ne peut plus recevoir les mentions qui manquent : il manque `
      + `${characters(missingCharacters)} sur ${OFFER_LIMITS_MAX_LENGTH}. ${OVERFLOW_WAYS_OUT}`;
}
