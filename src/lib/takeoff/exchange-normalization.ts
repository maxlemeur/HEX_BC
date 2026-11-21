import { TakeoffWarningSchema } from "@/lib/takeoff/schemas";
import type {
  TakeoffExchange,
  TakeoffWarning,
} from "@/lib/takeoff/types";
import { toUnitToken } from "@/lib/takeoff/units";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { toNonEmptyString } from "@/lib/value-guards";

export type NormalizedTakeoffItemForInsert = {
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
};

const UNIT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  m: ["m", "metre", "metres", "meter", "meters", "m."],
  ml: ["ml", "m.l", "ml.", "métré linéaire", "métrés lineaires", "linear meter"],
  m2: ["m2", "m²", "métré carre", "métrés carres", "sqm", "sq m"],
  m3: ["m3", "m³", "métré cube", "métrés cubes", "cbm", "cubic meter"],
  u: ["u", "unite", "unit", "piece", "pieces", "pcs", "pc", "ea"],
  kg: ["kg", "kilogramme", "kilogrammes", "kilo", "kilogram"],
  t: ["t", "tonne", "tonnes", "ton", "tons"],
  l: ["l", "litre", "litres", "liter", "liters"],
  h: ["h", "heure", "heures", "hour", "hours"],
  m2j: ["m2j", "m²/j", "m2/j"],
  forfait: ["forfait", "lot", "ens", "ensemble", "package"],
};

const UNIT_LOOKUP = new Map<string, string>();

for (const [canonical, aliases] of Object.entries(UNIT_SYNONYMS)) {
  UNIT_LOOKUP.set(toUnitToken(canonical), canonical);
  aliases.forEach((alias) => {
    UNIT_LOOKUP.set(toUnitToken(alias), canonical);
  });
}

export function warning(input: {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  itemIndex?: number;
  tableIndex?: number;
}): TakeoffWarning {
  return TakeoffWarningSchema.parse({
    code: input.code,
    message: input.message,
    severity: input.severity,
    item_index: input.itemIndex,
    table_index: input.tableIndex,
  });
}

function normalizeTakeoffUnit(input: {
  unit: string;
  itemIndex: number;
}): { normalizedUnit: string; warning?: TakeoffWarning } {
  const raw = input.unit.trim();
  const token = toUnitToken(raw);
  const mapped = UNIT_LOOKUP.get(token);

  if (mapped) {
    return { normalizedUnit: mapped };
  }

  const fallback = raw.length > 0 ? raw.toLowerCase() : "u";

  return {
    normalizedUnit: fallback,
    warning: warning({
      code: "UNIT_NORMALIZATION_UNKNOWN",
      message: `Unité '${raw || "vide"}' non reconnue, conservee telle quelle.`,
      severity: "warning",
      itemIndex: input.itemIndex,
    }),
  };
}

/**
 * Build a lookup that maps (source_page, item_index_within_page) → { table_index, row_index }
 * for Level B exchanges. Items are correlated to tables by matching source_page to table.page
 * and their sequential position within that page to the table row order.
 */
function buildLevelBTableMapping(tables: TakeoffExchange["tables"]) {
  if (!tables || tables.length === 0) return null;

  // Track cumulative item counter per page to correlate sequential items
  const pageItemCounters = new Map<number, number>();
  // Map: "page:itemIndexInPage" → { table_index, row_index }
  const mapping = new Map<string, { table_index: number; row_index: number }>();

  tables.forEach((table, tableIndex) => {
    const pageItemsBefore = pageItemCounters.get(table.page) ?? 0;
    table.rows.forEach((row, rowOffset) => {
      const key = `${table.page}:${pageItemsBefore + rowOffset}`;
      mapping.set(key, { table_index: tableIndex, row_index: row.row_index });
    });
    pageItemCounters.set(table.page, pageItemsBefore + table.rows.length);
  });

  return { mapping, pageItemCounters: new Map<number, number>() };
}

type TakeoffSourceProvenance = {
  sourceFileName: string | null;
  sourceDocument?: TakeoffSourceDocumentRef;
  sourceFileNamesByPage?: readonly string[];
  sourceDocumentsByPage?: readonly TakeoffSourceDocumentRef[];
  sourcePageNumbersByPage?: readonly number[];
  preparationSnapshot?: DownloadedTakeoffFile["preparationSnapshot"];
};

/**
 * Provenance connue du chargeur (M1b) : le libellé d'origine et la référence durable du document
 * source, unique ou page par page pour un jeu multi-fichiers. Un jeu multi-fichiers n'a pas de
 * nom de source unique : seule la page d'un item désigne son fichier.
 */
export function takeoffSourceProvenance(
  job: { source_file_name: string | null },
  sourceFile: DownloadedTakeoffFile
): TakeoffSourceProvenance {
  return {
    sourceFileName: sourceFile.sourceFileNamesByPage
      ? null
      : toNonEmptyString(sourceFile.fileName) ?? toNonEmptyString(job.source_file_name),
    sourceDocument: sourceFile.sourceDocument,
    sourceFileNamesByPage: sourceFile.sourceFileNamesByPage,
    sourceDocumentsByPage: sourceFile.sourceDocumentsByPage,
    sourcePageNumbersByPage: sourceFile.sourcePageNumbersByPage,
    preparationSnapshot: sourceFile.preparationSnapshot,
  };
}

