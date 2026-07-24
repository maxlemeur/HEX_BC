import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";

import {
  computeEstimateLineValues,
  computeReadOnlyTotals,
  computeStoredDiscountCents,
  hasActiveLaborSplitPayload,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import { internalError } from "@/lib/estimates/errors";
import { getEstimateVersionDetails, listEstimateItems } from "@/lib/estimates/server";

const moduleRequire = createRequire(import.meta.url);

export const ESTIMATE_EXPORT_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ESTIMATE_EXPORT_PROGRESS_COMPLETE = "100";

type WorksheetRowValue = Record<string, unknown> | unknown[];

type WorksheetCellLike = {
  numFmt?: string;
  font?: {
    bold?: boolean;
    color?: { argb: string };
  };
  fill?: {
    type: "pattern";
    pattern: "solid";
    fgColor: { argb: string };
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
  };
};

type WorksheetRowLike = {
  commit: () => void;
  font?: {
    bold?: boolean;
  };
  getCell?: (index: number) => WorksheetCellLike;
  eachCell?: (callback: (cell: WorksheetCellLike) => void) => void;
};

type WorksheetLike = {
  columns?: Array<{ header: string; key: string; width?: number }>;
  addRow: (value: WorksheetRowValue) => WorksheetRowLike;
  getRow?: (index: number) => WorksheetRowLike;
  commit: () => void;
};

type WorkbookWriterLike = {
  addWorksheet: (name: string) => WorksheetLike;
  commit: () => Promise<void>;
};

type WorkbookWriterConstructor = new (input: {
  stream: NodeJS.WritableStream;
  useStyles?: boolean;
  useSharedStrings?: boolean;
}) => WorkbookWriterLike;

type ExcelJsLike = {
  stream?: {
    xlsx?: {
      WorkbookWriter?: WorkbookWriterConstructor;
    };
  };
};

type ExportLineRow = {
  poste: string;
  designation: string;
  unite: string;
  quantite: number | null;
  pu_ht: number | null;
  total_ht: number | null;
  tva: number | null;
  total_ttc: number | null;
  isSection: boolean;
};

type EstimateExportPayload = {
  versionId: string;
  projectName: string;
  projectReference: string | null;
  versionNumber: number;
  versionTitle: string | null;
  versionStatus: string;
  totals: ReturnType<typeof computeReadOnlyTotals>;
  rows: ExportLineRow[];
};

export type WorkbookWriterFactory = (
  stream: NodeJS.WritableStream
) => WorkbookWriterLike | Promise<WorkbookWriterLike>;

export type EstimateExportStreamResult = {
  filename: string;
  contentType: string;
  progress: string;
  stream: ReadableStream<Uint8Array>;
};

function toSafeString(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized;
}

function sanitizeFilenameSegment(value: string | null | undefined, fallback: string) {
  const safe = toSafeString(value, fallback);
  const normalized = safe
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function buildFilename(input: {
  projectReference: string | null;
  projectName: string;
  versionNumber: number;
}) {
  const sourceName =
    input.projectReference && input.projectReference.trim().length > 0
      ? input.projectReference
      : input.projectName;
  const projectToken = sanitizeFilenameSegment(sourceName, "chiffrage");
  return `devis-${projectToken}-v${input.versionNumber}.xlsx`;
}

function toEuroAmount(valueCents: number | null | undefined): number | null {
  if (!Number.isFinite(valueCents ?? NaN)) return null;
  return (valueCents ?? 0) / 100;
}

function buildLineRows(input: {
  items: EstimateItemRecord[];
  version: EstimateVersionForCalc;
  laborRateById: Map<string, number>;
}) {

  return input.items.map((item): ExportLineRow => {
    if (item.item_type !== "line") {
      return {
        poste: `${item.position}`,
        designation: item.title,
        unite: "",
        quantite: null,
        pu_ht: null,
        total_ht: null,
        tva: null,
        total_ttc: null,
        isSection: true,
      };
    }

    const laborRateLegacyCents = item.labor_role_id
      ? (input.laborRateById.get(item.labor_role_id) ?? 0)
      : 0;
    const laborRateAtelierCents = item.labor_role_atelier_id
      ? (input.laborRateById.get(item.labor_role_atelier_id) ?? 0)
      : 0;
    const laborRateChantierCents = item.labor_role_chantier_id
      ? (input.laborRateById.get(item.labor_role_chantier_id) ?? 0)
      : 0;

    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: laborRateLegacyCents,
      },
      {
        marginMultiplier: input.version.margin_multiplier,
        taxRateBp: item.tax_rate_bp ?? input.version.tax_rate_bp ?? 0,
        isLaborSplitEnabled: hasActiveLaborSplitPayload(item),
        laborRateAtelierCents,
        laborRateChantierCents,
      }
    );

    return {
      poste: `${item.position}`,
      designation: item.title,
      unite: item.description?.trim() ?? "",
      quantite: item.quantity ?? 0,
      pu_ht: toEuroAmount(lineValues.puHtCents),
      total_ht: toEuroAmount(lineValues.saleLineCents),
      tva: toEuroAmount(lineValues.taxLineCents),
      total_ttc: toEuroAmount(lineValues.ttcLineCents),
      isSection: false,
    };
  });
}

