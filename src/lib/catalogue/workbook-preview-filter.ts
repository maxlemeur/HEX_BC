import type { CostingWorkbookColumn } from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { foldText } from "@/lib/text/fold";

type Cell = CostingWorkbookRows[number][number] | undefined;
export type WorkbookColumnFilterMode = "values" | "contains" | "exact" | "number" | "range";
export type WorkbookColumnFilter =
  | { mode: Exclude<WorkbookColumnFilterMode, "range">; value: string }
  | { mode: "range"; min: string; max: string };

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
const VALUE_LIST_THRESHOLD = 30;
const EMPTY = "empty";
const cellText = (cell: Cell) => String(cell ?? "").trim();
const decimal = /^[+-]?(?:0|[1-9]\d*)(?:[.,]\d+)?$/;

export function workbookFilterValue(cell: Cell) {
  const text = cellText(cell);
  return text ? `value:${text}` : EMPTY;
}

export function workbookFilterNumber(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const text = cellText(cell);
  if (!decimal.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

export function inspectWorkbookColumnFilter(cells: readonly Cell[], field?: CostingWorkbookColumn) {
  const labels = new Set<string>();
  let hasEmpty = false;
  let allNumbers = true;
  let hasNumbers = false;
  for (const cell of cells) {
    const text = cellText(cell);
    if (text === "") {
      hasEmpty = true;
      continue;
    }
    labels.add(text);
    const nativeNumber = typeof cell === "number" && Number.isFinite(cell);
    allNumbers &&= nativeNumber;
    hasNumbers ||= nativeNumber;
  }
  // Unknown digit-only text can be an identifier. Only native numbers justify
  // a numeric default for an unrecognised header.
  const numeric = field === "Fiabilité (/10)" || field === "PR. FO" || (hasNumbers && allNumbers);
  const suggestedMode: WorkbookColumnFilterMode = field === "Dimension" || labels.size <= VALUE_LIST_THRESHOLD
    ? "values" : numeric ? "number" : "contains";
  const options = [...labels].sort(collator.compare).map((label) => ({ label, value: workbookFilterValue(label) }));
  if (hasEmpty) options.push({ label: "Cellules vides", value: EMPTY });
  return { suggestedMode, numeric, options };
}

export function emptyWorkbookColumnFilter(mode: WorkbookColumnFilterMode): WorkbookColumnFilter {
  return mode === "range" ? { mode, min: "", max: "" } : { mode, value: "" };
}

export function compileWorkbookColumnFilter(filter: WorkbookColumnFilter): ((cell: Cell) => boolean) | null {
  if (filter.mode === "range") {
    const min = workbookFilterNumber(filter.min);
    const max = workbookFilterNumber(filter.max);
    if ((min === null && max === null) || (filter.min.trim() && min === null) || (filter.max.trim() && max === null)
      || (min !== null && max !== null && min > max)) return null;
    return (cell) => {
      const number = workbookFilterNumber(cell);
      return number !== null && (min === null || number >= min) && (max === null || number <= max);
    };
  }

  const query = filter.value.trim();
  if (!query) return null;
  if (filter.mode === "number") {
    const number = workbookFilterNumber(query);
    return number === null ? null : (cell) => workbookFilterNumber(cell) === number;
  }
  if (filter.mode === "values") return (cell) => workbookFilterValue(cell) === query;
  if (filter.mode === "exact") return (cell) => cellText(cell) === query;
  const folded = foldText(query);
  return (cell) => foldText(cellText(cell)).includes(folded);
}
