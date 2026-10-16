import {
  parseAmountCents,
  parseCoefficient,
  parseDecimalInput,
  parseHoursPerUnit,
  parseMajorationAdditive,
  parseMajorationCoefficient,
  parseMajorationPercent,
  parseQuantity,
  parseRateBp,
} from "@/lib/numeric-input/parsers";
import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import {
  MAJORATION_TARGETS,
  checkUnitPriceAgainstControl,
  isWorkbookParameterRow,
  readWorkbookParameterValues,
  type ImportUnitPriceCheck,
  type MajorationTarget,
  type WorkbookParameterValues,
} from "@/lib/imports/optima-profile";
import {
  IMPORT_ROW_PROVENANCE_KEY,
  IMPORT_ROW_STRUCTURE_KEY,
  readImportRowStructure,
} from "@/lib/imports/payload";
import {
  resolveImportStructure,
  type ImportStructureDecision,
  type ImportStructureLevel,
  type ImportStructureRow,
} from "@/lib/imports/structure";

type JsonRecord = Record<string, unknown>;

/** Labour role priced on imported lines that carry hours (v1/v2 read the role's rate, else 0 €/h). */
export type ImportFlowLaborRole = {
  id: string;
  hourlyRateCents: number;
};

export type ImportFlowLineValuesContext = {
  marginMultiplier: number;
  defaultTaxRateBp: number;
  laborRole?: ImportFlowLaborRole | null;
  /**
   * "preview": the unified import flow showed the import preview (h/u × Q, workbook parameters,
   * labour role) before confirmation. "direct", the default: the linked-DPGF import, the estimate
   * wizard's DPGF source and the quick-create action have no preview, so a line whose hours come
   * from hours per unit, and every line of a workbook with a parameter row, is refused
   * (`preview_required`) rather than priced at 0 €/h (P-16 « avec aperçu », E17).
   */
  entry?: "preview" | "direct";
};

export const IMPORT_PREVIEW_REQUIRED_MESSAGE =
  "Ce DPGF porte des heures par unité ou une ligne de paramètres de classeur (OPTIMA) : importez-le depuis " +
  "l’affaire (« Importer la DPGF ») pour vérifier l’aperçu h/u × Q et choisir le rôle MO.";

export type ImportFlowMappedRowInput = {
  id: string;
  payload: unknown;
};

export type ValidImportFlowLine = {
  itemType: "line";
  mappedRowId: string;
  rowIndex: number;
  title: string;
  description: string | null;
  notes: string | null;
  sourcePage: number | null;
  sourceMetadata: JsonRecord;
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  kFo: number;
  // Stored v1/v2 line hours: the total of the line, never per unit.
  hMo: number;
  // P-16: hours per unit read from the source when the line hours were computed as h/u × Q.
  hoursPerUnit?: number | null;
  hMoMajoration: number;
  kMo: number;
  laborRoleId?: string | null;
  puHtCents: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
};

export type ValidImportFlowSection = {
  itemType: "section";
  mappedRowId: string;
  rowIndex: number;
  title: string;
  level: ImportStructureLevel;
  sourcePage: number | null;
  sourceMetadata: JsonRecord;
};

export type ValidImportFlowItem = ValidImportFlowLine | ValidImportFlowSection;

export type InvalidImportFlowLineReason =
  | "missing_title"
  | "invalid_quantity"
  | "invalid_unit_price"
  | "invalid_tax_rate"
  | "invalid_coefficient"
  | "invalid_labor_hours"
  | "conflicting_labor_hours"
  | "invalid_majoration"
  | "undeclared_majoration_unit"
  | "preview_required"
  | "invalid_row_payload";

export type InvalidImportFlowLine = {
  mappedRowId: string;
  rowIndex: number;
  reason: InvalidImportFlowLineReason;
};

export type IgnoredImportFlowRow = {
  mappedRowId: string;
  rowIndex: number;
  reason: "footer" | "user_ignored" | "parameters";
};

/** Parameters read on the workbook parameter row (OPTIMA row 2), parsed with the D11 grammar. */
export type ImportWorkbookParameters = {
  rowIndex: number;
  coeffFo: number | null;
  coeffMo: number | null;
  hourlyRateCents: number | null;
  // Coefficient applied to lines whose own majoration cell is empty (OPTIMA: 1 + N2).
  majorationCoefficient: number | null;
};

