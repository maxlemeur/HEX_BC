import { DIMENSION_PATTERNS, normalizeDimensionText } from "@/lib/estimates/price-reuse-matching";
import { designationSimilarity } from "@/lib/takeoff/benchmark";
import { findDiameterEntries, type DiameterEntry } from "@/lib/takeoff/bench/diameters";
import {
  MATERIALS,
  NETWORKS,
  ORGANS,
  type KeyInfo,
  type LineKind,
  type MaterialCode,
  type NetworkCode,
  type OrganCode,
} from "@/lib/takeoff/bench/keys";
import { toUnitToken } from "@/lib/takeoff/units";

// Deterministic reader of an extracted takeoff item's key (TI-660), versioned
// with the vocabulary of keys.ts and the diameter table of diameters.ts; no
// client data. Each attribute is read in the item's designation, then its
// category, then its evidence: the first field where it is found decides.
// - Network: the aliases of NETWORKS, longest first, so that EU/EV is EUV and
//   ECS is never EC. Two networks on one item make the key unreadable.
// - Material: the aliases of MATERIALS; a printed grade refines a generic one
//   (inox 316L over inox), otherwise the leftmost material, the head noun of a
//   French designation, wins (« calorifuge sur tube cuivre » is an insulation).
// - Organ: the aliases of ORGANS, leftmost wins (« mitigeur de lavabo »).
// - DN: inch sizes first, read with their mark (« 3/4" », « 3/4 pouce »,
//   « 1"1/4 », « 1 1/4" », « 2" »), which DIMENSION_PATTERNS would read as a
//   bare fraction; then the DN, size, ID/OD pair, Ø and mm values
//   DIMENSION_PATTERNS reads (price-reuse-matching.ts), each resolved by
//   findDiameterEntries with the item's material; a thickness (« ép. 32 mm »)
//   is no diameter, nor a fraction without inch mark (« 1/4 de tour »). Values
//   whose entries do not overlap are two DN: unreadable. A « DN n » or an inch
//   size no series has is an unknown DN: unreadable, never a key without DN.
//   The quote that closes a quoted text holding a letter (« "EF cuivre DN 22" »,
//   « “Vanne DN 20” ») is the end of the plan text the answer quotes, never an
//   inch mark; a straight quote opens such a text only after neither a letter
//   nor a digit, so the mark of « 3/4" » never opens one. Inside a quoted text,
//   the number before a quote tells an inch mark from the closing quote: after
//   a fraction of an inch (« 3/4 », never a scale « 1/50 ») or the whole part
//   of « 1"1/4 », it is an inch mark (« "Vanne 3/4" EF" », « “Vanne 3/4”” »),
//   and the text closes at a later quote; after a whole inch size of the table,
//   only when the text still closes after it, quotes counted so that a later
//   quoted text does not count (« "Vanne 2" EF" », not « "repère 4" » nor
//   « "Box 2", près de "gaine" »); after a DN, a Ø or any other number, it
//   closes the text.
// - Aliases of up to two letters (EF, EP, PE, WC…) match only as printed, in
//   capitals; longer ones ignore case and accents. A code inside a longer word
//   (EV in « EVIER ») never matches.
// - Unit: toUnitToken, then m and ml are ml, m2 is m2, u, pce, piece and pcs
//   are u; any other unit is out of score. Not normalizeUnit (« m² » → « m »).
// - Kind: ml is a network length (network required), u a count (organ
//   required, network not read: counts are scored by zone x organ x DN). An m2
//   item is an insulation surface, read like a length (network required: a
//   network line in m2 is an insulation, keys.ts), when it reads as one in a
//   field before the field of its room; otherwise a room surface. Before a
//   room label read, only an insulation (material calorifuge) that names its
//   network counts: a room surface may name a network nearby (« près du poste
//   incendie ») or in its label (« Local sprinkler »). Before an unread room, a
//   network or the calorifuge material counts; that room may be in any field
//   after the designation when the scope has rooms, so only the designation
//   makes the item an insulation (« Pièce — aire relevée » whose evidence says
//   « près de la gaine calo » stays a room surface whose room is missing), and
//   any field does when the scope has none.
// - Room: the truth label a candidate of the field resembles most,
//   designationSimilarity ≥ 0.8; a tie between two labels is unreadable. The
//   candidates of a field are the labels it quotes (« … », “…”, "…"), which are
//   the text printed on the plan; without quote, its head (the text before the
//   first dash, comma, semicolon, colon or parenthesis: a level C answer adds
//   its qualifier after it, « Sellerie, aile nord — aire relevée ») and the
//   whole field, so that a hyphenated label (« Sellerie-forge ») stays whole;
//   when they match no label, the text before each spaced hyphen, longest
//   first (« Sellerie - aire relevée »), so that a label holding one
//   (« Atelier - reliure ») keeps its head. A printed area (« 14.30 m² ») is
//   removed from each candidate. A qualifier alone is never a candidate: it
//   says where the room is, not which room it is.
// - An unreadable item keeps the attributes it read and the networks or rooms it
//   hesitates between, so that the score can tell which missed key it may be.

