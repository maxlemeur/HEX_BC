import type { MaterialRequestLineInput } from "./contracts";

/**
 * A deterministic pre-reading of a pasted message (TI-690): one draft line per article, with the
 * technician's words kept beside what could be read. It saves typing and decides nothing: no material,
 * no supplier, no validation, and a line it cannot read comes back with its words only.
 *
 * Articles are cut at each line end, at a dash between spaces, and at a comma or a semicolon followed by a
 * quantity (« 50 coudes DN50, 10 manchons DN15 », as an SMS writes them). A line that still seems to hold a
 * second article (« 10 coudes et 5 manchons ») is not cut: its quantity is flagged for a look at the original.
 *
 * It runs in the browser on up to 20,000 pasted characters, so every step is linear in the length of
 * the text: segments and trimming are scanned by hand, a pattern tried at a separator reads a bounded
 * window after it, and no pattern here lets two unbounded quantifiers share the same characters (the
 * cause of the 27 s freeze this replaced).
 */

const ORIGINAL_TEXT_MAX = 500;
const PRODUCT_TYPE_MAX = 200;
const REFERENCE_MAX = 120;
const QUANTITY_MAX = 1_000_000;
/** A quantity alone after a dash ("- 25 pièces") is short; a longer segment is an article. */
const QUANTITY_SEGMENT_MAX = 40;
/** What a separator looks at after it: a quantity, its unit and the first letter of a word fit in it. */
const ARTICLE_START_WINDOW = 40;

/** "1.000" or "1 000": a thousand written with a separator. Read whole, and flagged for a human look. */
const DOTTED_THOUSANDS = String.raw`\d{1,3}(?:\.\d{3})+(?!\d)`;
const SPACED_THOUSANDS = String.raw`\d{1,3}(?:[ .  ]\d{3})+(?!\d)`;
const DECIMAL = String.raw`\d+(?:[.,]\d+)?`;
const NUMBER = `${SPACED_THOUSANDS}|${DECIMAL}`;
/** Where a size often precedes the quantity ("té 32 100 ml"), a space is not taken for a separator. */
const NUMBER_WITHOUT_SPACE = `${DOTTED_THOUSANDS}|${DECIMAL}`;
const THOUSANDS_ONLY = new RegExp(`^(?:${SPACED_THOUSANDS})$`);
/** Pieces, or metres when written. Longer spellings first: the alternation is ordered. */
const UNIT = String.raw`ml|m|pi[èe]ces?|pcs?|pces?|unit[ée]s?|u`;

const BULLET = /^[-–—•*]\s/;
const DASHES = new Set(["-", "–", "—"]);
const TRIMMED = new Set([",", ";", ":", "=", "-"]);
const QUANTITY_ONLY = new RegExp(String.raw`^(${NUMBER})\s?(${UNIT})?$`, "i");
const TRAILING_MULTIPLIER = new RegExp(String.raw`(?:^|\s)[x×]\s?(${NUMBER})\s?(${UNIT})?$`, "i");
const TRAILING_WITH_UNIT = new RegExp(String.raw`(?:^|\s)(${NUMBER_WITHOUT_SPACE})\s?(${UNIT})$`, "i");
const LEADING = new RegExp(String.raw`^(${NUMBER})(?:\s?[x×](?=\s)|\s?(${UNIT})(?=\s)|(?=\s))\s(?!(?:mm|cm)\b)`, "i");
/** A quantity read as LEADING reads it, then a word: what an article written after a separator starts with. */
/** « 6 x 40 » after a comma is a size in two figures (a screw, an anchor), not 6 pieces of « x 40 ». */
const ARTICLE_START = new RegExp(String.raw`^(?:${NUMBER})(?:\s?[x×](?=\s)|\s?(?:${UNIT})(?=\s)|(?=\s))\s(?!(?:mm|cm)\b)(?![x×]\s?\d)[\p{L}Øø]`, "iu");
/** Words that join a second article to the first without cutting it: « 10 coudes et 5 manchons ». */
const JOINERS = [" et ", " + ", " & "];
const REFERENCE =
  /(?<![\p{L}\d])r[ée]f(?:[ée]rence)?\.?(?:\s{0,2}n°)?[\s:=]{0,6}([A-Za-z0-9][A-Za-z0-9._/-]{0,199})/iu;
/** Sold by length as often as by piece: without a written unit, none is proposed. */
const SOLD_BY_LENGTH = /^(?:tubes?|tuyaux?|gaines?|c[âa]bles?)(?![\p{L}\d])/iu;

type Reading = { value: string; rest: string };
type QuantityReading = { quantity: number; doubtful: boolean; unit: string | null; rest: string };

