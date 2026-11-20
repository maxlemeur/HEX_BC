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
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-gate-server";
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
import { hasOfferLimitsText, readOfferProvisionalQuantity, readOfferReserve } from "@/lib/estimates/offer-choice";
import {
  composeProvisionalQuantityMention,
  countStaleProvisionalQuantityMentions,
  hasProvisionalQuantityMention,
  OFFER_LIMITS_MAX_LENGTH,
  planProvisionalQuantityMentions,
} from "@/lib/estimates/provisional-quantity";
import { requiresStatusReason } from "@/lib/estimates/status-reason";
import { readTakeoffProvision } from "@/lib/estimates/takeoff-provision";
import { mapSupabaseError } from "@/lib/http/api-response";
import { loadCanonicalFixedDiscountEvidence } from "./fixed-discount-evidence-server";
import { readAllEstimateItems } from "./read-all-items-server";
import { evaluateRules } from "./rules-engine";
import type { EstimateRuleUnavailableSignal, EstimateRuleViolation } from "./approval-types";
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

type GatingItem = Awaited<ReturnType<typeof readAllEstimateItems>>[number];
type ItemIdsByFlag = ReturnType<typeof buildItemIdsByFlag>;
type QualityFlagsByItemId = ReturnType<typeof computeEstimateQualityFlagsByItemId>;
type SendGatingSources = Awaited<ReturnType<typeof loadSendGatingSources>>;
type ProvisionalMention = { itemId: string; mention: string | null };
/** The ids a step flags, for the gating flags that step raises. */
type FlaggedItemIds<Key extends EstimateGatingFlagKey> = Record<Key, Set<string>>;
type GatingFlagBuckets = { blockingFlags: EstimateGatingFlag[]; warningFlags: EstimateGatingFlag[] };

/** Everything the send control reads at once: the lines, the version's documents and register, the tenant settings. */
async function loadSendGatingSources(input: EvaluateEstimateSendGatingInput) {
  const { supabase, tenantId, version, project } = input;
  // TI-682, lot C: the lines whose stored offer choice the reader could not read (it hands them a null choice).
  const unreadableOfferChoiceIds = new Set<string>();
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
    readAllEstimateItems({ supabase, tenantId, versionId: version.id, unreadableOfferChoiceIds }),
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

  return {
    items,
    unreadableOfferChoiceIds,
    marginTiers: (marginTiersResult.data ?? []) as MarginTierRow[],
    documents: (documentsResult.data ?? []) as Pick<EstimateDocumentRow, "id">[],
    registerSummary,
    versionZeroSummary,
    stalePriceDays,
    severityByFlag: resolveSeverityByFlag({
      blockingOverride,
      warningOverride,
    }),
  };
}

/** The lines whose selected supplier price is older than the tenant's stale-price delay. */
async function findStaleSupplierPriceItemIds(input: {
  supabase: Supabase;
  tenantId: string;
  items: GatingItem[];
  stalePriceDays: number;
}) {
  const { supabase, tenantId, items, stalePriceDays } = input;
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
  return staleSupplierPriceItemIds;
}

/** The quality flags of each line, and the flagged ids by gating flag, every key present, that they start. */
function collectLineQualityFlags(items: GatingItem[], staleSupplierPriceItemIds: Set<string>) {
  const hasAtLeastOneSplitLine = items.some(
    (item) => item.item_type === "line" && hasStoredLaborSplit(item)
  );

  const qualityFlagsByItemId = computeEstimateQualityFlagsByItemId(items, {
    staleSupplierPriceItemIds,
    isLaborSplitEnabled: hasAtLeastOneSplitLine,
  });

  return { qualityFlagsByItemId, itemIdsByFlag: buildItemIdsByFlag(qualityFlagsByItemId) };
}

/**
 * TI-682 (D25). Engine 3 only: a status other than « priced » exists on no other engine, and only engine 3 can say
 * « Inclus » or « Pour mémoire » instead of sending a line at 0 €.
 * A version read without its engine column is never treated as engine 3: no new flag rather than a wrong one.
 */