export const ITEM_KEY_READER_VERSION = 5;

export type ScoredUnit = "ml" | "m2" | "u";

const UNIT_TOKENS: Record<string, ScoredUnit> = { m: "ml", ml: "ml", m2: "m2", u: "u", pce: "u", piece: "u", pcs: "u" };

export function scoredUnit(unit: string): ScoredUnit | null {
  return UNIT_TOKENS[toUnitToken(unit)] ?? null;
}

export const ROOM_MIN_SIMILARITY = 0.8;

export type ItemText = { designation: string; category?: string | null; evidence?: string | null };

export type ItemDiameter = { printed: string; entries: readonly DiameterEntry[] };

export type BenchItemKey = {
  kind: LineKind;
  network: NetworkCode | null;
  material: MaterialCode | null;
  organ: OrganCode | null;
  dn: ItemDiameter | null;
  room: string | null;
  unit: ScoredUnit;
};

export type UnreadableReason =
  | "network_missing"
  | "network_ambiguous"
  | "organ_missing"
  | "dn_ambiguous"
  | "dn_unknown"
  | "room_missing"
  | "room_ambiguous";

/**
 * An item whose key cannot be read: `key` holds what was read (the attribute of
 * `reason` is null), `among` the networks or rooms it hesitates between.
 */
export type UnreadableReading = { status: "unreadable"; reason: UnreadableReason; key: BenchItemKey; among: readonly string[] };

export type ItemKeyReading =
  | { status: "read"; key: BenchItemKey }
  | { status: "out_of_score"; unit: string }
  | UnreadableReading;

type Alias<T extends string> = { code: T; pattern: RegExp; length: number };
type Match<T extends string> = { code: T; start: number; end: number };

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'");
}

function escapeAlias(alias: string) {
  return alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s*([/-])\s*/g, (_, separator: string) => `\\s*${separator}\\s*`)
    .replace(/\s+/g, "\\s+");
}

