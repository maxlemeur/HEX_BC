import "server-only";

import { headers } from "next/headers";

import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { executeEstimateBatch } from "@/lib/estimates/batch";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { ApiError, badRequest, conflict } from "@/lib/estimates/errors";
import { arbitratePriceReuseLines } from "@/lib/estimates/price-reuse-arbitration";
import {
  priceReuseApplySchema, priceReuseArbitrationSchema, priceReusePreviewSchema,
  type PriceReuseApplyInput, type PriceReuseApplyResult, type PriceReuseArbitration, type PriceReuseArbitrationInput,
  type PriceReusePreview, type PriceReusePreviewInput,
} from "@/lib/estimates/price-reuse-contracts";
import { matchPriceReuseLines, type PriceReuseMatch } from "@/lib/estimates/price-reuse-matching";
import {
  hasPriceReuseInput, PRICE_REUSE_COPIED_FIELDS, planPriceReuseOperations, PriceReusePlanError, type PriceReuseRole,
} from "@/lib/estimates/price-reuse-plan";
import { readAllItemsForCopy } from "@/lib/estimates/section-copy-read-server";
import { assertDraftStatus, getAuthenticatedContext, getVersionAccessOrThrow } from "@/lib/estimates/server-context";
import type { Database } from "@/types/database";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md). La comparaison et l'arbitrage lisent
// seulement ; l'application est une écriture atomique de l'écrivain de lot v3, sur le jeton du brouillon. Le devis
// de référence n'est jamais écrit.

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type Context = Awaited<ReturnType<typeof getAuthenticatedContext>>;
type Access = Awaited<ReturnType<typeof getVersionAccessOrThrow>>;

const TARGET_STATUSES = new Set(["priced", "not_priced"]);
const MAX_SECTION_DEPTH = 32;

function assertV3(access: Access, role: "target" | "reference") {
  if (usesPerUnitLabor(resolveEstimateEngineVersion(access.version))) return;
  throw conflict(role === "target"
    ? "La reprise des prix est disponible pour les devis au moteur de calcul 3."
    : "Le devis de référence doit utiliser le moteur de calcul 3 : ses heures par unité et ses statuts sont repris tels quels.",
  undefined, "PRICE_REUSE_ENGINE_UNSUPPORTED");
}

function sectionPaths(items: readonly ItemRow[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (item: ItemRow) => {
    const path: string[] = [];
    let parentId = item.parent_id;
    for (let depth = 0; parentId && depth < MAX_SECTION_DEPTH; depth += 1) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.item_type === "section") path.unshift(parent.title);
      parentId = parent.parent_id;
    }
    return path;
  };
}

const priceKey = (item: ItemRow) =>
  JSON.stringify(PRICE_REUSE_COPIED_FIELDS.map((field) => (typeof item[field] === "number" ? Number(item[field]) : item[field] ?? null)));

async function readRoles(context: Context, userId: string): Promise<PriceReuseRole[]> {
  const { data, error } = await context.supabase.from("labor_roles").select("id, name")
    .eq("tenant_id", context.tenantId).eq("user_id", userId);
  if (error) throw new ApiError({ status: 503, code: "PRICE_REUSE_READ_UNAVAILABLE", message: "Les rôles de main-d’œuvre sont indisponibles." });
  return data ?? [];
}

async function readComparison(versionId: string, referenceVersionId: string) {
  const context = await getAuthenticatedContext();
  if (versionId.toLowerCase() === referenceVersionId.toLowerCase()) {
    throw badRequest("Choisissez un autre devis que celui-ci comme référence.", undefined, "PRICE_REUSE_SAME_VERSION");
  }
  const [target, reference] = await Promise.all([
    getVersionAccessOrThrow(context.supabase, versionId, context),
    getVersionAccessOrThrow(context.supabase, referenceVersionId, context),
  ]);
  assertV3(target, "target");
  assertV3(reference, "reference");
  const [targetItems, referenceItems] = await Promise.all([
    readAllItemsForCopy(context.supabase, context.tenantId, target.version),
    readAllItemsForCopy(context.supabase, context.tenantId, reference.version),
  ]);
  const targetLines = targetItems.filter((item) => item.item_type === "line" && TARGET_STATUSES.has(item.pricing_status ?? "priced"));
  const referenceLines = referenceItems.filter((item) => item.item_type === "line");
  const targetPath = sectionPaths(targetItems);
  const referencePath = sectionPaths(referenceItems);
  const matches = matchPriceReuseLines({
    targets: targetLines.map((item) => ({ id: item.id, title: item.title, unitCode: item.unit_code, sectionPath: targetPath(item) })),
    references: referenceLines.map((item) => ({ id: item.id, title: item.title, unitCode: item.unit_code,
      sectionPath: referencePath(item), priced: item.pricing_status === "priced" && hasPriceReuseInput(item), priceKey: priceKey(item) })),
  });
  return { context, target, reference, targetItems, referenceItems, targetLines, referenceLines, targetPath, referencePath, matches };
}

