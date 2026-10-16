import {
  formatMajorationPercent,
  MAJORATION_COEFFICIENT_ERROR,
  MAJORATION_COEFFICIENT_HEADER,
  MAJORATION_PERCENT_ERROR,
  MAJORATION_PERCENT_HEADER,
  readMajorationCoefficient,
  readMajorationPercent,
} from "@/lib/estimates/majoration";
import {
  formatDecimalInput,
  NUMERIC_INPUT_ERROR,
  parseDecimalInput,
  parseQuantity,
  parseStoredCoefficient,
} from "@/lib/numeric-input/parsers";

export const CLIPBOARD_TARGET_FIELDS = [
  "designation",
  "quantity",
  "unit",
  "unit_price_ht",
  "supply_type",
  "k_fo",
  "h_mo",
  "k_mo",
  "h_mo_majoration",
] as const;

export type ClipboardTargetField = (typeof CLIPBOARD_TARGET_FIELDS)[number];
export type ClipboardFormat = "bdc_v1_1" | "optima" | "generic";

/**
 * D11 (2.3 review): a majoration column whose header declares no unit « doit être choisie
 * explicitement ». The mapping offers both units; the chosen one wins over the header and fills
 * the same `h_mo_majoration` value. `h_mo_majoration` alone keeps the unit the header declares.
 */
const CLIPBOARD_MAJORATION_UNIT_TARGETS = {
  h_mo_majoration_percent: "percent",
  h_mo_majoration_coefficient: "coefficient",
} as const;
type ClipboardMajorationUnitTarget = keyof typeof CLIPBOARD_MAJORATION_UNIT_TARGETS;
export type ClipboardMappingTarget = ClipboardTargetField | ClipboardMajorationUnitTarget;
export const CLIPBOARD_MAPPING_TARGETS: readonly ClipboardMappingTarget[] = [
  ...CLIPBOARD_TARGET_FIELDS,
  "h_mo_majoration_percent",
  "h_mo_majoration_coefficient",
];
export type ClipboardColumnMapping = Record<string, ClipboardMappingTarget>;

function isMajorationUnitTarget(target: ClipboardMappingTarget): target is ClipboardMajorationUnitTarget {
  return Object.prototype.hasOwnProperty.call(CLIPBOARD_MAJORATION_UNIT_TARGETS, target);
}

function toValueField(target: ClipboardMappingTarget): ClipboardTargetField {
  return isMajorationUnitTarget(target) ? "h_mo_majoration" : target;
}

export type ClipboardTsvMatrix = {
  headers: string[];
  rows: string[][];
  columnCount: number;
};

export type ClipboardPreviewValues = {
  designation: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_ht: number | null;
  supply_type: string | null;
  k_fo: number | null;
  h_mo: number | null;
  k_mo: number | null;
  h_mo_majoration: number | null;
};

export type ClipboardPreviewRow = {
  lineNumber: number;
  status: "valid" | "invalid";
  reasons: string[];
  rawValues: Record<string, string>;
  values: ClipboardPreviewValues;
};

export type ClipboardPreviewResult = {
  rows: ClipboardPreviewRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
};

export type ClipboardPreviewOptions = {
  limit?: number;
};

export type ClipboardSerializableRow = Partial<
  Record<ClipboardTargetField, string | number | null | undefined>
>;

export type SerializeSelectedRowsOptions = {
  fields?: ClipboardTargetField[];
  includeHeader?: boolean;
};

export const DEFAULT_CLIPBOARD_FIELD_ORDER: ClipboardTargetField[] = [
  ...CLIPBOARD_TARGET_FIELDS,
];

