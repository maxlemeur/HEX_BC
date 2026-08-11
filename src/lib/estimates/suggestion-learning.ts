import { z } from "zod";

import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import {
  getAuthenticatedTenantContext as getAuthenticatedContext,
  type ServerSupabaseClient,
} from "@/lib/auth/tenant-context";
import type { Database } from "@/types/database";

type Supabase = ServerSupabaseClient;
type TenantRole = Database["public"]["Enums"]["tenant_role"];

type EmbeddedProjectAccess = Pick<
  Database["public"]["Tables"]["estimate_projects"]["Row"],
  "id" | "tenant_id" | "user_id"
>;

type VersionAccessRow = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "status"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

const TENANT_ADMIN_ROLE: TenantRole = "admin";

const FEATURE_FLAG_LEARNING_ENABLED = "EST_163_SUGGESTION_LEARNING";
const FEATURE_FLAG_LEARNING_THRESHOLD = "EST_163_SUGGESTION_LEARNING_THRESHOLD";
const FEATURE_FLAG_LEARNING_RETENTION_MONTHS =
  "EST_163_SUGGESTION_LEARNING_RETENTION_MONTHS";
const DEFAULT_LEARNING_THRESHOLD = 3;
const DEFAULT_RETENTION_MONTHS = 12;
const MAX_LEARNING_THRESHOLD = 100;
const MAX_RETENTION_MONTHS = 120;

const SUGGESTION_LEARNING_FIELD_VALUES = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
] as const;

const TRACKED_FIELD_SET = new Set<string>(SUGGESTION_LEARNING_FIELD_VALUES);

const suggestionLearningFieldSchema = z.enum(SUGGESTION_LEARNING_FIELD_VALUES);

export type SuggestionLearningFieldName = z.infer<
  typeof suggestionLearningFieldSchema
>;

export type SuggestionLearningReviewStatus = "approved" | "rejected";

export type SuggestionCorrectionInput = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  original_value: string | null;
  corrected_value: string | null;
  item_title: string;
};

export type SuggestionLearningProposal = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  corrected_value: string | null;
  correction_count: number;
  first_seen_at: string;
  last_seen_at: string;
  review_status: SuggestionLearningReviewStatus | null;
  decided_by: string | null;
  decided_at: string | null;
  is_active: boolean;
  sample_original_value: string | null;
  sample_item_title: string | null;
};

export type SuggestionLearningRuleBoost = {
  rule_id: string;
  learning_boost: number;
  overrides: {
    description?: string | null;
    category_id?: string | null;
    k_fo?: number | null;
    k_mo?: number | null;
    labor_role_id?: string | null;
    supply_type_id?: string | null;
  };
  fields: SuggestionLearningProposal[];
};

export type SuggestionLearningConfig = {
  enabled: boolean;
  threshold: number;
  retention_months: number;
};

export type SuggestionLearningState = {
  config: SuggestionLearningConfig;
  proposals: SuggestionLearningProposal[];
  by_rule_id: Record<string, SuggestionLearningRuleBoost>;
};

export type TrackCorrectionsResult = SuggestionLearningState & {
  tracked_count: number;
};

export type ReviewLearningAction = "approve" | "reject" | "reset";

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

function assertDraftStatus(status: VersionAccessRow["status"]) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

function parseFlagInteger(input: {
  value: string | null;
  fallback: number;
  min: number;
  max: number;
}) {
  if (!input.value) return input.fallback;
  const parsed = Number.parseInt(input.value.trim(), 10);
  if (!Number.isFinite(parsed)) return input.fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < input.min) return input.min;
  if (normalized > input.max) return input.max;
  return normalized;
}

function parseFeatureFlagEnabled(value: unknown) {
  return value === true;
}

