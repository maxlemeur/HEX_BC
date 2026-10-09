"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";
import useSWR from "swr";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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

function getStatusBadge(proposal: SuggestionLearningProposal): {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
} {
  if (proposal.review_status === "approved") return { label: "Validée", variant: "success" };
  if (proposal.review_status === "rejected") return { label: "Rejetée", variant: "danger" };
  if (!proposal.is_active) return { label: "Inactive", variant: "neutral" };
  return { label: "À traiter", variant: "accent" };
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
    throw new Error(resolveErrorMessage(payload, "Impossible de charger l'apprentissage des suggestions."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse de l'apprentissage des suggestions invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningState>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.proposals)) {
    throw new Error(resolveErrorMessage(payload, "Réponse de l'apprentissage des suggestions invalide."));
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
    throw new Error(resolveErrorMessage(payload, "Impossible de charger les fonctionnalités."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse des fonctionnalités invalide.");
  }

  const envelope = payload as ApiEnvelope<FeatureFlagsResponse>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.flags)) {
    throw new Error(resolveErrorMessage(payload, "Réponse des fonctionnalités invalide."));
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
    throw new Error(resolveErrorMessage(payload, "Impossible de mettre à jour la revue."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse de l'apprentissage des suggestions invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningState>;
  if (!envelope.ok || !envelope.data || !Array.isArray(envelope.data.proposals)) {
    throw new Error(resolveErrorMessage(payload, "Réponse de l'apprentissage des suggestions invalide."));
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
    throw new Error(resolveErrorMessage(payload, "Impossible de mettre à jour la fonctionnalité."));
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse des fonctionnalités invalide.");
  }

  const envelope = payload as ApiEnvelope<{ flag: FeatureFlagRecord }>;
  if (!envelope.ok || !envelope.data?.flag) {
    throw new Error(resolveErrorMessage(payload, "Réponse des fonctionnalités invalide."));
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
      resolveErrorMessage(payload, "Impossible de purger les corrections apprises.")
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse de l'apprentissage des suggestions invalide.");
  }

  const envelope = payload as ApiEnvelope<SuggestionLearningPurgeResult>;
  if (
    !envelope.ok ||
    !envelope.data ||
    typeof envelope.data.deleted_count !== "number" ||
    !Array.isArray(envelope.data.proposals)
  ) {
    throw new Error(resolveErrorMessage(payload, "Réponse de l'apprentissage des suggestions invalide."));
  }

  return envelope.data;
}

export function SuggestionLearningAdminClient({
  tenantId,
}: Readonly<{ tenantId: string }>) {
  const confirm = useConfirm();
  const fieldId = useId();
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

    const confirmed = await confirm({
      title: `Supprimer définitivement les corrections apprises de plus de ${retentionMonths} mois ?`,
      description: "Cette action est irréversible.",
      confirmLabel: "Purger",
      tone: "danger",
    });
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
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Apprentissage des suggestions" },
        ]}
        title="Apprentissage des suggestions"
        description="Administrez les corrections apprises et la configuration de l'organisation."
        actions={
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            leftIcon={<RefreshCwIcon aria-hidden="true" />}
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Actualisation…" : "Actualiser"}
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
        {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}

        <PageSection
          title="Configuration de l'organisation"
          description="Les paramètres sont stockés dans les fonctionnalités de l'organisation."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Activer l&apos;apprentissage
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Fonctionnalité{" "}
                    <code className="[overflow-wrap:anywhere] font-mono">
                      {FEATURE_FLAG_LEARNING_ENABLED}
                    </code>
                  </p>
                </div>
                <Badge variant={config.enabled ? "success" : "neutral"} dot>
                  {config.enabled ? "Actif" : "Inactif"}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-threshold`}>Seuil N</FieldLabel>
                  <Input
                    id={`${fieldId}-threshold`}
                    type="number"
                    min={MIN_THRESHOLD}
                    max={MAX_THRESHOLD}
                    value={thresholdDraft}
                    onChange={(event) => setThresholdDraft(event.target.value)}
                    disabled={isConfigSaving}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor={`${fieldId}-retention`}>Rétention (mois)</FieldLabel>
                  <Input
                    id={`${fieldId}-retention`}
                    type="number"
                    min={MIN_RETENTION_MONTHS}
                    max={MAX_RETENTION_MONTHS}
                    value={retentionMonthsDraft}
                    onChange={(event) => setRetentionMonthsDraft(event.target.value)}
                    disabled={isConfigSaving}
                  />
                </Field>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                variant={config.enabled ? "danger" : "primary"}
                size="lg"
                onClick={() => void handleToggleLearning()}
                disabled={isConfigSaving || isPurging}
              >
                {config.enabled
                  ? "Désactiver l'apprentissage"
                  : "Activer l'apprentissage"}
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => void handleSaveConfig()}
                disabled={isConfigSaving || isPurging}
              >
                {isConfigSaving
                  ? "Enregistrement…"
                  : "Enregistrer le seuil et la rétention"}
              </Button>
              <Button
                variant="danger"
                size="lg"
                onClick={() => void handlePurge()}
                disabled={isConfigSaving || isPurging}
              >
                {isPurging ? "Purge…" : "Purger"}
              </Button>
            </div>
          </div>
        </PageSection>

        <PageSection title="Corrections apprises" flush>
          {isLoading ? (
            <LoadingState label="Chargement des corrections apprises…" className="min-h-60" />
          ) : loadError ? (
            <div className="p-4 sm:p-5">
              <Alert variant="danger">{loadError}</Alert>
            </div>
          ) : (
            <div
              role="region"
              aria-label="Corrections apprises"
              tabIndex={0}
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Règle</th>
                    <th scope="col">Champ</th>
                    <th scope="col">Valeur originale (exemple)</th>
                    <th scope="col">Valeur corrigée</th>
                    <th scope="col">Occurrences</th>
                    <th scope="col">Statut</th>
                    <th scope="col">Dernière occurrence</th>
                    <th scope="col" className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.length === 0 ? (
                    <EmptyTableRow
                      colSpan={8}
                      icon={<SparklesIcon />}
                      title="Aucune suggestion apprise"
                      description="Les corrections répétées des chiffreurs de l'organisation apparaîtront ici."
                    />
                  ) : (
                    proposals.map((proposal) => {
                      const proposalKey = getProposalKey(proposal);
                      const isUpdatingRow = activeRowKey === proposalKey;
                      const status = getStatusBadge(proposal);

                      return (
                        <tr key={proposalKey}>
                          <td className="font-mono text-xs text-foreground-secondary">
                            {proposal.rule_id}
                          </td>
                          <td>{FIELD_LABELS[proposal.field_name]}</td>
                          <td>
                            <div className="space-y-1">
                              <p>{proposal.sample_original_value ?? "—"}</p>
                              {proposal.sample_item_title ? (
                                <p className="text-xs text-muted-foreground">
                                  Ligne : {proposal.sample_item_title}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td>{proposal.corrected_value ?? "(vide)"}</td>
                          <td className="tabular-nums">{proposal.correction_count}</td>
                          <td>
                            <Badge variant={status.variant} dot>
                              {status.label}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap">{formatDateTime(proposal.last_seen_at)}</td>
                          <td>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="primary"
                                size="md"
                                onClick={() => void handleReview(proposal, "approve")}
                                disabled={isUpdatingRow}
                              >
                                Valider
                              </Button>
                              <Button
                                variant="danger"
                                size="md"
                                onClick={() => void handleReview(proposal, "reject")}
                                disabled={isUpdatingRow}
                              >
                                Rejeter
                              </Button>
                              <Button
                                variant="outline"
                                size="md"
                                onClick={() => void handleReview(proposal, "reset")}
                                disabled={isUpdatingRow}
                              >
                                Réinitialiser
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </PageSection>
      </div>
    </div>
  );
}
