"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { fetchApi } from "@/components/catalogue/api";
import type { CatalogueItem } from "@/components/catalogue/types";
import { formatEUR, parseEuroToCents } from "@/lib/money";

type CatalogueListResponse = {
  items: CatalogueItem[];
};

type ImportListItem = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
};

type LinkMappedRowsResponse = {
  import_id: string;
  scanned_rows: number;
  linked_count: number;
  created_catalogue_count: number;
  unmatched_count: number;
  dry_run: boolean;
  links?: Array<{
    mapped_row_id: string;
    product_id: string;
    match_type: string;
  }>;
};

type CatalogueFormState = {
  reference: string;
  designation: string;
  unit_price_euros: string;
  tax_rate_bp: string;
  is_active: boolean;
};

const EMPTY_FORM: CatalogueFormState = {
  reference: "",
  designation: "",
  unit_price_euros: "0,00",
  tax_rate_bp: "2000",
  is_active: true,
};

function toEuroInput(unitPriceCents: number | undefined | null) {
  if (typeof unitPriceCents !== "number") return "";
  return (unitPriceCents / 100).toFixed(2).replace(".", ",");
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

// M-20: Display TVA as percentage
function formatTaxRate(bp: number | undefined | null): string {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return "-";
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)} %`;
}

// M-17: Tab state for catalogue sections
type CatalogueTab = "catalogue" | "liaison";

export function CatalogueManager() {
  // M-16: Accept ?import_id= query param
  const searchParams = useSearchParams();
  const importIdFromUrl = searchParams.get("import_id");

  const [activeTab, setActiveTab] = useState<CatalogueTab>(
    importIdFromUrl ? "liaison" : "catalogue"
  );
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [availableImports, setAvailableImports] = useState<ImportListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [formState, setFormState] = useState<CatalogueFormState>(EMPTY_FORM);
  // M-16: Replace UUID input with dropdown
  const [linkImportId, setLinkImportId] = useState(importIdFromUrl ?? "");
  const [linkLimit, setLinkLimit] = useState(1000);
  const [linkCreateMissing, setLinkCreateMissing] = useState(true);
  const [linkUpdatePayload, setLinkUpdatePayload] = useState(true);
  const [linkDryRun, setLinkDryRun] = useState(false);
  const [linkSummary, setLinkSummary] = useState<LinkMappedRowsResponse | null>(null);
  // M-21: Advanced options toggle
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const search = searchTerm.trim();
      const query = new URLSearchParams();
      query.set("limit", "300");
      if (search.length > 0) {
        query.set("search", search);
      }

      const data = await fetchApi<CatalogueListResponse>(`/api/catalogue?${query.toString()}`);
      setItems(data.items ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Impossible de charger le catalogue."
      );
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm]);

  // M-16: Load available imports for dropdown
  const loadImports = useCallback(async () => {
    try {
      const response = await fetch("/api/imports", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;

      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : (payload?.data ?? []);
      const normalized: ImportListItem[] = list.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""),
        filename: String(item.filename ?? item.file_name ?? item.fileName ?? ""),
        status: String(item.status ?? ""),
        row_count: Number(item.row_count ?? item.rows_count ?? 0),
        created_at: String(item.created_at ?? ""),
      }));
      setAvailableImports(normalized);
    } catch {
      // Non-blocking: imports list is optional
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingId) ?? null,
    [items, editingId]
  );

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }

  function onEdit(item: CatalogueItem) {
    setError(null);
    setSuccess(null);
    setEditingId(item.id);
    setFormState({
      reference: item.reference ?? item.hex_code ?? "",
      designation: item.designation ?? "",
      unit_price_euros: toEuroInput(item.unit_price_cents),
      tax_rate_bp:
        typeof item.tax_rate_bp === "number" && Number.isFinite(item.tax_rate_bp)
          ? String(item.tax_rate_bp)
          : "2000",
      is_active: item.is_active ?? true,
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitPriceCents = parseEuroToCents(formState.unit_price_euros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setError("Prix unitaire invalide.");
      return;
    }

    const taxRateBp = Number.parseInt(formState.tax_rate_bp, 10);
    if (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) {
      setError("Taux TVA invalide.");
      return;
    }

    if (!formState.reference.trim() || !formState.designation.trim()) {
      setError("Reference et designation sont requises.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        await fetchApi<{ item: CatalogueItem }>("/api/catalogue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            item: {
              reference: formState.reference.trim(),
              designation: formState.designation.trim(),
              unit_price_cents: unitPriceCents,
              tax_rate_bp: taxRateBp,
              is_active: formState.is_active,
            },
          }),
        });

        setSuccess("Ligne catalogue mise a jour.");
      } else {
        await fetchApi<{ item: CatalogueItem }>("/api/catalogue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            item: {
              reference: formState.reference.trim(),
              designation: formState.designation.trim(),
              unit_price_cents: unitPriceCents,
              tax_rate_bp: taxRateBp,
              is_active: formState.is_active,
            },
          }),
        });

        setSuccess("Ligne catalogue creee.");
      }

      resetForm();
      await loadItems();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer la ligne catalogue."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(item: CatalogueItem) {
    if (!window.confirm(`Supprimer l'article "${item.designation}" ?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await fetchApi<{ deleted_id: string }>("/api/catalogue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          id: item.id,
        }),
      });

      if (editingId === item.id) {
        resetForm();
      }

      setSuccess("Ligne catalogue supprimee.");
      await loadItems();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer la ligne catalogue."
      );
    }
  }

  async function onRunLinking() {
    if (!linkImportId.trim()) {
      setError("Selectionnez un import pour lancer la liaison.");
      return;
    }

    setIsLinking(true);
    setError(null);
    setSuccess(null);
    setLinkSummary(null);

    try {
      const summary = await fetchApi<LinkMappedRowsResponse>("/api/catalogue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "link-mapped-rows",
          import_id: linkImportId.trim(),
          limit: linkLimit,
          create_missing: linkCreateMissing,
          update_payload: linkUpdatePayload,
          dry_run: linkDryRun,
        }),
      });

      setLinkSummary(summary);
      setSuccess(linkDryRun ? "Simulation de liaison terminee." : "Liaison terminee.");
      await loadItems();
    } catch (linkError) {
      setError(
        linkError instanceof Error ? linkError.message : "Impossible de lier les lignes mappees."
      );
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* M-17: Tab navigation to separate catalogue CRUD from liaison */}
      <div className="flex gap-1 rounded-xl bg-[var(--slate-100)] p-1">
        <button
          type="button"
          onClick={() => setActiveTab("catalogue")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "catalogue"
              ? "bg-white text-[var(--slate-900)] shadow-sm"
              : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
          }`}
        >
          Catalogue articles
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("liaison")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "liaison"
              ? "bg-white text-[var(--slate-900)] shadow-sm"
              : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
          }`}
        >
          Liaison lignes importees
        </button>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success && !linkSummary ? <div className="alert alert-success">{success}</div> : null}

      {/* ===== CATALOGUE TAB ===== */}
      {activeTab === "catalogue" ? (
        <>
          <section className="dashboard-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--slate-900)]">Catalogue articles</h2>
                <p className="text-sm text-[var(--slate-500)]">
                  Gerez les produits du catalogue (reference, designation, prix unitaire).
                </p>
              </div>

              <form
                className="flex w-full max-w-md items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearchTerm(searchInput.trim());
                }}
              >
                <input
                  className="form-input"
                  placeholder="Rechercher (reference ou designation)"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <button type="submit" className="btn btn-secondary">
                  Rechercher
                </button>
              </form>
            </div>

            <div className="mt-4 table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Designation</th>
                    <th>Prix HT</th>
                    {/* M-20: Display TVA as % */}
                    <th>TVA</th>
                    <th>Maj</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center text-[var(--slate-500)]">
                        Chargement...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center text-[var(--slate-500)]">
                        Aucun article catalogue.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium text-[var(--slate-900)]">
                          {item.reference ?? item.hex_code ?? "-"}
                        </td>
                        <td>{item.designation || "-"}</td>
                        <td>
                          {typeof item.unit_price_cents === "number"
                            ? formatEUR(item.unit_price_cents)
                            : "-"}
                        </td>
                        {/* M-20: TVA in percentage */}
                        <td>{formatTaxRate(item.tax_rate_bp)}</td>
                        <td>{formatDateTime(item.updated_at ?? item.created_at)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onEdit(item)}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => void onDelete(item)}
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="dashboard-card p-6">
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">
              {editingItem ? "Modifier un article" : "Ajouter un article"}
            </h2>

            <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
              <div>
                <label className="form-label" htmlFor="catalogue-reference">
                  Reference
                </label>
                <input
                  id="catalogue-reference"
                  className="form-input"
                  value={formState.reference}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, reference: event.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <label className="form-label" htmlFor="catalogue-designation">
                  Designation
                </label>
                <input
                  id="catalogue-designation"
                  className="form-input"
                  value={formState.designation}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, designation: event.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <label className="form-label" htmlFor="catalogue-unit-price">
                  Prix unitaire HT (EUR)
                </label>
                <input
                  id="catalogue-unit-price"
                  className="form-input"
                  value={formState.unit_price_euros}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, unit_price_euros: event.target.value }))
                  }
                  placeholder="0,00"
                />
              </div>

              <div>
                <label className="form-label" htmlFor="catalogue-tax-rate-bp">
                  Taux TVA
                </label>
                <input
                  id="catalogue-tax-rate-bp"
                  className="form-input"
                  value={formState.tax_rate_bp}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, tax_rate_bp: event.target.value }))
                  }
                  inputMode="numeric"
                />
                {/* M-20: Helper text explaining bp */}
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  En points de base (ex: 2000 = 20%, 550 = 5,5%)
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)] lg:col-span-2">
                <input
                  type="checkbox"
                  checked={formState.is_active}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                />
                Article actif
              </label>

              <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? "Enregistrement..." : editingItem ? "Mettre a jour" : "Ajouter"}
                </button>

                {editingItem ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={resetForm}
                    disabled={isSaving}
                  >
                    Annuler
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        </>
      ) : null}

      {/* ===== LIAISON TAB ===== */}
      {activeTab === "liaison" ? (
        <section className="dashboard-card p-6">
          {/* M-22: French title */}
          <h2 className="text-lg font-semibold text-[var(--slate-900)]">
            Liaison lignes importees &gt; catalogue
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Associe les lignes mappees par reference et designation aux produits du catalogue.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* M-16: Dropdown instead of UUID input */}
            <div className="lg:col-span-2">
              <label className="form-label" htmlFor="catalogue-link-import-id">
                Import source
              </label>
              <select
                id="catalogue-link-import-id"
                className="form-input form-select"
                value={linkImportId}
                onChange={(event) => setLinkImportId(event.target.value)}
              >
                <option value="">Selectionnez un import...</option>
                {availableImports.map((imp) => (
                  <option key={imp.id} value={imp.id}>
                    {imp.filename} - {imp.row_count} lignes ({imp.status})
                  </option>
                ))}
              </select>
            </div>

            {/* M-21: Advanced options */}
            <div className="flex items-end">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
              >
                {showAdvancedOptions ? "Masquer options" : "Options avancees"}
              </button>
            </div>
          </div>

          {showAdvancedOptions ? (
            <div className="mt-4 grid gap-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 lg:grid-cols-2">
              <div>
                {/* M-21: Renamed "Limite scan" */}
                <label className="form-label" htmlFor="catalogue-link-limit">
                  Nombre max de lignes a analyser
                </label>
                <input
                  id="catalogue-link-limit"
                  className="form-input"
                  type="number"
                  min={1}
                  max={5000}
                  value={linkLimit}
                  onChange={(event) => setLinkLimit(Number(event.target.value) || 1)}
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
                  <input
                    type="checkbox"
                    checked={linkCreateMissing}
                    onChange={(event) => setLinkCreateMissing(event.target.checked)}
                  />
                  Creer les articles manquants
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
                  <input
                    type="checkbox"
                    checked={linkUpdatePayload}
                    onChange={(event) => setLinkUpdatePayload(event.target.checked)}
                  />
                  Mettre a jour le payload mappe
                </label>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* M-21: Renamed "Dry run" */}
            <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
              <input
                type="checkbox"
                checked={linkDryRun}
                onChange={(event) => setLinkDryRun(event.target.checked)}
              />
              Simulation (sans modification)
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void onRunLinking()}
              disabled={isLinking || !linkImportId}
            >
              {isLinking ? "Traitement en cours..." : "Lancer la liaison"}
            </button>

            <Link href="/dashboard/mappings" className="btn btn-secondary">
              Retour au mapping
            </Link>
          </div>

          {/* M-18 + M-19: Detailed linking results */}
          {linkSummary ? (
            <div className="mt-6 space-y-4">
              {/* M-19: Completion summary */}
              <div className={`rounded-xl border p-4 ${
                linkSummary.unmatched_count === 0
                  ? "border-[var(--success)] bg-[var(--success-light)]"
                  : "border-[var(--warning)] bg-amber-50"
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    linkSummary.unmatched_count === 0
                      ? "bg-[var(--success)] text-white"
                      : "bg-amber-400 text-white"
                  }`}>
                    {linkSummary.unmatched_count === 0 ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--slate-900)]">
                      {linkSummary.dry_run ? "Simulation terminee" : "Liaison terminee"}
                    </p>
                    <p className="text-sm text-[var(--slate-600)]">
                      {linkSummary.scanned_rows > 0
                        ? `Taux de liaison : ${Math.round((linkSummary.linked_count / linkSummary.scanned_rows) * 100)} %`
                        : "Aucune ligne scannee"
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Summary counters */}
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Scannees</p>
                  <p className="mt-1 text-lg font-bold text-[var(--slate-900)]">{linkSummary.scanned_rows}</p>
                </div>
                <div className="rounded-xl border border-[var(--success)]/30 bg-[var(--success-light)] px-4 py-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--success)]">Liees</p>
                  <p className="mt-1 text-lg font-bold text-[var(--success)]">{linkSummary.linked_count}</p>
                </div>
                <div className="rounded-xl border border-[var(--info)]/30 bg-[var(--info-light)] px-4 py-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--info)]">Creees catalogue</p>
                  <p className="mt-1 text-lg font-bold text-[var(--info)]">{linkSummary.created_catalogue_count}</p>
                </div>
                <div className={`rounded-xl border px-4 py-3 text-center ${
                  linkSummary.unmatched_count > 0
                    ? "border-red-200 bg-red-50"
                    : "border-[var(--slate-200)] bg-[var(--slate-50)]"
                }`}>
                  <p className={`text-[11px] uppercase tracking-wide ${
                    linkSummary.unmatched_count > 0 ? "text-red-500" : "text-[var(--slate-500)]"
                  }`}>Sans match</p>
                  <p className={`mt-1 text-lg font-bold ${
                    linkSummary.unmatched_count > 0 ? "text-red-600" : "text-[var(--slate-900)]"
                  }`}>{linkSummary.unmatched_count}</p>
                </div>
              </div>

              {/* M-19: Next step link */}
              {!linkSummary.dry_run && linkSummary.linked_count > 0 ? (
                <div className="flex items-center gap-3">
                  <Link
                    href="/dashboard/imports"
                    className="btn btn-primary"
                  >
                    Retour aux imports
                  </Link>
                  <p className="text-sm text-[var(--slate-500)]">
                    Flux termine. Vous pouvez lancer un nouvel import ou consulter le catalogue.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
