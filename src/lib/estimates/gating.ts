import type { SupabaseClient } from "@supabase/supabase-js";

import { isPriceStale } from "@/lib/catalogue/stale-prices";
import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
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

import { mapSupabaseError } from "./errors";
import { evaluateRules, type EstimateRuleViolation } from "./rules-engine";
import { fetchVersionZeroDraftSummary } from "./version-zero-drafts";

type Supabase = SupabaseClient<Database>;
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SupplierPriceRow = Database["public"]["Tables"]["supplier_pricebook"]["Row"];
type EstimateDocumentRow = Database["public"]["Tables"]["estimate_documents"]["Row"];

const GATING_BLOCKING_FLAGS_KEY = "ESTIMATE_GATING_BLOCKING_FLAGS";
const GATING_WARNING_FLAGS_KEY = "ESTIMATE_GATING_WARNING_FLAGS";

export const ESTIMATE_GATING_FLAG_KEYS = [
  ...ESTIMATE_QUALITY_FLAG_KEYS,
  "margin_not_configured",
  "total_exceeds_budget",
  "no_pdf_generated",
  "rule_violation",
  "critical_open_questions",
  "client_clarification_required",
  "open_questions_pending",
  "version_zero_review_pending",
] as const;

export type EstimateGatingFlagKey = (typeof ESTIMATE_GATING_FLAG_KEYS)[number];

export type EstimateGatingSeverity = "blocking" | "warning";

export type EstimateGatingFlagMeta = {
  label: string;
  description: string;
};

export const ESTIMATE_GATING_FLAG_META: Record<
  EstimateGatingFlagKey,
  EstimateGatingFlagMeta
> = {
  ...ESTIMATE_QUALITY_FLAG_META,
  margin_not_configured: {
    label: "Marge par tranches non configuree",
    description:
      "Le mode de marge par tranches est actif mais aucune tranche n'est configuree pour ce tenant.",
  },
  total_exceeds_budget: {
    label: "Budget depasse",
    description:
      "Le total HT du devis depasse le plafond budgetaire configure pour le projet.",
  },
  no_pdf_generated: {
    label: "PDF absent",
    description:
      "Aucun document PDF n'est genere pour cette version. Lancez une generation avant l'envoi.",
  },
  rule_violation: {
    label: "Regles metier non respectees",
    description:
      "Des regles metier (marge, remise, approbation) ne sont pas satisfaites.",
  },
  critical_open_questions: {
    label: "Questions critiques ouvertes",
    description:
      "Le registre affaire contient des hypotheses ou pieces manquantes critiques encore ouvertes.",
  },
  client_clarification_required: {
    label: "Clarification client requise",
    description:
      "Le registre affaire contient des points a clarifier avec le client avant l'envoi.",
  },
  open_questions_pending: {
    label: "Questions ouvertes a traiter",
    description:
      "Des hypotheses ou pieces manquantes non critiques restent ouvertes dans le registre affaire.",
  },
  version_zero_review_pending: {
    label: "V0 IA a revoir",
    description:
      "Une V0 assistee est encore active sur cette version. La revue humaine explicite doit etre finalisee avant envoi.",
  },
};

const DEFAULT_GATING_SEVERITY_BY_FLAG: Record<
  EstimateGatingFlagKey,
  EstimateGatingSeverity
> = {
  missing_price: "blocking",
  missing_quantity: "blocking",
  missing_labor_time: "warning",
  missing_labor_role: "warning",
  price_outlier: "warning",
  quantity_outlier: "warning",
  supplier_price_outdated: "warning",
  labor_split_incomplete: "warning",
  margin_not_configured: "blocking",
  total_exceeds_budget: "blocking",
  no_pdf_generated: "blocking",
  rule_violation: "blocking",
  critical_open_questions: "blocking",
  client_clarification_required: "blocking",
  open_questions_pending: "warning",
  version_zero_review_pending: "blocking",
};

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
  "id" | "margin_mode" | "margin_multiplier" | "total_ht_cents" | "project_id"
> &
  Partial<Pick<EstimateVersionRow, "margin_bp" | "discount_bp">>;
type EstimateGatingProject = Pick<EstimateProjectRow, "id" | "client_name" | "notes">;

type EvaluateEstimateSendGatingInput = {
  supabase: Supabase;
  tenantId: string;
  version: EstimateGatingVersion;
  project: EstimateGatingProject;
};

