import {
  SPREADSHEET_COLUMN_KEYS,
  formatMajorationPercentInput,
  parseCoefficientDraft,
  parseLineHoursDraft,
  parseMajorationPercentToCoefficient,
  parseQuantityInput,
  type EstimateItem,
} from "@/components/estimates/components/estimate-editor-row/shared";
import type { EstimateEditorItemPatch } from "@/hooks/useEstimateEditorItemsController";
import type { GridSelection } from "@/hooks/useGridNavigation";
import type { SpreadsheetNavigationRow } from "@/hooks/useSpreadsheetNavigation";
import { resolveUniqueEstimateType, type EstimateTypeOption } from "@/lib/estimates/type-search";
import { resolveEstimateV3UnitInput } from "@/lib/estimates/v3-editor";
import { parseCurrencyToCents, type SupportedEstimateCurrency } from "@/lib/money";
import { formatDecimalInput, parseHoursPerUnit } from "@/lib/numeric-input/parsers";

// Cell-level clipboard, fill down and clear for the estimate grid. Everything
// here is pure: the grid hands a selection, this module answers with the text
// to copy or the inputs to write. A derived value (P.U., total) is never
// written; it can only be copied.

type ItemPatch = EstimateEditorItemPatch;
type PatchField = Extract<keyof ItemPatch & keyof EstimateItem, string>;

export type EstimateGridCellContext = {
  /** Engine 3 grid: units come from the referential, hours are per unit. */
  isV3: boolean;
  currency: SupportedEstimateCurrency;
  supplyTypeOptions: readonly EstimateTypeOption[];
  laborRoleOptions: readonly EstimateTypeOption[];
  /** v1/v2 only: the unit text shown for each line (draft over stored value). */
  legacyUnitByItemId: Readonly<Record<string, string>>;
};

export type EstimateGridCellWrite = {
  itemId: string;
  rowId: string;
  columnKey: string;
  patch: ItemPatch;
  /** v1/v2 unit cell: the draft shown by the cell follows the write. */
  legacyUnitDraft?: string;
};

export type EstimateGridWritePlan = {
  writes: EstimateGridCellWrite[];
  /** Cells left untouched because their text could not be read. */
  rejected: Array<{ rowId: string; columnKey: string; message: string }>;
  /** Cells left untouched because the column is computed. */
  readOnlyCount: number;
};

type ParseResult =
  | { ok: true; patch: ItemPatch; legacyUnitDraft?: string }
  | { ok: false; message: string };

type ColumnDescriptor = {
  read: (item: EstimateItem, context: EstimateGridCellContext) => string;
  /** Absent on a computed column. */
  parse?: (text: string, item: EstimateItem, context: EstimateGridCellContext) => ParseResult;
  /** Stored inputs behind the cell, copied as they are by fill down. */
  fields?: (context: EstimateGridCellContext) => PatchField[];
  /** Why the stored value of this source must not be copied by fill down; null when it can. */
  fillRefusal?: (source: EstimateItem, context: EstimateGridCellContext) => string | null;
};

const K = SPREADSHEET_COLUMN_KEYS;

function ok(patch: ItemPatch, legacyUnitDraft?: string): ParseResult {
  return legacyUnitDraft === undefined ? { ok: true, patch } : { ok: true, patch, legacyUnitDraft };
}

function patchOf(field: PatchField, value: string | number | null): ItemPatch {
  return { [field]: value } as ItemPatch;
}

function refuse(message: string): ParseResult {
  return { ok: false, message };
}

