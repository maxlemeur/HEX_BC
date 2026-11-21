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
  /** Pages whose title block was read, and those among them where it gave no text. */
  pages_read: number[];
  unreadable_pages: number[];
  building: PlanLocationCandidate[];
  level: PlanLocationCandidate[];
};

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
    building: field("building"),
    level: field("level"),
  };
}

function proposal(candidates: PlanLocationCandidate[]): PlanLocationFieldView {
  for (const source of ["title_block", "file_name"] as const) {
    const found = candidates.filter((candidate) => candidate.source === source);
    if (found.length === 1) return { value: found[0].value, state: "proposed", origin: source, pages: found[0].pages, candidates };
    if (found.length > 1) return { value: null, state: "multiple", origin: null, pages: [], candidates };
  }
  return { value: null, state: "unknown", origin: null, pages: [], candidates };
}

/**
 * The location shown for a revision: its own correction, else the correction of an earlier revision of the same plan
 * as a proposal to check (a field it left « À préciser » falls back to the reading), else the reading.
 */
export function resolvePlanLocation(input: {
  reading: PlanLocationReading | null;
  annotation: PlanLocationAnnotationValues | null;
  carryOver: PlanLocationAnnotationValues | null;
}): PlanLocationView {
  const view = (field: PlanLocationField): PlanLocationFieldView => {
    const read = proposal(input.reading?.[field] ?? []);
    if (input.annotation) {
      const value = input.annotation[field];
      const state = value === null ? "unknown" : read.state === "proposed" && read.value === value ? "confirmed" : "corrected";
      return { value, state, origin: "operator", pages: [], candidates: read.candidates };
    }
    const earlier = input.carryOver?.[field] ?? null;
    if (earlier !== null) return { value: earlier, state: "proposed", origin: "previous_revision", pages: [], candidates: read.candidates };
    return read;
  };
  return { building: view("building"), level: view("level") };
}

/** A typed value as stored: trimmed, inner spaces collapsed, empty for « À préciser ». */
export function normalizePlanLocationValue(raw: string): string | null {
  const value = raw.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!value) return null;
  if (value.length > PLAN_LOCATION_LABEL_MAX || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RangeError(`Une localisation tient en ${PLAN_LOCATION_LABEL_MAX} caractères, sans caractère de contrôle.`);
  }
  return value;
}
