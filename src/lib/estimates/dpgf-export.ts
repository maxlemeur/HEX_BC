import { sanitizeFilenameSegment, toNullableNumber, toEuroAmount, resolveDepthByItemId, usesLaborSplit, resolveLaborRoleLabel, resolveLaborHours, resolveLaborCoefficient, resolveExportAid } from "@/lib/estimates/legacy-export-projection";
import { PassThrough, Readable } from "node:stream";
import { type EstimateItemRecord } from "@/lib/estimate-calculations";
import { resolveEstimateEngineVersion, shouldPreserveStoredEstimateV2Snapshot } from "@/lib/estimates/calc-engine-version";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { ESTIMATE_EXPORT_PROGRESS_COMPLETE, ESTIMATE_EXPORT_XLSX_CONTENT_TYPE, createWorkbookWriterFactory, type EstimateExportStreamResult, type WorkbookWriterFactory } from "@/lib/estimates/export-stream";
import { MAJORATION_PERCENT_HEADER, majorationCoefficientToPercent } from "@/lib/estimates/majoration";
import { getEstimateVersionDetails } from "@/lib/estimates/server";
import { loadEstimateV3ExportDocument, writeEstimateV3DpgfWorkbook, type EstimateV3ExportDocument } from "@/lib/estimates/v3-export";

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

type DpgfLineRow = {
  type: "section" | "line";
  aid: string;
  designation: string;
  quantite: number | null;
  unite: string;
  prixUnitaireHtEur: number | null;
  typeFo: string;
  kFo: number | null;
  hMo: number | null;
  kMo: number | null;
  majorationMo: number | null;
  roleMo: string;
  categorie: string;
  hMoAtelier: number | null;
  kMoAtelier: number | null;
  roleMoAtelier: string;
  hMoChantier: number | null;
  kMoChantier: number | null;
  roleMoChantier: string;
  isSection: boolean;
};

type DpgfExportPayload = {
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  projectAuthor: string;
  versionNumber: number;
  versionTitle: string | null;
  dateDevis: string;
  rows: DpgfLineRow[];
  /** Lot 2, sous-lot 2.7 : document d'une v3 et ses référentiels (aucune ligne DPGF v1/v2). */
  v3?: {
    document: EstimateV3ExportDocument;
    supplyTypeById: Map<string, string>;
    laborRoleNameById: Map<string, string>;
    categoryById: Map<string, string>;
  };
};

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
  return `devis-${projectToken}-v${input.versionNumber}-dpgf.xlsx`;
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

function styleWorksheetHeader(worksheet: WorksheetLike) {
  const headerRow = worksheet.getRow?.(1);
  if (!headerRow) return;
  styleHeaderRow(headerRow);
  headerRow.commit();
}

function setCurrencyColumns(row: WorksheetRowLike, columns: number[]) {
  columns.forEach((columnIndex) => {
    const cell = row.getCell?.(columnIndex);
    if (!cell) return;
    cell.numFmt = "#,##0.00 \"€\"";
  });
}

function setDecimalColumns(row: WorksheetRowLike, columns: number[]) {
  columns.forEach((columnIndex) => {
    const cell = row.getCell?.(columnIndex);
    if (!cell) return;
    cell.numFmt = "0.###";
  });
}

function resolveLaborRoleSplitLabels(
  item: EstimateItemRecord,
  laborRoleNameById: Map<string, string>,
  isLaborSplitEnabled: boolean
) {
  if (!usesLaborSplit(item, isLaborSplitEnabled)) {
    return {
      atelier: "",
      chantier: "",
    };
  }

  return {
    atelier: item.labor_role_atelier_id
      ? (laborRoleNameById.get(item.labor_role_atelier_id) ?? "Rôle atelier")
      : "",
    chantier: item.labor_role_chantier_id
      ? (laborRoleNameById.get(item.labor_role_chantier_id) ?? "Rôle chantier")
      : "",
  };
}

