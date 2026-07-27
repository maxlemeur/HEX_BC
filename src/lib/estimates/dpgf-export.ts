import { PassThrough, Readable } from "node:stream";

import {
  hasActiveLaborSplitPayload,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  createWorkbookWriterFactory,
  type EstimateExportStreamResult,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { getEstimateVersionDetails } from "@/lib/estimates/server";

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

function toEuroAmount(valueCents: number | null | undefined): number | null {
  if (!Number.isFinite(valueCents ?? NaN)) return null;
  return (valueCents ?? 0) / 100;
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  return value ?? null;
}

function resolveExportAid(item: EstimateItemRecord) {
  const aid = (item as EstimateItemRecord & { aid?: string | null }).aid;
  if (typeof aid !== "string") return item.id;
  const normalized = aid.trim();
  return normalized.length > 0 ? normalized : item.id;
}

function resolveDepthByItemId(items: EstimateItemRecord[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (itemId: string): number => {
    const cached = depthById.get(itemId);
    if (cached !== undefined) return cached;
    if (visiting.has(itemId)) return 0;

    visiting.add(itemId);
    const item = itemById.get(itemId);
    if (!item || !item.parent_id) {
      depthById.set(itemId, 0);
      visiting.delete(itemId);
      return 0;
    }

    const parent = itemById.get(item.parent_id);
    const parentDepth = parent ? visit(parent.id) : 0;
    const depth = parent ? parentDepth + 1 : 0;
    depthById.set(itemId, depth);
    visiting.delete(itemId);
    return depth;
  };

  items.forEach((item) => {
    visit(item.id);
  });

  return depthById;
}

function usesLaborSplit(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  return isLaborSplitEnabled && hasActiveLaborSplitPayload(item);
}

function resolveLaborRoleLabel(
  item: EstimateItemRecord,
  laborRoleNameById: Map<string, string>,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    const parts: string[] = [];
    if (item.labor_role_atelier_id) {
      parts.push(
        `Atelier: ${laborRoleNameById.get(item.labor_role_atelier_id) ?? "Role atelier"}`
      );
    }
    if (item.labor_role_chantier_id) {
      parts.push(
        `Chantier: ${laborRoleNameById.get(item.labor_role_chantier_id) ?? "Role chantier"}`
      );
    }
    return parts.join(" / ");
  }

  if (!item.labor_role_id) return "";
  return laborRoleNameById.get(item.labor_role_id) ?? "";
}

function resolveLaborHours(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    return (item.h_mo_atelier ?? 0) + (item.h_mo_chantier ?? 0);
  }
  return item.h_mo ?? 0;
}

function resolveLaborCoefficient(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (!usesLaborSplit(item, isLaborSplitEnabled)) {
    return item.k_mo ?? 1;
  }

  const hAtelier = item.h_mo_atelier ?? 0;
  const hChantier = item.h_mo_chantier ?? 0;
  const totalHours = hAtelier + hChantier;
  if (totalHours <= 0) return 1;

  const kAtelier = item.k_mo_atelier ?? 1;
  const kChantier = item.k_mo_chantier ?? 1;
  return (hAtelier * kAtelier + hChantier * kChantier) / totalHours;
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
      ? (laborRoleNameById.get(item.labor_role_atelier_id) ?? "Role atelier")
      : "",
    chantier: item.labor_role_chantier_id
      ? (laborRoleNameById.get(item.labor_role_chantier_id) ?? "Role chantier")
      : "",
  };
}

function buildDpgfRows(input: {
  items: EstimateItemRecord[];
  supplyTypeById: Map<string, string>;
  laborRoleNameById: Map<string, string>;
  categoryById: Map<string, string>;
  isLaborSplitEnabled: boolean;
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

    const splitEnabled = usesLaborSplit(item, input.isLaborSplitEnabled);
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
      prixUnitaireHtEur: toEuroAmount(item.unit_price_ht_cents),
      typeFo: item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "",
      kFo: item.k_fo ?? 1,
      hMo: resolveLaborHours(item, input.isLaborSplitEnabled),
      kMo: resolveLaborCoefficient(item, input.isLaborSplitEnabled),
      majorationMo: item.h_mo_majoration ?? 1,
      roleMo: resolveLaborRoleLabel(
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

  const dataSheet = workbook.addWorksheet("Donnees");
  dataSheet.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "AID", key: "aid", width: 22 },
    { header: "Désignation", key: "designation", width: 44 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Unite", key: "unite", width: 18 },
    { header: "Prix unitaire HT EUR", key: "prix_unitaire_ht_eur", width: 22 },
    { header: "Type FO", key: "type_fo", width: 18 },
    { header: "K FO", key: "k_fo", width: 10 },
    { header: "h MO", key: "h_mo", width: 10 },
    { header: "K MO", key: "k_mo", width: 10 },
    { header: "Majoration MO", key: "majoration_mo", width: 18 },
    { header: "Role MO", key: "role_mo", width: 24 },
    { header: "Categorie", key: "categorie", width: 24 },
    { header: "h MO Atelier", key: "h_mo_atelier", width: 14 },
    { header: "K MO Atelier", key: "k_mo_atelier", width: 14 },
    { header: "Role MO Atelier", key: "role_mo_atelier", width: 24 },
    { header: "h MO Chantier", key: "h_mo_chantier", width: 15 },
    { header: "K MO Chantier", key: "k_mo_chantier", width: 15 },
    { header: "Role MO Chantier", key: "role_mo_chantier", width: 24 },
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
  const details = await getEstimateVersionDetails(versionId);
  const items = details.items as EstimateItemRecord[];
  const supplyTypeById = new Map(
    (details.supply_types ?? []).map((supplyType) => [supplyType.id, supplyType.name])
  );
  const laborRoleNameById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.name])
  );
  const categoryById = new Map(
    (details.categories ?? []).map((category) => [category.id, category.name])
  );

  return {
    projectName: details.version.estimate_projects.name,
    projectReference: details.version.estimate_projects.reference,
    projectClient: details.version.estimate_projects.client_name,
    projectAuthor: details.version.estimate_projects.user_id,
    versionNumber: details.version.version_number,
    versionTitle: details.version.title,
    dateDevis: details.version.date_devis,
    rows: buildDpgfRows({
      items,
      supplyTypeById,
      laborRoleNameById,
      categoryById,
      isLaborSplitEnabled,
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