function isEngine3Version(version: EstimateGatingVersion) {
  const engine = resolveEstimateEngineVersionForDisplay(version);
  return engine !== null && usesPerUnitLabor(engine);
}

/**
 * Flags the lines whose declared offer choice cannot be read, the « Non chiffrée » lines (reserved in writing or still
 * to classify), and the lines excluded after « Non chiffrée » without a reason.
 */
function flagLineStatusesAndOfferChoices(input: {
  items: GatingItem[];
  isEngine3: boolean;
  unreadableOfferChoiceIds: Set<string>;
}) {
  const { items, isEngine3, unreadableOfferChoiceIds } = input;
  const itemIdsByFlag: FlaggedItemIds<
    "offer_choice_unreadable" | "offer_reserve_declared" | "not_priced_unclassified" | "excluded_without_reason"
  > = {
    offer_choice_unreadable: new Set(),
    offer_reserve_declared: new Set(),
    not_priced_unclassified: new Set(),
    excluded_without_reason: new Set(),
  };
  for (const item of items) {
    if (item.item_type !== "line") continue;
    const pricingStatus = item.pricing_status ?? "priced";
    // TI-682, lot C: a declared choice the application cannot read (the database only stores one it reads) blocks the
    // send. The line would otherwise leave as an undeclared one: no sentence asked, a warning at most. A « Non chiffrée »
    // line is already blocked until classified (not_priced_unclassified), whatever its choice.
    const unreadableChoice = isEngine3 && pricingStatus !== "not_priced"
      && (unreadableOfferChoiceIds.has(item.id) || (item.offer_choice != null && readOfferProvisionalQuantity(item) === null));
    if (unreadableChoice) itemIdsByFlag.offer_choice_unreadable.add(item.id);
    if (pricingStatus === "not_priced") {
      // TI-682, lot C, PR 4 (D10, D28): a readable reserve declared by an administrator lets the line leave unpriced; the
      // issuer still sees it. Anything else is still to classify.
      if (isEngine3 && readOfferReserve(item) !== null) itemIdsByFlag.offer_reserve_declared.add(item.id);
      else itemIdsByFlag.not_priced_unclassified.add(item.id);
      continue;
    }
    // TI-682, lot C (D11): a necessary service left unpriced, then excluded, says why before it leaves (internally).
    if (isEngine3 && requiresStatusReason(item)) itemIdsByFlag.excluded_without_reason.add(item.id);
  }
  return itemIdsByFlag;
}

/**
 * Engine 3 « Chiffrée » lines: collects the provisional quantities declared on them (TI-682, lot C, PR 5) with their
 * sentence as the line is now, and flags the takeoff hypotheses nobody declared and the lines that would leave at 0 €.
 */
function flagEngine3PricedLines(input: {
  items: GatingItem[];
  isEngine3: boolean;
  /** The lines flagged offer_choice_unreadable: their choice is neither a declaration nor its absence. */
  unreadableChoiceItemIds: Set<string>;
  qualityFlagsByItemId: QualityFlagsByItemId;
}) {
  const { items, isEngine3, unreadableChoiceItemIds, qualityFlagsByItemId } = input;
  const itemIdsByFlag: FlaggedItemIds<"takeoff_hypothesis_without_mention" | "priced_line_without_amount"> = {
    takeoff_hypothesis_without_mention: new Set(),
    priced_line_without_amount: new Set(),
  };
  const provisionalMentions: ProvisionalMention[] = [];
  for (const item of items) {
    if (item.item_type !== "line") continue;
    const pricingStatus = item.pricing_status ?? "priced";
    if (!isEngine3 || pricingStatus !== "priced") continue;
    // TI-682, lot C, PR 5: a priced line whose quantity rests on a takeoff hypothesis leaves as an ordinary priced line.
    // Declared provisional, the offer must carry its sentence; undeclared, the issuer sees it (a warning, never a block:
    // the estimates sent before this lot did not say it either).
    const provisional = readOfferProvisionalQuantity(item);
    if (provisional) provisionalMentions.push({ itemId: item.id, mention: composeProvisionalQuantityMention(item, provisional) });
    else if (!unreadableChoiceItemIds.has(item.id) && readTakeoffProvision(item.source_metadata)?.kind === "hypothesis") {
      itemIdsByFlag.takeoff_hypothesis_without_mention.add(item.id);
    }
    const flags = qualityFlagsByItemId[item.id] ?? [];
    // A line that already misses its price or its quantity says so under its own flag.
    if (flags.includes("missing_price") || flags.includes("missing_quantity")) continue;
    if (!hasLineAmountInput(item)) itemIdsByFlag.priced_line_without_amount.add(item.id);
  }
  return { itemIdsByFlag, provisionalMentions };
}

