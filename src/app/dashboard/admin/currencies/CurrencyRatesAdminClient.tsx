"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

type CurrencyRateRecord = {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string | null;
  source: string | null;
  is_active: boolean;
  updated_at: string | null;
};

type CurrencyRatesResponse = {
  items: CurrencyRateRecord[];
};

type CurrencyRateDraft = {
  from_currency: string;
  to_currency: string;
  rate: string;
  effective_date: string;
  source: string;
  is_active: boolean;
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

const DEFAULT_CURRENCY = "EUR";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function normalizeCurrencyCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CURRENCY;
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const envelope = payload as ApiEnvelope<unknown>;
  return envelope.error?.message ?? fallback;
}

function extractRowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  if ("ok" in payload || "data" in payload || "error" in payload) {
    const envelope = payload as ApiEnvelope<unknown>;
    return extractRowsFromPayload(envelope.data);
  }

  const candidateKeys = [
    "items",
    "rates",
    "rows",
    "currency_rates",
    "currencyRates",
    "data",
  ] as const;

  for (const key of candidateKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

function normalizeCurrencyRate(
  value: unknown,
  index: number
): CurrencyRateRecord | null {
  if (!isRecord(value)) return null;

  const fromCurrency = normalizeCurrencyCode(
    toStringValue(value.from_currency) ??
      toStringValue(value.base_currency) ??
      toStringValue(value.fromCurrency)
  );
  const toCurrency = normalizeCurrencyCode(
    toStringValue(value.to_currency) ??
      toStringValue(value.quote_currency) ??
      toStringValue(value.toCurrency)
  );
  const rate =
    toNumberValue(value.rate) ??
    toNumberValue(value.rate_value) ??
    toNumberValue(value.exchange_rate);
  const id =
    toStringValue(value.id) ??
    `${fromCurrency}-${toCurrency}-${toStringValue(value.updated_at) ?? index}`;

  if (!id || !fromCurrency || !toCurrency || rate === null) {
    return null;
  }

  const effectiveDate =
    toStringValue(value.effective_date) ??
    toStringValue(value.effectiveDate) ??
    null;
  const source = toStringValue(value.source) ?? toStringValue(value.provider) ?? null;
  const isActive =
    toBooleanValue(value.is_active) ?? toBooleanValue(value.active) ?? true;
  const updatedAt =
    toStringValue(value.updated_at) ?? toStringValue(value.updatedAt) ?? null;

  return {
    id,
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate,
    effective_date: effectiveDate,
    source,
    is_active: isActive,
    updated_at: updatedAt,
  };
}

function toRateDraft(rate: CurrencyRateRecord): CurrencyRateDraft {
  return {
    from_currency: rate.from_currency,
    to_currency: rate.to_currency,
    rate: String(rate.rate),
    effective_date: (rate.effective_date ?? "").slice(0, 10),
    source: rate.source ?? "",
    is_active: rate.is_active,
  };
}

function parseRateInput(input: string): number {
  const normalized = input.trim().replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Le taux doit etre un nombre positif.");
  }
  return parsed;
}

function normalizeCreateOrUpdateInput(draft: CurrencyRateDraft) {
  const from = normalizeCurrencyCode(draft.from_currency);
  const to = normalizeCurrencyCode(draft.to_currency);
  if (from === to) {
    throw new Error("Les devises source et cible doivent etre differentes.");
  }

  const rate = parseRateInput(draft.rate);
  const effectiveDate = draft.effective_date.trim();
  const source = draft.source.trim();

  return {
    from_currency: from,
    to_currency: to,
    rate,
    ...(effectiveDate.length > 0 ? { effective_date: effectiveDate } : {}),
    ...(source.length > 0 ? { source } : {}),
    is_active: draft.is_active,
  };
}

