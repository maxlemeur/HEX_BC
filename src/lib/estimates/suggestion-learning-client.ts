import { type JsonRecord, toNumber, toBooleanValue, hasOwnProperty, getRootPayload, pickRecord, pickArray, parseOptionalNullableStringProperty } from "@/lib/estimates/client-json";
import { requestJson } from "@/lib/estimates/client-requests";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export type SuggestionLearningFieldName =
  | "description"
  | "category_id"
  | "k_fo"
  | "k_mo"
  | "labor_role_id"
  | "supply_type_id";

export type SuggestionLearningReviewStatus = "approved" | "rejected";

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

export type SuggestionLearningRuleOverrides = {
  description?: string | null;
  category_id?: string | null;
  k_fo?: number | null;
  k_mo?: number | null;
  labor_role_id?: string | null;
  supply_type_id?: string | null;
};

export type SuggestionLearningRuleBoost = {
  rule_id: string;
  learning_boost: number;
  overrides: SuggestionLearningRuleOverrides;
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

export type TrackEstimateSuggestionCorrection = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  original_value?: string | null;
  corrected_value?: string | null;
  item_title?: string | null;
};

export type TrackEstimateSuggestionCorrectionsPayload = {
  corrections: TrackEstimateSuggestionCorrection[];
};

export type TrackEstimateSuggestionCorrectionsResult = SuggestionLearningState & {
  tracked_count: number;
};

export type ReviewAdminSuggestionLearningProposalPayload = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  corrected_value?: string | null;
  action: "approve" | "reject" | "reset";
};

export type PurgeAdminSuggestionLearningsPayload = {
  retention_months?: number;
};

export type PurgeAdminSuggestionLearningsResult = SuggestionLearningState & {
  deleted_count: number;
  retention_months: number;
};

const SUGGESTION_LEARNING_FIELDS: SuggestionLearningFieldName[] = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
];

function parseOptionalNullableNumberProperty(
  record: JsonRecord,
  keys: string[]
): number | null | undefined {
  for (const key of keys) {
    if (!hasOwnProperty(record, key)) continue;
    const value = record[key];
    if (value === null) return null;
    return toNumber(value);
  }

  return undefined;
}

function isSuggestionLearningFieldName(
  value: unknown
): value is SuggestionLearningFieldName {
  return (
    typeof value === "string" &&
    SUGGESTION_LEARNING_FIELDS.includes(value as SuggestionLearningFieldName)
  );
}

function parseSuggestionLearningProposal(
  value: unknown
): SuggestionLearningProposal | null {
  if (!isRecord(value)) return null;

  const ruleId = toNonEmptyString(value.rule_id) ?? toNonEmptyString(value.ruleId);
  const fieldNameRaw = toNonEmptyString(value.field_name) ?? toNonEmptyString(value.fieldName);
  const correctionCount =
    toNumber(value.correction_count) ?? toNumber(value.correctionCount);
  const firstSeenAt =
    toNonEmptyString(value.first_seen_at) ?? toNonEmptyString(value.firstSeenAt);
  const lastSeenAt =
    toNonEmptyString(value.last_seen_at) ?? toNonEmptyString(value.lastSeenAt);

  if (
    !ruleId ||
    !fieldNameRaw ||
    !isSuggestionLearningFieldName(fieldNameRaw) ||
    correctionCount === null ||
    !firstSeenAt ||
    !lastSeenAt
  ) {
    return null;
  }

  const correctedValueRaw =
    parseOptionalNullableStringProperty(value, [
      "corrected_value",
      "correctedValue",
    ]) ?? null;

  const reviewStatusRaw =
    toNonEmptyString(value.review_status) ?? toNonEmptyString(value.reviewStatus);
  const reviewStatus: SuggestionLearningReviewStatus | null =
    reviewStatusRaw === "approved" || reviewStatusRaw === "rejected"
      ? reviewStatusRaw
      : null;

  return {
    rule_id: ruleId,
    field_name: fieldNameRaw,
    corrected_value: correctedValueRaw,
    correction_count: Math.max(0, Math.trunc(correctionCount)),
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    review_status: reviewStatus,
    decided_by: toNonEmptyString(value.decided_by) ?? toNonEmptyString(value.decidedBy) ?? null,
    decided_at: toNonEmptyString(value.decided_at) ?? toNonEmptyString(value.decidedAt) ?? null,
    is_active: toBooleanValue(value.is_active) ?? toBooleanValue(value.isActive) ?? false,
    sample_original_value:
      toNonEmptyString(value.sample_original_value) ??
      toNonEmptyString(value.sampleOriginalValue) ??
      null,
    sample_item_title:
      toNonEmptyString(value.sample_item_title) ??
      toNonEmptyString(value.sampleItemTitle) ??
      null,
  };
}