const TARGET_FIELD_ALIASES: Record<ClipboardTargetField, string[]> = {
  designation: [
    "designation",
    "libelle",
    "intitule",
    "description",
    "title",
    "article",
    "item",
  ],
  quantity: ["quantite", "qte", "qt", "quantity", "qty"],
  unit: ["unite", "unit", "uom", "u", "ute"],
  // The supply cost (PR FO). A generic sale price (« Prix Unitaire » of an OPTIMA sheet, « PU »,
  // « Unit price », « Prix HT ») is never proposed here, or a v2 margin applies twice (D11, 2.3
  // review); the user may still choose it. « Prix unitaire HT » stays: it is the paste field's own
  // label and the developers' contract (d484c5a1), « Prix unitaire HT (EUR) » the BDC format's.
  unit_price_ht: [
    "unit_price_ht",
    "unit price ht",
    "prix unitaire ht",
    "pr fo",
    "pr fo eur",
    "pr fourniture",
    "pr fourniture unitaire",
    "prix fourniture",
    "prix d achat",
    "prix achat",
    "prix de revient",
    "cout d achat",
  ],
  supply_type: ["supply_type", "supply type", "type fo", "famille fo"],
  k_fo: ["k_fo", "k fo", "coef fo", "coefficient fo"],
  h_mo: ["h_mo", "h mo", "heure mo", "heures mo", "mo hours", "labor hours"],
  k_mo: ["k_mo", "k mo", "coef mo", "coefficient mo"],
  h_mo_majoration: [
    "h_mo_majoration",
    "h mo majoration",
    "majoration mo",
    "majoration mo %",
    "temps majore",
    "temps majoration",
    "majoration",
  ],
};

const BDC_HEADER_MARKERS = new Set<string>([
  "designation",
  "quantite",
  "quantity",
  "unite",
  "unit",
  "prix unitaire ht eur",
  "pr fo",
  "pr fo eur",
  "unit price ht eur",
  "type fo",
  "k fo",
  "h mo",
  "k mo",
  "majoration mo",
  "majoration mo %",
]);

const OPTIMA_HEADER_MARKERS = new Set<string>([
  "famille fo",
  "type fo",
  "temps majore",
  "temps majoration",
  "qte",
  "qt",
  "pu ht",
  "prix unit ht",
]);

const BDC_CANONICAL_HEADERS: Partial<Record<ClipboardTargetField, string[]>> = {
  designation: ["designation"],
  quantity: ["quantite", "quantity"],
  unit: ["unite", "unit"],
  unit_price_ht: ["prix unitaire ht eur", "unit price ht eur", "pr fo", "pr fo eur"],
  supply_type: ["type fo"],
  k_fo: ["k fo"],
  h_mo: ["h mo"],
  k_mo: ["k mo"],
  h_mo_majoration: ["majoration mo %", "majoration mo"],
};

const OPTIMA_CANONICAL_HEADERS: Partial<Record<ClipboardTargetField, string[]>> = {
  designation: ["libelle", "designation"],
  quantity: ["qte", "qt"],
  unit: ["unite", "u"],
  supply_type: ["famille fo", "type fo"],
  h_mo_majoration: ["temps majore", "majoration mo"],
};

const NULL_LIKE_TOKENS = new Set<string>(["na", "n a", "null", "none", "vide"]);

// F17, U-03 : « Prix Unitaire », « PR Fourniture unitaire » ou « Tps pose unitaire » contiennent
// « unit » sans être une unité. Un en-tête qui nomme un prix, un temps, un total, un taux ou un
// coefficient n'est jamais proposé comme unité (mots entiers).
const NEVER_UNIT_HEADER_WORDS = new Set<string>([
  "prix", "pu", "pr", "price", "cout", "cost", "montant", "total", "tarif",
  "tps", "temps", "heure", "heures", "hours", "time", "taux", "rate",
  "coef", "coeff", "coefficient", "majoration",
]);

/** Libellés de la copie de la grille : relus à l'identique par l'aperçu du collage (D11). */
const CLIPBOARD_COPY_HEADERS: Record<ClipboardTargetField, string> = {
  designation: "Désignation",
  quantity: "Quantité",
  unit: "Unité",
  unit_price_ht: "Prix unitaire HT",
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo: "h MO",
  k_mo: "K MO",
  h_mo_majoration: MAJORATION_PERCENT_HEADER,
};

const FIELD_LABELS: Record<ClipboardTargetField, string> = {
  designation: "Désignation",
  quantity: "Quantité",
  unit: "Unité",
  unit_price_ht: "Prix unitaire HT",
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo: "h MO",
  k_mo: "K MO",
  h_mo_majoration: "Majoration MO",
};

type ClipboardNumericField = Exclude<
  ClipboardTargetField,
  "designation" | "unit" | "supply_type"
>;

// 2.3 review: quantity, h MO, K FO and K MO are numeric(12,3) in v1/v2. A fourth decimal is
// refused as in the import and the grid, instead of being rounded by PostgreSQL on write.
const STORED_PRECISION_PARSERS: Partial<Record<ClipboardNumericField, (raw: string) => number | null>> = {
  quantity: parseQuantity,
  h_mo: parseQuantity,
  k_fo: parseStoredCoefficient,
  k_mo: parseStoredCoefficient,
};