function resolveWorkbookWriterCtor() {
  try {
    const exceljs = moduleRequire("exceljs") as ExcelJsLike;
    const WorkbookWriter = exceljs.stream?.xlsx?.WorkbookWriter;

    if (!WorkbookWriter) {
      throw internalError("Moteur d'export XLSX indisponible.");
    }

    return WorkbookWriter;
  } catch (error) {
    throw internalError(
      "Impossible d'initialiser l'export XLSX.",
      error,
      "INTERNAL_ERROR"
    );
  }
}

export function createWorkbookWriterFactory(): WorkbookWriterFactory {
  return (stream) => {
    const WorkbookWriter = resolveWorkbookWriterCtor();
    return new WorkbookWriter({
      stream,
      useSharedStrings: true,
      useStyles: true,
    });
  };
}

function styleHeaderRow(row: WorksheetRowLike) {
  row.eachCell?.((cell) => {
    cell.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" },
    };
    cell.alignment = {
      horizontal: "left",
    };
  });
}

function setCurrencyColumns(row: WorksheetRowLike, columns: number[]) {
  columns.forEach((columnIndex) => {
    const cell = row.getCell?.(columnIndex);
    if (!cell) return;
    cell.numFmt = "#,##0.00 \"€\"";
  });
}

function styleWorksheetHeader(worksheet: WorksheetLike) {
  const headerRow = worksheet.getRow?.(1);
  if (!headerRow) return;
  styleHeaderRow(headerRow);
  headerRow.commit();
}

