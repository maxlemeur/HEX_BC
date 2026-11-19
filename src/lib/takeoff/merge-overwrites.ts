import { isDpgfTargetLine } from "@/lib/takeoff/dpgf-target-line";
import { unitKey } from "@/lib/takeoff/page-replacement";

// « Fusionner » (merge), as the database's writer pairs a takeoff's lines with the lines of the destination section,
// replayed on the screen so that a send which would overwrite an ordinary line is refused before anything is written (the
// re-check of 0fd09a20, finding 1). The screen sends « merge » on a version that holds a DPGF line; the writer then matches
// each line it is handed onto a line of the section with the same title and unit, at the same rank, and replaces that
// line's quantity, title and provenance. A DPGF line is refused there by the database (TI-723), an earlier line of a page
// the proposal pairs by the merge follows a page decision; any other line was overwritten without a choice.
//
// The writers mirrored, and where their rule cannot be read exactly from the client:
// - engine 3, private.takeoff_apply_v3_lines (supabase/migrations/20261025134000_takeoff_apply_engine_v3.sql:107-119 for
//   the takeoff's lines, 153-187 for the match): the title `lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))`, the unit
//   `coalesce(unit_code, 'status:' || pricing_status)`, the takeoff's unit resolved by private.normalize_unit (the same
//   referential as `unitKey`: src/lib/units/units.json generates its SQL); a line without a title or a takeoff line whose
//   unit is unknown never matches (the latter refuses the application whole: TAKEOFF_V3_UNIT_UNRESOLVED);
// - engines 1 and 2, public.apply_takeoff_job (20260225133000_tkf013_takeoff_apply_rpc.sql:139-153 for the
//   takeoff's lines, 280-337 for the match): the
//   title and the unit as written, `lower(regexp_replace(btrim(x), '\\s+', ' ', 'g'))` (the pattern is a backslash and
//   « s », not whitespace: inner spaces are kept), against the line's title and description;
// - both: duplicates paired rank to rank, the takeoff's lines by source order, the section's by position (nulls last)
//   then identifier, among the lines directly under the section, DPGF lines included.
// What `\s` and `lower()` do beyond ASCII (a non-breaking space, « É ») depends on the database's locale, and the impact
// preview hands the screen designations already trimmed and reduced (mapping-engine normalizeText). So two keys bound the
// writer's: a fine one (spaces trimmed, ASCII whitespace reduced, ASCII lower case) under which equal titles are equal
// for the writer too, and a coarse one (any whitespace trimmed and reduced, full lower case) under which titles the writer
// finds equal are equal too. Where they agree on every line of a title, the writer's pairs are known exactly; where they do
// not, every line of that title may be reached by every takeoff line of it: more is refused, never less.
// The screen does not know the version's engine: a line either writer would reach is reached.

/** A line the application hands the writer: its designation once a mapping rule renamed it, its unit, its source order. */
export type MergeSentLine = { id: string; designation: string; unit: string; quantity: number; sourceOrder: number };
/** A line directly under the destination section, as the estimate holds it. */
export type MergeSectionLine = {
  id: string;
  title: string | null;
  unit_code: string | null;
  description: string | null;
  pricing_status: string | null;
  position: number | null;
};
export type MergeWriter = "engine3" | "legacy";

// Whitespace for any locale's `\s` (JS `\s`, plus the controls ICU's u_isspace counts), and ASCII whitespace, which every
// locale's `\s` matches.
const ANY_SPACE = /[\s\u0085᠎\u001c-\u001f]+/g;
const ASCII_SPACE = /[ \t\n\v\f\r]+/g;
const btrimSpaces = (value: string) => value.replace(/^ +| +$/g, "");
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
// The simple lower case of each code point (U+0130 has no one-letter full mapping): what any locale's lower() gives, or less.
const fullLower = (value: string) => Array.from(value, (letter) => (letter === "İ" ? "i" : letter.toLowerCase())).join("");
// The engines 1/2 pattern '\\s+': a backslash followed by « s ».
const legacyPattern = (value: string) => value.replace(/\\s+/g, " ");

type Keys = { fine: string; coarse: string };
const engine3Text = (value: string): Keys => ({
  fine: asciiLower(btrimSpaces(value).replace(ASCII_SPACE, " ")),
  coarse: fullLower(value.replace(ANY_SPACE, " ").trim()),
});
const legacyText = (value: string | null): Keys => {
  const written = value ?? "";
  return { fine: asciiLower(legacyPattern(btrimSpaces(written))), coarse: fullLower(legacyPattern(written).replace(ANY_SPACE, " ").trim()) };
};

// A line's keys: its title's, then its unit's, apart.
const lineKeys = (title: Keys, unit: Keys): Keys => ({ fine: `${title.fine}\u0000${unit.fine}`, coarse: `${title.coarse}\u0000${unit.coarse}` });
const sameKeys = (value: string): Keys => ({ fine: value, coarse: value });