function normalizeTextValue(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumericOverride(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toLearningProposal(value: unknown): SuggestionLearningProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;

  const ruleId = typeof row.rule_id === "string" ? row.rule_id : null;
  const fieldName =
    typeof row.field_name === "string" && TRACKED_FIELD_SET.has(row.field_name)
      ? (row.field_name as SuggestionLearningFieldName)
      : null;
  const correctedValue =
    typeof row.corrected_value === "string" ? row.corrected_value : row.corrected_value === null ? null : null;
  const correctionCount =
    typeof row.correction_count === "number" && Number.isFinite(row.correction_count)
      ? Math.max(0, Math.trunc(row.correction_count))
      : 0;
  const firstSeenAt =
    typeof row.first_seen_at === "string" ? row.first_seen_at : null;
  const lastSeenAt =
    typeof row.last_seen_at === "string" ? row.last_seen_at : null;

  if (!ruleId || !fieldName || !firstSeenAt || !lastSeenAt) {
    return null;
  }

  const reviewStatusRaw = row.review_status;
  const reviewStatus =
    reviewStatusRaw === "approved" || reviewStatusRaw === "rejected"
      ? (reviewStatusRaw as SuggestionLearningReviewStatus)
      : null;

  return {
    rule_id: ruleId,
    field_name: fieldName,
    corrected_value: correctedValue,
    correction_count: correctionCount,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    review_status: reviewStatus,
    decided_by: typeof row.decided_by === "string" ? row.decided_by : null,
    decided_at: typeof row.decided_at === "string" ? row.decided_at : null,
    is_active: row.is_active === true,
    sample_original_value:
      typeof row.sample_original_value === "string"
        ? row.sample_original_value
        : null,
    sample_item_title:
      typeof row.sample_item_title === "string" ? row.sample_item_title : null,
  };
}

function compareLearningPriority(
  left: SuggestionLearningProposal,
  right: SuggestionLearningProposal
) {
  const leftStatusPriority = left.review_status === "approved" ? 2 : 1;
  const rightStatusPriority = right.review_status === "approved" ? 2 : 1;

  if (rightStatusPriority !== leftStatusPriority) {
    return rightStatusPriority - leftStatusPriority;
  }

  if (right.correction_count !== left.correction_count) {
    return right.correction_count - left.correction_count;
  }

  const leftTimestamp = Date.parse(left.last_seen_at);
  const rightTimestamp = Date.parse(right.last_seen_at);

  if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
    return rightTimestamp - leftTimestamp;
  }

  return 0;
}

function computeLearningFieldBoost(proposal: SuggestionLearningProposal) {
  const base = Math.min(4, Math.log10(proposal.correction_count + 1) * 4);
  const statusBonus = proposal.review_status === "approved" ? 2 : 0;
  return Math.min(6, base + statusBonus);
}

export function applyLearningBoost(input: {
  proposals: SuggestionLearningProposal[];
  boostCap?: number;
}) {
  const boostCap =
    typeof input.boostCap === "number" && Number.isFinite(input.boostCap)
      ? Math.max(0, input.boostCap)
      : 20;

  const groupedByRule = new Map<string, SuggestionLearningProposal[]>();
  input.proposals
    .filter((proposal) => proposal.is_active)
    .forEach((proposal) => {
      const current = groupedByRule.get(proposal.rule_id) ?? [];
      current.push(proposal);
      groupedByRule.set(proposal.rule_id, current);
    });

  const result: Record<string, SuggestionLearningRuleBoost> = {};

  groupedByRule.forEach((proposals, ruleId) => {
    const bestByField = new Map<SuggestionLearningFieldName, SuggestionLearningProposal>();

    proposals.forEach((proposal) => {
      const existing = bestByField.get(proposal.field_name);
      if (!existing || compareLearningPriority(proposal, existing) < 0) {
        bestByField.set(proposal.field_name, proposal);
      }
    });

    const selectedFields = Array.from(bestByField.values()).sort(compareLearningPriority);

    const overrides: SuggestionLearningRuleBoost["overrides"] = {};
    let scoreBoost = 0;

    selectedFields.forEach((proposal) => {
      const correctedValue = proposal.corrected_value;

      switch (proposal.field_name) {
        case "description":
          overrides.description = correctedValue;
          break;
        case "category_id":
          overrides.category_id = normalizeTextValue(correctedValue);
          break;
        case "k_fo":
          overrides.k_fo = parseNumericOverride(correctedValue);
          break;
        case "k_mo":
          overrides.k_mo = parseNumericOverride(correctedValue);
          break;
        case "labor_role_id":
          overrides.labor_role_id = normalizeTextValue(correctedValue);
          break;
        case "supply_type_id":
          overrides.supply_type_id = normalizeTextValue(correctedValue);
          break;
      }

      scoreBoost += computeLearningFieldBoost(proposal);
    });

    result[ruleId] = {
      rule_id: ruleId,
      learning_boost: Number(Math.min(boostCap, scoreBoost).toFixed(3)),
      overrides,
      fields: selectedFields,
    };
  });

  return result;
}

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select("id, tenant_id, status, estimate_projects!inner(id, tenant_id, user_id)")
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version,
    project,
  };
}

