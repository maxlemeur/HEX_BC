import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isPriceStale } from "@/lib/catalogue/stale-prices";
import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import {
  computeEstimateQualityFlagsByItemId,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import type { Database } from "@/types/database";
import {
  resolveEstimateReadinessCategoryFromGatingFlagKey,
  resolveEstimateReadinessCategoryFromRegisterEntryKind,
  type EstimateReadinessCategory,
} from "@/lib/estimates/readiness";

import {
  ESTIMATE_GATING_FLAG_KEYS,
  ESTIMATE_GATING_FLAG_META,
  GATING_BLOCKING_FLAGS_KEY,
  GATING_WARNING_FLAGS_KEY,
  hasStoredLaborSplit,
  resolveSeverityByFlag,
  type EstimateGatingFlagKey,
  type EstimateGatingSeverity,
} from "@/lib/estimates/gating-policy";

import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { mapSupabaseError, notFound } from "./errors";
import { loadCanonicalFixedDiscountEvidence } from "./fixed-discount-evidence-server";
import { readOfferTreatment, reviewOfferTreatments } from "./offer-treatment";
import { readAllEstimateItems } from "./read-all-items-server";
import {
  evaluateRules,
  type EstimateRuleUnavailableSignal,
  type EstimateRuleViolation,
} from "./rules-engine";
import { fetchVersionZeroDraftSummary } from "./version-zero-drafts";

export {
  ESTIMATE_GATING_FLAG_KEYS,
  ESTIMATE_GATING_FLAG_META,
  type EstimateGatingFlagKey,
  type EstimateGatingFlagMeta,
  type EstimateGatingSeverity,
} from "@/lib/estimates/gating-policy";

type Supabase = SupabaseClient<Database>;
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SupplierPriceRow = Database["public"]["Tables"]["supplier_pricebook"]["Row"];
type EstimateDocumentRow = Database["public"]["Tables"]["estimate_documents"]["Row"];

export type EstimateGatingFlag = {
  key: EstimateGatingFlagKey;
  category?: EstimateReadinessCategory;
  severity: EstimateGatingSeverity;
  count: number;
  item_ids: string[];
  label: string;
  description: string;
  details?: Record<string, unknown>;
};

export type EstimateSendGatingResult = {
  canSend: boolean;
  blockingFlags: EstimateGatingFlag[];
  warningFlags: EstimateGatingFlag[];
  stalePriceDays: number;
  checkedAt: string;
};

type EstimateGatingVersion = Pick<
  EstimateVersionRow,
  | "id"
  | "margin_mode"
  | "margin_multiplier"
  | "total_ht_cents"
  | "project_id"
> &
  Partial<
    Pick<
      EstimateVersionRow,
      | "margin_bp"
      | "discount_bp"
      | "discount_amount_cents"
      | "tenant_id"
      | "status"
      | "updated_at"
      | "calc_engine_version"
      | "content_revision"
      | "calc_snapshot_content_revision"
      | "calc_snapshot_context"
      | "exclusions"
    >
  >;
type EstimateGatingProject = Pick<EstimateProjectRow, "id" | "client_name" | "notes"> & Partial<Pick<EstimateProjectRow, "user_id">>;

type EvaluateEstimateSendGatingInput = {
  supabase: Supabase;
  tenantId: string;
  version: EstimateGatingVersion;
  project: EstimateGatingProject;
};

function parseProjectBudgetCeilingHtCents(notes: string | null) {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const directCandidates = [
      record.budget_ht_cents,
      record.budget_ceiling_ht_cents,
      record.total_budget_ht_cents,
    ];
    for (const candidate of directCandidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        const normalized = Math.round(candidate);
        return normalized >= 0 ? normalized : null;
      }
      if (typeof candidate === "string") {
        const parsedInt = Number.parseInt(candidate.trim(), 10);
        if (Number.isFinite(parsedInt) && parsedInt >= 0) {
          return parsedInt;
        }
      }
    }
  } catch {
    // Notes are commonly free text; no budget metadata means no budget gate.
  }

  const regexMatch = trimmed.match(
    /(?:budget_ht_cents|budget_ceiling_ht_cents)\s*[:=]\s*(\d+)/i
  );
  if (!regexMatch) return null;

  const parsed = Number.parseInt(regexMatch[1], 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function buildRegisterGatingEntries(input: {
  entries: Awaited<ReturnType<typeof fetchAffaireRegisterGateSummary>>["criticalOpenEntries"];
  projectId: string;
  status: "open" | "clarify_with_client";
  severity: "critical" | null;
  kind: "missing_piece" | "assumption";
}) {
  return input.entries.map((entry) => ({
    ...entry,
    href: buildAffaireRegisterHubHref({
      projectId: input.projectId,
      status: input.status,
      severity: input.severity,
      kind: input.kind,
      focusEntryId: entry.id,
    }),
  }));
}

function pushRegisterGatingFlag(input: {
  bucket: EstimateGatingFlag[];
  key: Extract<
    EstimateGatingFlagKey,
    | "critical_missing_pieces"
    | "critical_open_questions"
    | "client_missing_documents_required"
    | "client_clarification_required"
    | "missing_pieces_pending"
    | "open_questions_pending"
  >;
  severity: EstimateGatingSeverity;
  projectId: string;
  status: "open" | "clarify_with_client";
  registerSeverity: "critical" | null;
  entries: Awaited<ReturnType<typeof fetchAffaireRegisterGateSummary>>["criticalOpenEntries"];
  kind: "missing_piece" | "assumption";
  label: string;
  description: string;
}) {
  if (input.entries.length === 0) {
    return;
  }

  input.bucket.push({
    key: input.key,
    category: resolveEstimateReadinessCategoryFromRegisterEntryKind(input.kind),
    severity: input.severity,
    count: input.entries.length,
    item_ids: [],
    label: input.label,
    description: input.description,
    details: {
      register_entries: buildRegisterGatingEntries({
        entries: input.entries,
        projectId: input.projectId,
        status: input.status,
        severity: input.registerSeverity,
        kind: input.kind,
      }),
    },
  });
}

/** Whether a priced line carries anything to price: a supply price, or hours in any of the stored forms. */
function hasLineAmountInput(item: Awaited<ReturnType<typeof readAllEstimateItems>>[number]) {
  const positive = (value: unknown) => Number(value ?? 0) > 0;
  return positive(item.unit_price_ht_cents)
    || [item.h_mo, item.h_mo_atelier, item.h_mo_chantier, item.h_mo_per_unit, item.h_mo_atelier_per_unit,
      item.h_mo_chantier_per_unit].some(positive);
}

/**
 * The « Précisions et limites de prestation » text of the version, which holds the sentences of its reserves. Read
 * only when a line carries a reserve and the caller's version row does not have the column.
 */
async function readOfferLimitsText(input: {
  supabase: Supabase;
  tenantId: string;
  version: EstimateGatingVersion;
  items: Awaited<ReturnType<typeof readAllEstimateItems>>;
}): Promise<string | null> {
  if (input.version.exclusions !== undefined) return input.version.exclusions;
  const hasReserve = input.items.some((item) => {
    const read = readOfferTreatment(item.source_metadata);
    return read.state === "read" && read.treatment.kind === "offer_reserve";
  });
  if (!hasReserve) return null;
  const { data, error } = await input.supabase.from("estimate_versions").select("exclusions")
    .eq("tenant_id", input.tenantId).eq("id", input.version.id).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire le texte de l’offre de cette version.");
  if (!data) throw notFound("Version de chiffrage introuvable.");
  return data.exclusions;
}

function buildItemIdsByFlag(
  flagsByItemId: Record<string, EstimateQualityFlagKey[]>
) {
  const result = ESTIMATE_GATING_FLAG_KEYS.reduce(
    (acc, key) => {
      acc[key] = new Set<string>();
      return acc;
    },
    {} as Record<EstimateGatingFlagKey, Set<string>>
  );

  Object.entries(flagsByItemId).forEach(([itemId, flags]) => {
    flags.forEach((flag) => {
      if (!(flag in result)) return;
      result[flag as EstimateGatingFlagKey].add(itemId);
    });
  });

  return result;
}

export async function evaluateEstimateSendGating(
  input: EvaluateEstimateSendGatingInput
): Promise<EstimateSendGatingResult> {
  const {
    supabase,
    tenantId,
    version,
    project,
  } = input;

  const [
    items,
    marginTiersResult,
    documentsResult,
    registerSummary,
    versionZeroSummary,
    stalePriceDays,
    blockingOverride,
    warningOverride,
  ] = await Promise.all([
    readAllEstimateItems({ supabase, tenantId, versionId: version.id }),
    readAllRows(() => supabase
      .from("margin_tiers")
      .select("id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("threshold_cents", { ascending: true })
      .order("position", { ascending: true })),
    supabase
      .from("estimate_documents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("version_id", version.id)
      .limit(1),
    fetchAffaireRegisterGateSummary({
      supabase: supabase as never,
      projectId: project.id,
      versionId: version.id,
    }),
    fetchVersionZeroDraftSummary({ versionId: version.id }).catch(() => null),
    getStalePriceDaysForTenant(tenantId, { supabase }),
    getFeatureFlagValueForTenant(tenantId, GATING_BLOCKING_FLAGS_KEY, {
      supabase,
    }),
    getFeatureFlagValueForTenant(tenantId, GATING_WARNING_FLAGS_KEY, {
      supabase,
    }),
  ]);

  if (marginTiersResult.error) {
    throw mapSupabaseError(
      marginTiersResult.error,
      "Impossible de charger les tranches de marge."
    );
  }
  if (documentsResult.error) {
    throw mapSupabaseError(
      documentsResult.error,
      "Impossible de charger les documents de la version."
    );
  }

  const marginTiers = (marginTiersResult.data ?? []) as MarginTierRow[];
  const documents = (documentsResult.data ?? []) as Pick<EstimateDocumentRow, "id">[];
  const severityByFlag = resolveSeverityByFlag({
    blockingOverride,
    warningOverride,
  });

  const selectedSupplierPriceIds = Array.from(
    new Set(
      items
        .filter((item) => item.item_type === "line")
        .map((item) => item.selected_supplier_price_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  let staleSupplierPriceIds = new Set<string>();
  if (selectedSupplierPriceIds.length > 0) {
    const { data, error } = await readAllRowsInChunks(selectedSupplierPriceIds, (pageIds) => supabase
      .from("supplier_pricebook")
      .select("id, updated_at, created_at", { count: "exact" })
      .eq("tenant_id", tenantId)
      .in("id", pageIds));

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger les prix fournisseurs sélectionnés."
      );
    }

    staleSupplierPriceIds = new Set(
      ((data ?? []) as Pick<SupplierPriceRow, "id" | "updated_at" | "created_at">[])
        .filter((price) =>
          isPriceStale(
            {
              updatedAt: price.updated_at,
              createdAt: price.created_at,
            },
            stalePriceDays
          )
        )
        .map((price) => price.id)
    );
  }

  const staleSupplierPriceItemIds = new Set<string>();
  items.forEach((item) => {
    if (item.item_type !== "line") return;
    const selectedSupplierPriceId = item.selected_supplier_price_id ?? null;
    if (!selectedSupplierPriceId) return;
    if (staleSupplierPriceIds.has(selectedSupplierPriceId)) {
      staleSupplierPriceItemIds.add(item.id);
    }
  });

  const hasAtLeastOneSplitLine = items.some(
    (item) => item.item_type === "line" && hasStoredLaborSplit(item)
  );

  const qualityFlagsByItemId = computeEstimateQualityFlagsByItemId(items, {
    staleSupplierPriceItemIds,
    isLaborSplitEnabled: hasAtLeastOneSplitLine,
  });

  const itemIdsByFlag = buildItemIdsByFlag(qualityFlagsByItemId);

  // TI-682 (D25). Engine 3 only: a status other than « priced » exists on no other engine, and only engine 3 can say
  // « Inclus » or « Pour mémoire » instead of sending a line at 0 €.
  // A version read without its engine column is never treated as engine 3: no new flag rather than a wrong one.
  const engine = resolveEstimateEngineVersionForDisplay(version);
  const isEngine3 = engine !== null && usesPerUnitLabor(engine);
  // TI-682 (D12): the internal reason of an exclusion and the reserve written in the offer. A reserve classifies a
  // « Non chiffrée » line only while the offer text holds its sentence and every reserve rests on one basis.
  const offerTreatments = isEngine3
    ? reviewOfferTreatments(items, await readOfferLimitsText({ supabase, tenantId, version, items }))
    : null;
  const reservedNotPricedIds = new Set(offerTreatments?.reservedNotPricedIds ?? []);
  offerTreatments?.exclusionWithoutReasonIds.forEach((id) => itemIdsByFlag.exclusion_without_reason.add(id));
  offerTreatments?.reserveToRewriteIds.forEach((id) => itemIdsByFlag.offer_reserve_not_written.add(id));
  offerTreatments?.reserveBasisConflictIds.forEach((id) => itemIdsByFlag.offer_reserve_basis_conflict.add(id));
  for (const item of items) {
    if (item.item_type !== "line") continue;
    const pricingStatus = item.pricing_status ?? "priced";
    if (pricingStatus === "not_priced") {
      if (!reservedNotPricedIds.has(item.id)) itemIdsByFlag.not_priced_unclassified.add(item.id);
      continue;
    }
    if (!isEngine3 || pricingStatus !== "priced") continue;
    const flags = qualityFlagsByItemId[item.id] ?? [];
    // A line that already misses its price or its quantity says so under its own flag.
    if (flags.includes("missing_price") || flags.includes("missing_quantity")) continue;
    if (!hasLineAmountInput(item)) itemIdsByFlag.priced_line_without_amount.add(item.id);
  }

  if (version.margin_mode === "tiered" && marginTiers.length === 0) {
    itemIdsByFlag.margin_not_configured.add(version.id);
  }

  const budgetCeilingHtCents = parseProjectBudgetCeilingHtCents(project.notes);
  if (
    budgetCeilingHtCents !== null &&
    Number.isFinite(version.total_ht_cents) &&
    version.total_ht_cents > budgetCeilingHtCents
  ) {
    itemIdsByFlag.total_exceeds_budget.add(version.id);
  }

  if (documents.length === 0) {
    itemIdsByFlag.no_pdf_generated.add(version.id);
  }

  if (versionZeroSummary?.activeDraft) {
    itemIdsByFlag.version_zero_review_pending.add(version.id);
  }

  const fixedDiscountEvidence = version.discount_amount_cents != null && project.user_id &&
    version.tenant_id === tenantId && typeof version.status === "string" && typeof version.updated_at === "string" &&
    typeof version.content_revision === "number"
    ? await loadCanonicalFixedDiscountEvidence({
        supabase, tenantId, projectUserId: project.user_id,
        authorizedVersion: { ...version, status: version.status, updated_at: version.updated_at, content_revision: version.content_revision },
      })
    : null;
  const rulesEvaluation = await evaluateRules({
    supabase,
    tenantId,
    fixedDiscountEvidence,
    version: {
      id: version.id,
      project_id: version.project_id,
      margin_bp: version.margin_bp,
      margin_multiplier: version.margin_multiplier,
      margin_mode: version.margin_mode,
      discount_bp: version.discount_bp,
      discount_amount_cents: version.discount_amount_cents,
      tenant_id: version.tenant_id,
      status: version.status,
      updated_at: version.updated_at,
      calc_engine_version: version.calc_engine_version,
      content_revision: version.content_revision,
      calc_snapshot_content_revision: version.calc_snapshot_content_revision,
      calc_snapshot_context: version.calc_snapshot_context,
      total_ht_cents: version.total_ht_cents,
    },
    project: {
      id: project.id,
      client_name: project.client_name,
    },
    items: items
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        id: item.id,
        category_id: item.category_id,
        item_type: item.item_type,
      })),
  });

  const blockingFlags: EstimateGatingFlag[] = [];
  const warningFlags: EstimateGatingFlag[] = [];

  ESTIMATE_GATING_FLAG_KEYS.forEach((key) => {
    if (key === "rule_violation") {
      return;
    }

    const itemIds = Array.from(itemIdsByFlag[key]).sort((left, right) =>
      left.localeCompare(right)
    );
    if (itemIds.length === 0) return;

    const severity = severityByFlag[key];
    const details: Record<string, unknown> = {};

    if (key === "supplier_price_outdated") {
      details.stale_price_days = stalePriceDays;
    }
    if (key === "margin_not_configured") {
      details.margin_mode = version.margin_mode;
      details.margin_tiers_count = marginTiers.length;
    }
    if (key === "total_exceeds_budget") {
      details.total_ht_cents = version.total_ht_cents;
      details.budget_ceiling_ht_cents = budgetCeilingHtCents;
    }
    if (key === "version_zero_review_pending" && versionZeroSummary?.activeDraft) {
      details.draft_id = versionZeroSummary.activeDraft.id;
      details.pending_count = versionZeroSummary.activeDraft.counts.pending;
      details.selected_lots = versionZeroSummary.activeDraft.selectedLots;
    }

    const flag: EstimateGatingFlag = {
      key,
      category: resolveEstimateReadinessCategoryFromGatingFlagKey(key),
      severity,
      count: itemIds.length,
      item_ids: itemIds,
      label: ESTIMATE_GATING_FLAG_META[key].label,
      description: ESTIMATE_GATING_FLAG_META[key].description,
      details: Object.keys(details).length > 0 ? details : undefined,
    };

    if (severity === "blocking") {
      blockingFlags.push(flag);
      return;
    }
    warningFlags.push(flag);
  });

  function toRuleViolationDetails(violations: EstimateRuleViolation[]) {
    return {
      violations: violations.map((violation) => ({
        rule_id: violation.rule_id,
        rule_type: violation.rule_type,
        scope_type: violation.scope_type,
        scope_id: violation.scope_id,
        threshold_value: violation.threshold_value,
        action: violation.action,
        metric_key: violation.metric_key,
        actual_value: violation.actual_value,
        comparator: violation.comparator,
        approval_status: violation.approval_status,
        approval_id: violation.approval_id,
        approval_created_at: violation.approval_created_at,
        approval_decided_at: violation.approval_decided_at,
        source_state: violation.source_state,
        message: violation.message,
      })),
    } satisfies Record<string, unknown>;
  }

  function toUnavailableRuleDetails(signals: EstimateRuleUnavailableSignal[]) {
    return {
      unavailable_signals: signals.map((signal) => ({
        rule_id: signal.rule_id,
        rule_type: signal.rule_type,
        scope_type: signal.scope_type,
        scope_id: signal.scope_id,
        threshold_value: signal.threshold_value,
        action: signal.action,
        metric_key: signal.metric_key,
        comparator: signal.comparator,
        source_state: signal.source_state,
        message: signal.message,
      })),
    } satisfies Record<string, unknown>;
  }

  if (rulesEvaluation.blockingViolations.length > 0) {
    blockingFlags.push({
      key: "rule_violation",
      category: resolveEstimateReadinessCategoryFromGatingFlagKey("rule_violation"),
      severity: "blocking",
      count: rulesEvaluation.blockingViolations.length,
      item_ids: [],
      label: ESTIMATE_GATING_FLAG_META.rule_violation.label,
      description: ESTIMATE_GATING_FLAG_META.rule_violation.description,
      details: toRuleViolationDetails(rulesEvaluation.blockingViolations),
    });
  }

  if (rulesEvaluation.warningViolations.length > 0) {
    warningFlags.push({
      key: "rule_violation",
      category: resolveEstimateReadinessCategoryFromGatingFlagKey("rule_violation"),
      severity: "warning",
      count: rulesEvaluation.warningViolations.length,
      item_ids: [],
      label: ESTIMATE_GATING_FLAG_META.rule_violation.label,
      description: ESTIMATE_GATING_FLAG_META.rule_violation.description,
      details: toRuleViolationDetails(rulesEvaluation.warningViolations),
    });
  }

  const blockingUnavailableSignals = rulesEvaluation.unavailableSignals.filter(
    (signal) => signal.action !== "warn"
  );
  const warningUnavailableSignals = rulesEvaluation.unavailableSignals.filter(
    (signal) => signal.action === "warn"
  );

  if (blockingUnavailableSignals.length > 0) {
    blockingFlags.push({
      key: "rule_violation",
      category: resolveEstimateReadinessCategoryFromGatingFlagKey("rule_violation"),
      severity: "blocking",
      count: blockingUnavailableSignals.length,
      item_ids: [],
      label: ESTIMATE_GATING_FLAG_META.rule_violation.label,
      description:
        "Des règles bloquantes ne peuvent pas être evaluees avec les preuves disponibles.",
      details: toUnavailableRuleDetails(blockingUnavailableSignals),
    });
  }

  if (warningUnavailableSignals.length > 0) {
    warningFlags.push({
      key: "rule_violation",
      category: resolveEstimateReadinessCategoryFromGatingFlagKey("rule_violation"),
      severity: "warning",
      count: warningUnavailableSignals.length,
      item_ids: [],
      label: ESTIMATE_GATING_FLAG_META.rule_violation.label,
      description:
        "Certaines règles d'avertissement ne peuvent pas être evaluees avec les preuves disponibles.",
      details: toUnavailableRuleDetails(warningUnavailableSignals),
    });
  }

  const criticalMissingPieceEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const criticalAssumptionEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const clarifyMissingPieceEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const clarifyAssumptionEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const openMissingPieceEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const openAssumptionEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );

  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "critical_missing_pieces",
    severity: "blocking",
    projectId: input.project.id,
    status: "open",
    registerSeverity: "critical",
    entries: criticalMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents critiques manquants",
    description:
      "Des pièces critiques restent manquantes ou inexploitees dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "critical_open_questions",
    severity: "blocking",
    projectId: input.project.id,
    status: "open",
    registerSeverity: "critical",
    entries: criticalAssumptionEntries,
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.critical_open_questions.label,
    description: ESTIMATE_GATING_FLAG_META.critical_open_questions.description,
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_missing_documents_required",
    severity: "blocking",
    projectId: input.project.id,
    status: "clarify_with_client",
    registerSeverity: null,
    entries: clarifyMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents attendus du client",
    description:
      "Des pièces attendues du client restent nécessaires avant l'envoi.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_clarification_required",
    severity: "blocking",
    projectId: input.project.id,
    status: "clarify_with_client",
    registerSeverity: null,
    entries: clarifyAssumptionEntries,
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.client_clarification_required.label,
    description: ESTIMATE_GATING_FLAG_META.client_clarification_required.description,
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "missing_pieces_pending",
    severity: "warning",
    projectId: input.project.id,
    status: "open",
    registerSeverity: null,
    entries: openMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents manquants à traiter",
    description:
      "Des pièces manquantes non critiques restent ouvertes dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "open_questions_pending",
    severity: "warning",
    projectId: input.project.id,
    status: "open",
    registerSeverity: null,
    entries: openAssumptionEntries,
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.open_questions_pending.label,
    description: ESTIMATE_GATING_FLAG_META.open_questions_pending.description,
  });

  return {
    canSend: blockingFlags.length === 0,
    blockingFlags,
    warningFlags,
    stalePriceDays,
    checkedAt: new Date().toISOString(),
  };
}