export type NormalizeImportFlowRowsResult = {
  totalRows: number;
  validLines: ValidImportFlowLine[];
  validSections: ValidImportFlowSection[];
  validItems: ValidImportFlowItem[];
  invalidLines: InvalidImportFlowLine[];
  ignoredRows: IgnoredImportFlowRow[];
  zeroPriceRows: number;
  workbookParameters: ImportWorkbookParameters | null;
  unitPriceChecks: ImportUnitPriceCheck[];
};

export type NormalizeImportFlowRowsOptions = {
  detectStructure?: boolean;
  structureDecisions?: ImportStructureDecision[];
};

export type ImportFlowStats = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedRows: number;
  insertedSections: number;
  zeroPriceRows: number;
  ignoredRows: number;
  ignoredFooterRows: number;
  skippedRows: number;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function normalizeOptionalText(value: unknown): string | null {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

export function parseLocalizedNumber(value: unknown): number | null {
  return parseDecimalInput(value);
}

function resolveMappedPayload(payload: JsonRecord): JsonRecord | null {
  const embeddedMappedRow = asRecord(payload.mapped_row);
  return embeddedMappedRow ?? payload;
}

const EMPTY_NUMERIC_SENTINELS = new Set(["", "-", "--", "—", "–", "pm", "p.m.", "n/a", "na"]);

type PreparedImportFlowRow = ImportStructureRow & {
  payload: JsonRecord;
};

function isMissingNumericValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return EMPTY_NUMERIC_SENTINELS.has(value.trim().toLowerCase());
}

type NumericField =
  | { status: "missing"; value: null }
  | { status: "invalid"; value: null }
  | { status: "value"; value: number };

const MISSING_FIELD: NumericField = { status: "missing", value: null };
const INVALID_FIELD: NumericField = { status: "invalid", value: null };

/**
 * D11: one parser per quantity kind. Excess decimals in text are refused, never rounded; a native
 * spreadsheet number is read at the kind's precision; an import never stores a negative value.
 */
function readNumericField(value: unknown, parse: (input: unknown) => number | null): NumericField {
  if (isMissingNumericValue(value)) return MISSING_FIELD;
  const parsed = parse(value);
  if (parsed === null || parsed < 0) return INVALID_FIELD;
  return { status: "value", value: parsed };
}

type MajorationField =
  | { status: "missing" }
  | { status: "invalid"; reason: "invalid_majoration" | "undeclared_majoration_unit" }
  | { status: "value"; coefficient: number };

const MAJORATION_PARSERS: Record<Exclude<MajorationTarget, "h_mo_majoration">, (input: unknown) => number | null> = {
  h_mo_majoration_percent: parseMajorationPercent,
  h_mo_majoration_coefficient: parseMajorationCoefficient,
  h_mo_majoration_additive: parseMajorationAdditive,
};

/**
 * P-11: « Majoration MO (%) », 100 = neutral, is the single human convention. An imported column
 * declares its unit (%, coefficient, or the OPTIMA additive N with coefficient = 1 + N); a value
 * under an undeclared column is refused instead of being taken raw (C-11: « 100 » meant ×100).
 */
function readMajorationField(source: Partial<Record<MajorationTarget, unknown>>): MajorationField {
  const provided = MAJORATION_TARGETS.filter((target) => !isMissingNumericValue(source[target]));
  if (provided.length === 0) return { status: "missing" };
  if (provided.length > 1) return { status: "invalid", reason: "invalid_majoration" };
  const [target] = provided;
  if (target === "h_mo_majoration") return { status: "invalid", reason: "undeclared_majoration_unit" };
  const coefficient = MAJORATION_PARSERS[target](source[target]);
  return coefficient === null
    ? { status: "invalid", reason: "invalid_majoration" }
    : { status: "value", coefficient };
}

const QUANTITY_SCALE = 1000;
const HOURS_PER_UNIT_SCALE = 10_000;
const PRODUCT_TO_LINE_HOURS = BigInt(HOURS_PER_UNIT_SCALE);
const HALF_PRODUCT_UNIT = BigInt(HOURS_PER_UNIT_SCALE / 2);
const ZERO_UNITS = BigInt(0);