async function readArbiters(context: Context) {
  const capability = getOpenAiDecisionsCapability();
  let chatgpt = { available: false, message: "Le forfait ChatGPT est utilisable dans MergeOne local, sur le Mac connecté." };
  if (isLocalChatGptEnabled()) {
    try {
      assertLocalChatGptHost((await headers()).get("host"));
      chatgpt = await getStructuredAiAvailability({ tenantId: context.tenantId, userId: context.userId });
    } catch {
      chatgpt = { available: false, message: "Le forfait ChatGPT n’est utilisable que depuis MergeOne local, sur ce Mac." };
    }
  }
  return { decisions: { available: capability.status === "available", message: capability.message }, chatgpt };
}

async function readVersionLabel(context: Context, versionId: string) {
  const { data } = await context.supabase.from("estimate_versions").select("version_number, title")
    .eq("tenant_id", context.tenantId).eq("id", versionId).maybeSingle();
  return { versionNumber: data?.version_number ?? 0, title: data?.title ?? null };
}

async function readNames(context: Context, table: "labor_roles" | "supply_types", ids: Set<string>) {
  if (ids.size === 0) return new Map<string, string>();
  const { data, error } = await context.supabase.from(table).select("id, name").eq("tenant_id", context.tenantId).in("id", [...ids]);
  // Names are only displayed: an unreadable list leaves them empty instead of hiding the comparison.
  return new Map(error ? [] : (data ?? []).map((row) => [row.id, row.name]));
}

export async function previewPriceReuse(versionId: string, input: PriceReusePreviewInput): Promise<PriceReusePreview> {
  const comparison = await readComparison(versionId, input.reference_version_id);
  const { context, target, reference, targetLines, referenceLines, targetPath, referencePath, matches } = comparison;
  const referenceById = new Map(referenceLines.map((item) => [item.id, item]));
  const targetById = new Map(targetLines.map((item) => [item.id, item]));
  const usedReferences = new Set(matches.flatMap((match) => match.candidates.map((candidate) => candidate.referenceId)));
  const used = [...usedReferences].map((id) => referenceById.get(id)!);
  const [roleNames, supplyNames, arbiters, label] = await Promise.all([
    readNames(context, "labor_roles", new Set(used.map((item) => item.labor_role_id).filter((id): id is string => Boolean(id)))),
    readNames(context, "supply_types", new Set(used.map((item) => item.supply_type_id).filter((id): id is string => Boolean(id)))),
    readArbiters(context),
    readVersionLabel(context, reference.version.id),
  ]);
  const lines = matches.map((match) => {
    const item = targetById.get(match.lineId)!;
    const proposed = match.proposedReferenceId ? referenceById.get(match.proposedReferenceId) : undefined;
    return {
      line_id: item.id, title: item.title, unit_code: item.unit_code, section_path: targetPath(item), status: match.status,
      proposed_reference_line_id: match.proposedReferenceId,
      preselected: match.status === "identical" && !hasPriceReuseInput(item) && Boolean(proposed),
      current_unit_price_ht_cents: item.unit_price_ht_cents, current_h_mo_per_unit: item.h_mo_per_unit === null ? null : Number(item.h_mo_per_unit),
      notes: match.notes,
      candidates: match.candidates.map((candidate) => ({ reference_line_id: candidate.referenceId, exact: candidate.exact,
        score: candidate.score, differences: candidate.differences })),
    };
  });
  const summary = { identical: 0, to_review: 0, new: 0 };
  for (const line of lines) summary[line.status] += 1;
  return priceReusePreviewSchema.parse({
    target: { version_id: target.version.id, updated_at: target.version.updated_at },
    reference: { version_id: reference.version.id, updated_at: reference.version.updated_at, project_name: reference.project.name,
      version_number: label.versionNumber, title: label.title },
    summary, lines,
    references: used.map((item) => ({ reference_line_id: item.id, title: item.title, unit_code: item.unit_code,
      section_path: referencePath(item), unit_price_ht_cents: item.unit_price_ht_cents,
      h_mo_per_unit: item.h_mo_per_unit === null ? null : Number(item.h_mo_per_unit), pu_ht_cents: item.pu_ht_cents,
      labor_role_name: item.labor_role_id ? roleNames.get(item.labor_role_id) ?? null : null,
      supply_type_name: item.supply_type_id ? supplyNames.get(item.supply_type_id) ?? null : null })),
    arbiters,
  });
}