function normalizeUpdateInput(draft: CurrencyRateDraft) {
  const rate = parseRateInput(draft.rate);
  const effectiveDate = draft.effective_date.trim();
  const source = draft.source.trim();

  return {
    rate,
    ...(effectiveDate.length > 0 ? { effective_date: effectiveDate } : {}),
    ...(source.length > 0 ? { source } : {}),
    is_active: draft.is_active,
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatRate(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function buildRatesQuery(filters: {
  from: string;
  to: string;
  includeInactive: boolean;
}) {
  const params = new URLSearchParams();
  if (filters.from.trim().length > 0) {
    params.set("from_currency", normalizeCurrencyCode(filters.from));
  }
  if (filters.to.trim().length > 0) {
    params.set("to_currency", normalizeCurrencyCode(filters.to));
  }
  if (filters.includeInactive) {
    params.set("include_inactive", "true");
  }
  return params.toString();
}

async function fetchCurrencyRates([
  route,
  from,
  to,
  includeInactive,
]: readonly [string, string, string, boolean]): Promise<CurrencyRatesResponse> {
  const query = buildRatesQuery({
    from,
    to,
    includeInactive,
  });
  const url = query.length > 0 ? `${route}?${query}` : route;

  const response = await fetch(url, {
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de charger les taux de change."));
  }

  const rows = extractRowsFromPayload(payload);
  const items = rows
    .map((row, index) => normalizeCurrencyRate(row, index))
    .filter((row): row is CurrencyRateRecord => row !== null)
    .sort((left, right) => {
      const pair = `${left.from_currency}/${left.to_currency}`.localeCompare(
        `${right.from_currency}/${right.to_currency}`
      );
      if (pair !== 0) return pair;
      return (
        new Date(right.updated_at ?? "").getTime() -
        new Date(left.updated_at ?? "").getTime()
      );
    });

  return { items };
}

async function createCurrencyRate(payload: {
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date?: string;
  source?: string;
  is_active: boolean;
}) {
  const response = await fetch("/api/currency-rates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(body, "Impossible de creer le taux de change."));
  }
}

async function updateCurrencyRate(input: {
  id: string;
  rate: number;
  effective_date?: string;
  source?: string;
  is_active: boolean;
}) {
  const response = await fetch(`/api/currency-rates/${encodeURIComponent(input.id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rate: input.rate,
      effective_date: input.effective_date,
      source: input.source,
      is_active: input.is_active,
    }),
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(body, "Impossible de mettre a jour le taux de change."));
  }
}

async function deleteCurrencyRate(id: string) {
  const response = await fetch(`/api/currency-rates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Impossible de supprimer le taux de change."));
  }
}

export function CurrencyRatesAdminClient() {
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    includeInactive: false,
  });
  const [createDraft, setCreateDraft] = useState<CurrencyRateDraft>({
    from_currency: "EUR",
    to_currency: "USD",
    rate: "1",
    effective_date: "",
    source: "",
    is_active: true,
  });
  const [drafts, setDrafts] = useState<Record<string, CurrencyRateDraft>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const swrKey = useMemo(
    () =>
      ["/api/currency-rates", filters.from, filters.to, filters.includeInactive] as const,
    [filters.from, filters.to, filters.includeInactive]
  );
  const { data, error, isLoading, isValidating, mutate } = useSWR<CurrencyRatesResponse>(
    swrKey,
    fetchCurrencyRates
  );

  useEffect(() => {
    const nextDrafts = Object.fromEntries(
      (data?.items ?? []).map((item) => [item.id, toRateDraft(item)])
    );
    setDrafts(nextDrafts);
  }, [data?.items]);

  const loadError =
    error instanceof Error ? error.message : "Impossible de charger les taux de change.";
  const items = data?.items ?? [];

  function resetMessages() {
    setActionError(null);
    setSuccessMessage(null);
  }

  function updateRowDraft(
    id: string,
    patch: Partial<CurrencyRateDraft>
  ) {
    setDrafts((current) => {
      const currentDraft = current[id];
      if (!currentDraft) return current;
      return {
        ...current,
        [id]: {
          ...currentDraft,
          ...patch,
        },
      };
    });
  }

  async function handleCreate() {
    resetMessages();
    setCreating(true);

    try {
      const payload = normalizeCreateOrUpdateInput(createDraft);
      await createCurrencyRate(payload);
      await mutate();
      setCreateDraft((current) => ({
        ...current,
        rate: "1",
        source: "",
      }));
      setSuccessMessage(
        `Taux ${payload.from_currency}/${payload.to_currency} cree avec succes.`
      );
    } catch (createError) {
      setActionError(
        createError instanceof Error
          ? createError.message
          : "Impossible de creer le taux de change."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string) {
    const draft = drafts[id];
    if (!draft) return;

    resetMessages();
    setUpdatingId(id);

    try {
      const payload = normalizeUpdateInput(draft);
      await updateCurrencyRate({
        id,
        ...payload,
      });
      await mutate();
      setSuccessMessage(
        `Taux ${draft.from_currency}/${draft.to_currency} mis a jour.`
      );
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de mettre a jour le taux de change."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(rate: CurrencyRateRecord) {
    const confirmed = window.confirm(
      `Supprimer le taux ${rate.from_currency}/${rate.to_currency} ?`
    );
    if (!confirmed) return;

    resetMessages();
    setDeletingId(rate.id);

    try {
      await deleteCurrencyRate(rate.id);
      await mutate();
      setSuccessMessage(
        `Taux ${rate.from_currency}/${rate.to_currency} supprime.`
      );
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer le taux de change."
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Taux de change</h1>
          <p className="page-description">
            Gelez et maintenez les parites de devises pour les chiffrages multi-currency.
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

      <div className="dashboard-card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Filtres
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Devise source</span>
            <input
              type="text"
              className="form-input h-10"
              placeholder="Ex: EUR"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  from: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Devise cible</span>
            <input
              type="text"
              className="form-input h-10"
              placeholder="Ex: USD"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  to: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="flex items-center gap-2 self-end pb-1">
            <input
              type="checkbox"
              checked={filters.includeInactive}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  includeInactive: event.target.checked,
                }))
              }
            />
            <span className="text-sm text-[var(--slate-700)]">Inclure inactifs</span>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFilters({ from: "", to: "", includeInactive: false })}
            >
              Reinitialiser
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-card mb-6 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Nouveau taux
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">From</span>
            <input
              className="form-input h-10"
              type="text"
              value={createDraft.from_currency}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  from_currency: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">To</span>
            <input
              className="form-input h-10"
              type="text"
              value={createDraft.to_currency}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  to_currency: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Taux</span>
            <input
              className="form-input h-10"
              type="text"
              inputMode="decimal"
              value={createDraft.rate}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  rate: event.target.value,
                }))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Date effet</span>
            <input
              className="form-input h-10"
              type="date"
              value={createDraft.effective_date}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  effective_date: event.target.value,
                }))
              }
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--slate-500)]">Source</span>
            <input
              className="form-input h-10"
              type="text"
              placeholder="BCE, ECB..."
              value={createDraft.source}
              onChange={(event) =>
                setCreateDraft((current) => ({
                  ...current,
                  source: event.target.value,
                }))
              }
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createDraft.is_active}
                onChange={(event) =>
                  setCreateDraft((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Actif
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? "Creation..." : "Creer"}
            </button>
          </div>
        </div>
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
                  <th>From</th>
                  <th>To</th>
                  <th>Taux</th>
                  <th>Date effet</th>
                  <th>Source</th>
                  <th>Etat</th>
                  <th>Derniere MAJ</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-[var(--slate-500)]">
                      Aucun taux de change trouve.
                    </td>
                  </tr>
                ) : (
                  items.map((rate) => {
                    const rowDraft = drafts[rate.id] ?? toRateDraft(rate);
                    const isUpdating = updatingId === rate.id;
                    const isDeleting = deletingId === rate.id;

                    return (
                      <tr key={rate.id}>
                        <td>
                          <input
                            className="form-input h-9 w-24 font-mono text-sm uppercase"
                            type="text"
                            value={rowDraft.from_currency}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="form-input h-9 w-24 font-mono text-sm uppercase"
                            type="text"
                            value={rowDraft.to_currency}
                            readOnly
                          />
                        </td>
                        <td>
                          <input
                            className="form-input h-9 w-32 font-mono text-sm"
                            type="text"
                            inputMode="decimal"
                            value={rowDraft.rate}
                            onChange={(event) =>
                              updateRowDraft(rate.id, {
                                rate: event.target.value,
                              })
                            }
                          />
                          <p className="mt-1 text-[11px] text-[var(--slate-500)]">
                            {formatRate(rate.rate)}
                          </p>
                        </td>
                        <td>
                          <input
                            className="form-input h-9"
                            type="date"
                            value={rowDraft.effective_date}
                            onChange={(event) =>
                              updateRowDraft(rate.id, {
                                effective_date: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="form-input h-9 min-w-[180px]"
                            type="text"
                            value={rowDraft.source}
                            onChange={(event) =>
                              updateRowDraft(rate.id, {
                                source: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={rowDraft.is_active}
                              onChange={(event) =>
                                updateRowDraft(rate.id, {
                                  is_active: event.target.checked,
                                })
                              }
                            />
                            {rowDraft.is_active ? "Actif" : "Inactif"}
                          </label>
                        </td>
                        <td className="text-sm text-[var(--slate-500)]">
                          {formatDateTime(rate.updated_at)}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => void handleUpdate(rate.id)}
                              disabled={isUpdating || isDeleting}
                            >
                              {isUpdating ? "Sauvegarde..." : "Enregistrer"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-red-700"
                              onClick={() => void handleDelete(rate)}
                              disabled={isUpdating || isDeleting}
                            >
                              {isDeleting ? "Suppression..." : "Supprimer"}
                            </button>
                          </div>
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
