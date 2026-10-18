/**
 * Lot 2, sous-lot 2.8b (A5, A6, A7 ; D-e ; docs/testing/estimate-engine-v3-2.8b.md) — copies vers une v3.
 *
 * Une v3 porte ses montants stockés sous D12 : toute ligne qui y entre passe par l'écrivain de lot de 2.5
 * (`executeEstimateBatch` puis `commit_estimate_batch`), jamais par une insertion directe, refusée par le garde SQL
 * (M4). Un seul lot atomique : au-delà de 1 000 opérations ou de 1 Mio, refus nommé qui renvoie vers l'import de
 * l'affaire (nouvelle version, atomique), jamais une écriture en plusieurs lots.
 *
 * - v3 → v3 (même version ou une autre) : les saisies v3 sont copiées (unité du référentiel, statut, heures par
 *   unité) ; l'écrivain recalcule les montants aux coefficients de la cible.
 * - v1/v2 → v3 : règle P-12 des modèles (miroir de M6, `templateLineHoursPerUnitForV3`) : h/u = h / Q au demi
 *   supérieur à 4 décimales, unité et statut lus par le référentiel sur `description` ; les lignes dont les heures
 *   changent sont listées (`converted_lines`). Q nulle avec des heures : refus qui nomme la ligne.
 * - v3 → v1/v2 : refus nommé (D-e), les lignes non chiffrées y deviendraient chiffrées.
 */
import { randomUUID } from "node:crypto";

import type { ValidImportFlowLine } from "@/lib/affaires/import-flow";

import {
  ESTIMATE_BATCH_MAX_BODY_BYTES,
  ESTIMATE_BATCH_MAX_OPERATIONS,
  executeEstimateBatch,
  type EstimateBatchCommittedResult,
} from "@/lib/estimates/batch";
import { ApiError, badRequest, conflict } from "@/lib/estimates/errors";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import {
  listTemplateLinesConvertedForV3,
  templateLineHoursPerUnitForV3,
  type TemplateV3ConvertedLine,
} from "@/lib/estimates/template-v3-hours";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import type { Database } from "@/types/database";

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type ItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"];
type CreateData = Extract<BatchOperationInput, { op: "create" }>["data"];

export const ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL_MESSAGE =
  "Une section d’un devis au moteur de calcul 3 ne se copie pas vers un devis au moteur 1 ou 2 : ses lignes non " +
  "chiffrées (HL, PM, inclus…) y deviendraient chiffrées.";

export const ESTIMATE_V3_COPY_TOO_LARGE_MESSAGE =
  "Cette copie dépasse la limite d’une écriture atomique dans un devis au moteur de calcul 3 (1 000 éléments, 1 Mio). " +
  "Plusieurs sections : copiez-les en plusieurs fois. Au-delà pour une seule section ou un DPGF : importez ces " +
  "lignes depuis l’affaire (« Importer la DPGF »), qui crée une nouvelle version en une fois. Rien n’a été copié.";

/** D-e : refus nommé, avant toute écriture. */
export function estimateV3SectionCopyToHistoricalError() {
  return conflict(ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL_MESSAGE, undefined, "ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL");
}

/** Ligne prête à l'écrivain : valeurs absentes omises (la création applique les défauts de la v3). */
function compact<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== undefined)) as T;
}

function sectionOperation(item: ItemInsert, keepSourceJob: boolean): BatchOperationInput {
  return { op: "create", data: compact({
    item_type: "section" as const, parent_id: item.parent_id ?? null, position: item.position, title: item.title,
    aid: item.aid, source_provider: item.source_provider, source_job_id: keepSourceJob ? item.source_job_id : null,
    source_file_name: item.source_file_name, source_page: item.source_page,
  }) as CreateData } as BatchOperationInput;
}

function hoursWithoutQuantity(title: string) {
  return badRequest(
    `« ${title} » porte des heures sans quantité : un devis au moteur de calcul 3 stocke des heures par unité. ` +
      "Renseignez sa quantité dans la version source avant de la copier.",
    { title },
    "ESTIMATE_V3_COPY_HOURS_WITHOUT_QUANTITY"
  );
}