function singleLine(text: string) {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** The name the editor gives a designation typed empty: a row is never nameless. */
function emptyTitleOf(item: EstimateItem) {
  return item.item_type === "section" ? "Sans titre" : "Nouvelle ligne";
}

function numberColumn(options: {
  field: PatchField;
  read: (item: EstimateItem) => number | null | undefined;
  parse: (text: string) => number | null;
  emptyValue: number;
  label: string;
}): ColumnDescriptor {
  return {
    read: (item) => formatDecimalInput(options.read(item) ?? options.emptyValue),
    parse: (text) => {
      if (text.trim() === "") return ok(patchOf(options.field, options.emptyValue));
      const value = options.parse(text);
      return value === null
        ? refuse(`${options.label} : « ${text.trim()} » n'est pas un nombre accepté.`)
        : ok(patchOf(options.field, value));
    },
    fields: () => [options.field],
  };
}

function hoursColumn(options: {
  legacyField: PatchField;
  perUnitField: PatchField;
  label: string;
}): ColumnDescriptor {
  const fieldOf = (context: EstimateGridCellContext) =>
    context.isV3 ? options.perUnitField : options.legacyField;
  return {
    read: (item, context) => formatDecimalInput(Number(item[fieldOf(context)] ?? 0)),
    parse: (text, _item, context) => {
      if (text.trim() === "") return ok(patchOf(fieldOf(context), 0));
      const value = context.isV3 ? parseHoursPerUnit(text) : parseLineHoursDraft(text);
      return value === null
        ? refuse(`${options.label} : « ${text.trim()} » n'est pas un nombre accepté.`)
        : ok(patchOf(fieldOf(context), value));
    },
    fields: (context) => [fieldOf(context)],
  };
}

function typeColumn(options: {
  field: PatchField;
  options: (context: EstimateGridCellContext) => readonly EstimateTypeOption[];
  label: string;
}): ColumnDescriptor {
  return {
    read: (item, context) => {
      const id = item[options.field];
      if (typeof id !== "string" || !id) return "";
      return options.options(context).find((option) => option.id === id)?.label ?? "";
    },
    parse: (text, _item, context) => {
      if (text.trim() === "") return ok(patchOf(options.field, null));
      const match = resolveUniqueEstimateType(options.options(context), text);
      return match
        ? ok(patchOf(options.field, match.id))
        : refuse(`${options.label} : « ${text.trim()} » ne désigne pas un type unique.`);
    },
    fields: () => [options.field],
    // A type that is no longer offered is refused when typed or pasted: fill
    // down does not spread it either.
    fillRefusal: (source, context) => {
      const id = source[options.field];
      if (typeof id !== "string" || !id) return null;
      const option = options.options(context).find((candidate) => candidate.id === id);
      return option?.disabled ? `${options.label} : « ${option.label} » n'est plus proposé.` : null;
    },
  };
}

const COEFFICIENT_LABEL = "Coefficient";

const COLUMN_DESCRIPTORS: Record<string, ColumnDescriptor> = {
  [K.title]: {
    read: (item) => item.title ?? "",
    parse: (text, item) => ok({ title: singleLine(text) || emptyTitleOf(item) }),
    fields: () => ["title"],
  },
  [K.quantity]: numberColumn({
    field: "quantity",
    read: (item) => item.quantity,
    parse: parseQuantityInput,
    emptyValue: 0,
    label: "Quantité",
  }),
  [K.unit]: {
    read: (item, context) =>
      context.isV3 ? (item.unit_code ?? "") : (context.legacyUnitByItemId[item.id] ?? item.description ?? ""),
    parse: (text, item, context) => {
      if (!context.isV3) {
        const value = singleLine(text);
        return ok({ description: value || null }, value);
      }
      const resolution = resolveEstimateV3UnitInput(singleLine(text), item.unit_code);
      if (resolution.kind === "invalid") return refuse(resolution.message);
      return ok(resolution.kind === "unit" ? { unit_code: resolution.unitCode } : {});
    },
    fields: (context) => [context.isV3 ? "unit_code" : "description"],
  },
  [K.unitPrice]: {
    read: (item) =>
      item.unit_price_ht_cents === null || item.unit_price_ht_cents === undefined
        ? ""
        : formatDecimalInput(item.unit_price_ht_cents / 100),
    parse: (text, _item, context) => {
      if (text.trim() === "") return ok({ unit_price_ht_cents: 0 });
      const cents = parseCurrencyToCents(text, context.currency);
      return cents === null || cents < 0
        ? refuse(`Prix FO : « ${text.trim()} » n'est pas un montant accepté.`)
        : ok({ unit_price_ht_cents: cents });
    },
    fields: () => ["unit_price_ht_cents"],
  },
  [K.supplyType]: typeColumn({
    field: "supply_type_id",
    options: (context) => context.supplyTypeOptions,
    label: "Type FO",
  }),
  [K.kFo]: numberColumn({
    field: "k_fo",
    read: (item) => item.k_fo,
    parse: parseCoefficientDraft,
    emptyValue: 1,
    label: `${COEFFICIENT_LABEL} K FO`,
  }),
  // The supplier cell opens the comparison panel: nothing to type, copy or paste.
  [K.supplier]: { read: () => "" },
  [K.hMo]: hoursColumn({ legacyField: "h_mo", perUnitField: "h_mo_per_unit", label: "Heures MO" }),
  [K.hMoAtelier]: hoursColumn({
    legacyField: "h_mo_atelier",
    perUnitField: "h_mo_atelier_per_unit",
    label: "Heures atelier",
  }),
  [K.hMoChantier]: hoursColumn({
    legacyField: "h_mo_chantier",
    perUnitField: "h_mo_chantier_per_unit",
    label: "Heures chantier",
  }),
  [K.hMoMajoration]: {
    read: (item) => formatMajorationPercentInput(item.h_mo_majoration).replace(".", ","),
    parse: (text) => {
      if (text.trim() === "") return ok({ h_mo_majoration: 1 });
      const coefficient = parseMajorationPercentToCoefficient(text);
      return coefficient === null
        ? refuse(`Majoration MO : « ${text.trim()} » n'est pas un pourcentage accepté.`)
        : ok({ h_mo_majoration: coefficient });
    },
    fields: () => ["h_mo_majoration"],
  },
  [K.laborRole]: typeColumn({
    field: "labor_role_id",
    options: (context) => context.laborRoleOptions,
    label: "Type MO",
  }),
  [K.laborRoleAtelier]: typeColumn({
    field: "labor_role_atelier_id",
    options: (context) => context.laborRoleOptions,
    label: "Type MO atelier",
  }),
  [K.laborRoleChantier]: typeColumn({
    field: "labor_role_chantier_id",
    options: (context) => context.laborRoleOptions,
    label: "Type MO chantier",
  }),
  [K.kMo]: numberColumn({
    field: "k_mo",
    read: (item) => item.k_mo,
    parse: parseCoefficientDraft,
    emptyValue: 1,
    label: `${COEFFICIENT_LABEL} K MO`,
  }),
  [K.kMoAtelier]: numberColumn({
    field: "k_mo_atelier",
    read: (item) => item.k_mo_atelier,
    parse: parseCoefficientDraft,
    emptyValue: 1,
    label: `${COEFFICIENT_LABEL} K MO atelier`,
  }),
  [K.kMoChantier]: numberColumn({
    field: "k_mo_chantier",
    read: (item) => item.k_mo_chantier,
    parse: parseCoefficientDraft,
    emptyValue: 1,
    label: `${COEFFICIENT_LABEL} K MO chantier`,
  }),
  [K.pu]: {
    read: (item) =>
      item.pu_ht_cents === null || item.pu_ht_cents === undefined ? "" : formatDecimalInput(item.pu_ht_cents / 100),
  },
  [K.total]: {
    read: (item) =>
      item.line_total_ht_cents === null || item.line_total_ht_cents === undefined
        ? ""
        : formatDecimalInput(item.line_total_ht_cents / 100),
  },
};

function descriptorOf(item: EstimateItem, columnKey: string): ColumnDescriptor | null {
  // A section only has its title; every other key belongs to lines.
  if (item.item_type === "section" && columnKey !== K.title) return null;
  return COLUMN_DESCRIPTORS[columnKey] ?? null;
}

export function isEstimateGridCellWritable(item: EstimateItem, columnKey: string) {
  return Boolean(descriptorOf(item, columnKey)?.parse);
}

export function readEstimateGridCellText(
  item: EstimateItem,
  columnKey: string,
  context: EstimateGridCellContext,
): string {
  return descriptorOf(item, columnKey)?.read(item, context) ?? "";
}

/** Drops the fields that already hold the wanted value: an unchanged cell is not a write. */
function keepChangedFields(item: EstimateItem, patch: ItemPatch): ItemPatch | null {
  const record = item as unknown as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  let hasChange = false;
  for (const [field, value] of Object.entries(patch)) {
    if ((record[field] ?? null) === (value ?? null)) continue;
    changed[field] = value;
    hasChange = true;
  }
  return hasChange ? (changed as ItemPatch) : null;
}

type ItemLookup = (rowId: string) => EstimateItem | undefined;

type PlanCell = { rowId: string; columnKey: string };

function createPlan(): EstimateGridWritePlan {
  return { writes: [], rejected: [], readOnlyCount: 0 };
}

function pushResult(
  plan: EstimateGridWritePlan,
  cell: PlanCell,
  item: EstimateItem,
  result: ParseResult,
) {
  if (!result.ok) {
    plan.rejected.push({ ...cell, message: result.message });
    return;
  }
  const patch = keepChangedFields(item, result.patch);
  if (!patch) return;
  plan.writes.push({
    itemId: item.id,
    ...cell,
    patch,
    ...(result.legacyUnitDraft === undefined ? {} : { legacyUnitDraft: result.legacyUnitDraft }),
  });
}

function writeText(
  plan: EstimateGridWritePlan,
  cell: PlanCell,
  text: string,
  getItem: ItemLookup,
  context: EstimateGridCellContext,
) {
  const item = getItem(cell.rowId);
  if (!item) return;
  const descriptor = descriptorOf(item, cell.columnKey);
  if (!descriptor) return;
  if (!descriptor.parse) {
    plan.readOnlyCount += 1;
    return;
  }
  pushResult(plan, cell, item, descriptor.parse(text, item, context));
}

/**
 * « Suppr » on the selection: every input cell goes back to its empty value.
 * A designation goes back to the name the editor gives an empty one.
 */
export function planEstimateGridClear(
  selection: GridSelection,
  getItem: ItemLookup,
  context: EstimateGridCellContext,
): EstimateGridWritePlan {
  const plan = createPlan();
  for (const row of selection.rows) {
    for (const columnKey of row.columnKeys) {
      const cell = { rowId: row.rowId, columnKey };
      const item = getItem(row.rowId);
      if (!item) continue;
      const descriptor = descriptorOf(item, columnKey);
      if (!descriptor) continue;
      if (!descriptor.parse) {
        plan.readOnlyCount += 1;
        continue;
      }
      // An emptied designation takes the editor's default name, as when it is typed empty.
      pushResult(plan, cell, item, descriptor.parse("", item, context));
    }
  }
  return plan;
}

/**
 * Ctrl+D. On a range, the first row of each column is copied down the range.
 * On a single cell, the nearest row above that has the column is copied.
 * Stored inputs are copied as they are: no text round trip, no lost decimal.
 * A line is filled from a line and a section title from a section title.
 */
export function planEstimateGridFillDown(
  selection: GridSelection,
  rows: readonly SpreadsheetNavigationRow[],
  getItem: ItemLookup,
  context: EstimateGridCellContext,
): EstimateGridWritePlan {
  const plan = createPlan();

  const copyInto = (source: EstimateItem, target: EstimateItem, cell: PlanCell) => {
    const descriptor = descriptorOf(target, cell.columnKey);
    const sourceDescriptor = descriptorOf(source, cell.columnKey);
    if (!descriptor || !sourceDescriptor) return;
    if (!descriptor.parse || !descriptor.fields) {
      plan.readOnlyCount += 1;
      return;
    }
    const refusal = descriptor.fillRefusal?.(source, context);
    if (refusal) {
      plan.rejected.push({ ...cell, message: refusal });
      return;
    }
    const sourceRecord = source as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const field of descriptor.fields(context)) patch[field] = sourceRecord[field] ?? null;
    const legacyUnitDraft =
      cell.columnKey === K.unit && !context.isV3 ? sourceDescriptor.read(source, context) : undefined;
    if (legacyUnitDraft !== undefined) patch.description = legacyUnitDraft.trim() || null;
    pushResult(plan, cell, target, ok(patch as ItemPatch, legacyUnitDraft));
  };

  if (selection.rows.length > 1) {
    for (const columnKey of selection.columnKeys) {
      const column = selection.rows.filter((row) => row.columnKeys.includes(columnKey));
      const source = column[0] ? getItem(column[0].rowId) : undefined;
      if (!source) continue;
      for (const row of column.slice(1)) {
        const target = getItem(row.rowId);
        if (target && target.item_type === source.item_type) {
          copyInto(source, target, { rowId: row.rowId, columnKey });
        }
      }
    }
    return plan;
  }

  const activeIndex = rows.findIndex((row) => row.rowId === selection.active.rowId);
  const target = getItem(selection.active.rowId);
  if (activeIndex < 0 || !target) return plan;
  for (const columnKey of selection.columnKeys) {
    for (let index = activeIndex - 1; index >= 0; index -= 1) {
      if (!rows[index].columnKeys.includes(columnKey)) continue;
      const source = getItem(rows[index].rowId);
      if (!source || source.item_type !== target.item_type) continue;
      copyInto(source, target, { rowId: selection.active.rowId, columnKey });
      break;
    }
  }
  return plan;
}

