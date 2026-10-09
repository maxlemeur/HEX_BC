"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CoinsIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import useSWR from "swr";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

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
    throw new Error("Le taux doit être un nombre positif.");
  }
  return parsed;
}

function normalizeCreateOrUpdateInput(draft: CurrencyRateDraft) {
  const from = normalizeCurrencyCode(draft.from_currency);
  const to = normalizeCurrencyCode(draft.to_currency);
  if (from === to) {
    throw new Error("Les devises source et cible doivent être différentes.");
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
  if (!value) return "—";
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
    throw new Error(resolveErrorMessage(body, "Impossible de créer le taux de change."));
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
    throw new Error(resolveErrorMessage(body, "Impossible de mettre à jour le taux de change."));
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
  const confirm = useConfirm();
  const fieldId = useId();
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

  function updateCreateDraft(patch: Partial<CurrencyRateDraft>) {
    setCreateDraft((current) => ({ ...current, ...patch }));
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
        `Taux ${payload.from_currency}/${payload.to_currency} créé.`
      );
    } catch (createError) {
      setActionError(
        createError instanceof Error
          ? createError.message
          : "Impossible de créer le taux de change."
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
        `Taux ${draft.from_currency}/${draft.to_currency} mis à jour.`
      );
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de mettre à jour le taux de change."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(rate: CurrencyRateRecord) {
    const confirmed = await confirm({
      title: `Supprimer le taux ${rate.from_currency}/${rate.to_currency} ?`,
      description: "Le taux sera supprimé définitivement. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    resetMessages();
    setDeletingId(rate.id);

    try {
      await deleteCurrencyRate(rate.id);
      await mutate();
      setSuccessMessage(
        `Taux ${rate.from_currency}/${rate.to_currency} supprimé.`
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
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Taux de change" },
        ]}
        title="Taux de change"
        description="Gelez et maintenez les parités de devises pour les chiffrages multidevises."
        actions={
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
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

        <PageSection title="Filtres">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-filter-from`}>Devise source</FieldLabel>
              <Input
                id={`${fieldId}-filter-from`}
                type="text"
                placeholder="Ex. EUR"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value.toUpperCase(),
                  }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-filter-to`}>Devise cible</FieldLabel>
              <Input
                id={`${fieldId}-filter-to`}
                type="text"
                placeholder="Ex. USD"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value.toUpperCase(),
                  }))
                }
              />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground-secondary lg:min-h-(--density-input-h)">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={filters.includeInactive}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    includeInactive: event.target.checked,
                  }))
                }
              />
              Inclure inactifs
            </label>
            <div>
              <Button
                variant="ghost"
                size="md"
                leftIcon={<RotateCcwIcon aria-hidden="true" />}
                onClick={() => setFilters({ from: "", to: "", includeInactive: false })}
              >
                Réinitialiser
              </Button>
            </div>
          </div>
        </PageSection>

        <PageSection title="Nouveau taux">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-create-from`}>Devise source</FieldLabel>
              <Input
                id={`${fieldId}-create-from`}
                type="text"
                className="font-mono uppercase"
                value={createDraft.from_currency}
                onChange={(event) =>
                  updateCreateDraft({ from_currency: event.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-create-to`}>Devise cible</FieldLabel>
              <Input
                id={`${fieldId}-create-to`}
                type="text"
                className="font-mono uppercase"
                value={createDraft.to_currency}
                onChange={(event) =>
                  updateCreateDraft({ to_currency: event.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-create-rate`}>Taux</FieldLabel>
              <Input
                id={`${fieldId}-create-rate`}
                type="text"
                inputMode="decimal"
                className="font-mono"
                value={createDraft.rate}
                onChange={(event) => updateCreateDraft({ rate: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-create-date`}>Date d&apos;effet</FieldLabel>
              <Input
                id={`${fieldId}-create-date`}
                type="date"
                value={createDraft.effective_date}
                onChange={(event) => updateCreateDraft({ effective_date: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-create-source`}>Source</FieldLabel>
              <Input
                id={`${fieldId}-create-source`}
                type="text"
                placeholder="Ex. BCE"
                value={createDraft.source}
                onChange={(event) => updateCreateDraft({ source: event.target.value })}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={createDraft.is_active}
                  onChange={(event) => updateCreateDraft({ is_active: event.target.checked })}
                />
                Actif
              </label>
              <Button
                variant="primary"
                size="lg"
                leftIcon={<PlusIcon aria-hidden="true" />}
                onClick={() => void handleCreate()}
                disabled={creating}
              >
                {creating ? "Création…" : "Créer"}
              </Button>
            </div>
          </div>
        </PageSection>

        {isLoading ? (
          <LoadingState label="Chargement des taux de change…" className="min-h-60" />
        ) : error ? (
          <Alert variant="danger">{loadError}</Alert>
        ) : (
          <PageSection title="Taux enregistrés" flush>
            <div
              role="region"
              aria-label="Taux de change enregistrés"
              tabIndex={0}
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Cible</th>
                    <th scope="col">Taux</th>
                    <th scope="col">Date d&apos;effet</th>
                    <th scope="col">Origine</th>
                    <th scope="col">État</th>
                    <th scope="col">Dernière mise à jour</th>
                    <th scope="col" className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <EmptyTableRow
                      colSpan={8}
                      icon={<CoinsIcon />}
                      title="Aucun taux de change trouvé"
                      description="Créez un taux ou modifiez les filtres."
                    />
                  ) : (
                    items.map((rate) => {
                      const rowDraft = drafts[rate.id] ?? toRateDraft(rate);
                      const isUpdating = updatingId === rate.id;
                      const isDeleting = deletingId === rate.id;
                      const pair = `${rate.from_currency}/${rate.to_currency}`;

                      return (
                        <tr key={rate.id}>
                          <td>
                            <Input
                              size="sm"
                              aria-label={`Devise source du taux ${pair}`}
                              className="w-24 bg-surface-subtle font-mono uppercase"
                              type="text"
                              value={rowDraft.from_currency}
                              readOnly
                            />
                          </td>
                          <td>
                            <Input
                              size="sm"
                              aria-label={`Devise cible du taux ${pair}`}
                              className="w-24 bg-surface-subtle font-mono uppercase"
                              type="text"
                              value={rowDraft.to_currency}
                              readOnly
                            />
                          </td>
                          <td>
                            <Input
                              size="sm"
                              aria-label={`Taux ${pair}`}
                              className="w-32 font-mono"
                              type="text"
                              inputMode="decimal"
                              value={rowDraft.rate}
                              onChange={(event) =>
                                updateRowDraft(rate.id, {
                                  rate: event.target.value,
                                })
                              }
                            />
                            <p className="mt-1 text-micro text-muted-foreground">
                              {formatRate(rate.rate)}
                            </p>
                          </td>
                          <td>
                            <Input
                              size="sm"
                              aria-label={`Date d'effet du taux ${pair}`}
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
                            <Input
                              size="sm"
                              aria-label={`Source du taux ${pair}`}
                              className="min-w-44"
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
                            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground-secondary">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
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
                          <td className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(rate.updated_at)}
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="md"
                                onClick={() => void handleUpdate(rate.id)}
                                disabled={isUpdating || isDeleting}
                              >
                                {isUpdating ? "Enregistrement…" : "Enregistrer"}
                              </Button>
                              <Button
                                variant="danger"
                                size="md"
                                onClick={() => void handleDelete(rate)}
                                disabled={isUpdating || isDeleting}
                              >
                                {isDeleting ? "Suppression…" : "Supprimer"}
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
          </PageSection>
        )}
      </div>
    </div>
  );
}