function assertReferenceUnchanged(updatedAt: string, expected: string) {
  if (Date.parse(updatedAt) === Date.parse(expected)) return;
  throw conflict("Le devis de référence a changé depuis la comparaison. Relancez la comparaison.", undefined, "PRICE_REUSE_REFERENCE_CHANGED");
}

export async function arbitratePriceReuse(versionId: string, input: PriceReuseArbitrationInput): Promise<PriceReuseArbitration> {
  const comparison = await readComparison(versionId, input.reference_version_id);
  const { context, target, reference, targetLines, referenceLines, targetPath, referencePath, matches } = comparison;
  assertReferenceUnchanged(reference.version.updated_at, input.reference_updated_at);
  const [arbiters, label] = await Promise.all([readArbiters(context), readVersionLabel(context, reference.version.id)]);
  const arbiter = arbiters[input.provider];
  const requested = new Set(input.line_ids.map((id) => id.toLowerCase()));
  // Only lines still « à vérifier » with candidates are sent: the client never chooses what the provider sees.
  const toReview = matches.filter((match: PriceReuseMatch) => requested.has(match.lineId.toLowerCase()) &&
    match.status === "to_review" && match.candidates.length > 0);
  if (!arbiter.available) {
    return priceReuseArbitrationSchema.parse({ provider: input.provider, model: null, status: "unavailable", message: arbiter.message,
      answers: toReview.map((match) => ({ line_id: match.lineId, reference_line_id: null, confidence: null })) });
  }
  if (toReview.length === 0) {
    return priceReuseArbitrationSchema.parse({ provider: input.provider, model: null, status: "available",
      message: "Aucune ligne à vérifier n’a de candidat à départager.", answers: [] });
  }
  const targetById = new Map(targetLines.map((item) => [item.id, item]));
  const referenceById = new Map(referenceLines.map((item) => [item.id, item]));
  const result = await arbitratePriceReuseLines({
    provider: input.provider, owner: { tenantId: context.tenantId, userId: context.userId }, projectId: target.project.id,
    referenceLabel: `${reference.project.name} v${label.versionNumber}`,
    lines: toReview.map((match) => {
      const item = targetById.get(match.lineId)!;
      return { lineId: item.id, title: item.title, unitCode: item.unit_code, sectionPath: targetPath(item),
        candidates: match.candidates.map((candidate) => {
          const source = referenceById.get(candidate.referenceId)!;
          return { referenceLineId: source.id, title: source.title, unitCode: source.unit_code, sectionPath: referencePath(source),
            unitPriceCents: source.unit_price_ht_cents, hoursPerUnit: source.h_mo_per_unit === null ? null : Number(source.h_mo_per_unit),
            differences: candidate.differences };
        }) };
    }),
  });
  return priceReuseArbitrationSchema.parse(result);
}

const PLAN_ERROR_STATUS: Record<PriceReusePlanError["code"], 400 | 409 | 413 | 422> = {
  PRICE_REUSE_TOO_MANY: 413, PRICE_REUSE_DUPLICATE_LINE: 400, PRICE_REUSE_LINE_NOT_FOUND: 409,
  PRICE_REUSE_REFERENCE_NOT_FOUND: 409, PRICE_REUSE_REFERENCE_NOT_PRICED: 409, PRICE_REUSE_UNIT_MISMATCH: 409,
  PRICE_REUSE_LABOR_ROLE_MISSING: 422, PRICE_REUSE_LABOR_ROLE_AMBIGUOUS: 422,
};