/**
 * A cell on the clipboard. A text that starts with a quote would be read back
 * as a quoted cell and lose its quotes: it is quoted, its quotes doubled.
 */
function toClipboardCell(text: string) {
  const flat = text.replace(/[\t\r\n]+/g, " ");
  return flat.startsWith('"') ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/** Tab-separated text of the selection, one line per row, as a spreadsheet expects it. */
export function serializeEstimateGridSelection(
  selection: GridSelection,
  getItem: ItemLookup,
  context: EstimateGridCellContext,
): string {
  return selection.rows
    .map((row) => {
      const item = getItem(row.rowId);
      return selection.columnKeys
        .map((columnKey) =>
          item && row.columnKeys.includes(columnKey)
            ? toClipboardCell(readEstimateGridCellText(item, columnKey, context))
            : "",
        )
        .join("\t");
    })
    .join("\n");
}

/**
 * Clipboard text as a matrix. Spreadsheets end the block with a line break and
 * quote the cells that hold a tab, a line break or a quote.
 */
export function parseClipboardMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let index = 0;
  const source = text.replace(/\r\n?/g, "\n");

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '"' && cell === "") {
      // Quoted cell: read up to the closing quote, « "" » is a literal quote.
      let end = index + 1;
      let value = "";
      let closed = false;
      while (end < source.length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          closed = true;
          break;
        }
        value += source[end];
        end += 1;
      }
      const after = source[end + 1];
      if (closed && (after === undefined || after === "\t" || after === "\n")) {
        cell = value;
        index = end + 1;
        continue;
      }
    }
    if (char === "\t") endCell();
    else if (char === "\n") endRow();
    else cell += char;
    index += 1;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Ctrl+V on cells.
 * - One value: every cell of the selection takes it.
 * - A block: laid from the top-left cell of the selection, downwards over the
 *   rows that have the column, rightwards in display order; repeated to fill a
 *   selection that is a whole multiple of the block. What falls off the grid is dropped.
 */
