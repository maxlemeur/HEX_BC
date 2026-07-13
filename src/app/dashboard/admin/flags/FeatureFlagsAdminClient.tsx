"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

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

function badgeClass(enabled: boolean) {
  return enabled
    ? "inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]"
    : "inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]";
}

function FlagStatus({ enabled }: { enabled: boolean }) {
  return <span className={badgeClass(enabled)}>{enabled ? "Actif" : "Inactif"}</span>;
}

export function FeatureFlagsAdminClient({ tenantId }: Readonly<{ tenantId: string }>) {
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
        <input
          type="text"
          aria-label={`Valeur de ${flag.flag_key}`}
          className="form-input min-h-11 min-w-0 flex-1 text-sm"
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
        <button
          type="button"
          aria-label={`Enregistrer la valeur de ${flag.flag_key}`}
          className="btn btn-secondary min-h-11 shrink-0"
          disabled={isUpdating || !hasChanged}
          onClick={() => void handleSaveValue(flag)}
        >
          {isUpdating ? "Mise à jour…" : "Enregistrer"}
        </button>
      </div>
    );
  }

  function renderToggle(flag: FeatureFlagRecord) {
    const isUpdating = updatingKeys.has(flag.flag_key);
    return (
      <button
        type="button"
        aria-label={`${flag.enabled ? "Désactiver" : "Activer"} ${flag.flag_key}`}
        className={`${flag.enabled ? "btn btn-secondary" : "btn btn-primary"} min-h-11`}
        disabled={isUpdating}
        onClick={() => void handleToggle(flag)}
      >
        {isUpdating ? "Mise à jour…" : flag.enabled ? "Désactiver" : "Activer"}
      </button>
    );
  }

  const loadError =
    error instanceof Error ? error.message : "Impossible de charger les fonctionnalités.";

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Fonctionnalités</h1>
          <p className="page-description">
            Activez ou désactivez les fonctionnalités disponibles pour l&apos;organisation.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary min-h-11 w-full sm:w-auto"
          onClick={() => void mutate()}
          disabled={isValidating}
        >
          {isValidating ? "Actualisation…" : "Actualiser"}
        </button>
      </div>

      {actionError ? <div className="alert alert-error mb-6" role="alert">{actionError}</div> : null}
      {successMessage ? (
        <div className="alert alert-success mb-6" role="status" aria-live="polite">
          {successMessage}
        </div>
      ) : null}
      {dirtyDraftCount > 0 ? (
        <div className="alert alert-warning mb-6" role="status">
          {dirtyDraftCount} modification{dirtyDraftCount > 1 ? "s" : ""} non enregistrée{dirtyDraftCount > 1 ? "s" : ""}. Les brouillons sont conservés pendant l&apos;actualisation.
        </div>
      ) : null}

      <section className="dashboard-card mb-6 p-4 sm:p-5" aria-labelledby="feature-flags-filters">
        <h2 id="feature-flags-filters" className="sr-only">Filtres des fonctionnalités</h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]" htmlFor="feature-flag-search-input">
              Rechercher une fonctionnalité
            </label>
            <input
              id="feature-flag-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ex. STALE_PRICE_DAYS"
              className="form-input mt-2 min-h-11 w-full"
              type="search"
            />
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">État</span>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Filtrer par état">
              {([
                ["all", "Tous"],
                ["enabled", "Actifs"],
                ["disabled", "Inactifs"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${
                    statusFilter === value
                      ? "border-[var(--brand-blue)] bg-[var(--info-light)] text-[var(--brand-blue)]"
                      : "border-[var(--slate-200)] bg-white text-[var(--slate-600)]"
                  }`}
                  onClick={() => setStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-[var(--slate-500)]" aria-live="polite">
          {filteredFlags.length} résultat{filteredFlags.length > 1 ? "s" : ""}
        </p>
      </section>

      {isLoading ? (
        <div className="flex min-h-60 items-center justify-center" role="status">
          <span className="text-[var(--slate-500)]">Chargement des fonctionnalités…</span>
        </div>
      ) : error ? (
        <div className="alert alert-error flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn btn-secondary min-h-11" onClick={() => void mutate()}>
            Réessayer
          </button>
        </div>
      ) : filteredFlags.length === 0 ? (
        <div className="dashboard-card px-4 py-10 text-center">
          <p className="font-medium text-[var(--slate-900)]">Aucune fonctionnalité trouvée</p>
          <p className="mt-1 text-sm text-[var(--slate-500)]">Modifiez la recherche ou le filtre d&apos;état.</p>
        </div>
      ) : (
        <div aria-busy={isValidating} className={isValidating ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="space-y-3 md:hidden">
            {filteredFlags.map((flag) => (
              <article key={flag.flag_key} className="dashboard-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <code className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-[var(--slate-800)]">{flag.flag_key}</code>
                  <FlagStatus enabled={flag.enabled} />
                </div>
                <div className="mt-4">
                  <span className="mb-1 block text-xs font-medium text-[var(--slate-500)]">Valeur</span>
                  {renderValueEditor(flag)}
                </div>
                <div className="mt-4 flex justify-end">{renderToggle(flag)}</div>
              </article>
            ))}
          </div>

          <div className="dashboard-card hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
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
                        <code className="block [overflow-wrap:anywhere] text-sm text-[var(--slate-800)]">{flag.flag_key}</code>
                      </td>
                      <td className="align-top">{renderValueEditor(flag)}</td>
                      <td className="align-top"><FlagStatus enabled={flag.enabled} /></td>
                      <td className="align-top text-right">{renderToggle(flag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