function compileAliases<T extends string>(vocabulary: Record<T, KeyInfo>): Alias<T>[] {
  const aliases: Alias<T>[] = [];
  for (const code of Object.keys(vocabulary) as T[]) {
    for (const raw of new Set([code, ...vocabulary[code].aliases])) {
      const alias = stripAccents(raw);
      const caseSensitive = alias.replace(/[^A-Za-z]/g, "").length <= 2;
      aliases.push({
        code,
        length: alias.length,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeAlias(alias)}(?![\\p{L}\\p{N}])`, caseSensitive ? "gu" : "giu"),
      });
    }
  }
  // Longest first, then by code, so that the reading never depends on the vocabulary order.
  return aliases.sort((left, right) => right.length - left.length || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

const NETWORK_ALIASES = compileAliases(NETWORKS);
const MATERIAL_ALIASES = compileAliases(MATERIALS);
const ORGAN_ALIASES = compileAliases(ORGANS);

/** A grade or finish printed with its generic material refines it. */
const MATERIAL_REFINEMENTS: Partial<Record<MaterialCode, readonly MaterialCode[]>> = {
  inox: ["inox-304l", "inox-316l"],
  acier: ["acier-noir", "acier-galvanise"],
  pvc: ["pvc-pression"],
};

function findAliases<T extends string>(text: string, aliases: readonly Alias<T>[]): Match<T>[] {
  const accepted: Match<T>[] = [];
  const plain = stripAccents(text);
  for (const alias of aliases) {
    for (const found of plain.matchAll(alias.pattern)) {
      const start = found.index;
      const end = start + found[0].length;
      if (accepted.some((match) => start < match.end && match.start < end)) continue;
      accepted.push({ code: alias.code, start, end });
    }
  }
  return accepted.sort((left, right) => left.start - right.start);
}

function fieldsOf(item: ItemText) {
  return [item.designation, item.category, item.evidence].filter((field): field is string =>
    typeof field === "string" && field.trim().length > 0);
}

type Read<T> = { found: false } | { found: true; value: T } | { found: true; ambiguous: true; among: readonly T[] };
/** `field`: the rank of the field it was read in (designation 0, then category, then evidence), Infinity when not read. */
type FieldRead<T> = Read<T> & { field: number };

function readFirst<T>(item: ItemText, readField: (text: string) => Read<T>): FieldRead<T> {
  for (const [field, text] of fieldsOf(item).entries()) {
    const read = readField(text);
    if (read.found) return { ...read, field };
  }
  return { found: false, field: Infinity };
}

function readNetwork(item: ItemText): FieldRead<NetworkCode> {
  return readFirst<NetworkCode>(item, (text) => {
    const codes = [...new Set(findAliases(text, NETWORK_ALIASES).map((match) => match.code))];
    if (codes.length === 0) return { found: false };
    return codes.length === 1 ? { found: true, value: codes[0] } : { found: true, ambiguous: true, among: codes.sort() };
  });
}

function readMaterial(item: ItemText): FieldRead<MaterialCode> {
  return readFirst<MaterialCode>(item, (text) => {
    const matches = findAliases(text, MATERIAL_ALIASES);
    const codes = new Set(matches.map((match) => match.code));
    const refined = matches.filter((match) => !(MATERIAL_REFINEMENTS[match.code] ?? []).some((code) => codes.has(code)));
    return refined.length === 0 ? { found: false } : { found: true, value: refined[0].code };
  });
}

function readOrgan(item: ItemText): FieldRead<OrganCode> {
  return readFirst<OrganCode>(item, (text) => {
    const [first] = findAliases(text, ORGAN_ALIASES);
    return first ? { found: true, value: first.code } : { found: false };
  });
}

const DIAMETER_KINDS = new Set(["size", "fraction", "dn", "diameter", "mm"]);

function diameterText(kind: string, value: string) {
  if (kind === "dn") return `DN ${value.slice(2)}`;
  if (kind === "diameter") return `Ø ${value.slice(1)}`;
  if (kind === "mm") return `${value.slice(0, -2)} mm`;
  return value;
}

function entryId(entry: DiameterEntry) {
  return `${entry.family}:${entry.od_mm}`;
}

// « 1"1/4 » and « 1 1/4" » (one-digit whole part), « 3/4" », « 2" »; the mark touches the number, so that a
// closing quote after a word or a space (« DN 20 "EF" ») is no inch mark.
const INCH_SIZE = /(?<![\w./"])(?:(\d)"\s*(\d+\/\d+)|(\d)\s+(\d+\/\d+)"|(\d+\/\d+)"|(\d+)")(?![\w/])/g;

function inchText(match: readonly string[]) {
  const [, whole, fraction, spacedWhole, spacedFraction, alone, inches] = match;
  if (whole !== undefined) return `${whole}"${fraction}`;
  if (spacedWhole !== undefined) return `${spacedWhole}"${spacedFraction}`;
  return `${alone ?? inches}"`;
}

type DiameterRead = Read<ItemDiameter> | { found: true; unknown: true };

const AFTER_DN_OR_DIAMETER = /(?:\bDN|[Øø⌀])\s*-?\s*\d+(?:[.,]\d+)?$/iu;
// A fraction of an inch (« 3/4 », the « 1/4 » of « 1 1/4 »), never a scale (« 1/50 ») nor an ID/OD pair (« 20/22 »).
const INCH_FRACTION = /(?<![\d.,/])\d{1,2}\/(?:2|4|8|16)$/;
const WHOLE_NUMBER = /(?<![\d.,/])\d+$/;

/**
 * Whether the quoted text that `close` ends still closes after this point, counting quotes so that a later quoted
 * text (« "Box 2", près de "gaine" », « “Box 2” près de “Box 3” ») does not count: an odd number of straight quotes
 * left, or more closing than opening curly quotes left.
 */
function stillCloses(after: string, close: string) {
  const count = (quote: string) => [...after].filter((char) => char === quote).length;
  return close === "”" ? count("”") > count("“") : count("\"") % 2 === 1;
}

/**
 * Whether the quote at `index`, inside a quoted text that `close` ends, is an inch mark rather than its closing
 * quote, from the number before it: a fraction of an inch, the whole part of « 1"1/4 », or a whole inch size of the
 * table when the quoted text still closes after it (« "Vanne 2" EF" », not « "repère 4" » nor « "Box 2" … "gaine" »).
 * After a DN, a Ø or any other number (« "EF cuivre DN 22" »), it closes the text.
 */
function isInchMark(text: string, index: number, close: string) {
  const before = text.slice(0, index);
  if (AFTER_DN_OR_DIAMETER.test(before)) return false;
  if (INCH_FRACTION.test(before)) return true;
  const whole = WHOLE_NUMBER.exec(before)?.[0];
  if (whole === undefined) return false;
  const after = text.slice(index + 1);
  return /^\s*\d+\/\d+/.test(after) || (stillCloses(after, close) && findDiameterEntries(`${whole}"`).length > 0);
}

/**
 * Drops the quotes around a quoted text holding a letter: its closing quote ends the plan text, it is no inch mark.
 * A quoted text is “…”, or "…" opened after neither a letter nor a digit (the mark of « 3/4" » opens nothing); an
 * inch mark inside it (« "Vanne 3/4" EF" », « “Vanne 3/4” EF” ») stays, and the text closes at the next quote.
 */
function unquote(text: string) {
  const chars = text.split("");
  let open: { index: number; close: string } | null = null;
  for (const [index, char] of chars.entries()) {
    if (open === null) {
      const straight = char === "\"" && !/[\p{L}\p{N}]/u.test(chars[index - 1] ?? "") && /[^\s"]/.test(chars[index + 1] ?? "");
      if (char === "“" || straight) open = { index, close: char === "“" ? "”" : "\"" };
    } else if (char === open.close && !isInchMark(text, index, open.close)) {
      if (/\p{L}/u.test(text.slice(open.index + 1, index))) chars[open.index] = chars[index] = " ";
      open = null;
    }
  }
  return chars.join("");
}

function readDiameterField(text: string, material: MaterialCode | null): DiameterRead {
  const values: ItemDiameter[] = [];
  let unknown = false;
  const resolve = (printed: string, unknownWithoutEntry: boolean) => {
    const entries = findDiameterEntries(printed, material);
    if (entries.length > 0) values.push({ printed, entries });
    else if (unknownWithoutEntry) unknown = true;
  };
  const marked = unquote(text).replace(/[″”“]|''/g, "\"").replace(/\s*\bpouces?\b/gi, "\"");
  let normalized = normalizeDimensionText(marked.replace(INCH_SIZE, (...match: string[]) => {
    resolve(inchText(match), true);
    return " ";
  }));
  for (const { kind, pattern, value } of DIMENSION_PATTERNS) {
    normalized = normalized.replace(pattern, (...match: string[]) => {
      // The thickness pattern (« ep 32 mm ») shares the mm kind: it is never a diameter.
      if (DIAMETER_KINDS.has(kind) && !/^ep/.test(match[0])) resolve(diameterText(kind, value(match)), kind === "dn");
      return " ";
    });
  }
  if (unknown) return { found: true, unknown: true };
  if (values.length === 0) return { found: false };
  let shared = values[0].entries;
  for (const { entries } of values.slice(1)) {
    const ids = new Set(entries.map(entryId));
    shared = shared.filter((entry) => ids.has(entryId(entry)));
  }
  return shared.length === 0 ? { found: true, ambiguous: true, among: values } : { found: true, value: { printed: values[0].printed, entries: shared } };
}

function readDiameter(item: ItemText, material: MaterialCode | null): DiameterRead {
  for (const field of fieldsOf(item)) {
    const read = readDiameterField(field, material);
    if (read.found) return read;
  }
  return { found: false };
}

const QUOTED = /«\s*([^»]*?)\s*»|“([^”]*)”|"([^"]*)"/g;
const PRINTED_AREA = /\d+(?:[.,]\d+)?\s*m(?:²|2)(?![\p{L}\p{N}])/gu;
const HEAD_END = /\s*[—–,;:(]/;
const SPACED_HYPHEN = /\s+-\s+/g;

/**
 * The texts of a field a room label is looked for in, by rank, without printed area: its quoted labels; else its head
 * and itself, then, one by one, the texts before its spaced hyphens, longest first.
 */
function roomCandidates(field: string): string[][] {
  const quoted = [...field.matchAll(QUOTED)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
  const beforeHyphens = [...field.matchAll(SPACED_HYPHEN)].map((match) => [field.slice(0, match.index)]).reverse();
  const ranks = quoted.length > 0 ? [quoted] : [[field.split(HEAD_END)[0], field], ...beforeHyphens];
  return ranks.map((texts) => texts.map((text) => text.replace(PRINTED_AREA, " ").trim()).filter((text) => text.length > 0));
}

/** The labels the candidates resemble most, at or above ROOM_MIN_SIMILARITY. */
function closestRooms(candidates: readonly string[], labels: readonly string[]) {
  let best = ROOM_MIN_SIMILARITY;
  let found = new Set<string>();
  for (const candidate of candidates) {
    for (const room of labels) {
      const similarity = designationSimilarity(candidate, room);
      if (similarity > best) {
        best = similarity;
        found = new Set([room]);
      } else if (similarity === best) {
        found.add(room);
      }
    }
  }
  return [...found].sort();
}

function readRoom(item: ItemText, rooms: readonly string[]): FieldRead<string> {
  const labels = [...new Set(rooms)];
  return readFirst<string>(item, (field) => {
    // The first rank that matches a label decides.
    for (const candidates of roomCandidates(field)) {
      const among = closestRooms(candidates, labels);
      if (among.length === 1) return { found: true, value: among[0] };
      if (among.length > 1) return { found: true, ambiguous: true, among };
    }
    return { found: false };
  });
}

function valueOf<T>(read: Read<T>) {
  return read.found && "value" in read ? read.value : null;
}

function unreadable(reason: UnreadableReason, key: BenchItemKey, among: readonly string[] = []): UnreadableReading {
  return { status: "unreadable", reason, key, among };
}

/** An m2 item is an insulation when it reads as one in a field before the field of its room (module header). */
function isRoomSurface(network: FieldRead<NetworkCode>, material: FieldRead<MaterialCode>, room: FieldRead<string>, scopeHasRooms: boolean) {
  const calorifuge = valueOf(material) === "calorifuge";
  // Before a room read, an insulation that names its network; before an unread room, its network or its calorifuge material.
  const insulationField = room.found ? (calorifuge ? network.field : Infinity) : Math.min(network.field, calorifuge ? material.field : Infinity);
  // An unread room of a scope with rooms may be in any field after the designation; a scope without room has none.
  const roomField = room.found ? room.field : scopeHasRooms ? 1 : Infinity;
  return insulationField >= roomField;
}

/** Reads the key of an extracted item; `rooms` are the room labels of the truth it is scored against. */
export function readItemKey(item: ItemText & { unit: string }, context: { rooms: readonly string[] }): ItemKeyReading {
  const unit = scoredUnit(item.unit);
  if (unit === null) return { status: "out_of_score", unit: item.unit };
  const network = readNetwork(item);
  const materialRead = readMaterial(item);
  const material = valueOf(materialRead);
  const base: BenchItemKey = { kind: "network", network: valueOf(network), material: null, organ: null, dn: null, room: null, unit };

  if (unit === "m2") {
    const room = readRoom(item, context.rooms);
    if (isRoomSurface(network, materialRead, room, context.rooms.length > 0)) {
      // A network a room surface names (nearby, or in its label) is no attribute of its key.
      const surface: BenchItemKey = { ...base, kind: "surface", network: null };
      if (!room.found) return unreadable("room_missing", surface);
      if ("ambiguous" in room) return unreadable("room_ambiguous", surface, room.among);
      return { status: "read", key: { ...surface, room: room.value } };
    }
  }
  const diameter = readDiameter(item, material);
  const dn = diameter.found && "value" in diameter ? diameter.value : null;
  const dnUnreadable = !diameter.found ? null : "unknown" in diameter ? "dn_unknown" as const : "ambiguous" in diameter ? "dn_ambiguous" as const : null;
  if (unit === "u") {
    // A count is scored without its network: two networks on a valve leave it readable.
    const count: BenchItemKey = { ...base, kind: "count", network: null, material, organ: valueOf(readOrgan(item)), dn };
    if (dnUnreadable) return unreadable(dnUnreadable, count);
    if (count.organ === null) return unreadable("organ_missing", count);
    return { status: "read", key: count };
  }
  const length: BenchItemKey = { ...base, material, dn };
  if (network.found && "ambiguous" in network) return unreadable("network_ambiguous", length, network.among);
  if (dnUnreadable) return unreadable(dnUnreadable, length);
  if (length.network === null) return unreadable("network_missing", length);
  return { status: "read", key: length };
}