/** The first form found, in this order: DN 32, 20/27, M8, Ø 35 (or "diamètre 35"). */
const DIMENSIONS: Array<{ pattern: RegExp; format: (match: RegExpMatchArray) => string }> = [
  { pattern: /(?<![\p{L}\d])DN\s{0,3}(\d{1,4})(?![\p{L}\d])/iu, format: (match) => `DN ${match[1]}` },
  { pattern: /(?<![\p{L}\d/])(\d{1,3})\/(\d{1,3})(?![\p{L}\d/])/u, format: (match) => `${match[1]}/${match[2]}` },
  { pattern: /(?<![\p{L}\d])M(\d{1,2})(?![\p{L}\d])/iu, format: (match) => `M${match[1]}` },
  {
    pattern: /(?:[Øø]|(?<![\p{L}\d])diam(?:[èe]tre)?\.?)\s{0,3}(\d{1,4}(?:[.,]\d{1,3})?)(?![\p{L}\d])/iu,
    format: (match) => `Ø ${match[1]}`,
  },
];

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/** Whether an article starts at `from` (spaces skipped), read in a window of bounded length. */
function startsArticle(text: string, from: number): boolean {
  let start = from;
  while (start < text.length && isSpace(text[start])) start += 1;
  return ARTICLE_START.test(text.slice(start, start + ARTICLE_START_WINDOW));
}

/**
 * A comma or a semicolon that stands between two articles: followed by a quantity and a word. A comma between
 * two figures is a decimal (« 2,5 ml ») or a typo too close to call (« DN50,10 manchons »): it never separates.
 */
function separatesArticles(line: string, index: number): boolean {
  const character = line[index];
  if (character !== "," && character !== ";") return false;
  if (character === "," && isDigit(line[index - 1]) && isDigit(line[index + 1])) return false;
  return startsArticle(line, index + 1);
}

/**
 * Whether the words left once an article is read still hold a second one: a quantity and a word after a comma, a
 * semicolon, « et », « + » or « & ». `words` is at most PRODUCT_TYPE_MAX characters long.
 */
function holdsSecondArticle(words: string): boolean {
  for (let index = 0; index < words.length; index += 1) {
    if ((words[index] === "," || words[index] === ";") && startsArticle(words, index + 1)) return true;
    for (const joiner of JOINERS) {
      if (words.startsWith(joiner, index) && startsArticle(words, index + joiner.length)) return true;
    }
  }
  return false;
}

function cut(text: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0;
  return `${text.slice(0, start)} ${text.slice(start + match[0].length)}`;
}

/**
 * One space between words, none before a comma or a semicolon (what a size cut out of « té DN 32, 90° » leaves),
 * and no separator left hanging at either end. One pass each way.
 */
function tidy(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").replace(/ (?=[,;])/g, "");
  let start = 0;
  let end = collapsed.length;
  while (start < end && (collapsed[start] === " " || TRIMMED.has(collapsed[start]))) start += 1;
  while (end > start && (collapsed[end - 1] === " " || TRIMMED.has(collapsed[end - 1]))) end -= 1;
  return collapsed.slice(start, end);
}

/** A quantity the API accepts: above zero, bounded, three decimals at most. Anything else stays unread. */
function parseQuantity(raw: string): { quantity: number; doubtful: boolean } | null {
  const doubtful = THOUSANDS_ONLY.test(raw);
  const value = Number(doubtful ? raw.replace(/\D/g, "") : raw.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > QUANTITY_MAX) return null;
  if (Math.abs(value * 1000 - Math.round(value * 1000)) >= 1e-6) return null;
  return { quantity: value, doubtful };
}

/** The unit as written: metres, pieces, or null when the text gives none. */
function parseUnit(raw: string | undefined): string | null {
  if (!raw) return null;
  const unit = raw.toLowerCase();
  return unit === "ml" || unit === "m" ? unit : "u";
}

function readReference(text: string): Reading | null {
  const match = text.match(REFERENCE);
  if (!match || !/\d/.test(match[1]) || match[1].length > REFERENCE_MAX) return null;
  return { value: match[1], rest: cut(text, match) };
}

function readDimension(text: string): Reading | null {
  for (const { pattern, format } of DIMENSIONS) {
    const match = text.match(pattern);
    if (match) return { value: format(match), rest: cut(text, match) };
  }
  return null;
}

/** `rest` is the text once the quantity is taken out of it. */
function quantityOf(number: string, unit: string | undefined, rest: string): QuantityReading | null {
  const parsed = parseQuantity(number);
  return parsed ? { ...parsed, unit: parseUnit(unit), rest } : null;
}