export async function applyPriceReuse(versionId: string, input: PriceReuseApplyInput, concurrencyToken: string | null): Promise<PriceReuseApplyResult> {
  if (!concurrencyToken?.trim()) throw badRequest("Jeton de concurrence manquant (If-Match).", undefined, "VERSION_TOKEN_REQUIRED");
  const comparison = await readComparison(versionId, input.reference_version_id);
  const { context, target, reference, targetItems, referenceItems, matches } = comparison;
  assertDraftStatus(target.version.status);
  assertReferenceUnchanged(reference.version.updated_at, input.reference_updated_at);
  // The editor's queue sends its latest token: the comparison's own token proves the user saw these lines.
  if (Date.parse(target.version.updated_at) !== Date.parse(input.target_updated_at)) {
    throw conflict("Ce devis a changé depuis la comparaison (enregistrement en cours ou autre écriture). Relancez la comparaison.",
      undefined, "PRICE_REUSE_TARGET_CHANGED");
  }
  // Only a candidate of the current comparison, on a line it compares, can be written.
  const candidatesOf = new Map(matches.map((match) => [match.lineId, new Set(match.candidates.map((candidate) => candidate.referenceId))]));
  const titleOfLine = new Map(targetItems.map((item) => [item.id, item.title]));
  for (const selection of input.selections) {
    if (candidatesOf.get(selection.line_id)?.has(selection.reference_line_id)) continue;
    const title = titleOfLine.get(selection.line_id);
    throw conflict(`${title ? `« ${title} » : ` : ""}cet article n’est plus un candidat de la comparaison. Relancez la comparaison.`,
      { line_id: selection.line_id }, "PRICE_REUSE_SELECTION_STALE");
  }
  const [targetRoles, referenceRoles] = await Promise.all([
    readRoles(context, target.project.user_id), readRoles(context, reference.project.user_id),
  ]);
  let plan;
  try {
    plan = planPriceReuseOperations({ targets: targetItems, references: referenceItems, selections: input.selections, targetRoles, referenceRoles });
  } catch (error) {
    if (!(error instanceof PriceReusePlanError)) throw error;
    throw new ApiError({ status: PLAN_ERROR_STATUS[error.code], code: error.code, message: error.message,
      details: error.lineId ? { line_id: error.lineId } : undefined });
  }
  const referenceOf = new Map(input.selections.map((selection) => [selection.line_id, selection.reference_line_id]));
  const referencePu = new Map(referenceItems.map((item) => [item.id, item.pu_ht_cents]));
  if (plan.operations.length === 0) {
    return priceReuseApplySchema.parse({ applied_count: 0, unchanged_count: plan.unchanged.length, lines: [],
      version: { id: target.version.id, updated_at: target.version.updated_at } });
  }
  const result = await executeEstimateBatch(target.version.id, plan.operations, {
    concurrencyToken, operationKey: input.operation_key, maxOperations: plan.operations.length, targetItems,
  }).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "ESTIMATE_BATCH_RECEIPT_TOO_LARGE") {
      throw new ApiError({ status: 413, code: "PRICE_REUSE_TOO_LARGE", message:
        "Cette reprise dépasse la taille d’une écriture atomique (désignations longues). Reprenez les prix en plusieurs fois, " +
        "par exemple section par section. Aucun prix n’a été repris." });
    }
    throw error;
  });
  if (!result.committed) {
    const failed = result.results.at(-1);
    const title = failed ? targetItems.find((item) => item.id === plan.operations[failed.index]?.id)?.title : undefined;
    const code = failed?.status === "error" ? failed.code : "PRICE_REUSE_REFUSED";
    const cause = failed?.status === "error" ? failed.message : "Reprise refusée.";
    throw new ApiError({ status: /CONFLICT|STALE|LOCK/.test(code) ? 409 : 400, code,
      message: `${title ? `« ${title} » : ` : ""}${cause} Aucun prix n’a été repris.` });
  }
  const saved = new Map(result.results.flatMap((entry) => {
    const item = entry.status === "ok" ? (entry.data as { item?: { id?: string; pu_ht_cents?: number | null } }).item : undefined;
    return item?.id ? [[item.id, item.pu_ht_cents ?? null] as const] : [];
  }));
  const titleOf = new Map(targetItems.map((item) => [item.id, item.title]));
  return priceReuseApplySchema.parse({
    applied_count: plan.operations.length, unchanged_count: plan.unchanged.length,
    lines: plan.operations.map((operation) => {
      const referenceLineId = referenceOf.get(operation.id)!;
      return { line_id: operation.id, reference_line_id: referenceLineId, title: titleOf.get(operation.id) ?? "",
        reference_pu_ht_cents: referencePu.get(referenceLineId) ?? null, pu_ht_cents: saved.get(operation.id) ?? null };
    }),
    version: { id: result.version.id, updated_at: result.version.updated_at },
  });
}
