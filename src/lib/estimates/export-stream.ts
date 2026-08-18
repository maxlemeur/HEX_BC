import { createRequire } from "node:module";
import { PassThrough, Readable } from "node:stream";

import {
  allocateProRata,
  buildStoredEstimateBreakdown,
  computeEstimateBreakdown,
  computeStoredDiscountCents,
  type EstimateBreakdown,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import {
  resolveCalcEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import { ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";
import { internalError } from "@/lib/estimates/errors";
import { getEstimateVersionDetails, listEstimateItems } from "@/lib/estimates/server";
import { bankersRound } from "@/lib/money";

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
  /** EST-E27 : sous-traitance — l export ne porte aucune TVA. */
  vatReverseCharge: boolean;
  totals: EstimateBreakdown["totals"];
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
  breakdown: EstimateBreakdown;
  preserveStoredSnapshot?: boolean;
}) {
  const lines = input.items.filter((item) => item.item_type === "line");
  const lineValues = lines.map((item) => input.breakdown.lineById.get(item.id));
  // Un export est un document comptable lisible : même avec un devis historique
  // épinglé au moteur v1, ses lignes doivent se sommer au pied qui applique
  // coefficient, remise et arrondi global. Cette allocation de présentation ne
  // bascule pas le moteur du devis ; elle répartit seulement ses totaux établis.
  const htShares = input.preserveStoredSnapshot
    ? lineValues.map((line) => line?.saleNetHtCents ?? 0)
    : allocateProRata(
        input.breakdown.totals.saleTotalCents,
        lineValues.map((line) => line?.saleNetHtCents ?? 0)
      );
  // La TVA reste la taxe comptable réelle. L'arrondi commercial est présenté
  // séparément dans le pied et ne doit jamais être ventilé comme de la taxe.
  const actualTaxTotalCents = Math.max(input.breakdown.totals.taxCents, 0);
  const taxShares = input.preserveStoredSnapshot
    ? lineValues.map((line) => line?.taxCents ?? 0)
    : allocateProRata(
        actualTaxTotalCents,
        lineValues.map((line) => line?.taxCents ?? 0)
      );
  const lineIndexById = new Map(
    lines.map((line, index) => [line.id, index])
  );

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

    const lineIndex = lineIndexById.get(item.id);
    const totalHtCents = lineIndex === undefined ? 0 : htShares[lineIndex];
    const taxCents = lineIndex === undefined ? 0 : taxShares[lineIndex];
    const totalTtcCents = totalHtCents + taxCents;
    const quantity = Math.max(item.quantity ?? 0, 0);

    return {
      poste: `${item.position}`,
      designation: item.title,
      unite: item.description?.trim() ?? "",
      quantite: item.quantity ?? 0,
      pu_ht: toEuroAmount(
        input.preserveStoredSnapshot
          ? (lineValues[lineIndex ?? -1]?.puNetHtCents ?? 0)
          : quantity > 0
            ? bankersRound(totalHtCents / quantity)
            : 0
      ),
      total_ht: toEuroAmount(totalHtCents),
      tva: toEuroAmount(taxCents),
      total_ttc: toEuroAmount(totalTtcCents),
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

  // EST-E27 : en autoliquidation, le classeur ne porte aucune colonne de TVA —
  // une colonne vide laisserait croire a un oubli de saisie plutot qu au regime.
  const isVatReverseCharge = input.payload.vatReverseCharge;
  const estimateSheet = workbook.addWorksheet("Devis");
  estimateSheet.columns = [
    { header: "Poste", key: "poste", width: 12 },
    { header: "Désignation", key: "designation", width: 44 },
    { header: "Unite", key: "unite", width: 20 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "PU HT", key: "pu_ht", width: 14 },
    { header: "Total HT", key: "total_ht", width: 14 },
    ...(isVatReverseCharge
      ? []
      : [
          { header: "TVA", key: "tva", width: 14 },
          { header: "Total TTC", key: "total_ttc", width: 14 },
        ]),
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
      ...(isVatReverseCharge ? [] : [row.tva, row.total_ttc]),
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
    ["Référence", input.payload.projectReference ?? ""],
    ["Version", input.payload.versionNumber],
    ["Titre", input.payload.versionTitle ?? ""],
    ["Statut", input.payload.versionStatus],
    ["Total HT", toEuroAmount(input.payload.totals.saleTotalCents) ?? 0],
    ...(isVatReverseCharge
      ? ([["Regime de TVA", ESTIMATE_VAT_REVERSE_CHARGE_NOTICE]] as Array<
          [string, string | number]
        >)
      : ([
          [
            "Total TVA",
            toEuroAmount(Math.max(input.payload.totals.taxCents, 0)) ?? 0,
          ],
          ...(input.payload.totals.roundingAdjustmentCents !== 0
            ? ([
                [
                  "TTC calcule",
                  toEuroAmount(input.payload.totals.ttcCents) ?? 0,
                ],
                [
                  "Arrondi commercial",
                  toEuroAmount(
                    input.payload.totals.roundingAdjustmentCents
                  ) ?? 0,
                ],
              ] as Array<[string, string | number]>)
            : []),
          [
            input.payload.totals.roundingAdjustmentCents !== 0
              ? "Montant a payer"
              : "Total TTC",
            toEuroAmount(input.payload.totals.roundedTtcCents) ?? 0,
          ],
        ] as Array<[string, string | number]>)),
    [
      "Parametres",
      `Marge ${input.payload.totals.appliedMarginMultiplier.toFixed(2)} / Remise ${toEuroAmount(input.payload.totals.discountCents)?.toFixed(2) ?? "0.00"} €`,
    ],
  ];

  summaryRows.forEach(([field, value]) => {
    const summaryRow = summarySheet.addRow([field, value]);
    // Le format monetaire suit le TYPE de la valeur, plus sa position : les
    // index 6 a 8 codes en dur formataient la ligne « Regime de TVA » comme un
    // montant des que le regime changeait la composition du resume.
    if (typeof value === "number") {
      setCurrencyColumns(summaryRow, [2]);
    }
    summaryRow.commit();
  });
  summarySheet.commit();

  await workbook.commit();
}

async function buildEstimateExportPayload(
  versionId: string,
  isLaborSplitEnabled: boolean
): Promise<EstimateExportPayload> {
  const [versionDetails, listItemsResult] = await Promise.all([
    getEstimateVersionDetails(versionId, { includeExportCalculationContext: true }),
    listEstimateItems(versionId),
  ]);

  const items = listItemsResult.items as EstimateItemRecord[];
  const version = versionDetails.version as unknown as EstimateVersionForCalc;
  const calcEngineVersion = resolveCalcEngineVersion(
    versionDetails.version as { calc_engine_version?: number | null }
  );
  const preserveStoredSnapshot = shouldPreserveStoredEstimateV2Snapshot(
    versionDetails.version
  );
  const laborRateById = new Map(
    versionDetails.labor_roles.map((role) => [role.id, role.hourly_rate_cents ?? 0])
  );
  // EST-E26 (T6, étape 10) : plus de fork ; on utilise le calcul canonique
  // (applique global_coefficient et le repli discount_bp, cf. golden Surface-5).
  const discountCents = preserveStoredSnapshot
    ? 0
    : computeStoredDiscountCents(version, items);

  const breakdown = preserveStoredSnapshot
    ? buildStoredEstimateBreakdown({ items, version })
    : computeEstimateBreakdown({
    items,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode === "tiered" ? "tiered" : "fixed",
    marginTiers: (versionDetails.margin_tiers ?? []).map((tier) => ({
      threshold_cents: tier.threshold_cents,
      multiplier: tier.multiplier,
      position: tier.position,
    })),
    globalCoefficient: version.global_coefficient ?? 1,
    discountMode: version.discount_mode === "cascade" ? "cascade" : "simple",
    discountCents,
    discountStepsBp:
      version.discount_steps?.filter(
        (step): step is number => typeof step === "number"
      ) ?? [],
    taxRateBp: version.tax_rate_bp,
    roundingMode: versionDetails.version.rounding_mode ?? "none",
    roundingStepCents: versionDetails.version.rounding_step_cents ?? 0,
    laborRateById,
    isLaborSplitEnabled:
      versionDetails.is_labor_split_enabled ?? isLaborSplitEnabled,
    laborRateAtelierById: laborRateById,
    laborRateChantierById: laborRateById,
    calcEngineVersion,
      });

  return {
    versionId: versionDetails.version.id,
    projectName: versionDetails.version.estimate_projects.name,
    projectReference: versionDetails.version.estimate_projects.reference,
    versionNumber: versionDetails.version.version_number,
    versionTitle: versionDetails.version.title,
    versionStatus: versionDetails.version.status,
    vatReverseCharge:
      (versionDetails.version as { contractor_role?: string | null })
        .contractor_role === "subcontractor",
    totals: breakdown.totals,
    rows: buildLineRows({
      items,
      breakdown,
      preserveStoredSnapshot,
    }),
  };
}

export async function streamEstimateVersionXlsx(
  versionId: string,
  options?: {
    workbookWriterFactory?: WorkbookWriterFactory;
    /**
     * Valeur résolue par la route depuis le tenant authentifié. Le repli
     * fail-closed évite qu'un payload split résiduel active la ventilation
     * lorsque l'exporteur est appelé hors de cette route.
     */
    isLaborSplitEnabled?: boolean;
  }
): Promise<EstimateExportStreamResult> {
  const payload = await buildEstimateExportPayload(
    versionId,
    options?.isLaborSplitEnabled === true
  );
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