async function resolveDraftLockOwnerName(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
  return fullName.length > 0 ? fullName : null;
}

async function assertDraftLockOwnedByCurrentUser(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data: lock, error } = await input.context.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, locked_at, expires_at")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de vérifier le verrou de brouillon.");
  }

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      {
        lock: null,
      },
      "LOCK_REQUIRED"
    );
  }

  if (lock.user_id === input.context.userId) {
    return;
  }

  const holderName = await resolveDraftLockOwnerName(
    input.context.supabase,
    lock.user_id
  );

  throw conflict("Cette version est déjà verrouillée par un autre utilisateur.", {
    lock: {
      version_id: lock.version_id,
      user_id: lock.user_id,
      holder_name: holderName,
      locked_at: lock.locked_at,
      expires_at: lock.expires_at,
      is_owner: false,
    },
  });
}

async function getLearningConfig(
  context: Pick<AuthenticatedContext, "supabase" | "tenantId">
): Promise<SuggestionLearningConfig> {
  const flagKeys = [
    FEATURE_FLAG_LEARNING_ENABLED,
    FEATURE_FLAG_LEARNING_THRESHOLD,
    FEATURE_FLAG_LEARNING_RETENTION_MONTHS,
  ];

  const { data, error } = await context.supabase
    .from("feature_flags")
    .select("flag_key, enabled, value")
    .eq("tenant_id", context.tenantId)
    .in("flag_key", flagKeys);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la configuration d'apprentissage.");
  }

  const byKey = new Map<string, { enabled: boolean; value: string | null }>();

  (data ?? []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as { flag_key?: unknown; enabled?: unknown; value?: unknown };
    if (typeof row.flag_key !== "string") return;

    byKey.set(row.flag_key, {
      enabled: parseFeatureFlagEnabled(row.enabled),
      value: typeof row.value === "string" ? row.value : null,
    });
  });

  const enabled = byKey.get(FEATURE_FLAG_LEARNING_ENABLED)?.enabled === true;

  const threshold = parseFlagInteger({
    value: byKey.get(FEATURE_FLAG_LEARNING_THRESHOLD)?.value ?? null,
    fallback: DEFAULT_LEARNING_THRESHOLD,
    min: 1,
    max: MAX_LEARNING_THRESHOLD,
  });

  const retentionMonths = parseFlagInteger({
    value: byKey.get(FEATURE_FLAG_LEARNING_RETENTION_MONTHS)?.value ?? null,
    fallback: DEFAULT_RETENTION_MONTHS,
    min: 1,
    max: MAX_RETENTION_MONTHS,
  });

  return {
    enabled,
    threshold,
    retention_months: retentionMonths,
  };
}

