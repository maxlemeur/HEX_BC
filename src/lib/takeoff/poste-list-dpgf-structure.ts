import type { ImportRowStructure } from "@/lib/imports/payload";
import { EMPTY_CELL_SENTINELS, isFooterTitle, resolveImportRowTitle } from "@/lib/imports/structure";
import { normalizeHeaderValue } from "@/lib/imports/tabular-normalization";
import { stripAccents } from "@/lib/text/fold";

const SECTION_TITLE = /^(?:lot|sous[- ]lot|batiment|chapitre|tranche|niveau|etage|zone)\s+\S/i;
const CURRENCY_CODE = /^(?:EUR|USD|CHF|GBP|CAD|AUD|JPY)|(?:EUR|USD|CHF|GBP|CAD|AUD|JPY)$/gi;
const NUMERIC_DESIGNATION = /^(?=.*\p{Nd})[\p{Nd}\p{Sc}\s.,'’+\-−–()%]+$/u;

type HeaderTarget = "designation" | "unit" | "quantity";
type StructureRow = {
  designation?: unknown;
  reference?: unknown;
  hex_code?: unknown;
  unit?: unknown;
  quantity?: unknown;
};

export function isEmptyDpgfCell(value: unknown) {
  return value == null || (typeof value === "string" && EMPTY_CELL_SENTINELS.has(value.trim().toLowerCase()));
}

export function createDpgfPosteClassifier(columnMapping: Readonly<Record<string, unknown>>) {
  const headers = { designation: new Set<string>(), unit: new Set<string>(), quantity: new Set<string>() };
  for (const [column, field] of Object.entries(columnMapping)) {
    if (field === "designation" || field === "unit" || field === "quantity") {
      headers[field].add(normalizeHeaderValue(column, 0));
    }
  }
  const matchesHeader = (value: unknown, field: HeaderTarget) =>
    typeof value === "string" && value.trim() !== "" && headers[field].has(normalizeHeaderValue(value, 0));

  return (row: StructureRow, structure?: ImportRowStructure | null) => {
    const title = resolveImportRowTitle(row);
    if ([row.designation, row.reference, row.hex_code].some(
      (value) => typeof value === "string" && isFooterTitle(value.trim().replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, " ")),
    )) return { kind: "footer" } as const;
    if (!title || isEmptyDpgfCell(title)) return { kind: "empty" } as const;
    const withoutCurrency = title.replace(/\s+(?:H\.?T\.?|T\.?T\.?C\.?)$/i, "").replace(CURRENCY_CODE, "");
    if (NUMERIC_DESIGNATION.test(withoutCurrency)) return { kind: "unreadable_designation" } as const;
    if (matchesHeader(row.designation, "designation") &&
      (matchesHeader(row.unit, "unit") || matchesHeader(row.quantity, "quantity"))) {
      return { kind: "header" } as const;
    }
    if (!isEmptyDpgfCell(row.unit) || !isEmptyDpgfCell(row.quantity)) return { kind: "line" } as const;

    const styledDesignation = structure && [...structure.bold_columns, ...structure.merged_columns]
      .some((column) => matchesHeader(column, "designation"));
    if (styledDesignation || SECTION_TITLE.test(stripAccents(title))) {
      return { kind: "section", level: structure?.outline_level && structure.outline_level > 1 ? 2 : 1 } as const;
    }
    return { kind: "ambiguous" } as const;
  };
}