const NUMERIC_FIELDS = new Set<ClipboardNumericField>([
  "quantity",
  "unit_price_ht",
  "k_fo",
  "h_mo",
  "k_mo",
  "h_mo_majoration",
]);

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();

  return headers.map((header) => {
    const count = counts.get(header) ?? 0;
    const nextCount = count + 1;
    counts.set(header, nextCount);
    return nextCount === 1 ? header : `${header}_${nextCount}`;
  });
}

function parseTsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "\t" && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeRowLength(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => (row[index] ?? "").trim());
}

function buildHeaders(headerRow: string[], columnCount: number): string[] {
  const rawHeaders = Array.from({ length: columnCount }, (_, index) => {
    const rawHeader = (headerRow[index] ?? "").trim();
    return rawHeader.length > 0 ? rawHeader : `column_${index + 1}`;
  });

  return dedupeHeaders(rawHeaders);
}

function hasExactNormalizedMatch(normalizedHeader: string, aliases?: string[]) {
  if (!aliases || aliases.length === 0) return false;
  return aliases.some(
    (alias) => normalizeClipboardHeader(alias) === normalizedHeader
  );
}

// `allowSubset: false` refuses a header whose words are only part of the alias (« Prix unitaire »
// for « prix unitaire ht »): the supply cost needs its full name.
function scoreAliasMatch(normalizedHeader: string, alias: string, allowSubset = true): number {
  const normalizedAlias = normalizeClipboardHeader(alias);
  if (!normalizedAlias) return 0;

  if (normalizedAlias.length <= 1) {
    return normalizedHeader === normalizedAlias ? 220 : 0;
  }

  if (normalizedHeader === normalizedAlias) {
    return 200 + normalizedAlias.length;
  }

  if (normalizedHeader.startsWith(normalizedAlias)) {
    return 170 + normalizedAlias.length;
  }

  if (normalizedHeader.includes(normalizedAlias)) {
    return 140 + normalizedAlias.length;
  }

  const headerWords = normalizedHeader.split(" ").filter(Boolean);
  const aliasWords = normalizedAlias.split(" ").filter(Boolean);

  if (aliasWords.length > 1 && aliasWords.every((word) => headerWords.includes(word))) {
    return 110 + aliasWords.length;
  }

  if (allowSubset && headerWords.length > 1 && headerWords.every((word) => aliasWords.includes(word))) {
    return 90 + headerWords.length;
  }

  return 0;
}

function isNumericField(field: ClipboardTargetField): field is ClipboardNumericField {
  return NUMERIC_FIELDS.has(field as ClipboardNumericField);
}

function createEmptyPreviewValues(): ClipboardPreviewValues {
  return {
    designation: null,
    quantity: null,
    unit: null,
    unit_price_ht: null,
    supply_type: null,
    k_fo: null,
    h_mo: null,
    k_mo: null,
    h_mo_majoration: null,
  };
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (isNullLikeToken(trimmed)) return null;
  return trimmed;
}

function isNullLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const normalized = normalizeClipboardHeader(trimmed);
  if (normalized.length === 0) return true;
  return NULL_LIKE_TOKENS.has(normalized);
}

function invertColumnMapping(
  mapping: ClipboardColumnMapping
): Partial<Record<ClipboardTargetField, string>> {
  const fieldToSource: Partial<Record<ClipboardTargetField, string>> = {};

  for (const [sourceHeader, target] of Object.entries(mapping)) {
    const normalizedSource = sourceHeader.trim();
    if (!normalizedSource) continue;
    const field = toValueField(target);
    if (fieldToSource[field]) continue;
    fieldToSource[field] = normalizedSource;
  }

  return fieldToSource;
}

type MajorationUnit = "percent" | "coefficient" | null;

const MAJORATION_UNDECLARED_REASON =
  "Majoration MO : unité non déclarée. Dans la correspondance, choisissez « Majoration MO (%) » ou " +
  `« Majoration MO (coefficient) », titrez la colonne « ${MAJORATION_PERCENT_HEADER} » (100 = neutre) ` +
  `ou « ${MAJORATION_COEFFICIENT_HEADER} » (1 = neutre), ou ne l’importez pas.`;