function parseCsvFlagList(value: string | null): Set<EstimateGatingFlagKey> {
  if (!value) return new Set();

  const normalized = value
    .split(/[,\n;\s]+/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  const allowed = new Set<string>(ESTIMATE_GATING_FLAG_KEYS);
  const parsed = new Set<EstimateGatingFlagKey>();

  normalized.forEach((token) => {
    if (allowed.has(token)) {
      parsed.add(token as EstimateGatingFlagKey);
    }
  });

  return parsed;
}

function resolveSeverityByFlag(input: {
  blockingOverride: string | null;
  warningOverride: string | null;
}) {
  const blockingOverrideSet = parseCsvFlagList(input.blockingOverride);
  const warningOverrideSet = parseCsvFlagList(input.warningOverride);

  return ESTIMATE_GATING_FLAG_KEYS.reduce(
    (acc, key) => {
      if (blockingOverrideSet.has(key)) {
        acc[key] = "blocking";
        return acc;
      }
      if (warningOverrideSet.has(key)) {
        acc[key] = "warning";
        return acc;
      }
      acc[key] = DEFAULT_GATING_SEVERITY_BY_FLAG[key];
      return acc;
    },
    {} as Record<EstimateGatingFlagKey, EstimateGatingSeverity>
  );
}

function hasLaborSplitPayload(item: EstimateItemRow) {
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
}

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
    | "critical_open_questions"
    | "client_clarification_required"
    | "open_questions_pending"
  >;
  severity: EstimateGatingSeverity;
  projectId: string;
  status: "open" | "clarify_with_client";
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
        severity: input.severity === "blocking" ? "critical" : null,
        kind: input.kind,
      }),
    },
  });
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
    itemsResult,
    marginTiersResult,
    documentsResult,
    registerSummary,
    versionZeroSummary,
    stalePriceDays,
    blockingOverride,
    warningOverride,
  ] = await Promise.all([
    supabase
      .from("estimate_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("version_id", version.id)
      .order("position", { ascending: true }),
    supabase
      .from("margin_tiers")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("threshold_cents", { ascending: true })
      .order("position", { ascending: true }),
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

  if (itemsResult.error) {
    throw mapSupabaseError(itemsResult.error, "Impossible de charger les lignes.");
  }
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

  const items = (itemsResult.data ?? []) as EstimateItemRow[];
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
    const { data, error } = await supabase
      .from("supplier_pricebook")
      .select("id, updated_at, created_at")
      .eq("tenant_id", tenantId)
      .in("id", selectedSupplierPriceIds);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger les prix fournisseurs selectionnes."
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
    (item) => item.item_type === "line" && hasLaborSplitPayload(item)
  );

  const qualityFlagsByItemId = computeEstimateQualityFlagsByItemId(items, {
    staleSupplierPriceItemIds,
    isLaborSplitEnabled: hasAtLeastOneSplitLine,
  });

  const itemIdsByFlag = buildItemIdsByFlag(qualityFlagsByItemId);

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

  const rulesEvaluation = await evaluateRules({
    supabase,
    tenantId,
    version: {
      id: version.id,
      project_id: version.project_id,
      margin_bp: version.margin_bp,
      margin_multiplier: version.margin_multiplier,
      discount_bp: version.discount_bp,
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
    key: "critical_open_questions",
    severity: "blocking",
    projectId: input.project.id,
    status: "open",
    entries: criticalMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents critiques manquants",
    description:
      "Des pieces critiques restent manquantes ou inexploitees dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "critical_open_questions",
    severity: "blocking",
    projectId: input.project.id,
    status: "open",
    entries: criticalAssumptionEntries,
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.critical_open_questions.label,
    description: ESTIMATE_GATING_FLAG_META.critical_open_questions.description,
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_clarification_required",
    severity: "blocking",
    projectId: input.project.id,
    status: "clarify_with_client",
    entries: clarifyMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents attendus du client",
    description:
      "Des pieces attendues du client restent necessaires avant l'envoi.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_clarification_required",
    severity: "blocking",
    projectId: input.project.id,
    status: "clarify_with_client",
    entries: clarifyAssumptionEntries,
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.client_clarification_required.label,
    description: ESTIMATE_GATING_FLAG_META.client_clarification_required.description,
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "open_questions_pending",
    severity: "warning",
    projectId: input.project.id,
    status: "open",
    entries: openMissingPieceEntries,
    kind: "missing_piece",
    label: "Documents manquants a traiter",
    description:
      "Des pieces manquantes non critiques restent ouvertes dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "open_questions_pending",
    severity: "warning",
    projectId: input.project.id,
    status: "open",
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