function buildDpgfRows(input: {
  items: EstimateItemRecord[];
  supplyTypeById: Map<string, string>;
  laborRoleNameById: Map<string, string>;
  categoryById: Map<string, string>;
  isLaborSplitEnabled: boolean;
  preserveStoredSnapshot?: boolean;
}) {
  const depthByItemId = resolveDepthByItemId(input.items);

  return input.items.map((item): DpgfLineRow => {
    const depth = depthByItemId.get(item.id) ?? 0;
    const indentation = depth > 0 ? "  ".repeat(depth) : "";

    if (item.item_type !== "line") {
      return {
        type: "section",
        aid: resolveExportAid(item),
        designation: `${indentation}${item.title}`,
        quantite: null,
        unite: "",
        prixUnitaireHtEur: null,
        typeFo: "",
        kFo: null,
        hMo: null,
        kMo: null,
        majorationMo: null,
        roleMo: "",
        categorie: "",
        hMoAtelier: null,
        kMoAtelier: null,
        roleMoAtelier: "",
        hMoChantier: null,
        kMoChantier: null,
        roleMoChantier: "",
        isSection: true,
      };
    }

    const splitEnabled =
      !input.preserveStoredSnapshot &&
      usesLaborSplit(item, input.isLaborSplitEnabled);
    const splitRoleLabels = resolveLaborRoleSplitLabels(
      item,
      input.laborRoleNameById,
      input.isLaborSplitEnabled
    );

    return {
      type: "line",
      aid: resolveExportAid(item),
      designation: `${indentation}${item.title}`,
      quantite: toNullableNumber(item.quantity),
      unite: item.description?.trim() ?? "",
      prixUnitaireHtEur: toEuroAmount(
        input.preserveStoredSnapshot
          ? (item.snapshot_pu_ht_cents ?? item.pu_ht_cents)
          : item.unit_price_ht_cents
      ),
      typeFo: item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "",
      kFo: input.preserveStoredSnapshot ? 1 : (item.k_fo ?? 1),
      hMo: input.preserveStoredSnapshot
        ? null
        : resolveLaborHours(item, input.isLaborSplitEnabled),
      kMo: input.preserveStoredSnapshot
        ? null
        : resolveLaborCoefficient(item, input.isLaborSplitEnabled),
      // P-11: « Majoration MO (%) », 100 = neutral, as in the editor export (2.3 review).
      majorationMo: input.preserveStoredSnapshot
        ? null
        : majorationCoefficientToPercent(item.h_mo_majoration ?? 1),
      roleMo: input.preserveStoredSnapshot
        ? ""
        : resolveLaborRoleLabel(
            item,
            input.laborRoleNameById,
            input.isLaborSplitEnabled
          ),
      categorie: item.category_id ? (input.categoryById.get(item.category_id) ?? "") : "",
      hMoAtelier: splitEnabled ? (item.h_mo_atelier ?? 0) : null,
      kMoAtelier: splitEnabled ? (item.k_mo_atelier ?? 1) : null,
      roleMoAtelier: splitRoleLabels.atelier,
      hMoChantier: splitEnabled ? (item.h_mo_chantier ?? 0) : null,
      kMoChantier: splitEnabled ? (item.k_mo_chantier ?? 1) : null,
      roleMoChantier: splitRoleLabels.chantier,
      isSection: false,
    };
  });
}