async function loadRuleIdsForVersion(input: {
  context: AuthenticatedContext;
  ownerUserId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_suggestion_rules")
    .select("id")
    .eq("tenant_id", input.context.tenantId)
    .eq("user_id", input.ownerUserId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les regles de suggestion.");
  }

  return (data ?? []).map((row) => row.id);
}

async function listLearnedProposals(input: {
  context: AuthenticatedContext;
  threshold: number;
  includeInactive: boolean;
  ruleIds?: string[];
}) {
  const { data, error } = await input.context.supabase.rpc("get_suggestion_learnings", {
    target_tenant_id: input.context.tenantId,
    threshold: input.threshold,
    include_inactive: input.includeInactive,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les apprentissages.");
  }

  const normalized = (data ?? [])
    .map((row) => toLearningProposal(row))
    .filter((row): row is SuggestionLearningProposal => row !== null);

  const ruleIdFilter =
    Array.isArray(input.ruleIds) && input.ruleIds.length > 0
      ? new Set(input.ruleIds)
      : null;

  if (!ruleIdFilter) {
    return normalized;
  }

  return normalized.filter((row) => ruleIdFilter.has(row.rule_id));
}

function buildLearningState(input: {
  config: SuggestionLearningConfig;
  proposals: SuggestionLearningProposal[];
}) {
  return {
    config: input.config,
    proposals: input.proposals,
    by_rule_id: applyLearningBoost({ proposals: input.proposals }),
  } satisfies SuggestionLearningState;
}

async function assertTenantAdmin(context: AuthenticatedContext) {
  if (isTenantAdmin(context.tenantRole)) {
    return;
  }

  throw forbidden("Acces reserve aux administrateurs du tenant.");
}

export async function getLearnings(input: {
  versionId?: string;
  includeInactive?: boolean;
  adminOnly?: boolean;
}) {
  const context = await getAuthenticatedContext();

  if (input.adminOnly) {
    await assertTenantAdmin(context);
  }

  const config = await getLearningConfig(context);
  const includeInactive = input.includeInactive === true;

  if (!includeInactive && !config.enabled) {
    return buildLearningState({
      config,
      proposals: [],
    });
  }

  let scopedRuleIds: string[] | undefined;

  if (input.versionId) {
    const { project } = await getVersionAccessOrThrow(context, input.versionId);
    scopedRuleIds = await loadRuleIdsForVersion({
      context,
      ownerUserId: project.user_id,
    });

    if (scopedRuleIds.length === 0) {
      return buildLearningState({
        config,
        proposals: [],
      });
    }
  }

  const proposals = await listLearnedProposals({
    context,
    threshold: config.threshold,
    includeInactive,
    ruleIds: scopedRuleIds,
  });

  return buildLearningState({
    config,
    proposals,
  });
}

async function loadAllowedRuleIdsForTracking(input: {
  context: AuthenticatedContext;
  ownerUserId: string;
  ruleIds: string[];
}) {
  const uniqueRuleIds = [...new Set(input.ruleIds)];
  if (uniqueRuleIds.length === 0) return new Set<string>();

  const { data, error } = await input.context.supabase
    .from("estimate_suggestion_rules")
    .select("id")
    .eq("tenant_id", input.context.tenantId)
    .eq("user_id", input.ownerUserId)
    .in("id", uniqueRuleIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier les regles de suggestion.");
  }

  return new Set((data ?? []).map((row) => row.id));
}

export async function trackCorrection(input: {
  versionId: string;
  corrections: SuggestionCorrectionInput[];
}): Promise<TrackCorrectionsResult> {
  const context = await getAuthenticatedContext();
  const config = await getLearningConfig(context);

  if (!config.enabled) {
    return {
      ...buildLearningState({
        config,
        proposals: [],
      }),
      tracked_count: 0,
    };
  }

  const { version, project } = await getVersionAccessOrThrow(context, input.versionId);
  assertDraftStatus(version.status);

  await assertDraftLockOwnedByCurrentUser({
    context,
    versionId: input.versionId,
  });

  const allowedRuleIds = await loadAllowedRuleIdsForTracking({
    context,
    ownerUserId: project.user_id,
    ruleIds: input.corrections.map((correction) => correction.rule_id),
  });

  if (allowedRuleIds.size === 0) {
    return {
      ...buildLearningState({
        config,
        proposals: [],
      }),
      tracked_count: 0,
    };
  }

  const rows = input.corrections
    .map((correction) => {
      if (!allowedRuleIds.has(correction.rule_id)) {
        return null;
      }

      if (!TRACKED_FIELD_SET.has(correction.field_name)) {
        return null;
      }

      const originalValue = normalizeTextValue(correction.original_value);
      const correctedValue = normalizeTextValue(correction.corrected_value);

      if (originalValue === correctedValue) {
        return null;
      }

      const itemTitle = correction.item_title.trim();
      return {
        tenant_id: context.tenantId,
        rule_id: correction.rule_id,
        field_name: correction.field_name,
        original_value: originalValue,
        corrected_value: correctedValue,
        item_title: itemTitle,
        user_id: context.userId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length > 0) {
    const { error } = await context.supabase
      .from("suggestion_corrections")
      .insert(rows);

    if (error) {
      throw mapSupabaseError(error, "Impossible d'enregistrer les corrections de suggestion.");
    }
  }

  const proposals = await listLearnedProposals({
    context,
    threshold: config.threshold,
    includeInactive: false,
    ruleIds: Array.from(allowedRuleIds),
  });

  return {
    ...buildLearningState({
      config,
      proposals,
    }),
    tracked_count: rows.length,
  };
}

async function loadExistingReview(input: {
  context: AuthenticatedContext;
  ruleId: string;
  fieldName: SuggestionLearningFieldName;
  correctedValue: string | null;
}) {
  let query = input.context.supabase
    .from("suggestion_learning_reviews")
    .select("id")
    .eq("tenant_id", input.context.tenantId)
    .eq("rule_id", input.ruleId)
    .eq("field_name", input.fieldName);

  query =
    input.correctedValue === null
      ? query.is("corrected_value", null)
      : query.eq("corrected_value", input.correctedValue);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la revue d'apprentissage.");
  }

  return data;
}

export async function reviewLearning(input: {
  ruleId: string;
  fieldName: SuggestionLearningFieldName;
  correctedValue: string | null;
  action: ReviewLearningAction;
}) {
  const context = await getAuthenticatedContext();
  await assertTenantAdmin(context);

  const normalizedCorrectedValue = normalizeTextValue(input.correctedValue);

  if (input.action === "reset") {
    let deleteQuery = context.supabase
      .from("suggestion_learning_reviews")
      .delete()
      .eq("tenant_id", context.tenantId)
      .eq("rule_id", input.ruleId)
      .eq("field_name", input.fieldName);

    deleteQuery =
      normalizedCorrectedValue === null
        ? deleteQuery.is("corrected_value", null)
        : deleteQuery.eq("corrected_value", normalizedCorrectedValue);

    const { error } = await deleteQuery;

    if (error) {
      throw mapSupabaseError(error, "Impossible de reinitialiser la revue.");
    }
  } else {
    const status = input.action === "approve" ? "approved" : "rejected";

    const existing = await loadExistingReview({
      context,
      ruleId: input.ruleId,
      fieldName: input.fieldName,
      correctedValue: normalizedCorrectedValue,
    });

    if (existing?.id) {
      const { error } = await context.supabase
        .from("suggestion_learning_reviews")
        .update({
          status,
          decided_by: context.userId,
          decided_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("tenant_id", context.tenantId);

      if (error) {
        throw mapSupabaseError(error, "Impossible d'enregistrer la revue.");
      }
    } else {
      const { error } = await context.supabase
        .from("suggestion_learning_reviews")
        .insert({
          tenant_id: context.tenantId,
          rule_id: input.ruleId,
          field_name: input.fieldName,
          corrected_value: normalizedCorrectedValue,
          status,
          decided_by: context.userId,
          decided_at: new Date().toISOString(),
        });

      if (error) {
        throw mapSupabaseError(error, "Impossible d'enregistrer la revue.");
      }
    }
  }

  return getLearnings({
    includeInactive: true,
    adminOnly: true,
  });
}

export async function purgeLearnings(input?: {
  retentionMonths?: number;
}) {
  const context = await getAuthenticatedContext();
  await assertTenantAdmin(context);

  const config = await getLearningConfig(context);
  const retentionMonths =
    typeof input?.retentionMonths === "number" && Number.isFinite(input.retentionMonths)
      ? Math.max(1, Math.min(MAX_RETENTION_MONTHS, Math.trunc(input.retentionMonths)))
      : config.retention_months;

  const { data, error } = await context.supabase.rpc("purge_suggestion_corrections", {
    target_tenant_id: context.tenantId,
    retention_months: retentionMonths,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de purger l'historique d'apprentissage.");
  }

  const deletedCount =
    typeof data === "number" && Number.isFinite(data) ? Math.max(0, Math.trunc(data)) : 0;

  const refreshed = await getLearnings({
    includeInactive: true,
    adminOnly: true,
  });

  return {
    deleted_count: deletedCount,
    retention_months: retentionMonths,
    ...refreshed,
  };
}

export function assertTrackedFieldName(value: string): SuggestionLearningFieldName {
  const parsed = suggestionLearningFieldSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("field_name invalide.");
  }

  return parsed.data;
}