/** Saisies d'une ligne copiée vers une v3 : celles de la v3 source, sinon la règle P-12 (miroir de M6). */
function lineOperation(item: ItemInsert, source: ItemRow, sourceIsV3: boolean, keepSourceJob: boolean): BatchOperationInput {
  const common = {
    item_type: "line" as const, parent_id: item.parent_id ?? null, position: item.position, title: item.title,
    aid: source.aid, description: source.description, line_nature: source.line_nature, quantity: source.quantity,
    unit_price_ht_cents: source.unit_price_ht_cents, tax_rate_bp: source.tax_rate_bp, k_fo: source.k_fo,
    h_mo_majoration: source.h_mo_majoration, k_mo: source.k_mo, k_mo_atelier: source.k_mo_atelier,
    k_mo_chantier: source.k_mo_chantier, labor_role_id: source.labor_role_id,
    labor_role_atelier_id: source.labor_role_atelier_id, labor_role_chantier_id: source.labor_role_chantier_id,
    category_id: source.category_id, supply_type_id: source.supply_type_id, product_id: source.product_id,
    selected_supplier_price_id: source.selected_supplier_price_id, source_provider: source.source_provider,
    source_job_id: keepSourceJob ? source.source_job_id : null, source_file_name: source.source_file_name,
    source_page: source.source_page,
  };
  if (sourceIsV3) {
    return { op: "create", data: compact({ ...common, unit_code: source.unit_code, pricing_status: source.pricing_status,
      h_mo_per_unit: source.h_mo_per_unit, h_mo_atelier_per_unit: source.h_mo_atelier_per_unit,
      h_mo_chantier_per_unit: source.h_mo_chantier_per_unit }) } as BatchOperationInput;
  }
  const hours = templateLineHoursPerUnitForV3({
    item_type: "line", title: source.title, quantity: source.quantity, h_mo: source.h_mo,
    h_mo_atelier: source.h_mo_atelier, h_mo_chantier: source.h_mo_chantier,
  });
  if (!hours) throw hoursWithoutQuantity(source.title);
  const unit = normalizeMeasurementUnit(source.description);
  return { op: "create", data: compact({ ...common, unit_code: unit.unitCode,
    pricing_status: unit.pricingStatus ?? "priced", ...hours }) } as BatchOperationInput;
}

export type V3CopyPlan = {
  operations: BatchOperationInput[];
  createdIds: Array<{ index: number; id: string }>;
  titles: string[];
  convertedLines: TemplateV3ConvertedLine[];
};

/**
 * Copie préparée par les écrivains historiques (`buildImportedEstimateItemInsert` : identités, parents et positions
 * dans la cible), rendue en opérations de l'écrivain de lot. Les parents précèdent leurs enfants.
 */
export function planV3SectionCopy(input: {
  payload: readonly ItemInsert[];
  sourceIdByNewId: ReadonlyMap<string, string>;
  sourceItemsById: ReadonlyMap<string, ItemRow>;
  sourceIsV3: boolean;
  sameVersion: boolean;
}): V3CopyPlan {
  const plan: V3CopyPlan = { operations: [], createdIds: [], titles: [], convertedLines: [] };
  const v2Lines: ItemRow[] = [];
  for (const item of input.payload) {
    const source = input.sourceItemsById.get(input.sourceIdByNewId.get(item.id!) ?? "");
    if (!source || !item.id) throw new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Impossible de copier la section." });
    plan.createdIds.push({ index: plan.operations.length, id: item.id });
    plan.titles.push(item.title ?? source.title);
    if (item.item_type === "section") {
      plan.operations.push(sectionOperation(item, input.sameVersion));
      continue;
    }
    plan.operations.push(lineOperation(item, source, input.sourceIsV3, input.sameVersion));
    if (!input.sourceIsV3) v2Lines.push(source);
  }
  plan.convertedLines = listTemplateLinesConvertedForV3(v2Lines);
  return plan;
}