/**
 * P-16: v1/v2 store the line's total hours (numeric(12,3)). Hours per unit (4 decimals) times
 * the quantity (3 decimals) is exact in 1e-7 h, then rounded half up to the stored 0,001 h.
 */
export function computeLineHoursFromHoursPerUnit(quantity: number, hoursPerUnit: number): number | null {
  const quantityUnits = Math.round(quantity * QUANTITY_SCALE);
  const hoursPerUnitUnits = Math.round(hoursPerUnit * HOURS_PER_UNIT_SCALE);
  if (!Number.isSafeInteger(quantityUnits) || !Number.isSafeInteger(hoursPerUnitUnits)) return null;
  if (quantityUnits < 0 || hoursPerUnitUnits < 0) return null;
  const product = BigInt(quantityUnits) * BigInt(hoursPerUnitUnits);
  const lineHourUnits = (product + HALF_PRODUCT_UNIT) / PRODUCT_TO_LINE_HOURS;
  if (lineHourUnits < ZERO_UNITS) return null;
  const digits = lineHourUnits.toString().padStart(4, "0");
  const value = Number(`${digits.slice(0, -3)}.${digits.slice(-3)}`);
  return Number.isFinite(value) ? value : null;
}

function readControlUnitPriceCents(value: unknown): number | null {
  if (isMissingNumericValue(value)) return null;
  const euros = parseDecimalInput(value, { currency: "EUR" });
  return euros === null || euros < 0 ? null : euros * 100;
}

function parseWorkbookParameters(
  rowIndex: number,
  values: WorkbookParameterValues
): ImportWorkbookParameters {
  const coeffFo = readNumericField(values.coeffFo, parseCoefficient);
  const coeffMo = readNumericField(values.coeffMo, parseCoefficient);
  const hourlyRate = readNumericField(values.hourlyRate, parseAmountCents);
  const majoration = readMajorationField(values.majoration);
  return {
    rowIndex,
    coeffFo: coeffFo.value,
    coeffMo: coeffMo.value,
    hourlyRateCents: hourlyRate.value,
    majorationCoefficient: majoration.status === "value" ? majoration.coefficient : null,
  };
}

function readSourcePage(rawRow: JsonRecord) {
  const provenance = asRecord(rawRow[IMPORT_ROW_PROVENANCE_KEY]);
  const sourcePage = Number(provenance?.source_page);
  return Number.isInteger(sourcePage) && sourcePage > 0 ? sourcePage : null;
}

function buildSourceMetadata(input: {
  mappedRowId: string;
  rowIndex: number;
  rawRow: JsonRecord;
  notes: string | null;
}) {
  const structure = readImportRowStructure(input.rawRow);
  const provenance = asRecord(input.rawRow[IMPORT_ROW_PROVENANCE_KEY]);

  return {
    mapped_row_id: input.mappedRowId,
    row_index: input.rowIndex,
    notes: input.notes,
    ...(structure
      ? {
          [IMPORT_ROW_STRUCTURE_KEY]: structure,
          sheet_name: structure.sheet_name,
          source_row_number: structure.source_row_number,
          bold_columns: structure.bold_columns,
          merged_columns: structure.merged_columns,
          outline_level: structure.outline_level,
        }
      : {}),
    ...(provenance ? { [IMPORT_ROW_PROVENANCE_KEY]: provenance } : {}),
  };
}

function sortImportFlowItems(items: ValidImportFlowItem[]) {
  return [...items].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) return left.rowIndex - right.rowIndex;
    if (left.itemType !== right.itemType) return left.itemType === "section" ? -1 : 1;
    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

function resolveRowTitle(mappedRow: JsonRecord) {
  const designation = normalizeText(mappedRow.designation);
  const reference = normalizeText(mappedRow.reference ?? mappedRow.hex_code);
  return designation || reference;
}

