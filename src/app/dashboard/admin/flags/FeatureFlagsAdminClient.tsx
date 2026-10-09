"use client";

import { useId, useMemo, useState } from "react";
import { FlagIcon, RefreshCwIcon } from "lucide-react";
import useSWR from "swr";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  error?: { message?: string };
};

type StatusFilter = "all" | "enabled" | "disabled";

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  return (payload as ApiEnvelope<unknown>).error?.message ?? fallback;
}

function normalizeFeatureFlagKey(value: string) {
  return value.trim().toUpperCase();
}

async function fetchFeatureFlags([
  route,
  tenantId,
]: readonly [string, string, "include-inactive"]): Promise<FeatureFlagsResponse> {
  const query = new URLSearchParams({
    tenant_id: tenantId,
    include_inactive: "true",
  }).toString();
  const response = await fetch(`${route}?${query}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      resolveErrorMessage(payload, "Impossible de charger les fonctionnalités.")
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse des fonctionnalités invalide.");
  }

  const envelope = payload as ApiEnvelope<FeatureFlagsResponse>;
  if (!envelope.ok || !envelope.data) {
    throw new Error(
      resolveErrorMessage(payload, "Réponse des fonctionnalités invalide.")
    );
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

  if (Object.prototype.hasOwnProperty.call(input, "value")) {
    requestBody.value = input.value ?? null;
  }

  const response = await fetch("/api/feature-flags", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(
      resolveErrorMessage(payload, "Impossible de mettre à jour la fonctionnalité.")
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Réponse des fonctionnalités invalide.");
  }

  const envelope = payload as ApiEnvelope<{ flag: FeatureFlagRecord }>;
  if (!envelope.ok || !envelope.data?.flag) {
    throw new Error(
      resolveErrorMessage(payload, "Réponse des fonctionnalités invalide.")
    );
  }
  return envelope.data.flag;
}

function FlagStatus({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "success" : "neutral"} dot>
      {enabled ? "Actif" : "Inactif"}
    </Badge>
  );
}

const STATUS_FILTERS = [
  ["all", "Tous"],
  ["enabled", "Actifs"],
  ["disabled", "Inactifs"],
] as const;

export function FeatureFlagsAdminClient({ tenantId }: Readonly<{ tenantId: string }>) {
  const fieldId = useId();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(() => new Set());
  const [valueDrafts, setValueDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const swrKey = ["/api/feature-flags", tenantId, "include-inactive"] as const;
  const { data, error, isLoading, isValidating, mutate } = useSWR<FeatureFlagsResponse>(
    swrKey,
    fetchFeatureFlags
  );

  const filteredFlags = useMemo(() => {
    const normalizedSearch = normalizeFeatureFlagKey(search);
    return (data?.flags ?? []).filter((flag) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        normalizeFeatureFlagKey(flag.flag_key).includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "enabled" ? flag.enabled : !flag.enabled);
      return matchesSearch && matchesStatus;
    });
  }, [data?.flags, search, statusFilter]);

  const dirtyDraftCount = useMemo(
    () =>
      (data?.flags ?? []).filter((flag) => {
        if (!Object.prototype.hasOwnProperty.call(valueDrafts, flag.flag_key)) return false;
        return valueDrafts[flag.flag_key] !== (flag.value ?? "");
      }).length,
    [data?.flags, valueDrafts]
  );

  function setUpdating(flagKey: string, updating: boolean) {
    setUpdatingKeys((current) => {
      const next = new Set(current);
      if (updating) next.add(flagKey);
      else next.delete(flagKey);
      return next;
    });
  }

  function clearValueDraft(flagKey: string) {
    setValueDrafts((current) => {
      if (!(flagKey in current)) return current;
      const next = { ...current };
      delete next[flagKey];
      return next;
    });
  }

  async function updateCachedFlag(updatedFlag: FeatureFlagRecord) {
    await mutate(
      (current) => {
        if (!current) return current;
        return {
          ...current,
          flags: current.flags.map((flag) =>
            flag.flag_key === updatedFlag.flag_key ? updatedFlag : flag
          ),
        };
      },
      { revalidate: false }
    );
  }

  async function handleToggle(flag: FeatureFlagRecord) {
    setUpdating(flag.flag_key, true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updatedFlag = await patchFeatureFlag({
        tenantId,
        flagKey: flag.flag_key,
        enabled: !flag.enabled,
      });
      await updateCachedFlag(updatedFlag);
      setSuccessMessage(
        `${updatedFlag.flag_key} ${updatedFlag.enabled ? "activée" : "désactivée"}.`
      );
    } catch (toggleError) {
      setActionError(
        toggleError instanceof Error
          ? toggleError.message
          : "Impossible de mettre à jour la fonctionnalité."
      );
    } finally {
      setUpdating(flag.flag_key, false);
    }
  }

  async function handleSaveValue(flag: FeatureFlagRecord) {
    const draftValue = valueDrafts[flag.flag_key];
    if (draftValue === undefined || draftValue === (flag.value ?? "")) return;

    setUpdating(flag.flag_key, true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updatedFlag = await patchFeatureFlag({
        tenantId,
        flagKey: flag.flag_key,
        enabled: flag.enabled,
        value: draftValue,
      });
      await updateCachedFlag(updatedFlag);
      clearValueDraft(updatedFlag.flag_key);
      setSuccessMessage(`Valeur de ${updatedFlag.flag_key} mise à jour.`);
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de mettre à jour la valeur de la fonctionnalité."
      );
    } finally {
      setUpdating(flag.flag_key, false);
    }
  }

  function renderValueEditor(flag: FeatureFlagRecord) {
    const isUpdating = updatingKeys.has(flag.flag_key);
    const valueDraft = valueDrafts[flag.flag_key] ?? flag.value ?? "";
    const hasChanged = valueDraft !== (flag.value ?? "");

    return (
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="text"
          aria-label={`Valeur de ${flag.flag_key}`}
          className="min-h-11 flex-1 text-sm md:min-h-0"
          value={valueDraft}
          onChange={(event) =>
            setValueDrafts((current) => ({
              ...current,
              [flag.flag_key]: event.target.value,
            }))
          }
          placeholder="Valeur optionnelle"
          disabled={isUpdating}
        />
        <Button
          variant="outline"
          size="lg"
          aria-label={`Enregistrer la valeur de ${flag.flag_key}`}
          className="min-h-11 md:min-h-0"
          disabled={isUpdating || !hasChanged}
          onClick={() => void handleSaveValue(flag)}
        >
          {isUpdating ? "Mise à jour…" : "Enregistrer"}
        </Button>
      </div>
    );
  }

  function renderToggle(flag: FeatureFlagRecord) {
    const isUpdating = updatingKeys.has(flag.flag_key);
    return (
      <Button
        variant={flag.enabled ? "outline" : "primary"}
        size="lg"
        aria-label={`${flag.enabled ? "Désactiver" : "Activer"} ${flag.flag_key}`}
        className="min-h-11 md:min-h-0"
        disabled={isUpdating}
        onClick={() => void handleToggle(flag)}
      >
        {isUpdating ? "Mise à jour…" : flag.enabled ? "Désactiver" : "Activer"}
      </Button>
    );
  }

  const loadError =
    error instanceof Error ? error.message : "Impossible de charger les fonctionnalités.";

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Fonctionnalités" },
        ]}
        title="Fonctionnalités"
        description="Activez ou désactivez les fonctionnalités disponibles pour l'organisation."
        actions={
          <Button
            variant="outline"
            size="lg"
            className="min-h-11 w-full sm:w-auto"
            leftIcon={<RefreshCwIcon aria-hidden="true" />}
            onClick={() => void mutate()}
            disabled={isValidating}
          >
            {isValidating ? "Actualisation…" : "Actualiser"}
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}
        {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
        {dirtyDraftCount > 0 ? (
          <Alert variant="warning">
            {dirtyDraftCount} modification{dirtyDraftCount > 1 ? "s" : ""} non enregistrée{dirtyDraftCount > 1 ? "s" : ""}. Les brouillons sont conservés pendant l&apos;actualisation.
          </Alert>
        ) : null}

        <section
          className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
          aria-labelledby={`${fieldId}-filters`}
        >
          <h2 id={`${fieldId}-filters`} className="sr-only">Filtres des fonctionnalités</h2>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="feature-flag-search-input">
                Rechercher une fonctionnalité
              </FieldLabel>
              <Input
                id="feature-flag-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ex. STALE_PRICE_DAYS"
                className="min-h-11"
                type="search"
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id={`${fieldId}-status`} className="text-sm font-medium text-foreground">
                État
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${fieldId}-status`}>
                {STATUS_FILTERS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={statusFilter === value}
                    className={cn(
                      "min-h-11 rounded-control border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      statusFilter === value
                        ? "border-primary bg-info-subtle text-primary"
                        : "border-border bg-surface text-foreground-secondary hover:bg-surface-subtle"
                    )}
                    onClick={() => setStatusFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
            {filteredFlags.length} résultat{filteredFlags.length > 1 ? "s" : ""}
          </p>
        </section>

        {isLoading ? (
          <LoadingState label="Chargement des fonctionnalités…" className="min-h-60" />
        ) : error ? (
          <Alert variant="danger">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError}</span>
              <Button variant="outline" size="lg" className="min-h-11" onClick={() => void mutate()}>
                Réessayer
              </Button>
            </div>
          </Alert>
        ) : filteredFlags.length === 0 ? (
          <EmptyState
            icon={<FlagIcon />}
            headingLevel={2}
            title="Aucune fonctionnalité trouvée"
            description="Modifiez la recherche ou le filtre d'état."
          />
        ) : (
          <div aria-busy={isValidating} className={cn("transition-opacity", isValidating && "opacity-60")}>
            <div className="space-y-3 md:hidden">
              {filteredFlags.map((flag) => (
                <Card key={flag.flag_key} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <code className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-foreground">{flag.flag_key}</code>
                    <FlagStatus enabled={flag.enabled} />
                  </div>
                  <div className="mt-4">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Valeur</span>
                    {renderValueEditor(flag)}
                  </div>
                  <div className="mt-4 flex justify-end">{renderToggle(flag)}</div>
                </Card>
              ))}
            </div>

            <Card className="hidden overflow-hidden md:block">
              <div
                role="region"
                aria-label="Liste des fonctionnalités"
                tabIndex={0}
                className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <table className="data-table table-fixed">
                  <thead>
                    <tr>
                      <th scope="col" className="w-[28%]">Clé</th>
                      <th scope="col" className="w-[42%]">Valeur</th>
                      <th scope="col" className="w-[12%]">État</th>
                      <th scope="col" className="w-[18%] text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFlags.map((flag) => (
                      <tr key={flag.flag_key}>
                        <td className="align-top">
                          <code className="block [overflow-wrap:anywhere] text-sm text-foreground">{flag.flag_key}</code>
                        </td>
                        <td className="align-top">{renderValueEditor(flag)}</td>
                        <td className="align-top"><FlagStatus enabled={flag.enabled} /></td>
                        <td className="align-top text-right">{renderToggle(flag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