/**
 * Un seul lot atomique dans la v3 cible, au jeton lu par l'appelant. Une opération refusée par l'écrivain est
 * rendue par son code, avec l'élément nommé ; rien n'est écrit.
 */
export async function commitV3Copy(input: {
  versionId: string;
  updatedAt: string;
  plan: Pick<V3CopyPlan, "operations" | "createdIds" | "titles">;
}): Promise<EstimateBatchCommittedResult> {
  const { operations, createdIds, titles } = input.plan;
  if (operations.length > ESTIMATE_BATCH_MAX_OPERATIONS ||
    Buffer.byteLength(JSON.stringify({ operations }), "utf8") > ESTIMATE_BATCH_MAX_BODY_BYTES - 4096) {
    throw new ApiError({ status: 413, code: "ESTIMATE_V3_COPY_TOO_LARGE", message: ESTIMATE_V3_COPY_TOO_LARGE_MESSAGE,
      details: { operations: operations.length, max_operations: ESTIMATE_BATCH_MAX_OPERATIONS } });
  }
  const result = await executeEstimateBatch(input.versionId, operations, {
    concurrencyToken: input.updatedAt, operationKey: randomUUID(), maxOperations: ESTIMATE_BATCH_MAX_OPERATIONS, createdIds,
  });
  if (result.committed) return result;
  const failed = result.results.at(-1);
  const title = failed ? titles[failed.index] : undefined;
  const code = failed?.status === "error" ? failed.code : "ESTIMATE_V3_COPY_REFUSED";
  const cause = failed?.status === "error" ? failed.message : "Copie refusée.";
  throw new ApiError({
    status: /CONFLICT|STALE|LOCK/.test(code) ? 409 : 400,
    code,
    message: title ? `« ${title} » : ${cause} Rien n’a été copié.` : `${cause} Rien n’a été copié.`,
    details: { index: failed?.index ?? null },
  });
}

/**
 * A5 : le DPGF lié importé dans un brouillon v3 existant. Lignes normalisées pour le moteur 3 par l'outil commun
 * d'import (unité du référentiel, statut à 0 €), aux coefficients du brouillon ; provenance de l'import gardée
 * (fournisseur `dpgf`, fichier, ligne source). Une section racine nouvelle, puis ses lignes, en un seul lot.
 */
export function planV3LinkedDpgfImport(input: {
  sectionId: string;
  rootPosition: number;
  sectionTitle: string;
  filename: string | null;
  lines: ReadonlyArray<ValidImportFlowLine & { id: string }>;
}): Pick<V3CopyPlan, "operations" | "createdIds" | "titles"> {
  const operations: BatchOperationInput[] = [{ op: "create", data: compact({
    item_type: "section" as const, parent_id: null, position: input.rootPosition, title: input.sectionTitle,
    source_provider: "dpgf", source_file_name: input.filename,
  }) as CreateData } as BatchOperationInput];
  const createdIds = [{ index: 0, id: input.sectionId }];
  const titles = [input.sectionTitle];
  input.lines.forEach((line, index) => {
    createdIds.push({ index: operations.length, id: line.id });
    titles.push(line.title);
    operations.push({ op: "create", data: compact({
      item_type: "line" as const, parent_id: input.sectionId, position: index + 1, title: line.title,
      description: line.description, quantity: line.quantity, unit_price_ht_cents: line.unitPriceHtCents,
      tax_rate_bp: line.taxRateBp, k_fo: line.kFo, h_mo_majoration: line.hMoMajoration, k_mo: line.kMo,
      labor_role_id: line.laborRoleId, unit_code: line.unitCode, pricing_status: line.pricingStatus ?? "priced",
      h_mo_per_unit: line.hoursPerUnit, source_provider: "dpgf", source_file_name: input.filename,
      source_page: line.rowIndex > 0 ? line.rowIndex : null,
    }) } as BatchOperationInput);
  });
  return { operations, createdIds, titles };
}