/**
 * Checks the « Précisions et limites de prestation » text against the reserves and provisional quantities the lines
 * declare. Also returns how many characters the missing sentences lack to fit in that text (0 when they fit).
 */
function flagOfferLimitsText(input: {
  version: EstimateGatingVersion;
  isEngine3: boolean;
  /** The lines flagged offer_reserve_declared. */
  reservedItemIds: Set<string>;
  provisionalMentions: ProvisionalMention[];
}) {
  const { version, isEngine3, reservedItemIds, provisionalMentions } = input;
  const itemIdsByFlag: FlaggedItemIds<
    "offer_limits_required" | "provisional_quantity_mention_missing" | "provisional_quantity_mention_stale"
  > = {
    offer_limits_required: new Set(),
    provisional_quantity_mention_missing: new Set(),
    provisional_quantity_mention_stale: new Set(),
  };
  // A reserve is written in the offer: its limits text says something. A version read without that text is treated as
  // empty (refused rather than sent).
  if (!hasOfferLimitsText(version.exclusions)) {
    reservedItemIds.forEach((itemId) => itemIdsByFlag.offer_limits_required.add(itemId));
    provisionalMentions.forEach(({ itemId }) => itemIdsByFlag.offer_limits_required.add(itemId));
  }
  // The sentence written from the line as it is now is in the limits text, whatever its blanks and line breaks: a new
  // quantity, title or unit asks the new sentence. A line without a quantity has no sentence and stays blocked.
  for (const { itemId, mention } of provisionalMentions) {
    if (mention === null || !hasProvisionalQuantityMention(version.exclusions, mention)) {
      itemIdsByFlag.provisional_quantity_mention_missing.add(itemId);
    }
  }
  // When the limits text can no longer receive the missing sentences, the flag says by how much: the issuer reads what
  // unblocks the offer instead of a refusal without a way out.
  const currentMentions = provisionalMentions.flatMap(({ mention }) => (mention === null ? [] : [mention]));
  const mentionsOverflow = planProvisionalQuantityMentions(version.exclusions, currentMentions).overflow;
  // A « quantité provisionnelle » sentence that matches no current line (a quantity changed, a choice withdrawn or
  // cleared) still reaches the client: listed for the issuer, never blocked.
  if (isEngine3 && countStaleProvisionalQuantityMentions(version.exclusions, currentMentions) > 0) {
    itemIdsByFlag.provisional_quantity_mention_stale.add(version.id);
  }
  return { itemIdsByFlag, mentionsOverflow };
}

/** The version-wide conditions: tiered margin configured, budget ceiling kept, a PDF generated, no V0 left to review. */
function flagVersionWideConditions(input: {
  version: EstimateGatingVersion;
  marginTiers: MarginTierRow[];
  budgetCeilingHtCents: number | null;
  documents: Pick<EstimateDocumentRow, "id">[];
  versionZeroSummary: SendGatingSources["versionZeroSummary"];
}) {
  const { version, marginTiers, budgetCeilingHtCents, documents, versionZeroSummary } = input;
  const itemIdsByFlag: FlaggedItemIds<
    "margin_not_configured" | "total_exceeds_budget" | "no_pdf_generated" | "version_zero_review_pending"
  > = {
    margin_not_configured: new Set(),
    total_exceeds_budget: new Set(),
    no_pdf_generated: new Set(),
    version_zero_review_pending: new Set(),
  };
  if (version.margin_mode === "tiered" && marginTiers.length === 0) {
    itemIdsByFlag.margin_not_configured.add(version.id);
  }

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
  return itemIdsByFlag;
}