export function normalizeMappedRowsForEstimateCreation(
  rows: ImportFlowMappedRowInput[],
  context: ImportFlowLineValuesContext,
  options: NormalizeImportFlowRowsOptions = {}
): NormalizeImportFlowRowsResult {
  const validLines: ValidImportFlowLine[] = [];
  const validSections: ValidImportFlowSection[] = [];
  const validItems: ValidImportFlowItem[] = [];
  const invalidLines: InvalidImportFlowLine[] = [];
  const ignoredRows: IgnoredImportFlowRow[] = [];
  const preparedRows: PreparedImportFlowRow[] = [];
  const unitPriceChecks: ImportUnitPriceCheck[] = [];
  let zeroPriceRows = 0;

  rows.forEach((row, index) => {
    const payload = asRecord(row.payload);
    const rowIndexRaw = payload?.row_index;
    const rowIndex = Number.isInteger(rowIndexRaw) ? Number(rowIndexRaw) : index + 1;

    if (!payload) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_row_payload",
      });
      return;
    }

    const mappedRow = resolveMappedPayload(payload);
    if (!mappedRow) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_row_payload",
      });
      return;
    }

    preparedRows.push({
      id: row.id,
      rowIndex,
      payload,
      rawRow: asRecord(payload.raw_row) ?? {},
      mappedRow,
    });
  });

  // The first untitled row carrying workbook parameters (OPTIMA row 2) supplies them to the lines.
  const parameterRow = preparedRows.find((row) =>
    isWorkbookParameterRow(row.mappedRow, resolveRowTitle(row.mappedRow))
  );
  const parameterValues = parameterRow ? readWorkbookParameterValues(parameterRow.mappedRow) : null;
  const workbookParameters =
    parameterRow && parameterValues
      ? parseWorkbookParameters(parameterRow.rowIndex, parameterValues)
      : null;

  const structure = resolveImportStructure(
    preparedRows,
    options.detectStructure || (options.structureDecisions?.length ?? 0) > 0
      ? options.structureDecisions
      : []
  );
  const detectStructure =
    options.detectStructure || (options.structureDecisions?.length ?? 0) > 0;

  for (const row of preparedRows) {
    if (structure.footerRowIndexes.has(row.rowIndex)) {
      ignoredRows.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "footer",
      });
      continue;
    }

    const structureDecision = detectStructure
      ? structure.decisionsByRowIndex.get(row.rowIndex)
      : undefined;
    if (structureDecision?.kind === "ignore") {
      ignoredRows.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "user_ignored",
      });
      continue;
    }

    const title = resolveRowTitle(row.mappedRow);
    if (isWorkbookParameterRow(row.mappedRow, title)) {
      ignoredRows.push({ mappedRowId: row.id, rowIndex: row.rowIndex, reason: "parameters" });
      continue;
    }

    const notes = normalizeOptionalText(row.mappedRow.notes);
    const sourcePage = readSourcePage(row.rawRow);
    const sourceMetadata = buildSourceMetadata({
      mappedRowId: row.id,
      rowIndex: row.rowIndex,
      rawRow: row.rawRow,
      notes,
    });

    if (structureDecision?.kind === "section") {
      const section: ValidImportFlowSection = {
        itemType: "section",
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        title,
        level: structureDecision.level,
        sourcePage,
        sourceMetadata,
      };
      validSections.push(section);
      validItems.push(section);
      continue;
    }

    const reject = (reason: InvalidImportFlowLineReason) => {
      invalidLines.push({ mappedRowId: row.id, rowIndex: row.rowIndex, reason });
    };

    if (title.length === 0) {
      reject("missing_title");
      continue;
    }

    if (
      context.entry !== "preview" &&
      (workbookParameters !== null || !isMissingNumericValue(row.mappedRow.labor_hours_per_unit))
    ) {
      reject("preview_required");
      continue;
    }

    const quantityField = readNumericField(row.mappedRow.quantity, parseQuantity);
    if (quantityField.status === "invalid") {
      reject("invalid_quantity");
      continue;
    }

    const roundedQuantity = quantityField.value ?? 0;
    const unitPriceField = readNumericField(row.mappedRow.unit_price_ht, parseAmountCents);
    const totalHtField = readNumericField(row.mappedRow.total_ht, parseAmountCents);
    if (unitPriceField.status === "invalid" || totalHtField.status === "invalid") {
      reject("invalid_unit_price");
      continue;
    }

    if (
      unitPriceField.status === "missing" &&
      totalHtField.value !== null &&
      totalHtField.value > 0 &&
      roundedQuantity <= 0
    ) {
      reject("invalid_unit_price");
      continue;
    }

    const unitPriceHtCents =
      unitPriceField.value ??
      (totalHtField.value !== null && roundedQuantity > 0
        ? Math.round(totalHtField.value / roundedQuantity)
        : 0);

    const taxRateField = readNumericField(row.mappedRow.tax_rate_bp, parseRateBp);
    if (taxRateField.status === "invalid") {
      reject("invalid_tax_rate");
      continue;
    }
    const taxRateBp = taxRateField.value ?? context.defaultTaxRateBp;

    const kFoField = readNumericField(row.mappedRow.k_fo, parseCoefficient);
    const kMoField = readNumericField(row.mappedRow.k_mo, parseCoefficient);
    if (kFoField.status === "invalid" || kMoField.status === "invalid") {
      reject("invalid_coefficient");
      continue;
    }

    // Line hours share the stored h_mo precision (numeric(12,3)), the quantity's.
    const lineHoursField = readNumericField(row.mappedRow.labor_hours ?? row.mappedRow.h_mo, parseQuantity);
    const hoursPerUnitField = readNumericField(row.mappedRow.labor_hours_per_unit, parseHoursPerUnit);
    if (lineHoursField.status === "invalid" || hoursPerUnitField.status === "invalid") {
      reject("invalid_labor_hours");
      continue;
    }
    if (lineHoursField.status === "value" && hoursPerUnitField.status === "value") {
      reject("conflicting_labor_hours");
      continue;
    }
    const hoursPerUnit = hoursPerUnitField.value;
    const hMo =
      hoursPerUnit !== null
        ? computeLineHoursFromHoursPerUnit(roundedQuantity, hoursPerUnit)
        : (lineHoursField.value ?? 0);
    if (hMo === null) {
      reject("invalid_labor_hours");
      continue;
    }

    let majorationField = readMajorationField(row.mappedRow);
    if (majorationField.status === "missing" && parameterValues) {
      majorationField = readMajorationField(parameterValues.majoration);
    }
    if (majorationField.status === "invalid") {
      reject(majorationField.reason);
      continue;
    }

    const kFo = kFoField.value ?? 1;
    const hMoMajoration = majorationField.status === "value" ? majorationField.coefficient : 1;
    const kMo = kMoField.value ?? 1;
    const laborRole = hMo > 0 ? (context.laborRole ?? null) : null;

    const lineValues = computeEstimateLineValues(
      {
        quantity: roundedQuantity,
        unit_price_ht_cents: unitPriceHtCents,
        tax_rate_bp: taxRateBp,
        k_fo: kFo,
        h_mo: hMo,
        h_mo_majoration: hMoMajoration,
        k_mo: kMo,
        labor_role_hourly_rate_cents: laborRole?.hourlyRateCents ?? 0,
        pu_ht_cents: 0,
      },
      {
        marginMultiplier: context.marginMultiplier,
        taxRateBp,
        isLaborSplitEnabled: false,
      }
    );

    const line: ValidImportFlowLine = {
      itemType: "line",
      mappedRowId: row.id,
      rowIndex: row.rowIndex,
      title,
      description: normalizeOptionalText(row.mappedRow.unit),
      notes,
      sourcePage,
      sourceMetadata,
      quantity: roundedQuantity,
      unitPriceHtCents,
      taxRateBp,
      kFo,
      hMo,
      hoursPerUnit,
      hMoMajoration,
      kMo,
      laborRoleId: laborRole?.id ?? null,
      puHtCents: lineValues.puHtCents,
      lineTotalHtCents: lineValues.saleLineCents,
      lineTaxCents: lineValues.taxLineCents,
      lineTotalTtcCents: lineValues.ttcLineCents,
    };
    validLines.push(line);
    validItems.push(line);
    if (unitPriceHtCents === 0) zeroPriceRows += 1;

    const unitPriceCheck = checkUnitPriceAgainstControl({
      rowIndex: row.rowIndex,
      title,
      quantity: roundedQuantity,
      lineTotalHtCents: lineValues.saleLineCents,
      controlUnitPriceCents: readControlUnitPriceCents(row.mappedRow.control_unit_price),
    });
    if (unitPriceCheck) unitPriceChecks.push(unitPriceCheck);
  }

  return {
    totalRows: rows.length,
    validLines,
    validSections,
    validItems: sortImportFlowItems(validItems),
    invalidLines,
    ignoredRows,
    zeroPriceRows,
    workbookParameters,
    unitPriceChecks,
  };
}