function sentKeys(line: MergeSentLine, writer: MergeWriter): Keys | null {
  if (writer === "legacy") return lineKeys(legacyText(line.designation), legacyText(line.unit));
  const unit = unitKey(line.unit);
  if (unit === null) return null;
  return lineKeys(engine3Text(line.designation), sameKeys(unit));
}

function sectionKeys(line: MergeSectionLine, writer: MergeWriter): Keys | null {
  if (writer === "legacy") return lineKeys(legacyText(line.title), legacyText(line.description));
  const unit = line.unit_code ?? (line.pricing_status === null ? null : `status:${line.pricing_status}`);
  if (line.title === null || unit === null) return null;
  return lineKeys(engine3Text(line.title), sameKeys(unit));
}

// uuid order is byte order, which is the order of their lower-case text.
const byText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const bySection = (left: MergeSectionLine, right: MergeSectionLine) =>
  (left.position ?? Number.POSITIVE_INFINITY) - (right.position ?? Number.POSITIVE_INFINITY)
  || byText(left.id.toLowerCase(), right.id.toLowerCase());

/**
 * For each line of the section the writer may merge onto, the takeoff lines that may land on it: one where the writer's
 * pairs are known exactly, every takeoff line of that title where the database's locale decides. `sent` is what the writer
 * is handed, or more: a line it is not handed (decided out of scope at the application) can only move a pair to a later
 * rank, never reach a line this does not.
 */
export function writerMergeReach(sent: readonly MergeSentLine[], section: readonly MergeSectionLine[], writer: MergeWriter) {
  const groups = new Map<string, { sent: Array<{ line: MergeSentLine; fine: string }>; section: Array<{ line: MergeSectionLine; fine: string }> }>();
  const groupOf = (coarse: string) => {
    const group = groups.get(coarse) ?? { sent: [], section: [] };
    groups.set(coarse, group);
    return group;
  };
  for (const line of sent) {
    const keys = sentKeys(line, writer);
    if (keys) groupOf(keys.coarse).sent.push({ line, fine: keys.fine });
  }
  for (const line of section) {
    const keys = sectionKeys(line, writer);
    if (keys) groupOf(keys.coarse).section.push({ line, fine: keys.fine });
  }

  const reach = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (group.sent.length === 0 || group.section.length === 0) continue;
    const ordered = [...group.section].sort((left, right) => bySection(left.line, right.line));
    const exact = new Set([...group.sent, ...group.section].map((entry) => entry.fine)).size === 1;
    const sources = [...group.sent].sort((left, right) => left.line.sourceOrder - right.line.sourceOrder);
    if (!exact) {
      const all = sources.map((entry) => entry.line.id);
      for (const entry of ordered) reach.set(entry.line.id, all);
      continue;
    }
    sources.slice(0, ordered.length).forEach((entry, rank) => reach.set(ordered[rank].line.id, [entry.line.id]));
  }
  return reach;
}

/** An estimate line of the version, as the screen reads it with the sections. */
export type MergeEstimateLine = MergeSectionLine & {
  parent_id: string | null;
  item_type: string | null;
  source_provider?: string | null;
  quantity: number | string | null;
};

export type MergeOverwrite<T extends MergeEstimateLine = MergeEstimateLine> = { line: T; sent: MergeSentLine[] };

/**
 * The ordinary lines directly under the destination section that « Fusionner » would overwrite, each with the takeoff
 * lines that may land on it, in the section's order. Left out: a DPGF line (the database refuses a merge onto it outside
 * the reconciliation, TI-723) and a line `accounted` for elsewhere (an earlier line the proposal pairs by the merge, whose
 * page decision says what it becomes; a DPGF target).
 */
export function mergeOverwrites<T extends MergeEstimateLine>(input: {
  sent: readonly MergeSentLine[];
  estimateItems: readonly T[];
  targetSectionId: string;
  accounted: ReadonlySet<string>;
}): MergeOverwrite<T>[] {
  const section = input.estimateItems.filter((item) => item.item_type === "line" && (item.parent_id ?? null) === input.targetSectionId)
    .sort(bySection);
  const sentById = new Map(input.sent.map((line) => [line.id, line]));
  const reached = new Map<string, Set<string>>();
  for (const writer of ["engine3", "legacy"] as const) {
    for (const [lineId, sentIds] of writerMergeReach(input.sent, section, writer)) {
      const ids = reached.get(lineId) ?? new Set<string>();
      for (const sentId of sentIds) ids.add(sentId);
      reached.set(lineId, ids);
    }
  }
  return section.flatMap((line) => {
    const ids = reached.get(line.id);
    if (!ids || isDpgfTargetLine(line) || input.accounted.has(line.id)) return [];
    const lines = [...ids].map((sentId) => sentById.get(sentId)!).sort((left, right) => left.sourceOrder - right.sourceOrder);
    return [{ line, sent: lines }];
  });
}