/** Adds to the quality flags' ids, every key present, the ids the later steps flagged. */
function mergeFlaggedItemIds(
  itemIdsByFlag: ItemIdsByFlag,
  flaggedBySteps: Partial<FlaggedItemIds<EstimateGatingFlagKey>>[]
) {
  for (const flagged of flaggedBySteps) {
    for (const [key, itemIds] of Object.entries(flagged) as [EstimateGatingFlagKey, Set<string>][]) {
      itemIds.forEach((itemId) => itemIdsByFlag[key].add(itemId));
    }
  }
  return itemIdsByFlag;
}

/** The tenant's business rules on the version, with the fixed discount evidence when the version carries one. */
async function evaluateSendRules(input: EvaluateEstimateSendGatingInput & { items: GatingItem[] }) {
  const { supabase, tenantId, version, project, items } = input;
  const fixedDiscountEvidence = version.discount_amount_cents != null && project.user_id &&
    version.tenant_id === tenantId && typeof version.status === "string" && typeof version.updated_at === "string" &&
    typeof version.content_revision === "number"
    ? await loadCanonicalFixedDiscountEvidence({
        supabase, tenantId, projectUserId: project.user_id,
        authorizedVersion: { ...version, status: version.status, updated_at: version.updated_at, content_revision: version.content_revision },
      })
    : null;
  return evaluateRules({
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
}

/** The figures that explain a line or version flag beyond its items. */
type GatingFlagDetailsContext = {
  version: EstimateGatingVersion;
  stalePriceDays: number;
  marginTiers: MarginTierRow[];
  budgetCeilingHtCents: number | null;
  mentionsOverflow: number;
  versionZeroSummary: SendGatingSources["versionZeroSummary"];
};

function buildGatingFlagDetails(key: EstimateGatingFlagKey, context: GatingFlagDetailsContext) {
  const { version, stalePriceDays, marginTiers, budgetCeilingHtCents, mentionsOverflow, versionZeroSummary } = context;
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
  if (key === "provisional_quantity_mention_missing" && mentionsOverflow > 0) {
    details.limits_overflow = { missing_characters: mentionsOverflow, limit: OFFER_LIMITS_MAX_LENGTH };
  }
  if (key === "version_zero_review_pending" && versionZeroSummary?.activeDraft) {
    details.draft_id = versionZeroSummary.activeDraft.id;
    details.pending_count = versionZeroSummary.activeDraft.counts.pending;
    details.selected_lots = versionZeroSummary.activeDraft.selectedLots;
  }
  return details;
}

/** One flag per line or version condition met, in the policy's order, at the severity the tenant settings give it. */
function pushLineAndVersionGatingFlags(input: GatingFlagBuckets & {
  itemIdsByFlag: ItemIdsByFlag;
  severityByFlag: SendGatingSources["severityByFlag"];
  context: GatingFlagDetailsContext;
}) {
  const { blockingFlags, warningFlags, itemIdsByFlag, severityByFlag, context } = input;
  ESTIMATE_GATING_FLAG_KEYS.forEach((key) => {
    if (key === "rule_violation") {
      return;
    }

    const itemIds = Array.from(itemIdsByFlag[key]).sort((left, right) =>
      left.localeCompare(right)
    );
    if (itemIds.length === 0) return;

    const severity = severityByFlag[key];
    const details = buildGatingFlagDetails(key, context);

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
}

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

function buildRuleViolationFlag(input: {
  severity: EstimateGatingSeverity;
  count: number;
  description: string;
  details: Record<string, unknown>;
}): EstimateGatingFlag {
  return {
    key: "rule_violation",
    category: resolveEstimateReadinessCategoryFromGatingFlagKey("rule_violation"),
    severity: input.severity,
    count: input.count,
    item_ids: [],
    label: ESTIMATE_GATING_FLAG_META.rule_violation.label,
    description: input.description,
    details: input.details,
  };
}

/**
 * The business rules not met, then those the available evidence cannot evaluate: blocking unless the rule only warns.
 * The tenant settings change neither.
 */
function pushRuleGatingFlags(input: GatingFlagBuckets & {
  rulesEvaluation: Awaited<ReturnType<typeof evaluateRules>>;
}) {
  const { blockingFlags, warningFlags, rulesEvaluation } = input;
  if (rulesEvaluation.blockingViolations.length > 0) {
    blockingFlags.push(buildRuleViolationFlag({
      severity: "blocking",
      count: rulesEvaluation.blockingViolations.length,
      description: ESTIMATE_GATING_FLAG_META.rule_violation.description,
      details: toRuleViolationDetails(rulesEvaluation.blockingViolations),
    }));
  }

  if (rulesEvaluation.warningViolations.length > 0) {
    warningFlags.push(buildRuleViolationFlag({
      severity: "warning",
      count: rulesEvaluation.warningViolations.length,
      description: ESTIMATE_GATING_FLAG_META.rule_violation.description,
      details: toRuleViolationDetails(rulesEvaluation.warningViolations),
    }));
  }

  const blockingUnavailableSignals = rulesEvaluation.unavailableSignals.filter(
    (signal) => signal.action !== "warn"
  );
  const warningUnavailableSignals = rulesEvaluation.unavailableSignals.filter(
    (signal) => signal.action === "warn"
  );

  if (blockingUnavailableSignals.length > 0) {
    blockingFlags.push(buildRuleViolationFlag({
      severity: "blocking",
      count: blockingUnavailableSignals.length,
      description:
        "Des règles bloquantes ne peuvent pas être evaluees avec les preuves disponibles.",
      details: toUnavailableRuleDetails(blockingUnavailableSignals),
    }));
  }

  if (warningUnavailableSignals.length > 0) {
    warningFlags.push(buildRuleViolationFlag({
      severity: "warning",
      count: warningUnavailableSignals.length,
      description:
        "Certaines règles d'avertissement ne peuvent pas être evaluees avec les preuves disponibles.",
      details: toUnavailableRuleDetails(warningUnavailableSignals),
    }));
  }
}

/**
 * The questions of the affaire register: critical open entries and those to clarify with the client block, the other
 * open entries warn. The tenant settings change neither.
 */
function pushRegisterGatingFlags(input: GatingFlagBuckets & {
  registerSummary: SendGatingSources["registerSummary"];
  projectId: string;
}) {
  const { blockingFlags, warningFlags, registerSummary, projectId } = input;
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "critical_missing_pieces",
    severity: "blocking",
    projectId,
    status: "open",
    registerSeverity: "critical",
    entries: registerSummary.criticalOpenEntries.filter((entry) => entry.kind === "missing_piece"),
    kind: "missing_piece",
    label: "Documents critiques manquants",
    description:
      "Des pièces critiques restent manquantes ou inexploitees dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "critical_open_questions",
    severity: "blocking",
    projectId,
    status: "open",
    registerSeverity: "critical",
    entries: registerSummary.criticalOpenEntries.filter((entry) => entry.kind === "assumption"),
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.critical_open_questions.label,
    description: ESTIMATE_GATING_FLAG_META.critical_open_questions.description,
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_missing_documents_required",
    severity: "blocking",
    projectId,
    status: "clarify_with_client",
    registerSeverity: null,
    entries: registerSummary.clarifyWithClientEntries.filter((entry) => entry.kind === "missing_piece"),
    kind: "missing_piece",
    label: "Documents attendus du client",
    description:
      "Des pièces attendues du client restent nécessaires avant l'envoi.",
  });
  pushRegisterGatingFlag({
    bucket: blockingFlags,
    key: "client_clarification_required",
    severity: "blocking",
    projectId,
    status: "clarify_with_client",
    registerSeverity: null,
    entries: registerSummary.clarifyWithClientEntries.filter((entry) => entry.kind === "assumption"),
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.client_clarification_required.label,
    description: ESTIMATE_GATING_FLAG_META.client_clarification_required.description,
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "missing_pieces_pending",
    severity: "warning",
    projectId,
    status: "open",
    registerSeverity: null,
    entries: registerSummary.nonCriticalOpenEntries.filter((entry) => entry.kind === "missing_piece"),
    kind: "missing_piece",
    label: "Documents manquants à traiter",
    description:
      "Des pièces manquantes non critiques restent ouvertes dans le registre affaire.",
  });
  pushRegisterGatingFlag({
    bucket: warningFlags,
    key: "open_questions_pending",
    severity: "warning",
    projectId,
    status: "open",
    registerSeverity: null,
    entries: registerSummary.nonCriticalOpenEntries.filter((entry) => entry.kind === "assumption"),
    kind: "assumption",
    label: ESTIMATE_GATING_FLAG_META.open_questions_pending.label,
    description: ESTIMATE_GATING_FLAG_META.open_questions_pending.description,
  });
}

export async function evaluateEstimateSendGating(
  input: EvaluateEstimateSendGatingInput
): Promise<EstimateSendGatingResult> {
  const { supabase, tenantId, version, project } = input;
  const sources = await loadSendGatingSources(input);
  const { items, stalePriceDays } = sources;

  const staleSupplierPriceItemIds = await findStaleSupplierPriceItemIds({ supabase, tenantId, items, stalePriceDays });
  const lineQuality = collectLineQualityFlags(items, staleSupplierPriceItemIds);

  const isEngine3 = isEngine3Version(version);
  const lineStatuses = flagLineStatusesAndOfferChoices({
    items, isEngine3, unreadableOfferChoiceIds: sources.unreadableOfferChoiceIds,
  });
  const pricedLines = flagEngine3PricedLines({
    items,
    isEngine3,
    unreadableChoiceItemIds: lineStatuses.offer_choice_unreadable,
    qualityFlagsByItemId: lineQuality.qualityFlagsByItemId,
  });
  const offerLimits = flagOfferLimitsText({
    version, isEngine3, reservedItemIds: lineStatuses.offer_reserve_declared, provisionalMentions: pricedLines.provisionalMentions,
  });

  const budgetCeilingHtCents = parseProjectBudgetCeilingHtCents(project.notes);
  const versionConditions = flagVersionWideConditions({
    version,
    marginTiers: sources.marginTiers,
    budgetCeilingHtCents,
    documents: sources.documents,
    versionZeroSummary: sources.versionZeroSummary,
  });

  const itemIdsByFlag = mergeFlaggedItemIds(lineQuality.itemIdsByFlag, [
    lineStatuses, pricedLines.itemIdsByFlag, offerLimits.itemIdsByFlag, versionConditions,
  ]);

  const rulesEvaluation = await evaluateSendRules({ ...input, items });

  const blockingFlags: EstimateGatingFlag[] = [];
  const warningFlags: EstimateGatingFlag[] = [];
  pushLineAndVersionGatingFlags({
    blockingFlags,
    warningFlags,
    itemIdsByFlag,
    severityByFlag: sources.severityByFlag,
    context: {
      version,
      stalePriceDays,
      marginTiers: sources.marginTiers,
      budgetCeilingHtCents,
      mentionsOverflow: offerLimits.mentionsOverflow,
      versionZeroSummary: sources.versionZeroSummary,
    },
  });
  pushRuleGatingFlags({ blockingFlags, warningFlags, rulesEvaluation });
  pushRegisterGatingFlags({ blockingFlags, warningFlags, registerSummary: sources.registerSummary, projectId: project.id });

  return {
    canSend: blockingFlags.length === 0,
    blockingFlags,
    warningFlags,
    stalePriceDays,
    checkedAt: new Date().toISOString(),
  };
}
