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
  error?: {
    message?: string;
  };
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
  if (!envelope.ok || !envelope.data) {
    throw new Error(resolveErrorMessage(payload, "Reponse feature flags invalide."));
  }

  return envelope.data;
}

async function patchFeatureFlag(input: {
  tenantId: string;
  flagKey: string;
  enabled: boolean;
  value?: string | null;
}) {
  const response = await fetch("/api/feature-flags", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      flag_key: input.flagKey,
      enabled: input.enabled,
      value: input.value ?? null,
    }),
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

function badgeClass(enabled: boolean) {
  if (enabled) {
    return "inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]";
  }

  return "inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]";
}

export function FeatureFlagsAdminClient({ tenantId }: Readonly<{ tenantId: string }>) {
  const [search, setSearch] = useState("");
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [valueDraftByKey, setValueDraftByKey] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const swrKey = ["/api/feature-flags", tenantId] as const;
  const { data, error, isLoading, isValidating, mutate } = useSWR<FeatureFlagsResponse>(
    swrKey,
    fetchFeatureFlags
  );

  const filteredFlags = useMemo(() => {
    const flags = data?.flags ?? [];
    const normalizedSearch = normalizeFeatureFlagKey(search);
    if (!normalizedSearch) {
      return flags;
    }

    return flags.filter((flag) =>
      normalizeFeatureFlagKey(flag.flag_key).includes(normalizedSearch)
    );
  }, [data?.flags, search]);

  async function handleToggle(flag: FeatureFlagRecord) {
    setUpdatingKey(flag.flag_key);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const updatedFlag = await patchFeatureFlag({
        tenantId,
        flagKey: flag.flag_key,
        enabled: !flag.enabled,
        value:
          valueDraftByKey[flag.flag_key] === undefined
            ? flag.value
            : (valueDraftByKey[flag.flag_key]?.trim() || null),
      });

      await mutate(
        (current) => {
          if (!current) return current;

          return {
            ...current,
            flags: current.flags.map((row) =>
              row.flag_key === updatedFlag.flag_key ? updatedFlag : row
            ),
          };
        },
        { revalidate: false }
      );

      setSuccessMessage(
        `${updatedFlag.flag_key} ${updatedFlag.enabled ? "active" : "desactive"}.`
      );
    } catch (toggleError) {
      setActionError(
        toggleError instanceof Error
          ? toggleError.message
          : "Impossible de mettre a jour le feature flag."
      );
    } finally {
      setUpdatingKey(null);
    }
  }

  function getFlagValue(flag: FeatureFlagRecord) {
    const draftValue = valueDraftByKey[flag.flag_key];
    if (draftValue !== undefined) {
      return draftValue;
    }
    return flag.value ?? "";
  }

  async function handleSaveValue(flag: FeatureFlagRecord) {
    const nextValue = getFlagValue(flag).trim();
    const actionKey = `${flag.flag_key}:value`;
    setUpdatingKey(actionKey);
    setActionError(null);
    setSuccessMessage(null);

    try {
      const updatedFlag = await patchFeatureFlag({
        tenantId,
        flagKey: flag.flag_key,
        enabled: flag.enabled,
        value: nextValue.length > 0 ? nextValue : null,
      });

      await mutate(
        (current) => {
          if (!current) return current;

          return {
            ...current,
            flags: current.flags.map((row) =>
              row.flag_key === updatedFlag.flag_key ? updatedFlag : row
            ),
          };
        },
        { revalidate: false }
      );

      setValueDraftByKey((prev) => {
        if (!(flag.flag_key in prev)) return prev;
        const next = { ...prev };
        delete next[flag.flag_key];
        return next;
      });

      setSuccessMessage(`${updatedFlag.flag_key} valeur mise a jour.`);
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible de mettre a jour la valeur du feature flag."
      );
    } finally {
      setUpdatingKey(null);
    }
  }

  const loadError =
    error instanceof Error ? error.message : "Impossible de charger les feature flags.";

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Feature flags</h1>
          <p className="page-description">
            Activez ou desactivez les fonctionnalites runtime pour le tenant courant.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void mutate()}
          disabled={isValidating}
        >
          {isValidating ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {actionError ? <div className="alert alert-error mb-6">{actionError}</div> : null}
      {successMessage ? <div className="alert alert-success mb-6">{successMessage}</div> : null}

      <div className="dashboard-card p-5 mb-6">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Rechercher un flag
        </label>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ex: STALE_PRICE_DAYS"
          className="form-input mt-2 max-w-md"
          type="text"
        />
      </div>

      {isLoading ? (
        <div className="animate-fade-in flex min-h-[240px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
            <span className="text-[var(--slate-500)]">Chargement...</span>
          </div>
        </div>
      ) : error ? (
        <div className="alert alert-error">{loadError}</div>
      ) : (
        <div className="dashboard-card overflow-hidden">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Etat</th>
                  <th>Valeur</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredFlags.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-[var(--slate-500)]">
                      Aucun feature flag trouve.
                    </td>
                  </tr>
                ) : (
                  filteredFlags.map((flag) => {
                    const isUpdating = updatingKey === flag.flag_key;
                    const isSavingValue = updatingKey === `${flag.flag_key}:value`;
                    const flagValue = getFlagValue(flag);

                    return (
                      <tr key={flag.flag_key}>
                        <td className="font-mono text-sm text-[var(--slate-800)]">{flag.flag_key}</td>
                        <td>
                          <span className={badgeClass(flag.enabled)}>
                            {flag.enabled ? "Actif" : "Inactif"}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              className="form-input h-9 min-w-[170px] max-w-[220px]"
                              placeholder="Valeur optionnelle"
                              value={flagValue}
                              onChange={(event) =>
                                setValueDraftByKey((prev) => ({
                                  ...prev,
                                  [flag.flag_key]: event.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={isSavingValue}
                              onClick={() => void handleSaveValue(flag)}
                            >
                              {isSavingValue ? "Enregistrement..." : "Sauver"}
                            </button>
                          </div>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className={flag.enabled ? "btn btn-secondary" : "btn btn-primary"}
                            disabled={isUpdating || isSavingValue}
                            onClick={() => void handleToggle(flag)}
                          >
                            {isUpdating
                              ? "Mise a jour..."
                              : flag.enabled
                                ? "Desactiver"
                                : "Activer"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
