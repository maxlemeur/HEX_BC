import { freeTakeoffLevelLabel, leadingTakeoffLevel, takeoffLevelTokens } from "@/lib/takeoff/page-triage";

/**
 * The building and the level of one plan revision (lot 3, « Localisation canonique »). Client-safe.
 *
 * A reading proposes each field from what these bytes show: the title block of each page read first, the original
 * file name when the title block says nothing, never the brief (a building of the brief shared by five plans proves
 * none of them). An operator's correction of this very revision replaces the proposal; the correction of an earlier
 * revision of the same plan is only a proposal to check. RDC, SSn, R+n keep their usual spelling; a free label such
 * as L00 is kept as written, with no equivalence invented. Descriptive for now: nothing measures or sends from it.
 */

export const PLAN_LOCATION_FIELDS = ["building", "level"] as const;
export type PlanLocationField = (typeof PLAN_LOCATION_FIELDS)[number];
export const PLAN_LOCATION_LABEL_MAX = 40;
export const PLAN_LOCATION_RULE_VERSION = 1;

export type PlanLocationCandidate = { value: string; source: "title_block" | "file_name"; pages: number[] };

export type PlanLocationReading = {
  rule_version: typeof PLAN_LOCATION_RULE_VERSION;
  /** Pages of the document, when known. */
  pages_total: number | null;
  /** Pages whose title block was asked for, and those among them where it gave no text (or could not be read). */
  pages_read: number[];
  unreadable_pages: number[];
  /** At least one page's title block was read, with or without text: false when none could be or was. */
  title_block_read: boolean;
  building: PlanLocationCandidate[];
  level: PlanLocationCandidate[];
};

/** An operator's correction of a revision: a null field has no correction, the reading of these bytes applies. */
export type PlanLocationAnnotationValues = { building: string | null; level: string | null };

export type PlanLocationFieldView = {
  value: string | null;
  /**
   * proposed: deduced, to check; confirmed: an operator kept the proposal; corrected: an operator set another value;
   * unknown: « À préciser »; multiple: the plan shows several values.
   */
  state: "proposed" | "confirmed" | "corrected" | "unknown" | "multiple";
  origin: "title_block" | "file_name" | "previous_revision" | "operator" | null;
  /** Pages the proposed value was read on. */
  pages: number[];
  /** Every value these bytes show for the field, a contradiction included. */
  candidates: PlanLocationCandidate[];
  /** False when the title block was not read: no file name value is then proposed in its place. */
  title_block_read: boolean;
};

export type PlanLocationView = Record<PlanLocationField, PlanLocationFieldView>;

const BUILDING_LABEL = /(?<![\p{L}\p{N}])(?:b[âa]timents?|b[âa]t\.|b[âa]t(?=\s)|bldg\.?)(?![\p{L}\p{N}])/giu;
const LEVEL_LABEL = /(?<![\p{L}\p{N}])(?:niveaux?|niv\.|[ée]tages?)(?![\p{L}\p{N}])/giu;
const LIST_SEPARATOR = /^\s*(?:,|;|\/|&|(?<![\p{L}\p{N}])(?:et|à|au)(?![\p{L}\p{N}]))\s*/iu;
// Words that follow a label without being its value (« Niveau de plancher », « Bâtiment : voir plan »).
const NOT_A_VALUE = /^(?:de|du|des|la|le|les|et|à|au|aux|en|sur|sous|par|pour|voir|plan|plans|indice|ind|rev|échelle|echelle|date|lot|phase|zone|bâtiment|batiment|bât|bat|niveau|niveaux|niv|étage|etage|fini|plancher|no|n°)$/iu;
const MAX_VALUES_PER_LABEL = 6;

function readList(tail: string, readValue: (text: string) => { value: string; length: number } | null) {
  const values: string[] = [];
  let rest = tail.replace(/^[\s:=]+/u, "");
  while (rest && values.length < MAX_VALUES_PER_LABEL) {
    const read = readValue(rest);
    if (!read) break;
    values.push(read.value);
    rest = rest.slice(read.length);
    const separator = LIST_SEPARATOR.exec(rest);
    if (!separator) break;
    rest = rest.slice(separator[0].length);
  }
  return values;
}

function readLevelValue(text: string) {
  const known = leadingTakeoffLevel(text);
  if (known) return known;
  const token = /^[\p{L}\p{N}][\p{L}\p{N}._+-]*/u.exec(text)?.[0];
  if (!token || NOT_A_VALUE.test(token)) return null;
  const label = freeTakeoffLevelLabel(token);
  return label ? { value: label, length: token.length } : null;
}

function readBuildingValue(text: string) {
  // A title block prints a building in capitals or digits (« A », « B2 », « Nord »): « bâtiment existant » names none.
  const token = /^[\p{Lu}\p{N}][\p{L}\p{N}._-]{0,19}(?![\p{L}\p{N}])/u.exec(text)?.[0];
  return token && !NOT_A_VALUE.test(token) ? { value: token, length: token.length } : null;
}

function labelledValues(text: string, label: RegExp, readValue: (text: string) => { value: string; length: number } | null) {
  const values: string[] = [];
  label.lastIndex = 0;
  for (let match = label.exec(text); match; match = label.exec(text)) {
    const line = text.slice(match.index + match[0].length).split("\n")[0].slice(0, 80);
    values.push(...readList(line, readValue));
  }
  return values;
}

/** Values the title block of one page shows for each field. */
function readTitleBlock(text: string): Record<PlanLocationField, string[]> {
  const normalized = text.normalize("NFC");
  return {
    building: labelledValues(normalized, BUILDING_LABEL, readBuildingValue),
    // A labelled value, then the levels the title block prints without a label (« PLAN DU REZ DE CHAUSSÉE »).
    level: [...labelledValues(normalized, LEVEL_LABEL, readLevelValue), ...takeoffLevelTokens(normalized)],
  };
}

