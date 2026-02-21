"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierPrice } from "@/components/catalogue/types";
import { formatEUR, parseEuroToCents } from "@/lib/money";

type PricesListResponse = {
  items: SupplierPrice[];
};

type SupplierPriceFormState = {
  supplier_id: string;
  product_id: string;
  unit_price_euros: string;
  currency: string;
  valid_from: string;
  valid_to: string;
  source: string;
  notes: string;
};

const EMPTY_FORM: SupplierPriceFormState = {
  supplier_id: "",
  product_id: "",
  unit_price_euros: "",
  currency: "EUR",
  valid_from: "",
  valid_to: "",
  source: "",
  notes: "",
};

function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  return value;
}

function toEuroInput(unitPriceCents: number | undefined) {
  if (typeof unitPriceCents !== "number") return "";
  return (unitPriceCents / 100).toFixed(2).replace(".", ",");
}

export function PricesManager() {
  const [items, setItems] = useState<SupplierPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchSupplierId, setSearchSupplierId] = useState("");
  const [searchProductId, setSearchProductId] = useState("");
  const [formState, setFormState] = useState<SupplierPriceFormState>(EMPTY_FORM);
  const [bulkPayload, setBulkPayload] = useState(
    JSON.stringify(
      [
        {
          supplier_id: "",
          product_id: "",
          unit_price_cents: 0,
          currency: "EUR",
          valid_from: null,
          valid_to: null,
          source: null,
          notes: null,
        },
      ],
      null,
      2
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      query.set("limit", "400");
      if (searchSupplierId.trim()) {
        query.set("supplier_id", searchSupplierId.trim());
      }
      if (searchProductId.trim()) {
        query.set("product_id", searchProductId.trim());
      }

      const data = await fetchApi<PricesListResponse>(`/api/prices?${query.toString()}`);
      setItems(data.items ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les prix fournisseur."
      );
    } finally {
      setIsLoading(false);
    }
  }, [searchProductId, searchSupplierId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }

  function onEdit(item: SupplierPrice) {
    setEditingId(item.id);
    setFormState({
      supplier_id: item.supplier_id ?? "",
      product_id: item.product_id ?? item.catalogue_item_id ?? "",
      unit_price_euros: toEuroInput(item.unit_price_cents),
      currency: item.currency ?? "EUR",
      valid_from: item.valid_from ?? "",
      valid_to: item.valid_to ?? "",
      source: item.source ?? "",
      notes: item.notes ?? "",
    });
    setError(null);
    setSuccess(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitPriceCents = parseEuroToCents(formState.unit_price_euros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setError("Prix unitaire invalide.");
      return;
    }

    if (!formState.supplier_id.trim() || !formState.product_id.trim()) {
      setError("supplier_id et product_id sont requis.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            item: {
              supplier_id: formState.supplier_id.trim(),
              product_id: formState.product_id.trim(),
              unit_price_cents: unitPriceCents,
              currency: formState.currency.trim().toUpperCase() || "EUR",
              valid_from: formState.valid_from || null,
              valid_to: formState.valid_to || null,
              source: formState.source.trim() || null,
              notes: formState.notes.trim() || null,
            },
          }),
        });

        setSuccess("Prix fournisseur mis a jour.");
      } else {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            item: {
              supplier_id: formState.supplier_id.trim(),
              product_id: formState.product_id.trim(),
              unit_price_cents: unitPriceCents,
              currency: formState.currency.trim().toUpperCase() || "EUR",
              valid_from: formState.valid_from || null,
              valid_to: formState.valid_to || null,
              source: formState.source.trim() || null,
              notes: formState.notes.trim() || null,
            },
          }),
        });

        setSuccess("Prix fournisseur cree.");
      }

      resetForm();
      await loadItems();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer le prix fournisseur."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(item: SupplierPrice) {
    if (!window.confirm("Supprimer ce prix fournisseur ?")) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await fetchApi<{ deleted_id: string }>("/api/prices", {
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

      setSuccess("Prix fournisseur supprime.");
      await loadItems();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer le prix fournisseur."
      );
    }
  }

  async function onBulkCreate() {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(bulkPayload);
    } catch {
      setError("Le JSON de bulk create est invalide.");
      return;
    }

    setIsBulkRunning(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchApi<{ created_count: number; mode: string }>("/api/prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "bulk-create",
          items: parsedPayload,
        }),
      });

      setSuccess(`Bulk create termine: ${result.created_count} lignes (${result.mode}).`);
      await loadItems();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Impossible d'executer le bulk create."
      );
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="dashboard-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Prix fournisseur</h2>
            <p className="text-sm text-[var(--slate-500)]">
              CRUD + operation bulk create via endpoint RPC/fallback.
            </p>
          </div>

          <button type="button" className="btn btn-secondary" onClick={() => void loadItems()}>
            Rafraichir
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="prices-filter-supplier">
              Filtre supplier_id
            </label>
            <input
              id="prices-filter-supplier"
              className="form-input"
              value={searchSupplierId}
              onChange={(event) => setSearchSupplierId(event.target.value)}
              placeholder="UUID fournisseur"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="prices-filter-product">
              Filtre product_id
            </label>
            <input
              id="prices-filter-product"
              className="form-input"
              value={searchProductId}
              onChange={(event) => setSearchProductId(event.target.value)}
              placeholder="UUID produit"
            />
          </div>
        </div>

        {error ? <div className="alert alert-error mt-4">{error}</div> : null}
        {success ? <div className="alert alert-success mt-4">{success}</div> : null}

        <div className="mt-4 table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Supplier ID</th>
                <th>Product ID</th>
                <th>Prix</th>
                <th>Validite</th>
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
                    Aucun prix fournisseur.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-xs text-[var(--slate-700)]">{item.supplier_id}</td>
                    <td className="font-mono text-xs text-[var(--slate-700)]">
                      {item.product_id ?? item.catalogue_item_id}
                    </td>
                    <td className="font-medium text-[var(--slate-900)]">
                      {typeof item.unit_price_cents === "number"
                        ? formatEUR(item.unit_price_cents)
                        : "-"}
                      {item.currency ? ` ${item.currency}` : ""}
                    </td>
                    <td>
                      {formatDate(item.valid_from)} {'->'} {formatDate(item.valid_to)}
                    </td>
                    <td>{item.updated_at ?? item.created_at ?? "-"}</td>
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
          {editingId ? "Modifier un prix fournisseur" : "Ajouter un prix fournisseur"}
        </h2>

        <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="form-label" htmlFor="price-supplier-id">
              Supplier ID
            </label>
            <input
              id="price-supplier-id"
              className="form-input"
              value={formState.supplier_id}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, supplier_id: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-product-id">
              Product ID
            </label>
            <input
              id="price-product-id"
              className="form-input"
              value={formState.product_id}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, product_id: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-unit-price">
              Prix unitaire HT (EUR)
            </label>
            <input
              id="price-unit-price"
              className="form-input"
              value={formState.unit_price_euros}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, unit_price_euros: event.target.value }))
              }
              placeholder="0,00"
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-currency">
              Devise
            </label>
            <input
              id="price-currency"
              className="form-input"
              value={formState.currency}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, currency: event.target.value }))
              }
              placeholder="EUR"
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-valid-from">
              Valide du
            </label>
            <input
              id="price-valid-from"
              type="date"
              className="form-input"
              value={formState.valid_from}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, valid_from: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-valid-to">
              Valide au
            </label>
            <input
              id="price-valid-to"
              type="date"
              className="form-input"
              value={formState.valid_to}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, valid_to: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-source">
              Source
            </label>
            <input
              id="price-source"
              className="form-input"
              value={formState.source}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, source: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-notes">
              Notes
            </label>
            <input
              id="price-notes"
              className="form-input"
              value={formState.notes}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, notes: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Enregistrement..." : editingId ? "Mettre a jour" : "Ajouter"}
            </button>

            {editingId ? (
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
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">Bulk create prix fournisseur</h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Envoi direct vers `/api/prices` action `bulk-create`.
        </p>

        <textarea
          className="form-input form-textarea mt-4 font-mono text-xs"
          value={bulkPayload}
          onChange={(event) => setBulkPayload(event.target.value)}
          spellCheck={false}
          rows={12}
        />

        <div className="mt-4">
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void onBulkCreate()}
            disabled={isBulkRunning}
          >
            {isBulkRunning ? "Traitement..." : "Executer bulk create"}
          </button>
        </div>
      </section>
    </div>
  );
}