const MAJORATION_SEVERAL_COLUMNS_REASON =
  "Majoration MO : une seule colonne de majoration peut être collée ; ignorez les autres.";

/** L'en-tête déclare l'unité : « % », « pourcent(age) », « pct » ou « coef », « coefficient ». */
function readDeclaredMajorationUnit(sourceHeader: string): MajorationUnit {
  const words = normalizeClipboardHeader(sourceHeader).replace(/%/g, " % ").split(" ").filter(Boolean);
  const percent = words.some((word) => ["%", "pourcent", "pourcentage", "percent", "pct"].includes(word));
  const coefficient = words.some((word) => ["coef", "coeff", "coefficient"].includes(word));
  if (percent === coefficient) return null;
  return percent ? "percent" : "coefficient";
}

/**
 * P-11 : une colonne en « % » est divisée par 100, une colonne « coefficient » est prise brute, une
 * colonne sans unité déclarée est refusée (« 10 » valait ×10, « 150 » ×1,5) ; le coefficient reste
 * dans [0 ; 10]. Un « % » écrit dans la cellule déclare l'unité de cette cellule.
 */
function readPastedMajoration(
  rawCell: string,
  sourceHeader: string,
  chosenUnit: MajorationUnit = null
): { coefficient: number } | { reason: string } {
  const headerUnit = chosenUnit ?? readDeclaredMajorationUnit(sourceHeader);
  const cellIsPercent = /%\s*$/.test(rawCell);
  if (cellIsPercent && headerUnit === "coefficient") {
    return { reason: `Majoration MO : « % » dans une colonne déclarée en coefficient (« ${MAJORATION_COEFFICIENT_HEADER} »).` };
  }
  const unit = cellIsPercent ? "percent" : headerUnit;
  if (!unit) return { reason: MAJORATION_UNDECLARED_REASON };

  const reading = unit === "percent" ? readMajorationPercent(rawCell) : readMajorationCoefficient(rawCell);
  if (reading.status === "valid") return { coefficient: reading.coefficient };
  if (reading.status === "invalid" && reading.error === "number") {
    return { reason: `${FIELD_LABELS.h_mo_majoration} : ${NUMERIC_INPUT_ERROR}` };
  }
  return { reason: unit === "percent" ? MAJORATION_PERCENT_ERROR : MAJORATION_COEFFICIENT_ERROR };
}

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    deduped.push(reason);
  }

  return deduped;
}

function sanitizeTsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function formatSerializableValue(
  field: ClipboardTargetField,
  value: string | number | null | undefined
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // Virgule décimale : « 1.234 » serait refusé comme ambigu au collage (D11). La majoration,
    // stockée en coefficient, est copiée en % sous « Majoration MO (%) » (P-11).
    if (!Number.isFinite(value)) return "";
    return field === "h_mo_majoration" ? formatMajorationPercent(value) : formatDecimalInput(value);
  }
  return sanitizeTsvCell(value);
}

