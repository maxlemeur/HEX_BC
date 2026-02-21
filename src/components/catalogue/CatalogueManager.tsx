"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { CatalogueItem } from "@/components/catalogue/types";
import { formatEUR, parseEuroToCents } from "@/lib/money";

type CatalogueListResponse = {
  items: CatalogueItem[];
};

type LinkMappedRowsResponse = {
  import_id: string;
  scanned_rows: number;
  linked_count: number;
  created_catalogue_count: number;
  unmatched_count: number;
  dry_run: boolean;
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

export function CatalogueManager() {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [formState, setFormState] = useState<CatalogueFormState>(EMPTY_FORM);
  const [linkImportId, setLinkImportId] = useState("");
  const [linkLimit, setLinkLimit] = useState(1000);
  const [linkCreateMissing, setLinkCreateMissing] = useState(true);
  const [linkUpdatePayload, setLinkUpdatePayload] = useState(true);
  const [linkDryRun, setLinkDryRun] = useState(false);
  const [linkSummary, setLinkSummary] = useState<LinkMappedRowsResponse | null>(null);
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

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

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
      setError("Taux TVA (bp) invalide.");
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
      setError("L'identifiant d'import est requis pour la liaison.");
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
      <section className="dashboard-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Catalogue articles</h2>
            <p className="text-sm text-[var(--slate-500)]">
              Gere les produits du catalogue (`reference`, `designation`, prix unitaire).
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

        {error ? <div className="alert alert-error mt-4">{error}</div> : null}
        {success ? <div className="alert alert-success mt-4">{success}</div> : null}

        <div className="mt-4 table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Designation</th>
                <th>Prix HT</th>
                <th>TVA (bp)</th>
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
                    <td>{typeof item.tax_rate_bp === "number" ? item.tax_rate_bp : "-"}</td>
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
              Taux TVA (bp)
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

      <section className="dashboard-card p-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">
          Liaison mapped rows {'->'} catalogue
        </h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Associe les lignes mappees par `hex_code` / `designation` aux produits (`reference`).
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className="form-label" htmlFor="catalogue-link-import-id">
              Import ID
            </label>
            <input
              id="catalogue-link-import-id"
              className="form-input"
              value={linkImportId}
              onChange={(event) => setLinkImportId(event.target.value)}
              placeholder="UUID de dpgf_imports"
            />
          </div>

          <div>
            <label className="form-label" htmlFor="catalogue-link-limit">
              Limite scan
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
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
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
          <label className="inline-flex items-center gap-2 text-sm text-[var(--slate-700)]">
            <input
              type="checkbox"
              checked={linkDryRun}
              onChange={(event) => setLinkDryRun(event.target.checked)}
            />
            Dry run
          </label>
        </div>

        <div className="mt-4">
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void onRunLinking()}
            disabled={isLinking}
          >
            {isLinking ? "Traitement..." : "Lancer la liaison"}
          </button>
        </div>

        {linkSummary ? (
          <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-700)]">
            <p>
              Import: <strong>{linkSummary.import_id}</strong>
            </p>
            <p>
              Scannees: <strong>{linkSummary.scanned_rows}</strong>
            </p>
            <p>
              Liees: <strong>{linkSummary.linked_count}</strong>
            </p>
            <p>
              Creees catalogue: <strong>{linkSummary.created_catalogue_count}</strong>
            </p>
            <p>
              Sans match: <strong>{linkSummary.unmatched_count}</strong>
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