export function normalizeTakeoffExchange(input: TakeoffSourceProvenance & {
  exchange: TakeoffExchange;
  parseWarnings: TakeoffWarning[];
}): {
  exchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
} {
  const extraWarnings: TakeoffWarning[] = [...input.parseWarnings];
  const normalizedExchangeItems: TakeoffExchange["items"] = [];
  const itemsForInsert: NormalizedTakeoffItemForInsert[] = [];

  const isLevelB = input.exchange.metadata.level === "B";
  const tableMapping = isLevelB
    ? buildLevelBTableMapping(input.exchange.tables)
    : null;
  // Runtime counter per page for matching items to table rows
  const pageItemCounters = new Map<number, number>();

  input.exchange.items.forEach((item, index) => {
    const pageIndex =
      item.source_page === undefined || item.source_page === null ? null : item.source_page - 1;
    const pageMappedSourceFileName =
      pageIndex === null || !input.sourceFileNamesByPage
        ? null
        : input.sourceFileNamesByPage[pageIndex] ?? null;
    const pageMappedSourceDocument =
      pageIndex === null || !input.sourceDocumentsByPage
        ? null
        : input.sourceDocumentsByPage[pageIndex] ?? null;
    // M1b : le document que le chargeur connaît (page d'un jeu de plans, ou source unique
    // référencée) l'emporte sur le source_file du fournisseur, qui n'est souvent qu'un écho de
    // l'indice du prompt ; la valeur du fournisseur reste une preuve brute dans les métadonnées.
    const providerSourceFile = toNonEmptyString(item.source_file);
    const canonicalSourceFileName = input.sourceFileNamesByPage
      ? toNonEmptyString(pageMappedSourceFileName)
      : input.sourceDocument
        ? input.sourceFileName
        : null;
    const sourceDocument = input.sourceFileNamesByPage
      ? pageMappedSourceDocument
      : input.sourceDocument ?? null;
    // Dans un jeu multi-fichiers, le fournisseur ne voit que le PDF fusionné : sans page connue,
    // l'item n'est attribué à aucun fichier plutôt qu'au premier ou au nom interne du PDF fusionné.
    const sourceFileName = input.sourceFileNamesByPage
      ? canonicalSourceFileName
      : canonicalSourceFileName ?? providerSourceFile ?? input.sourceFileName;
    if (input.sourceFileNamesByPage && pageIndex !== null && pageMappedSourceFileName === null) {
      extraWarnings.push(
        warning({
          code: "SOURCE_PAGE_OUT_OF_RANGE",
          message: `Page ${item.source_page} hors du jeu de plans (${input.sourceFileNamesByPage.length} pages) : aucun fichier source attribué.`,
          severity: "warning",
          itemIndex: index,
        })
      );
    }
    const normalizedUnit = normalizeTakeoffUnit({
      unit: item.unit,
      itemIndex: index,
    });

    if (normalizedUnit.warning) {
      extraWarnings.push(normalizedUnit.warning);
    }

    const normalizedItem = {
      ...item,
      unit: normalizedUnit.normalizedUnit,
      category: toNonEmptyString(item.category) ?? null,
      source_file: sourceFileName ?? undefined,
    };

    // Level B: resolve table_index / row_index from page position
    let tableMeta: { table_index: number; row_index: number } | undefined;
    if (tableMapping && normalizedItem.source_page != null) {
      const page = normalizedItem.source_page;
      const posInPage = pageItemCounters.get(page) ?? 0;
      pageItemCounters.set(page, posInPage + 1);
      const found = tableMapping.mapping.get(`${page}:${posInPage}`);
      if (found) {
        tableMeta = found;
      }
    }

    const originalPage = pageIndex !== null ? input.sourcePageNumbersByPage?.[pageIndex] : undefined;
    if (originalPage !== undefined) normalizedItem.source_page = originalPage;
    normalizedExchangeItems.push(normalizedItem);
    itemsForInsert.push({
      designation: normalizedItem.designation,
      quantity: normalizedItem.quantity,
      unit: normalizedItem.unit,
      confidence: normalizedItem.confidence ?? null,
      evidence: toNonEmptyString(normalizedItem.evidence),
      source_file_name: sourceFileName,
      source_page: normalizedItem.source_page ?? null,
      metadata: {
        ...(input.preparationSnapshot ? {
          preparation_revision: input.preparationSnapshot.preparation_revision,
          quantity_nature: input.preparationSnapshot.preparation.objective === "estimate" ? "estimated" : "proposed",
          accepted_reservations: input.preparationSnapshot.readiness.reservations,
        } : {}),
        category: normalizedItem.category ?? null,
        original_unit: item.unit,
        normalized_unit: normalizedItem.unit,
        source_file: sourceFileName,
        ...(sourceDocument ? { source_document: sourceDocument } : {}),
        ...(providerSourceFile && providerSourceFile !== sourceFileName
          ? { provider_source_file: providerSourceFile }
          : {}),
        ...(tableMeta != null
          ? { table_index: tableMeta.table_index, row_index: tableMeta.row_index }
          : {}),
      },
    });
  });

  return {
    exchange: {
      ...input.exchange,
      items: normalizedExchangeItems,
      warnings: [...input.exchange.warnings, ...extraWarnings],
    },
    itemsForInsert,
  };
}
