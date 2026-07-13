"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

type SuggestionLearningFieldName =
  | "description"
  | "category_id"
  | "k_fo"
  | "k_mo"
  | "labor_role_id"
  | "supply_type_id";
type SuggestionLearningReviewStatus = "approved" | "rejected";

type SuggestionLearningProposal = {
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

type SuggestionLearningConfig = {
  enabled: boolean;
  threshold: number;
  retention_months: number;
};

type SuggestionLearningState = {
  config: SuggestionLearningConfig;
  proposals: SuggestionLearningProposal[];
  by_rule_id: Record<string, unknown>;
};

type SuggestionLearningPurgeResult = SuggestionLearningState & {
  deleted_count: number;
  retention_months: number;
};

type FeatureFlagRecord = {
  tenant_id: string;
  flag_key: string;
  enabled: boolean;
  value: string | null;
};

type FeatureFlagsResponse = {
  tenant_id: string;
  flags: FeatureFlagRecord[];
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

type ReviewLearningAction = "approve" | "reject" | "reset";

const FEATURE_FLAG_LEARNING_ENABLED = "EST_163_SUGGESTION_LEARNING";
const FEATURE_FLAG_LEARNING_THRESHOLD = "EST_163_SUGGESTION_LEARNING_THRESHOLD";
const FEATURE_FLAG_LEARNING_RETENTION_MONTHS =
  "EST_163_SUGGESTION_LEARNING_RETENTION_MONTHS";

const DEFAULT_THRESHOLD = 3;
const DEFAULT_RETENTION_MONTHS = 12;
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 100;
const MIN_RETENTION_MONTHS = 1;
const MAX_RETENTION_MONTHS = 120;

const FIELD_LABELS: Record<SuggestionLearningFieldName, string> = {
  description: "Description",
  category_id: "Catégorie",
  k_fo: "K FO",
  k_mo: "K MO",
  labor_role_id: "Rôle MO",
  supply_type_id: "Type fourniture",
};

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const envelope = payload as ApiEnvelope<unknown>;
  return envelope.error?.message ?? fallback;
}

function normalizeFeatureFlagKey(value: string) {
  return value.trim().toUpperCase();
}

function getFeatureFlag(flags: FeatureFlagRecord[], key: string) {
  const normalizedKey = normalizeFeatureFlagKey(key);
  return (
    flags.find((flag) => normalizeFeatureFlagKey(flag.flag_key) === normalizedKey) ??
    null
  );
}

function parseFlagIntegerValue(input: {
  value: string | null | undefined;
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

function parseRequiredIntegerInput(input: {
  value: string;
  label: string;
  min: number;
  max: number;
}) {
  const parsed = Number.parseInt(input.value.trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${input.label} invalide.`);
  }

  const normalized = Math.trunc(parsed);
  if (normalized < input.min || normalized > input.max) {
    throw new Error(
      `${input.label} doit être compris entre ${input.min} et ${input.max}.`
    );
  }

  return normalized;
}

function resolveLearningConfig(input: {
  flags: FeatureFlagRecord[];
  fallback?: SuggestionLearningConfig;
}) {
  const enabledFlag = getFeatureFlag(input.flags, FEATURE_FLAG_LEARNING_ENABLED);
  const thresholdFlag = getFeatureFlag(input.flags, FEATURE_FLAG_LEARNING_THRESHOLD);
  const retentionFlag = getFeatureFlag(
    input.flags,
    FEATURE_FLAG_LEARNING_RETENTION_MONTHS
  );

  return {
    enabled: enabledFlag?.enabled ?? input.fallback?.enabled ?? false,
    threshold: parseFlagIntegerValue({
      value: thresholdFlag?.value,
      fallback: input.fallback?.threshold ?? DEFAULT_THRESHOLD,
      min: MIN_THRESHOLD,
      max: MAX_THRESHOLD,
    }),
    retention_months: parseFlagIntegerValue({
      value: retentionFlag?.value,
      fallback: input.fallback?.retention_months ?? DEFAULT_RETENTION_MONTHS,
      min: MIN_RETENTION_MONTHS,
      max: MAX_RETENTION_MONTHS,
    }),
  } satisfies SuggestionLearningConfig;
}

function upsertFlagInResponse(input: {
  current: FeatureFlagsResponse | undefined;
  tenantId: string;
  flag: FeatureFlagRecord;
}) {
  const currentFlags = input.current?.flags ?? [];
  const normalizedTarget = normalizeFeatureFlagKey(input.flag.flag_key);
  const existingIndex = currentFlags.findIndex(
    (entry) => normalizeFeatureFlagKey(entry.flag_key) === normalizedTarget
  );

  const nextFlags = [...currentFlags];
  if (existingIndex >= 0) {
    nextFlags[existingIndex] = input.flag;
  } else {
    nextFlags.push(input.flag);
  }

  nextFlags.sort((left, right) => left.flag_key.localeCompare(right.flag_key));

  return {
    tenant_id: input.current?.tenant_id ?? input.tenantId,
    flags: nextFlags,
  } satisfies FeatureFlagsResponse;
}

function getProposalKey(proposal: SuggestionLearningProposal) {
  return `${proposal.rule_id}:${proposal.field_name}:${proposal.corrected_value ?? "__null__"}`;
}

function getStatusLabel(proposal: SuggestionLearningProposal) {
  if (proposal.review_status === "approved") return "Validée";
  if (proposal.review_status === "rejected") return "Rejetée";
  if (!proposal.is_active) return "Inactive";
  return "À traiter";
}

function getStatusClass(proposal: SuggestionLearningProposal) {
  if (proposal.review_status === "approved") {
    return "inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]";
  }

  if (proposal.review_status === "rejected") {
    return "inline-flex items-center rounded-full bg-[var(--danger-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--danger)]";
  }

  if (!proposal.is_active) {
    return "inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]";
  }

  return "inline-flex items-center rounded-full bg-[var(--brand-orange-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-orange)]";
}

function formatDateTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

async function fetchSuggestionLearnings(route: string): Promise<SuggestionLearningState> {
  const response = await fetch(route, {
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de charger suggestion learning."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse suggestion learning invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningState>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.proposals)) {
    throw new Error(resolveErrorMessage(payload, "Reponse suggestion learning invalide."));
  }

  return envelope.data;
}

async function fetchFeatureFlags([
  route,
  tenantId,
]: readonly [string, string]): Promise<FeatureFlagsResponse> {
  const query = new URLSearchParams({
    tenant_id: tenantId,
    include_inactive: "true",
  }).toString();

  const response = await fetch(`${route}?${query}`, {
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de charger les feature flags."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse feature flags invalide.");
  }

  const envelope = payload as ApiEnvelope<FeatureFlagsResponse>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.flags)) {
    throw new Error(resolveErrorMessage(payload, "Reponse feature flags invalide."));
  }

  return envelope.data;
}

async function patchReview(input: {
  ruleId: string;
  fieldName: SuggestionLearningFieldName;
  correctedValue: string | null;
  action: ReviewLearningAction;
}) {
  const response = await fetch("/api/admin/suggestion-learning", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rule_id: input.ruleId,
      field_name: input.fieldName,
      corrected_value: input.correctedValue,
      action: input.action,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de mettre a jour la revue."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse suggestion learning invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningState>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.proposals)) {
    throw new Error(resolveErrorMessage(payload, "Reponse suggestion learning invalide."));
  }

  return envelope.data;
}

async function patchFeatureFlag(input: {
  tenantId: string;
  flagKey: string;
  enabled: boolean;
  value?: string | null;
}) {
  const requestBody: {
    tenant_id: string;
    flag_key: string;
    enabled: boolean;
    value?: string | null;
  } = {
    tenant_id: input.tenantId,
    flag_key: input.flagKey,
    enabled: input.enabled,
  };

  if ("value" in input) {
    requestBody.value = input.value ?? null;
  }

  const response = await fetch("/api/feature-flags", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de mettre a jour le feature flag."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse feature flags invalide.");
  }

  const envelope = payload as ApiEnvelope<{ flag: FeatureFlagRecord }>;
  if (!envelope.ok || !envelope.data?.flag) {
    throw new Error(resolveErrorMessage(payload, "Reponse feature flags invalide."));
  }

  return envelope.data.flag;
}

async function purgeSuggestionLearning(input: { retentionMonths: number }) {
  const response = await fetch("/api/admin/suggestion-learning/purge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      retention_months: input.retentionMonths,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveErrorMessage(payload, "Impossible de purger les donnees suggestion learning.")
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Reponse suggestion learning invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningPurgeResult>;
  if (
    !envelope.ok ||
    !envelope.data ||
    typeof envelope.data.deleted_count !== "number" ||
    !Array.isArray(envelope.data.proposals)
  ) {
    throw new Error(resolveErrorMessage(payload, "Reponse suggestion learning invalide."));
  }

  return envelope.data;
}

export function SuggestionLearningAdminClient({
  tenantId,
}: Readonly<{ tenantId: string }>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [retentionMonthsDraft, setRetentionMonthsDraft] = useState("");

  const {
    data: learningData,
    error: learningError,
    isLoading: isLearningLoading,
    isValidating: isLearningValidating,
    mutate: mutateLearning,
  } = useSWR<SuggestionLearningState>(
    "/api/admin/suggestion-learning",
    fetchSuggestionLearnings
  );

  const {
    data: featureFlagsData,
    error: featureFlagsError,
    isLoading: isFeatureFlagsLoading,
    isValidating: isFeatureFlagsValidating,
    mutate: mutateFeatureFlags,
  } = useSWR<FeatureFlagsResponse>(["/api/feature-flags", tenantId] as const, fetchFeatureFlags);

  const config = useMemo(
    () =>
      resolveLearningConfig({
        flags: featureFlagsData?.flags ?? [],
        fallback: learningData?.config,
      }),
    [featureFlagsData?.flags, learningData?.config]
  );

  const proposals = useMemo(() => {
    const rows = [...(learningData?.proposals ?? [])];

    rows.sort((left, right) => {
      if (right.correction_count !== left.correction_count) {
        return right.correction_count - left.correction_count;
      }

      const leftTimestamp = Date.parse(left.last_seen_at);
      const rightTimestamp = Date.parse(right.last_seen_at);
      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
        return rightTimestamp - leftTimestamp;
      }

      return 0;
    });

    return rows;
  }, [learningData?.proposals]);

  useEffect(() => {
    setThresholdDraft(String(config.threshold));
    setRetentionMonthsDraft(String(config.retention_months));
  }, [config.threshold, config.retention_months]);

  const loadError =
    learningError instanceof Error
      ? learningError.message
      : featureFlagsError instanceof Error
        ? featureFlagsError.message
        : null;
  const isRefreshing = isLearningValidating || isFeatureFlagsValidating;
  const isLoading = isLearningLoading || isFeatureFlagsLoading;

  function startAction() {
    setActionError(null);
    setSuccessMessage(null);
  }

  async function handleRefresh() {
    startAction();

    try {
      await Promise.all([mutateLearning(), mutateFeatureFlags()]);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible d'actualiser les données."
      );
    }
  }

  async function handleReview(proposal: SuggestionLearningProposal, action: ReviewLearningAction) {
    const rowKey = getProposalKey(proposal);
    setActiveRowKey(rowKey);
    startAction();

    try {
      const updated = await patchReview({
        ruleId: proposal.rule_id,
        fieldName: proposal.field_name,
        correctedValue: proposal.corrected_value,
        action,
      });

      await mutateLearning(updated, { revalidate: false });

      const actionLabel =
        action === "approve" ? "validée" : action === "reject" ? "rejetée" : "réinitialisée";
      setSuccessMessage(`Suggestion ${actionLabel}.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de mettre à jour la revue."
      );
    } finally {
      setActiveRowKey(null);
    }
  }

  async function handleToggleLearning() {
    setIsConfigSaving(true);
    startAction();

    try {
      const updatedFlag = await patchFeatureFlag({
        tenantId,
        flagKey: FEATURE_FLAG_LEARNING_ENABLED,
        enabled: !config.enabled,
      });

      await mutateFeatureFlags(
        (current) =>
          upsertFlagInResponse({
            current,
            tenantId,
            flag: updatedFlag,
          }),
        { revalidate: false }
      );
      await mutateLearning();

      setSuccessMessage(`Apprentissage ${updatedFlag.enabled ? "activé" : "désactivé"}.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de mettre à jour la configuration."
      );
    } finally {
      setIsConfigSaving(false);
    }
  }

  async function handleSaveConfig() {
    setIsConfigSaving(true);
    startAction();

    try {
      const threshold = parseRequiredIntegerInput({
        value: thresholdDraft,
        label: "Le seuil",
        min: MIN_THRESHOLD,
        max: MAX_THRESHOLD,
      });
      const retentionMonths = parseRequiredIntegerInput({
        value: retentionMonthsDraft,
        label: "La rétention",
        min: MIN_RETENTION_MONTHS,
        max: MAX_RETENTION_MONTHS,
      });

      const [thresholdFlag, retentionFlag] = await Promise.all([
        patchFeatureFlag({
          tenantId,
          flagKey: FEATURE_FLAG_LEARNING_THRESHOLD,
          enabled: true,
          value: String(threshold),
        }),
        patchFeatureFlag({
          tenantId,
          flagKey: FEATURE_FLAG_LEARNING_RETENTION_MONTHS,
          enabled: true,
          value: String(retentionMonths),
        }),
      ]);

      await mutateFeatureFlags(
        (current) => {
          const afterThreshold = upsertFlagInResponse({
            current,
            tenantId,
            flag: thresholdFlag,
          });

          return upsertFlagInResponse({
            current: afterThreshold,
            tenantId,
            flag: retentionFlag,
          });
        },
        { revalidate: false }
      );
      await mutateLearning();

      setSuccessMessage("Configuration de l'apprentissage mise à jour.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de mettre à jour la configuration."
      );
    } finally {
      setIsConfigSaving(false);
    }
  }

  async function handlePurge() {
    startAction();

    let retentionMonths: number;
    try {
      retentionMonths = parseRequiredIntegerInput({
        value: retentionMonthsDraft,
        label: "La rétention",
        min: MIN_RETENTION_MONTHS,
        max: MAX_RETENTION_MONTHS,
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "La rétention est invalide."
      );
      return;
    }

    const confirmed = window.confirm(
      `Supprimer définitivement les corrections apprises de plus de ${retentionMonths} mois ? Cette action est irréversible.`
    );
    if (!confirmed) return;

    setIsPurging(true);
    try {
      const purgeResult = await purgeSuggestionLearning({ retentionMonths });
      await mutateLearning(purgeResult, { revalidate: false });

      setSuccessMessage(`${purgeResult.deleted_count} correction(s) purgée(s).`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de purger l'historique."
      );
    } finally {
      setIsPurging(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Apprentissage des suggestions</h1>
          <p className="page-description">
            Administrez les corrections apprises et la configuration de l&apos;organisation.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary w-full sm:w-auto"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {actionError ? (
        <div className="alert alert-error mb-6" role="alert">
          {actionError}
        </div>
      ) : null}
      {successMessage ? (
        <div className="alert alert-success mb-6" role="status" aria-live="polite">
          {successMessage}
        </div>
      ) : null}

      <section className="dashboard-card p-5 mb-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--slate-900)]">
            Configuration de l&apos;organisation
          </h2>
          <p className="text-sm text-[var(--slate-500)]">
            Les paramètres sont stockés dans les fonctionnalités de l&apos;organisation.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--slate-200)] p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--slate-900)]">
                    Activer l&apos;apprentissage
                  </p>
                  <p className="text-xs text-[var(--slate-500)]">
                    Flag {FEATURE_FLAG_LEARNING_ENABLED}
                  </p>
                </div>
                <span
                  className={
                    config.enabled
                      ? "inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]"
                      : "inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]"
                  }
                >
                  {config.enabled ? "Actif" : "Inactif"}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="form-label">
                Seuil N
                <input
                  type="number"
                  min={MIN_THRESHOLD}
                  max={MAX_THRESHOLD}
                  className="form-input mt-1"
                  value={thresholdDraft}
                  onChange={(event) => setThresholdDraft(event.target.value)}
                  disabled={isConfigSaving}
                />
              </label>

              <label className="form-label">
                Rétention (mois)
                <input
                  type="number"
                  min={MIN_RETENTION_MONTHS}
                  max={MAX_RETENTION_MONTHS}
                  className="form-input mt-1"
                  value={retentionMonthsDraft}
                  onChange={(event) => setRetentionMonthsDraft(event.target.value)}
                  disabled={isConfigSaving}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={config.enabled ? "btn btn-danger" : "btn btn-primary"}
              onClick={() => void handleToggleLearning()}
              disabled={isConfigSaving || isPurging}
            >
              {config.enabled
                ? "Désactiver l'apprentissage"
                : "Activer l'apprentissage"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSaveConfig()}
              disabled={isConfigSaving || isPurging}
            >
              {isConfigSaving
                ? "Enregistrement..."
                : "Enregistrer le seuil et la rétention"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handlePurge()}
              disabled={isConfigSaving || isPurging}
            >
              {isPurging ? "Purge..." : "Purger"}
            </button>
          </div>
        </div>
      </section>

      <section className="dashboard-card overflow-hidden">
        <div className="table-scroll">
          {isLoading ? (
            <div className="animate-fade-in flex min-h-[260px] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                <span className="text-[var(--slate-500)]">Chargement...</span>
              </div>
            </div>
          ) : loadError ? (
            <div className="p-5">
              <div className="alert alert-error">{loadError}</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Règle</th>
                  <th>Champ</th>
                  <th>Valeur originale échantillon</th>
                  <th>Valeur corrigée</th>
                  <th>Occurrences</th>
                  <th>Statut</th>
                  <th>Dernière occurrence</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proposals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[var(--slate-500)]">
                      Aucune suggestion apprise pour le tenant.
                    </td>
                  </tr>
                ) : (
                  proposals.map((proposal) => {
                    const proposalKey = getProposalKey(proposal);
                    const isUpdatingRow = activeRowKey === proposalKey;

                    return (
                      <tr key={proposalKey}>
                        <td className="font-mono text-xs text-[var(--slate-700)]">
                          {proposal.rule_id}
                        </td>
                        <td>{FIELD_LABELS[proposal.field_name]}</td>
                        <td>
                          <div className="space-y-1">
                            <p>{proposal.sample_original_value ?? "-"}</p>
                            {proposal.sample_item_title ? (
                              <p className="text-xs text-[var(--slate-500)]">
                                Item: {proposal.sample_item_title}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td>{proposal.corrected_value ?? "(vide)"}</td>
                        <td>{proposal.correction_count}</td>
                        <td>
                          <span className={getStatusClass(proposal)}>
                            {getStatusLabel(proposal)}
                          </span>
                        </td>
                        <td>{formatDateTime(proposal.last_seen_at)}</td>
                        <td>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => void handleReview(proposal, "approve")}
                              disabled={isUpdatingRow}
                            >
                              Valider
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => void handleReview(proposal, "reject")}
                              disabled={isUpdatingRow}
                            >
                              Rejeter
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => void handleReview(proposal, "reset")}
                              disabled={isUpdatingRow}
                            >
                              Réinitialiser
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
