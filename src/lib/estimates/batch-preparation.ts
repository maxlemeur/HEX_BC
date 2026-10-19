import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { resolveCalcEngineVersion, resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine, usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { ApiError, badRequest, conflict, internalError, notFound } from "@/lib/estimates/errors";
import {
  assertLinePlacementAllowed, assertSectionPlacementAllowed, assertSectionSubtreePlacementAllowed,
} from "@/lib/estimates/estimate-placement-helpers";
import {
  buildHierarchyIndex, clampMaxSectionDepth, getDefaultSectionTitleForLevel,
  isAncestorOrSelf, resolveSectionLevel, type HierarchyIndex,
} from "@/lib/estimates/hierarchy";
import { resolveEstimateLineNature, resolvePromotedEstimateLineNature } from "@/lib/estimates/line-nature";
import {
  DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN, ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY,
  parseEstimateItemAidRegexPattern, type BatchOperationInput,
} from "@/lib/estimates/schemas";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { normalizeStoredItemNumerics } from "@/lib/estimates/stored-item-numeric";
import {
  assertHistoricalItemHasNoV3Columns, type EstimateV3VersionTotals, normalizeV3ItemWrite,
  toEstimateV3LineProjections, toEstimateV3VersionTotals, V3_ITEM_INPUT_KEYS,
} from "@/lib/estimates/v3-persistence";
import {
  calculateEstimateSnapshotForItems, calculateEstimateV3SnapshotForItems, type CalculatedEstimateTotals,
  type EstimateCalculationDependencies,
} from "@/lib/estimates/version-totals";
import type { Database } from "@/types/database";

type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type Version = Database["public"]["Tables"]["estimate_versions"]["Row"];
/** `pu_ht_cents` nul pour une ligne v3 non chiffrée (décision 3 du sous-lot 2.5). */
type ItemProjection = { id: string; pu_ht_cents: number | null; line_total_ht_cents: number;
  line_tax_cents: number; line_total_ttc_cents: number };
export type EstimateBatchAidPolicy = { id: string; enabled: boolean; value: string | null } | null;
/** Identity of a created item; `source_metadata` only from the server-side copies into a v3 (2.8b). */
export type EstimateBatchCreatedId = { index: number; id: string; source_metadata?: Record<string, unknown> };
export type EstimateBatchItem = Item;
export type PreparedEstimateBatch = {
  createdIds: EstimateBatchCreatedId[];
  itemUpdates: ItemProjection[];
  /** v1/v2 : trois totaux ; v3 : les six totaux de `EstimateV3VersionTotals`. */
  versionPatch: CalculatedEstimateTotals | EstimateV3VersionTotals;
  calculationContext: EstimateCalculationDependencies;
  expectedAidPolicy: EstimateBatchAidPolicy;
};

export class EstimateBatchPreparationError extends Error {
  constructor(readonly index: number, readonly operation: BatchOperationInput["op"], readonly failure: ApiError) {
    super(failure.message);
  }
}

function unavailable() {
  return new ApiError({ status: 503, code: "ESTIMATE_BATCH_READ_UNAVAILABLE",
    message: "Impossible de vérifier les éléments du batch. Réessayez la même demande." });
}

export function sameEstimateBatchTimestamp(left: string, right: string) {
  const a = Date.parse(left);
  const b = Date.parse(right);
  const micros = (value: string) =>
    (value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "").padEnd(6, "0").slice(3, 6);
  return Number.isFinite(a) && Number.isFinite(b) && a === b && micros(left) === micros(right);
}

const LINE_FIELDS = new Set([
  "line_nature", "description", "quantity", "unit_price_ht_cents", "tax_rate_bp", "k_fo",
  "h_mo", "h_mo_majoration", "k_mo", "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id",
  "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "pu_ht_cents", "labor_role_id",
  "category_id", "supply_type_id", "product_id", "selected_supplier_price_id",
  "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents", ...V3_ITEM_INPUT_KEYS,
]);
const DERIVED_FIELDS = ["pu_ht_cents", "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents"] as const;

/** Simulate ordered operations and calculate their final projection; never write. */
export async function prepareEstimateBatch(input: {
  context: AuthenticatedContext;
  versionId: string;
  projectUserId: string;
  expectedUpdatedAt: string;
  operations: BatchOperationInput[];
  /** Internal aggregate preparation only; never populated by the HTTP batch API. */
  createdIds?: EstimateBatchCreatedId[];
  /** Server-side copies only (lot 3.1): every item of the version, read by the caller at `expectedUpdatedAt`. */
  targetItems?: readonly Item[];
}): Promise<PreparedEstimateBatch> {
  const { context, versionId } = input;
  const { supabase, tenantId } = context;
  const { data: versionData, error: versionError } = await supabase.from("estimate_versions")
    .select("*").eq("tenant_id", tenantId).eq("id", versionId).single();
  if (versionError) throw unavailable();
  if (!versionData) throw notFound("Version de chiffrage introuvable.");
  const version: Version = versionData;
  // Lot 2, sous-lot 2.5 : une v3 reçoit ses colonnes de saisie (D4, D9) ; une v1/v2 aucune.
  const perUnitLabor = usesPerUnitLabor(resolveEstimateEngineVersion(version));
  const engineItemWrite = <T extends Record<string, unknown>>(data: T, itemType: "section" | "line"): T => {
    if (perUnitLabor) return normalizeV3ItemWrite(data, itemType);
    assertHistoricalItemHasNoV3Columns(data);
    return data;
  };
  if (!sameEstimateBatchTimestamp(version.updated_at, input.expectedUpdatedAt)) {
    throw conflict("Le devis a changé. Rechargez avant de réessayer.", undefined, "VERSION_CONFLICT");
  }
  const items = new Map<string, Item>();
  if (input.targetItems) {
    // Lot 3.1: the copy already read every item of this version at this token; same order as the read below.
    if (input.targetItems.some((item) => item.tenant_id !== tenantId || item.version_id !== versionId)) {
      throw internalError("Les éléments de la version cible sont incohérents.");
    }
    for (const item of [...input.targetItems].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      items.set(item.id, { ...item });
    }
  } else {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("estimate_items").select("*")
        .eq("tenant_id", tenantId).eq("version_id", versionId)
        .order("id").range(offset, offset + 999);
      if (error) throw unavailable();
      for (const item of data ?? []) items.set(item.id, { ...item });
      if (!data || data.length < 1000) break;
    }
  }
  // Lot 3.1: the hierarchy index by id of the current items, live (no children index: only an existing section's
  // subtree check reads it, from a full index).
  const idIndex: HierarchyIndex = { byId: items, childrenByParentId: new Map() };
  const { data: aidPolicy, error: aidError } = await supabase.from("feature_flags")
    .select("id, enabled, value").eq("tenant_id", tenantId)
    .eq("flag_key", ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY).maybeSingle();
  if (aidError) throw unavailable();
  const expectedAidPolicy = aidPolicy ?? null;
  const aidRegex = parseEstimateItemAidRegexPattern(aidPolicy?.enabled ? aidPolicy.value : null);
  const maximumDepth = clampMaxSectionDepth(version.max_section_depth);
  const createdIds: PreparedEstimateBatch["createdIds"] = [];
  const suppliedIds = new Map<number, string>();
  const suppliedMetadata = new Map<number, Record<string, unknown>>();
  if (input.createdIds !== undefined) {
    const parsed = z.array(z.object({ index: z.number().int().nonnegative(), id: z.string().uuid(),
      source_metadata: z.record(z.string(), z.unknown()).optional() }).strict()).parse(input.createdIds);
    if (parsed.length !== input.operations.filter((operation) => operation.op === "create").length ||
      new Set(parsed.map((entry) => entry.index)).size !== parsed.length ||
      new Set(parsed.map((entry) => entry.id.toLowerCase())).size !== parsed.length ||
      parsed.some((entry) => input.operations[entry.index]?.op !== "create" || items.has(entry.id.toLowerCase()))) {
      throw badRequest("Les identités de création préparées sont invalides.");
    }
    for (const entry of parsed) {
      suppliedIds.set(entry.index, entry.id.toLowerCase());
      if (entry.source_metadata) suppliedMetadata.set(entry.index, entry.source_metadata);
    }
  }
  const changedLineIds = new Set<string>();
  const checkedReferences = new Map<string, Promise<void>>();

  function references(data: Partial<Item>) {
    const checks: Promise<void>[] = [];
    const check = (field: keyof Item, table: "estimate_categories" | "labor_roles" | "supply_types" |
      "products" | "supplier_pricebook", owner: boolean) => {
      const id = data[field];
      if (typeof id !== "string") return;
      const cacheKey = `${table}:${id}`;
      let promise = checkedReferences.get(cacheKey);
      if (!promise) {
        promise = (async () => {
          if (owner) {
            const ownerTable = table as "estimate_categories" | "labor_roles";
            const { data: found, error } = await supabase.from(ownerTable).select("id")
              .eq("tenant_id", tenantId).eq("user_id", input.projectUserId).eq("id", id).maybeSingle();
            if (error) throw unavailable();
            if (!found) throw badRequest(`${field} invalide.`);
          } else {
            const { data: found, error } = await supabase.from(table).select("id")
              .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
            if (error) throw unavailable();
            if (!found) throw badRequest(`${field} invalide.`);
          }
        })();
        checkedReferences.set(cacheKey, promise);
      }
      checks.push(promise);
    };
    check("category_id", "estimate_categories", true);
    for (const field of ["labor_role_id", "labor_role_atelier_id", "labor_role_chantier_id"] as const) {
      check(field, "labor_roles", true);
    }
    check("supply_type_id", "supply_types", false);
    check("product_id", "products", false);
    check("selected_supplier_price_id", "supplier_pricebook", false);
    if (typeof data.source_job_id === "string") {
      const jobId = data.source_job_id;
      const cacheKey = `takeoff_jobs:${jobId}`;
      let promise = checkedReferences.get(cacheKey);
      if (!promise) {
        promise = (async () => {
          const { data: job, error } = await supabase.from("takeoff_jobs").select("id, estimate_version_id")
            .eq("tenant_id", tenantId).eq("id", jobId).maybeSingle();
          if (error) throw unavailable();
          if (!job) throw badRequest("source_job_id invalide.");
          if (job.estimate_version_id === versionId) return;
          const { data: link, error: linkError } = await supabase.from("takeoff_version_links").select("id")
            .eq("tenant_id", tenantId).eq("takeoff_job_id", jobId)
            .eq("source_version_id", job.estimate_version_id).eq("target_version_id", versionId).maybeSingle();
          if (linkError) throw unavailable();
          if (!link) throw badRequest("Le métré source n’est pas lié à cette version.");
        })();
        checkedReferences.set(cacheKey, promise);
      }
      checks.push(promise);
    }
    return Promise.all(checks);
  }

  function validatePlacement(item: Item) {
    const parent = item.parent_id === null ? null : items.get(item.parent_id);
    if (item.parent_id !== null && (!parent || parent.item_type !== "section")) {
      throw badRequest("Le parent doit être une section de cette version.");
    }
    // Lot 3.1: a new item has no subtree, so the live map by id is its index (a 1 000-creation copy rebuilt the full
    // index at each operation); an existing item still gets the full one for its subtree check.
    const index = items.has(item.id) ? buildHierarchyIndex([...items.values()]) : idIndex;
    if (isAncestorOrSelf(index, item.id, item.parent_id)) {
      throw badRequest("Un élément ne peut pas être déplacé dans sa descendance.");
    }
    const parentLevel = parent ? resolveSectionLevel(index, parent.id) : null;
    if (parent && parentLevel === null) throw badRequest("Hiérarchie invalide.");
    if (item.item_type === "line") {
      assertLinePlacementAllowed({ maxSectionDepth: maximumDepth, parentSectionLevel: parentLevel });
    } else {
      const nextSectionLevel = (parentLevel ?? 0) + 1;
      assertSectionPlacementAllowed({ maxSectionDepth: maximumDepth, nextSectionLevel });
      if (items.has(item.id)) assertSectionSubtreePlacementAllowed({ hierarchyIndex: index,
        sectionId: item.id, nextSectionLevel, maxSectionDepth: maximumDepth });
    }
    for (const other of items.values()) {
      if (other.id !== item.id && other.parent_id === item.parent_id && other.position === item.position) {
        throw conflict("Cette position est déjà occupée.");
      }
    }
  }

  async function assertBatchVersionUnchanged() {
    const { data: latest, error: latestError } = await supabase.from("estimate_versions")
      .select("updated_at").eq("tenant_id", tenantId).eq("id", versionId).single();
    if (latestError || !latest) throw unavailable();
    if (!sameEstimateBatchTimestamp(latest.updated_at, input.expectedUpdatedAt)) throw conflict("Le devis a changé.", undefined, "VERSION_CONFLICT");
  }

  function validateAid(data: { aid?: string | null }) {
    if (data.aid && !aidRegex.test(data.aid)) {
      throw badRequest(`AID invalide. Format attendu: ${DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN}.`);
    }
  }

  for (let index = 0; index < input.operations.length; index += 1) {
    const operation = input.operations[index];
    try {
      if (operation.op === "create") {
        const data = engineItemWrite(normalizeStoredItemNumerics(operation.data), operation.data.item_type);
        const parentId = data.parent_id ?? null;
        // Lot 3.1: the sibling scan and the parent level only feed the default position and title.
        const position = data.position ?? [...items.values()].filter((item) => item.parent_id === parentId)
          .reduce((max, item) => Math.max(max, item.position), 0) + 1;
        const isLine = data.item_type === "line";
        const parentLevel = data.title != null || isLine ? 0 : parentId ? resolveSectionLevel(idIndex, parentId) : 0;
        const item: Item = {
          id: suppliedIds.get(index) ?? randomUUID(), tenant_id: tenantId, version_id: versionId,
          created_at: version.updated_at, updated_at: version.updated_at,
          parent_id: parentId, item_type: data.item_type, position,
          title: data.title ?? (isLine ? "Nouvelle ligne" : getDefaultSectionTitleForLevel((parentLevel ?? 0) + 1)),
          aid: data.aid ?? null, description: null, line_nature: null,
          quantity: null, unit_price_ht_cents: null, tax_rate_bp: null, k_fo: null, h_mo: null,
          h_mo_majoration: 1, k_mo: null, labor_role_id: null, category_id: null,
          h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
          h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
          supply_type_id: null, product_id: null, selected_supplier_price_id: null,
          pu_ht_cents: null, line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null,
          source_provider: data.source_provider ?? "manual", source_job_id: data.source_job_id ?? null,
          source_file_name: data.source_file_name ?? null, source_page: data.source_page ?? null,
          source_metadata: {}, snapshot_pu_ht_cents: null, snapshot_fo_ht_cents: null,
          snapshot_mo_ht_cents: null, snapshot_mo_atelier_ht_cents: null, snapshot_mo_chantier_ht_cents: null,
        };
        if (data.item_type === "line") Object.assign(item, {
          ...data, id: item.id, parent_id: parentId, position, title: item.title,
          source_provider: item.source_provider, description: data.description ?? null,
          quantity: data.quantity ?? 1, unit_price_ht_cents: data.unit_price_ht_cents ?? 0,
          tax_rate_bp: data.tax_rate_bp ?? version.tax_rate_bp, k_fo: data.k_fo ?? 1,
          h_mo: perUnitLabor ? null : data.h_mo ?? 0, h_mo_majoration: data.h_mo_majoration ?? 1, k_mo: data.k_mo ?? 1,
          pu_ht_cents: 0, line_total_ht_cents: 0, line_tax_cents: 0, line_total_ttc_cents: 0,
          line_nature: data.line_nature ?? resolveEstimateLineNature(data),
        });
        validateAid(item);
        validatePlacement(item);
        await references(item);
        items.set(item.id, item);
        const sourceMetadata = suppliedMetadata.get(index);
        createdIds.push(sourceMetadata ? { index, id: item.id, source_metadata: sourceMetadata } : { index, id: item.id });
        if (isLine) changedLineIds.add(item.id);
      } else if (operation.op === "update") {
        const current = items.get(operation.id);
        if (!current) throw notFound("Élément de chiffrage introuvable.");
        const rawPatch = normalizeStoredItemNumerics(operation.data);
        if (current.item_type === "section" && Object.keys(rawPatch).some((key) => LINE_FIELDS.has(key))) {
          throw badRequest("Les champs de ligne ne sont pas applicables à une section.");
        }
        const patch = engineItemWrite(rawPatch, current.item_type);
        validateAid(patch);
        await references(patch);
        const next = { ...current, ...patch };
        // Derived values in old client buffers are never a pricing authority.
        for (const field of DERIVED_FIELDS) next[field] = current[field];
        if (next.item_type === "line") {
          next.line_nature = resolvePromotedEstimateLineNature(current, patch);
          changedLineIds.add(next.id);
        }
        validatePlacement(next);
        items.set(next.id, next);
      } else if (operation.op === "delete") {
        if (!items.has(operation.id)) throw notFound("Élément de chiffrage introuvable.");
        const pending = [operation.id];
        while (pending.length) {
          const id = pending.pop()!;
          for (const child of items.values()) if (child.parent_id === id) pending.push(child.id);
          items.delete(id);
        }
      } else {
        const parentId = operation.data.parent_id ?? null;
        if (parentId !== null && items.get(parentId)?.item_type !== "section") throw badRequest("parent_id invalide.");
        const siblings = [...items.values()].filter((item) => item.parent_id === parentId);
        const requested = new Set(operation.data.ordered_ids);
        if (siblings.length === 0) throw notFound("Aucun élément à réordonner pour ce parent.");
        if (requested.size !== operation.data.ordered_ids.length || requested.size !== siblings.length ||
          siblings.some((item) => !requested.has(item.id))) throw conflict("La liste de réordonnancement est obsolète.");
        operation.data.ordered_ids.forEach((id, itemIndex) => {
          items.set(id, { ...items.get(id)!, position: itemIndex + 1 });
        });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw new EstimateBatchPreparationError(index, operation.op, error);
      throw error;
    }
  }
  const lines: EstimateItemRecord[] = [...items.values()].filter((item) => item.item_type === "line")
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (perUnitLabor) {
    // v3 : remise et TVA par taux touchent toutes les lignes, donc toutes sont projetées.
    const v3Lines = [...items.values()].filter((item) => item.item_type === "line")
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const calculated = await calculateEstimateV3SnapshotForItems({
      supabase, tenantId, projectUserId: input.projectUserId, version, lineItems: v3Lines, captureDependencies: true,
    });
    if (!calculated.dependencies) throw internalError("Contexte de calcul indisponible.");
    await assertBatchVersionUnchanged();
    return { createdIds, itemUpdates: toEstimateV3LineProjections(calculated.breakdown),
      calculationContext: calculated.dependencies, expectedAidPolicy,
      versionPatch: toEstimateV3VersionTotals(calculated.breakdown) };
  }
  const { breakdown, dependencies } = await calculateEstimateSnapshotForItems({
    supabase, tenantId, projectUserId: input.projectUserId, version,
    lineItems: lines, captureDependencies: true,
  });
  if (!dependencies) throw internalError("Contexte de calcul indisponible.");
  let itemUpdates: ItemProjection[];
  if (isUnifiedEngine(resolveCalcEngineVersion(version))) {
    if (!breakdown.invariants.matchesFooter) throw badRequest("Le calcul des lignes ne correspond pas au pied du devis.");
    itemUpdates = buildEstimateV2SnapshotProjection({ items: lines, breakdown }).items.map((item) => ({
      id: item.id, pu_ht_cents: item.snapshot_pu_ht_cents, line_total_ht_cents: item.line_total_ht_cents,
      line_tax_cents: item.line_tax_cents, line_total_ttc_cents: item.line_total_ttc_cents,
    }));
  } else {
    itemUpdates = lines.filter((item) => changedLineIds.has(item.id)).map((item) => {
      const line = breakdown.lineById.get(item.id);
      if (!line) throw internalError("Projection de ligne indisponible.");
      return { id: item.id, pu_ht_cents: line.puNetHtCents, line_total_ht_cents: line.saleGrossCents,
        line_tax_cents: line.taxCents, line_total_ttc_cents: line.saleGrossCents + line.taxCents };
    });
  }
  await assertBatchVersionUnchanged();
  return { createdIds, itemUpdates, calculationContext: dependencies, expectedAidPolicy,
    versionPatch: { total_ht_cents: breakdown.totals.saleTotalCents,
      total_tax_cents: breakdown.totals.adjustedTaxCents, total_ttc_cents: breakdown.totals.roundedTtcCents } };
}