export function planEstimateGridPaste(
  selection: GridSelection,
  matrix: readonly (readonly string[])[],
  rows: readonly SpreadsheetNavigationRow[],
  getItem: ItemLookup,
  context: EstimateGridCellContext,
): EstimateGridWritePlan {
  const plan = createPlan();
  const blockHeight = matrix.length;
  const blockWidth = matrix.reduce((width, line) => Math.max(width, line.length), 0);
  if (blockHeight === 0 || blockWidth === 0) return plan;

  if (blockHeight === 1 && blockWidth === 1) {
    for (const row of selection.rows) {
      for (const columnKey of row.columnKeys) {
        writeText(plan, { rowId: row.rowId, columnKey }, matrix[0][0] ?? "", getItem, context);
      }
    }
    return plan;
  }

  const anchorRowId = selection.rows[0]?.rowId ?? selection.active.rowId;
  const anchorColumnKey = selection.columnKeys[0] ?? selection.active.columnKey;
  const anchorRowIndex = rows.findIndex((row) => row.rowId === anchorRowId);
  if (anchorRowIndex < 0) return plan;

  const selectionHeight = selection.rows.length;
  const selectionWidth = selection.columnKeys.length;
  const repeatsDown =
    selection.isRange && selectionHeight % blockHeight === 0 ? selectionHeight / blockHeight : 1;
  const repeatsRight =
    selection.isRange && selectionWidth % blockWidth === 0 ? selectionWidth / blockWidth : 1;

  const targetRows = rows
    .slice(anchorRowIndex)
    .filter((row) => row.columnKeys.includes(anchorColumnKey))
    .slice(0, blockHeight * repeatsDown);
  // Columns follow the widest row that receives the block: a section on the
  // first row only has its title, the lines under it have every column.
  const columnSource = targetRows.reduce<SpreadsheetNavigationRow | undefined>(
    (widest, row) => (!widest || row.columnKeys.length > widest.columnKeys.length ? row : widest),
    undefined,
  );
  if (!columnSource) return plan;
  const anchorColumnIndex = columnSource.columnKeys.indexOf(anchorColumnKey);

  for (let rowOffset = 0; rowOffset < blockHeight * repeatsDown; rowOffset += 1) {
    const targetRow = targetRows[rowOffset];
    if (!targetRow) break;
    const line = matrix[rowOffset % blockHeight];
    for (let columnOffset = 0; columnOffset < blockWidth * repeatsRight; columnOffset += 1) {
      const columnKey = columnSource.columnKeys[anchorColumnIndex + columnOffset];
      if (!columnKey) break;
      if (!targetRow.columnKeys.includes(columnKey)) continue;
      writeText(
        plan,
        { rowId: targetRow.rowId, columnKey },
        line[columnOffset % blockWidth] ?? "",
        getItem,
        context,
      );
    }
  }
  return plan;
}