/** True when the rows carry hours per unit or workbook parameters, which only the preview shows. */
export function importRequiresPreview(normalized: NormalizeImportFlowRowsResult): boolean {
  return (
    normalized.workbookParameters !== null ||
    normalized.invalidLines.some((line) => line.reason === "preview_required") ||
    normalized.validLines.some((line) => typeof line.hoursPerUnit === "number")
  );
}

export type ImportLaborRoleCandidate = {
  id: string;
  name: string;
  hourlyRateCents: number;
};

export type ImportLaborRoleResolution =
  // No imported line carries hours: no role is needed.
  | { status: "not_needed"; role: null }
  // The role is chosen: the one requested, or the single active role at the workbook rate.
  | { status: "resolved"; role: ImportLaborRoleCandidate; origin: "requested" | "workbook_rate" }
  // The workbook states a rate that matches no active role, or several: an explicit choice is
  // required rather than importing hours at 0 €/h (E17).
  | { status: "choice_required"; role: null; matchingRoleIds: string[] }
  // Hours without a workbook rate: no role unless the user picks one (MO valued at 0 €/h).
  | { status: "unassigned"; role: null }
  // The user explicitly declined any role in the preview: MO valued at 0 €/h, with its warning.
  | { status: "declined"; role: null }
  | { status: "invalid_role"; role: null };