function parseSuggestionLearningRuleOverrides(
  value: unknown
): SuggestionLearningRuleOverrides {
  if (!isRecord(value)) return {};

  const overrides: SuggestionLearningRuleOverrides = {};

  const description = parseOptionalNullableStringProperty(value, ["description"]);
  if (description !== undefined) {
    overrides.description = description;
  }

  const categoryId = parseOptionalNullableStringProperty(value, [
    "category_id",
    "categoryId",
  ]);
  if (categoryId !== undefined) {
    overrides.category_id = categoryId;
  }

  const kFo = parseOptionalNullableNumberProperty(value, ["k_fo", "kFo"]);
  if (kFo !== undefined) {
    overrides.k_fo = kFo;
  }

  const kMo = parseOptionalNullableNumberProperty(value, ["k_mo", "kMo"]);
  if (kMo !== undefined) {
    overrides.k_mo = kMo;
  }

  const laborRoleId = parseOptionalNullableStringProperty(value, [
    "labor_role_id",
    "laborRoleId",
  ]);
  if (laborRoleId !== undefined) {
    overrides.labor_role_id = laborRoleId;
  }

  const supplyTypeId = parseOptionalNullableStringProperty(value, [
    "supply_type_id",
    "supplyTypeId",
  ]);
  if (supplyTypeId !== undefined) {
    overrides.supply_type_id = supplyTypeId;
  }

  return overrides;
}

function parseSuggestionLearningRuleBoost(
  value: unknown,
  fallbackRuleId?: string
): SuggestionLearningRuleBoost | null {
  if (!isRecord(value)) return null;

  const ruleId =
    toNonEmptyString(value.rule_id) ??
    toNonEmptyString(value.ruleId) ??
    fallbackRuleId ??
    null;
  if (!ruleId) return null;

  const learningBoost =
    toNumber(value.learning_boost) ?? toNumber(value.learningBoost) ?? 0;

  const overrides = parseSuggestionLearningRuleOverrides(
    pickRecord(value, ["overrides"]) ?? {}
  );

  const fields = pickArray(value, ["fields", "proposals"])
    .map((entry) => parseSuggestionLearningProposal(entry))
    .filter((entry): entry is SuggestionLearningProposal => entry !== null);

  return {
    rule_id: ruleId,
    learning_boost: Math.max(0, learningBoost),
    overrides,
    fields,
  };
}

function parseSuggestionLearningConfig(value: unknown): SuggestionLearningConfig | null {
  const root = getRootPayload(value);
  if (!isRecord(root)) return null;

  const config = pickRecord(root, ["config", "learning_config", "learningConfig"]) ?? root;
  if (!isRecord(config)) return null;

  const enabled =
    toBooleanValue(config.enabled) ?? toBooleanValue(config.is_enabled);
  const threshold = toNumber(config.threshold);
  const retentionMonths =
    toNumber(config.retention_months) ?? toNumber(config.retentionMonths);

  if (enabled === null || threshold === null || retentionMonths === null) {
    return null;
  }

  return {
    enabled,
    threshold: Math.max(1, Math.trunc(threshold)),
    retention_months: Math.max(1, Math.trunc(retentionMonths)),
  };
}