async function writeWorkbook(input: {
  payload: DpgfExportPayload;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: WorkbookWriterFactory;
}) {
  const workbook = (await input.workbookWriterFactory(input.stream)) as WorkbookWriterLike;

  const dataSheet = workbook.addWorksheet("Données");
  dataSheet.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "AID", key: "aid", width: 22 },
    { header: "Désignation", key: "designation", width: 44 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Unité", key: "unite", width: 18 },
    { header: "Prix unitaire HT EUR", key: "prix_unitaire_ht_eur", width: 22 },
    { header: "Type FO", key: "type_fo", width: 18 },
    { header: "K FO", key: "k_fo", width: 10 },
    { header: "h MO", key: "h_mo", width: 10 },
    { header: "K MO", key: "k_mo", width: 10 },
    { header: MAJORATION_PERCENT_HEADER, key: "majoration_mo", width: 18 },
    { header: "Rôle MO", key: "role_mo", width: 24 },
    { header: "Catégorie", key: "categorie", width: 24 },
    { header: "h MO Atelier", key: "h_mo_atelier", width: 14 },
    { header: "K MO Atelier", key: "k_mo_atelier", width: 14 },
    { header: "Rôle MO Atelier", key: "role_mo_atelier", width: 24 },
    { header: "h MO Chantier", key: "h_mo_chantier", width: 15 },
    { header: "K MO Chantier", key: "k_mo_chantier", width: 15 },
    { header: "Rôle MO Chantier", key: "role_mo_chantier", width: 24 },
  ];
  styleWorksheetHeader(dataSheet);

  input.payload.rows.forEach((row) => {
    const dataRow = dataSheet.addRow([
      row.type,
      row.aid,
      row.designation,
      row.quantite,
      row.unite,
      row.prixUnitaireHtEur,
      row.typeFo,
      row.kFo,
      row.hMo,
      row.kMo,
      row.majorationMo,
      row.roleMo,
      row.categorie,
      row.hMoAtelier,
      row.kMoAtelier,
      row.roleMoAtelier,
      row.hMoChantier,
      row.kMoChantier,
      row.roleMoChantier,
    ]);

    if (row.isSection) {
      dataRow.font = {
        bold: true,
      };
    } else {
      setDecimalColumns(dataRow, [4, 8, 9, 10, 11, 14, 15, 17, 18]);
      setCurrencyColumns(dataRow, [6]);
    }

    dataRow.commit();
  });
  dataSheet.commit();

  const metadataSheet = workbook.addWorksheet("Metadata");
  metadataSheet.columns = [
    { header: "Champ", key: "champ", width: 22 },
    { header: "Valeur", key: "valeur", width: 42 },
  ];
  styleWorksheetHeader(metadataSheet);

  const metadataRows: Array<[string, string | number]> = [
    ["Référence", input.payload.projectReference ?? ""],
    ["Client", input.payload.projectClient ?? ""],
    ["Date", input.payload.dateDevis],
    [
      "Version",
      input.payload.versionTitle?.trim()
        ? `v${input.payload.versionNumber} - ${input.payload.versionTitle.trim()}`
        : `v${input.payload.versionNumber}`,
    ],
    ["Auteur", input.payload.projectAuthor],
  ];

  metadataRows.forEach(([field, value]) => {
    const metadataRow = metadataSheet.addRow([field, value]);
    metadataRow.commit();
  });
  metadataSheet.commit();

  await workbook.commit();
}

async function buildDpgfExportPayload(
  versionId: string,
  isLaborSplitEnabled: boolean
): Promise<DpgfExportPayload> {
  const details = await getEstimateVersionDetails(versionId, {
    includeExportCalculationContext: true,
  });
  const items = details.items as EstimateItemRecord[];
  const engineV3 = usesSaleCoefficients(resolveEstimateEngineVersion(details.version));
  const preserveStoredSnapshot =
    !engineV3 && shouldPreserveStoredEstimateV2Snapshot(details.version);
  const supplyTypeById = new Map(
    (details.supply_types ?? []).map((supplyType) => [supplyType.id, supplyType.name])
  );
  const laborRoleNameById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.name])
  );
  const categoryById = new Map(
    (details.categories ?? []).map((category) => [category.id, category.name])
  );

  const identity = {
    projectName: details.version.estimate_projects.name,
    projectReference: details.version.estimate_projects.reference,
    projectClient: details.version.estimate_projects.client_name,
    projectAuthor: details.version.estimate_projects.user_id,
    versionNumber: details.version.version_number,
    versionTitle: details.version.title,
    dateDevis: details.version.date_devis,
  };
  if (engineV3) {
    return { ...identity, rows: [], v3: { document: await loadEstimateV3ExportDocument(versionId),
      supplyTypeById, laborRoleNameById, categoryById } };
  }
  return {
    ...identity,
    rows: buildDpgfRows({
      items,
      supplyTypeById,
      laborRoleNameById,
      categoryById,
      isLaborSplitEnabled:
        details.is_labor_split_enabled ?? isLaborSplitEnabled,
      preserveStoredSnapshot,
    }),
  };
}

export async function streamEstimateVersionDpgfXlsx(
  versionId: string,
  options?: {
    workbookWriterFactory?: WorkbookWriterFactory;
    isLaborSplitEnabled?: boolean;
  }
): Promise<EstimateExportStreamResult> {
  const payload = await buildDpgfExportPayload(
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

  const written = payload.v3
    ? writeEstimateV3DpgfWorkbook({
        identity: { ...payload, versionStatus: payload.v3.document.version.status },
        ...payload.v3,
        stream: output,
        workbookWriterFactory: writerFactory,
      })
    : writeWorkbook({
        payload,
        stream: output,
        workbookWriterFactory: writerFactory,
      });
  written.catch((error) => {
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