export function normalizeClipboardHeader(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseTsvMatrix(input: string): ClipboardTsvMatrix {
  const normalizedInput = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

  if (normalizedInput.trim().length === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const rawLines = normalizedInput.split("\n");
  while (rawLines.length > 0 && rawLines[0].trim().length === 0) {
    rawLines.shift();
  }
  while (rawLines.length > 0 && rawLines[rawLines.length - 1]?.trim().length === 0) {
    rawLines.pop();
  }

  if (rawLines.length === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const matrix = rawLines.map((line) => parseTsvLine(line));
  const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);

  if (columnCount === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const headers = buildHeaders(matrix[0] ?? [], columnCount);
  const rows = matrix.slice(1).map((row) => normalizeRowLength(row, columnCount));

  return {
    headers,
    rows,
    columnCount,
  };
}

export function detectClipboardFormat(headers: string[]): ClipboardFormat {
  const normalizedHeaders = headers
    .map((header) => normalizeClipboardHeader(header))
    .filter((header) => header.length > 0);

  if (normalizedHeaders.length === 0) {
    return "generic";
  }

  if (normalizedHeaders.includes("bdc v1 1")) {
    return "bdc_v1_1";
  }

  const headerSet = new Set(normalizedHeaders);

  let bdcScore = 0;
  let optimaScore = 0;

  for (const marker of BDC_HEADER_MARKERS) {
    if (headerSet.has(marker)) {
      bdcScore += 2;
    }
  }

  for (const marker of OPTIMA_HEADER_MARKERS) {
    if (headerSet.has(marker)) {
      optimaScore += 2;
    }
  }

  if (normalizedHeaders.some((header) => header.includes("prix unitaire ht"))) {
    bdcScore += 2;
  }
  if (normalizedHeaders.some((header) => header.includes("majoration mo"))) {
    bdcScore += 2;
    optimaScore += 1;
  }
  if (normalizedHeaders.some((header) => header.includes("temps major"))) {
    optimaScore += 2;
  }
  if (normalizedHeaders.some((header) => header.includes("famille fo"))) {
    optimaScore += 2;
  }

  if (bdcScore >= 10) {
    return "bdc_v1_1";
  }

  if (optimaScore >= 6 && bdcScore < 10) {
    return "optima";
  }

  if (bdcScore >= 6 && optimaScore <= 4) {
    return "bdc_v1_1";
  }

  if (optimaScore >= 4) {
    return "optima";
  }

  return "generic";
}

function isNeverUnitHeader(normalizedHeader: string) {
  return normalizedHeader.split(" ").some((word) => NEVER_UNIT_HEADER_WORDS.has(word));
}

export function suggestClipboardColumnMapping(headers: string[]): ClipboardColumnMapping {
  type Candidate = {
    sourceHeader: string;
    sourceIndex: number;
    field: ClipboardTargetField;
    score: number;
  };

  const format = detectClipboardFormat(headers);
  const candidates: Candidate[] = [];

  headers.forEach((sourceHeader, sourceIndex) => {
    const normalizedHeader = normalizeClipboardHeader(sourceHeader);
    if (!normalizedHeader) return;

    for (const field of CLIPBOARD_TARGET_FIELDS) {
      if (field === "unit" && isNeverUnitHeader(normalizedHeader)) continue;
      const aliases = TARGET_FIELD_ALIASES[field];
      let bestScore = 0;

      for (const alias of aliases) {
        bestScore = Math.max(bestScore, scoreAliasMatch(normalizedHeader, alias, field !== "unit_price_ht"));
      }

      if (bestScore === 0) continue;

      if (
        format === "bdc_v1_1" &&
        hasExactNormalizedMatch(normalizedHeader, BDC_CANONICAL_HEADERS[field])
      ) {
        bestScore += 50;
      }

      if (
        format === "optima" &&
        hasExactNormalizedMatch(normalizedHeader, OPTIMA_CANONICAL_HEADERS[field])
      ) {
        bestScore += 45;
      }

      candidates.push({
        sourceHeader,
        sourceIndex,
        field,
        score: bestScore,
      });
    }
  });

  candidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  const mapping: ClipboardColumnMapping = {};
  const usedSources = new Set<string>();
  const usedFields = new Set<ClipboardTargetField>();

  for (const candidate of candidates) {
    if (usedSources.has(candidate.sourceHeader)) continue;
    if (usedFields.has(candidate.field)) continue;

    mapping[candidate.sourceHeader] = candidate.field;
    usedSources.add(candidate.sourceHeader);
    usedFields.add(candidate.field);
  }

  return mapping;
}

/** Money precision is checked, never used to guess a thousands separator. */
export type ClipboardNumberDomain = "money" | "quantity";

export function parseClipboardNumber(
  value: string | number | null | undefined,
  domain: ClipboardNumberDomain = "money",
): number | null {
  return parseDecimalInput(value, domain === "money" ? { maxFractionDigits: 2, currency: "EUR" } : {});
}

export function buildClipboardPreviewRows(
  matrix: ClipboardTsvMatrix,
  mapping: ClipboardColumnMapping,
  options: ClipboardPreviewOptions = {}
): ClipboardPreviewResult {
  const headerIndexByName = new Map<string, number>();
  matrix.headers.forEach((header, index) => {
    headerIndexByName.set(header, index);
  });

  const fieldToSource = invertColumnMapping(mapping);
  const majorationTargets = Object.values(mapping).filter((target) => toValueField(target) === "h_mo_majoration");
  const majorationSource = fieldToSource.h_mo_majoration;
  const majorationTarget = majorationSource ? mapping[majorationSource] : undefined;
  const chosenMajorationUnit =
    majorationTarget && isMajorationUnitTarget(majorationTarget)
      ? CLIPBOARD_MAJORATION_UNIT_TARGETS[majorationTarget]
      : null;
  const hasExplicitLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit);
  const normalizedLimit = hasExplicitLimit
    ? Math.max(0, Math.floor(options.limit as number))
    : matrix.rows.length;
  const rowLimit = Math.min(matrix.rows.length, normalizedLimit);

  const previewRows: ClipboardPreviewRow[] = [];

  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const row = matrix.rows[rowIndex] ?? [];
    const rawValues: Record<string, string> = {};
    const values = createEmptyPreviewValues();
    const reasons: string[] = [];
    let hasMappedValue = false;

    matrix.headers.forEach((header, columnIndex) => {
      rawValues[header] = (row[columnIndex] ?? "").trim();
    });

    for (const field of CLIPBOARD_TARGET_FIELDS) {
      const sourceHeader = fieldToSource[field];
      if (!sourceHeader) continue;

      const columnIndex = headerIndexByName.get(sourceHeader);
      if (columnIndex === undefined) continue;

      const rawCell = (row[columnIndex] ?? "").trim();
      if (!isNullLikeToken(rawCell)) {
        hasMappedValue = true;
      }

      if (isNumericField(field)) {
        if (isNullLikeToken(rawCell)) {
          values[field] = null;
          continue;
        }

        if (field === "h_mo_majoration") {
          if (majorationTargets.length > 1) {
            reasons.push(MAJORATION_SEVERAL_COLUMNS_REASON);
            continue;
          }
          const majoration = readPastedMajoration(rawCell, sourceHeader, chosenMajorationUnit);
          if ("reason" in majoration) {
            reasons.push(majoration.reason);
          } else {
            values[field] = majoration.coefficient;
          }
          continue;
        }

        // Seul le prix unitaire est un montant ; quantites, heures et
        // coefficients acceptent trois decimales (T16), la precision de leur stockage.
        const grammarValue = parseClipboardNumber(
          rawCell,
          field === "unit_price_ht" ? "money" : "quantity"
        );
        const storedParser = STORED_PRECISION_PARSERS[field];
        const parsedValue =
          grammarValue === null || grammarValue < 0 || !storedParser
            ? grammarValue
            : storedParser(rawCell);
        if (parsedValue === null) {
          // Même message qu'en grille et dans les réglages (D11), précédé du champ refusé.
          reasons.push(`${FIELD_LABELS[field]} : ${NUMERIC_INPUT_ERROR}`);
          continue;
        }

        if (parsedValue < 0) {
          reasons.push(`${FIELD_LABELS[field]} doit être >= 0.`);
          continue;
        }

        values[field] = parsedValue;
        continue;
      }

      values[field] = toNullableText(rawCell);
    }

    if (!fieldToSource.designation) {
      reasons.push("Colonne désignation non mappée.");
    } else if (!values.designation) {
      reasons.push("Désignation manquante.");
    }

    if (!hasMappedValue) {
      reasons.push("Ligne vide.");
    }

    const dedupedReasons = dedupeReasons(reasons);
    const status = dedupedReasons.length === 0 ? "valid" : "invalid";

    previewRows.push({
      lineNumber: rowIndex + 2,
      status,
      reasons: dedupedReasons,
      rawValues,
      values,
    });
  }

  const validCount = previewRows.filter((row) => row.status === "valid").length;
  const invalidCount = previewRows.length - validCount;

  return {
    rows: previewRows,
    totalRows: previewRows.length,
    validCount,
    invalidCount,
  };
}

export function serializeSelectedRowsToTsv(
  rows: ClipboardSerializableRow[],
  options: SerializeSelectedRowsOptions = {}
): string {
  const includeHeader = options.includeHeader ?? true;
  const sourceFields =
    options.fields && options.fields.length > 0
      ? options.fields
      : DEFAULT_CLIPBOARD_FIELD_ORDER;
  const dedupedFields: ClipboardTargetField[] = [];
  const seen = new Set<ClipboardTargetField>();

  for (const field of sourceFields) {
    if (seen.has(field)) continue;
    seen.add(field);
    dedupedFields.push(field);
  }

  const lines: string[] = [];

  if (includeHeader) {
    lines.push(dedupedFields.map((field) => CLIPBOARD_COPY_HEADERS[field]).join("\t"));
  }

  for (const row of rows) {
    const serializedRow = dedupedFields.map((field) =>
      formatSerializableValue(field, row[field])
    );
    lines.push(serializedRow.join("\t"));
  }

  return lines.join("\n");
}