async function writeWorkbook(input: {
  payload: EstimateExportPayload;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: WorkbookWriterFactory;
}) {
  const workbook = await input.workbookWriterFactory(input.stream);

  const estimateSheet = workbook.addWorksheet("Devis");
  estimateSheet.columns = [
    { header: "Poste", key: "poste", width: 12 },
    { header: "Designation", key: "designation", width: 44 },
    { header: "Unite", key: "unite", width: 20 },
    { header: "Quantite", key: "quantite", width: 12 },
    { header: "PU HT", key: "pu_ht", width: 14 },
    { header: "Total HT", key: "total_ht", width: 14 },
    { header: "TVA", key: "tva", width: 14 },
    { header: "Total TTC", key: "total_ttc", width: 14 },
  ];
  styleWorksheetHeader(estimateSheet);

  input.payload.rows.forEach((row) => {
    const estimateRow = estimateSheet.addRow([
      row.poste,
      row.designation,
      row.unite,
      row.quantite,
      row.pu_ht,
      row.total_ht,
      row.tva,
      row.total_ttc,
    ]);

    if (row.isSection) {
      estimateRow.font = {
        bold: true,
      };
    } else {
      setCurrencyColumns(estimateRow, [5, 6, 7, 8]);
    }

    estimateRow.commit();
  });
  estimateSheet.commit();

  const summarySheet = workbook.addWorksheet("Resume");
  summarySheet.columns = [
    { header: "Champ", key: "field", width: 34 },
    { header: "Valeur", key: "value", width: 32 },
  ];
  styleWorksheetHeader(summarySheet);

  const summaryRows: Array<[string, string | number]> = [
    ["Version ID", input.payload.versionId],
    ["Projet", input.payload.projectName],
    ["Reference", input.payload.projectReference ?? ""],
    ["Version", input.payload.versionNumber],
    ["Titre", input.payload.versionTitle ?? ""],
    ["Statut", input.payload.versionStatus],
    ["Total HT", toEuroAmount(input.payload.totals.saleTotalCents) ?? 0],
    ["Total TVA", toEuroAmount(input.payload.totals.taxCents) ?? 0],
    ["Total TTC", toEuroAmount(input.payload.totals.roundedTtcCents) ?? 0],
    [
      "Parametres",
      `Marge ${input.payload.totals.appliedMarginMultiplier.toFixed(2)} / Remise ${toEuroAmount(input.payload.totals.discountCents)?.toFixed(2) ?? "0.00"} €`,
    ],
  ];

  summaryRows.forEach(([field, value], index) => {
    const summaryRow = summarySheet.addRow([field, value]);
    if (index >= 6 && index <= 8) {
      setCurrencyColumns(summaryRow, [2]);
    }
    summaryRow.commit();
  });
  summarySheet.commit();

  await workbook.commit();
}

async function buildEstimateExportPayload(
  versionId: string
): Promise<EstimateExportPayload> {
  const [versionDetails, listItemsResult] = await Promise.all([
    getEstimateVersionDetails(versionId),
    listEstimateItems(versionId),
  ]);

  const items = listItemsResult.items as EstimateItemRecord[];
  const version = versionDetails.version as unknown as EstimateVersionForCalc;
  const laborRateById = new Map(
    versionDetails.labor_roles.map((role) => [role.id, role.hourly_rate_cents ?? 0])
  );
  // EST-E26 (T6, étape 10) : plus de fork ; on utilise le calcul canonique
  // (applique global_coefficient et le repli discount_bp, cf. golden Surface-5).
  const discountCents = computeStoredDiscountCents(version, items);

  const totals = computeReadOnlyTotals({
    items,
    version,
    discountCents,
    laborRateById,
    // EST-E26 (T6, étape 5) : la feuille « Résumé » reste sans split ici — le
    // flag tenant n'est pas résolu dans ce module. Le câblage réel du contexte
    // arrive en phase E (computeReadOnlyTotals → breakdown, spec §3 étape 17).
    isLaborSplitEnabled: false,
  });

  return {
    versionId: versionDetails.version.id,
    projectName: versionDetails.version.estimate_projects.name,
    projectReference: versionDetails.version.estimate_projects.reference,
    versionNumber: versionDetails.version.version_number,
    versionTitle: versionDetails.version.title,
    versionStatus: versionDetails.version.status,
    totals,
    rows: buildLineRows({
      items,
      version,
      laborRateById,
    }),
  };
}

export async function streamEstimateVersionXlsx(
  versionId: string,
  options?: {
    workbookWriterFactory?: WorkbookWriterFactory;
  }
): Promise<EstimateExportStreamResult> {
  const payload = await buildEstimateExportPayload(versionId);
  const filename = buildFilename({
    projectReference: payload.projectReference,
    projectName: payload.projectName,
    versionNumber: payload.versionNumber,
  });

  const output = new PassThrough();
  const writerFactory = options?.workbookWriterFactory ?? createWorkbookWriterFactory();

  writeWorkbook({
    payload,
    stream: output,
    workbookWriterFactory: writerFactory,
  }).catch((error) => {
    output.destroy(error as Error);
  });

  const stream = Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;

  return {
    filename,
    contentType: ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
    progress: ESTIMATE_EXPORT_PROGRESS_COMPLETE,
    stream,
  };
}