/** `text` is tidied: its spaces are single, so the patterns below never meet a run of them. */
function readQuantity(text: string): QuantityReading | null {
  const multiplier = text.match(TRAILING_MULTIPLIER);
  if (multiplier) {
    // "110 x 60" is a size in two figures, not sixty pieces.
    if (/\d\s?$/.test(text.slice(0, multiplier.index ?? 0))) return null;
    return quantityOf(multiplier[1], multiplier[2], cut(text, multiplier));
  }
  for (const pattern of [TRAILING_WITH_UNIT, LEADING]) {
    const match = text.match(pattern);
    const reading = match ? quantityOf(match[1], match[2], cut(text, match)) : null;
    if (reading) return reading;
  }
  return null;
}

type Chunk = { original: string; body: string; suffix: RegExpMatchArray | null };

/** A dash between spaces separates; a comma or a semicolon separates when an article follows it. */
function isSeparator(line: string, index: number): boolean {
  if (DASHES.has(line[index])) return index > 0 && isSpace(line[index - 1]) && isSpace(line[index + 1]);
  return separatesArticles(line, index);
}

/** The parts of a line around each separator, with the separator (and the spaces around it) before each. */
function segmentsOf(line: string): Array<{ text: string; separator: string }> {
  const segments: Array<{ text: string; separator: string }> = [];
  let start = 0;
  let separator = "";
  for (let index = 0; index < line.length; index += 1) {
    if (!isSeparator(line, index)) continue;
    let left = index;
    while (left > start && isSpace(line[left - 1])) left -= 1;
    let right = index + 1;
    while (right < line.length && isSpace(line[right])) right += 1;
    segments.push({ text: line.slice(start, left), separator });
    separator = line.slice(left, right);
    start = right;
    // The next dash may follow at once ("a - - b"): the space before it is at `right - 1`.
    index = right - 1;
  }
  segments.push({ text: line.slice(start), separator });
  return segments;
}

/**
 * A separator cuts the articles of a line, except when what follows is only a quantity ("- 25 pièces",
 * ", 25 pièces"): that belongs to the article before it.
 */
function chunksOf(line: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const { text, separator } of segmentsOf(line)) {
    const segment = text.trim();
    if (!segment) continue;
    // A separator left at the end (« 25 pièces, ») does not make the quantity an article of its own.
    let end = segment.length;
    while (end > 0 && TRIMMED.has(segment[end - 1])) end -= 1;
    const bare = segment.slice(0, end).trimEnd();
    const suffix = bare.length <= QUANTITY_SEGMENT_MAX ? bare.match(QUANTITY_ONLY) : null;
    const previous = chunks[chunks.length - 1];
    if (suffix && previous && !previous.suffix && parseQuantity(suffix[1]) !== null) {
      previous.original = `${previous.original}${separator}${segment}`;
      previous.suffix = suffix;
      continue;
    }
    chunks.push({ original: segment, body: segment, suffix: null });
  }
  return chunks;
}

function readChunk(chunk: Chunk): MaterialRequestLineInput {
  const draft: MaterialRequestLineInput = { original_text: chunk.original.slice(0, ORIGINAL_TEXT_MAX) };
  let rest = chunk.body.replace(BULLET, "");

  const reference = readReference(rest);
  if (reference) rest = reference.rest;
  const dimension = readDimension(rest);
  if (dimension) rest = dimension.rest;

  rest = tidy(rest);
  const quantity = chunk.suffix ? quantityOf(chunk.suffix[1], chunk.suffix[2], rest) : readQuantity(rest);
  if (quantity) rest = quantity.rest;

  // Nothing read: the words alone, without guessing that the sentence names an article.
  if (!reference && !dimension && !quantity) return draft;

  const type = tidy(rest).slice(0, PRODUCT_TYPE_MAX).trim();
  if (quantity) {
    draft.quantity = quantity.quantity;
    // A thousand written with a separator, or a second article the cuts above left in the words.
    if (quantity.doubtful || holdsSecondArticle(type)) draft.quantity_doubtful = true;
    // Pieces unless the text says otherwise, except for what is sold by length as often as by piece:
    // there the unit is left empty, so that the missing-unit alert asks the operator.
    const unit = quantity.unit ?? (SOLD_BY_LENGTH.test(type) ? null : "u");
    if (unit) draft.unit = unit;
  }
  if (dimension) draft.dimension = dimension.value;
  if (reference) draft.reference = reference.value;
  if (type) draft.product_type = type;
  return draft;
}

export function splitSourceText(text: string): MaterialRequestLineInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => chunksOf(line))
    .map((chunk) => readChunk(chunk));
}