/**
 * Labour role for imported hours (sub-lot 2.3, E17). `requestedRoleId`: `undefined` lets the
 * workbook rate decide, `null` declines any role, a string must be an active role of the owner.
 */
export function resolveImportLaborRole(input: {
  hasLaborHours: boolean;
  workbookHourlyRateCents: number | null;
  roles: ImportLaborRoleCandidate[];
  requestedRoleId?: string | null;
}): ImportLaborRoleResolution {
  if (!input.hasLaborHours) return { status: "not_needed", role: null };
  // An explicit null is the preview's « Aucun rôle (MO à 0 €/h) » choice, accepted even when the
  // workbook rate matches no role or the owner has none (2.3 review: it looped back to the choice).
  if (input.requestedRoleId === null) return { status: "declined", role: null };

  if (typeof input.requestedRoleId === "string") {
    const role = input.roles.find((candidate) => candidate.id === input.requestedRoleId);
    return role ? { status: "resolved", role, origin: "requested" } : { status: "invalid_role", role: null };
  }

  if (input.workbookHourlyRateCents === null) return { status: "unassigned", role: null };

  const matching = input.roles.filter(
    (candidate) => candidate.hourlyRateCents === input.workbookHourlyRateCents
  );
  if (matching.length === 1) {
    return { status: "resolved", role: matching[0]!, origin: "workbook_rate" };
  }
  return { status: "choice_required", role: null, matchingRoleIds: matching.map((role) => role.id) };
}

export function buildImportFlowStats(
  normalized: NormalizeImportFlowRowsResult,
  insertedRows: number,
  insertedSections = 0
): ImportFlowStats {
  const safeInsertedRows = Math.max(Math.trunc(insertedRows), 0);
  const safeInsertedSections = Math.max(Math.trunc(insertedSections), 0);
  const skippedRows = Math.max(
    normalized.totalRows - safeInsertedRows - safeInsertedSections,
    0
  );

  return {
    totalRows: normalized.totalRows,
    validRows: normalized.validLines.length + normalized.validSections.length,
    invalidRows: normalized.invalidLines.length,
    insertedRows: safeInsertedRows,
    insertedSections: safeInsertedSections,
    zeroPriceRows: normalized.zeroPriceRows,
    ignoredRows: normalized.ignoredRows.length,
    ignoredFooterRows: normalized.ignoredRows.filter((row) => row.reason === "footer").length,
    skippedRows,
  };
}