/** Several cells of one line become one patch: one write per line. */
export function groupEstimateGridWrites(writes: readonly EstimateGridCellWrite[]) {
  const byItemId = new Map<string, { itemId: string; patch: ItemPatch; legacyUnitDraft?: string }>();
  for (const write of writes) {
    const current = byItemId.get(write.itemId);
    byItemId.set(write.itemId, {
      itemId: write.itemId,
      patch: { ...current?.patch, ...write.patch },
      ...(write.legacyUnitDraft !== undefined
        ? { legacyUnitDraft: write.legacyUnitDraft }
        : current?.legacyUnitDraft !== undefined
          ? { legacyUnitDraft: current.legacyUnitDraft }
          : {}),
    });
  }
  return [...byItemId.values()];
}

/** One sentence for what a paste, a fill or a clear left untouched; null when everything went in. */
export function describeEstimateGridPlanLeftovers(plan: EstimateGridWritePlan): string | null {
  const parts: string[] = [];
  if (plan.rejected.length > 0) {
    parts.push(
      plan.rejected.length === 1
        ? plan.rejected[0].message
        : `${plan.rejected.length} cellules ont gardé leur valeur : ${plan.rejected[0].message}`,
    );
  }
  if (plan.readOnlyCount > 0) {
    parts.push(
      plan.readOnlyCount === 1
        ? "Une cellule calculée n'a pas été modifiée."
        : `${plan.readOnlyCount} cellules calculées n'ont pas été modifiées.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