function parseSuggestionLearningState(payload: unknown): SuggestionLearningState | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const config = parseSuggestionLearningConfig(root);
  if (!config) return null;

  const proposals = pickArray(root, ["proposals", "items"])
    .map((entry) => parseSuggestionLearningProposal(entry))
    .filter((entry): entry is SuggestionLearningProposal => entry !== null);

  const byRuleRoot = pickRecord(root, ["by_rule_id", "byRuleId"]);
  const byRuleId: Record<string, SuggestionLearningRuleBoost> = {};

  if (byRuleRoot) {
    Object.entries(byRuleRoot).forEach(([ruleId, value]) => {
      const parsed = parseSuggestionLearningRuleBoost(value, ruleId);
      if (!parsed) return;
      byRuleId[parsed.rule_id] = parsed;
    });
  }

  return {
    config,
    proposals,
    by_rule_id: byRuleId,
  };
}

function parseTrackEstimateSuggestionCorrectionsResult(
  payload: unknown
): TrackEstimateSuggestionCorrectionsResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const state = parseSuggestionLearningState(root);
  if (!state) return null;

  const trackedCount =
    toNumber(root.tracked_count) ?? toNumber(root.trackedCount);

  return {
    ...state,
    tracked_count:
      trackedCount !== null ? Math.max(0, Math.trunc(trackedCount)) : 0,
  };
}

function parsePurgeAdminSuggestionLearningsResult(
  payload: unknown
): PurgeAdminSuggestionLearningsResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const state = parseSuggestionLearningState(root);
  if (!state) return null;

  const deletedCount =
    toNumber(root.deleted_count) ?? toNumber(root.deletedCount);
  const retentionMonths =
    toNumber(root.retention_months) ??
    toNumber(root.retentionMonths) ??
    state.config.retention_months;

  return {
    ...state,
    deleted_count:
      deletedCount !== null ? Math.max(0, Math.trunc(deletedCount)) : 0,
    retention_months: Math.max(1, Math.trunc(retentionMonths)),
  };
}

export async function fetchEstimateSuggestionLearnings(
  versionId: string,
  options: { signal?: AbortSignal } = {}
): Promise<SuggestionLearningState> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-learning`,
    {
      method: "GET",
      signal: options.signal,
    },
    "Impossible de charger les apprentissages de suggestion."
  );

  const parsed = parseSuggestionLearningState(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les apprentissages de suggestion.");
  }

  return parsed;
}

export async function trackEstimateSuggestionCorrections(
  versionId: string,
  payload: TrackEstimateSuggestionCorrectionsPayload
): Promise<TrackEstimateSuggestionCorrectionsResult> {
  const result = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-learning`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible d'enregistrer les corrections d'apprentissage."
  );

  const parsed = parseTrackEstimateSuggestionCorrectionsResult(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de suivi des corrections.");
  }

  return parsed;
}

export async function fetchAdminSuggestionLearningProposals(): Promise<SuggestionLearningState> {
  const payload = await requestJson<unknown>(
    "/api/admin/suggestion-learning",
    {
      method: "GET",
    },
    "Impossible de charger les propositions d'apprentissage."
  );

  const parsed = parseSuggestionLearningState(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les propositions d'apprentissage.");
  }

  return parsed;
}

export async function reviewAdminSuggestionLearningProposal(
  payload: ReviewAdminSuggestionLearningProposalPayload
): Promise<SuggestionLearningState> {
  const result = await requestJson<unknown>(
    "/api/admin/suggestion-learning",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible de valider la proposition d'apprentissage."
  );

  const parsed = parseSuggestionLearningState(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de revue.");
  }

  return parsed;
}

export async function purgeAdminSuggestionLearnings(
  payload?: PurgeAdminSuggestionLearningsPayload
): Promise<PurgeAdminSuggestionLearningsResult> {
  const result = await requestJson<unknown>(
    "/api/admin/suggestion-learning/purge",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    },
    "Impossible de purger l'historique d'apprentissage."
  );

  const parsed = parsePurgeAdminSuggestionLearningsResult(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de purge.");
  }

  return parsed;
}