const FILE_NAME_BUILDING = /(?<![\p{L}\p{N}])(?:b[âa]timent|b[âa]t|bldg)[\s.-]+([\p{L}\p{N}]{1,3})(?![\p{L}\p{N}])/giu;

/** Values the original file name shows: a multi-level name proves none of its levels. */
function readFileName(documentName: string): Record<PlanLocationField, string[]> {
  const name = documentName.normalize("NFC").replace(/\.pdf$/iu, "").replace(/_+/gu, " ");
  FILE_NAME_BUILDING.lastIndex = 0;
  return {
    building: [...name.matchAll(FILE_NAME_BUILDING)].map((match) => match[1].toUpperCase()),
    level: takeoffLevelTokens(name),
  };
}

export function readPlanLocation(input: {
  documentName: string;
  pageCount: number | null;
  /** The title block text of each page read; null when the page could not be read. */
  pages: ReadonlyArray<{ page: number; titleBlockText: string | null }>;
}): PlanLocationReading {
  const pages = [...input.pages].sort((left, right) => left.page - right.page);
  const fromName = readFileName(input.documentName);
  const field = (key: PlanLocationField): PlanLocationCandidate[] => {
    const read = new Map<string, number[]>();
    for (const { page, titleBlockText } of pages) {
      for (const value of titleBlockText ? readTitleBlock(titleBlockText)[key] : []) {
        const onPages = read.get(value) ?? [];
        if (!onPages.includes(page)) onPages.push(page);
        read.set(value, onPages);
      }
    }
    const candidates: PlanLocationCandidate[] = [...read].map(([value, onPages]) => ({ value, source: "title_block", pages: onPages }));
    for (const value of new Set(fromName[key])) {
      if (!read.has(value)) candidates.push({ value, source: "file_name", pages: [] });
    }
    return candidates;
  };
  return {
    rule_version: PLAN_LOCATION_RULE_VERSION,
    pages_total: input.pageCount,
    pages_read: pages.map(({ page }) => page),
    unreadable_pages: pages.filter(({ titleBlockText }) => !titleBlockText?.trim()).map(({ page }) => page),
    title_block_read: pages.some(({ titleBlockText }) => titleBlockText !== null),
    building: field("building"),
    level: field("level"),
  };
}

function proposal(candidates: PlanLocationCandidate[], titleBlockRead: boolean): PlanLocationFieldView {
  // The file name stands in for a title block that was read and says nothing, never for one that was not read.
  for (const source of titleBlockRead ? ["title_block", "file_name"] as const : []) {
    const found = candidates.filter((candidate) => candidate.source === source);
    if (found.length === 1) {
      return { value: found[0].value, state: "proposed", origin: source, pages: found[0].pages, candidates, title_block_read: titleBlockRead };
    }
    if (found.length > 1) return { value: null, state: "multiple", origin: null, pages: [], candidates, title_block_read: titleBlockRead };
  }
  return { value: null, state: "unknown", origin: null, pages: [], candidates, title_block_read: titleBlockRead };
}

/**
 * The location shown for a revision, field by field: its own correction, else the correction of an earlier revision of
 * the same plan as a proposal to check, else the reading of these bytes.
 */
export function resolvePlanLocation(input: {
  reading: PlanLocationReading | null;
  annotation: PlanLocationAnnotationValues | null;
  carryOver: PlanLocationAnnotationValues | null;
}): PlanLocationView {
  const view = (field: PlanLocationField): PlanLocationFieldView => {
    const read = proposal(input.reading?.[field] ?? [], input.reading?.title_block_read ?? false);
    const corrected = input.annotation?.[field] ?? null;
    if (corrected !== null) {
      const state = read.state === "proposed" && read.value === corrected ? "confirmed" : "corrected";
      return { ...read, value: corrected, state, origin: "operator", pages: [] };
    }
    const earlier = input.annotation ? null : input.carryOver?.[field] ?? null;
    if (earlier !== null) return { ...read, value: earlier, state: "proposed", origin: "previous_revision", pages: [] };
    return read;
  };
  return { building: view("building"), level: view("level") };
}

export type PlanLocationRevisionKey = { source_kind: "intake_document" | "plan_file"; source_id: string; content_hash: string };

/**
 * The correction offered as a proposal for a revision without its own: the latest correction of the same source with
 * other bytes, or of a revision the preparation retained this one over. `rows` come latest first. A plan that merely
 * shares a name with another (« Plan RDC » of two buildings) never receives its correction.
 */
export function selectPlanLocationCarryOver<Row extends PlanLocationRevisionKey>(rows: readonly Row[], key: PlanLocationRevisionKey,
  replaced: readonly PlanLocationRevisionKey[]) {
  const same = (left: PlanLocationRevisionKey, right: PlanLocationRevisionKey) =>
    left.source_kind === right.source_kind && left.source_id === right.source_id && left.content_hash === right.content_hash;
  const sameSource = (row: Row) => row.source_kind === key.source_kind && row.source_id === key.source_id;
  const row = rows.find((candidate) => !same(candidate, key) && (sameSource(candidate) || replaced.some((earlier) => same(earlier, candidate))));
  return row ? { row, same_source: sameSource(row) } : null;
}

/** A typed value as stored: trimmed, inner spaces collapsed; empty for no correction (the reading applies). */
export function normalizePlanLocationValue(raw: string): string | null {
  const value = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!value) return null;
  if (value.length > PLAN_LOCATION_LABEL_MAX || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RangeError(`Une localisation tient en ${PLAN_LOCATION_LABEL_MAX} caractères, sans caractère de contrôle.`);
  }
  return value;
}
