"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";
import type { SupplierPrice } from "@/components/catalogue/types";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  DEFAULT_STALE_PRICE_DAYS,
  isPriceStale,
  parseStalePriceDays,
} from "@/lib/catalogue/stale-prices";
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
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toEuroInput(unitPriceCents: number | undefined) {
  if (typeof unitPriceCents !== "number") return "";
  return (unitPriceCents / 100).toFixed(2).replace(".", ",");
}

export function PricesManager() {
  const { value: stalePriceDaysValue } = useFeatureFlag("STALE_PRICE_DAYS");
  const stalePriceDays = useMemo(
    () => parseStalePriceDays(stalePriceDaysValue, DEFAULT_STALE_PRICE_DAYS),
    [stalePriceDaysValue]
  );
  const [items, setItems] = useState<SupplierPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchSupplierId, setSearchSupplierId] = useState("");
  const [searchProductId, setSearchProductId] = useState("");
  const [staleOnly, setStaleOnly] = useState(false);
  const [formState, setFormState] = useState<SupplierPriceFormState>(EMPTY_FORM);
  const [bulkPayload, setBulkPayload] = useState(() =>
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
  const [showBulkJson, setShowBulkJson] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Resolution noms ---
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; designation: string; reference?: string | null }[]>([]);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const supplierMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p.designation])), [products]);

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: s.name })),
    [suppliers]
  );
  const productOptions = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.designation, keywords: [p.reference ?? ""].filter(Boolean) })),
    [products]
  );

  useEffect(() => {
    async function loadLookups() {
      const [sr, pr] = await Promise.all([
        supabase.from("suppliers").select("id, name").order("name"),
        supabase.from("products").select("id, designation, reference").order("designation"),
      ]);
      setSuppliers((sr.data ?? []) as { id: string; name: string }[]);
      setProducts((pr.data ?? []) as { id: string; designation: string; reference?: string | null }[]);
    }
    void loadLookups();
  }, [supabase]);

  // --- Feedback formulaire ---
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const formSectionRef = useRef<HTMLElement>(null);

  const displayedItems = useMemo(() => {
    if (!staleOnly) return items;

    const now = new Date();
    return items.filter((item) =>
      isPriceStale(
        {
          updatedAt: item.updated_at ?? null,
          createdAt: item.created_at ?? null,
        },
        stalePriceDays,
        now
      )
    );
  }, [items, staleOnly, stalePriceDays]);

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

  useEffect(() => {
    if (editingId && formSectionRef.current) {
      formSectionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [editingId]);

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setFormError(null);
    setFormSuccess(null);
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
    setFormError(null);
    setFormSuccess(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitPriceCents = parseEuroToCents(formState.unit_price_euros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setFormError("Prix unitaire invalide.");
      return;
    }

    if (!formState.supplier_id.trim() || !formState.product_id.trim()) {
      setFormError("Le fournisseur et le produit sont requis.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    setFormSuccess(null);

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

        setFormSuccess("Prix fournisseur mis a jour.");
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

        setFormSuccess("Prix fournisseur cree.");
      }

      resetForm();
      await loadItems();
    } catch (saveError) {
      setFormError(
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
      setError("Le JSON saisi est invalide.");
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

      setSuccess(`Creation en masse terminee : ${result.created_count} ligne(s) creee(s).`);
      await loadItems();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Impossible d'executer la creation en masse."
      );
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PriceBookCsvImport onImported={loadItems} lookups={{ suppliers, products }} />

      <section className="dashboard-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Prix fournisseur</h2>
            <p className="text-sm text-[var(--slate-500)]">
              Liste des prix fournisseurs enregistres.
            </p>
          </div>

          <button type="button" className="btn btn-secondary" onClick={() => void loadItems()}>
            Rafraichir
          </button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="prices-filter-supplier">
              Filtrer par fournisseur
            </label>
            <SearchableSelect
              id="prices-filter-supplier"
              value={searchSupplierId}
              options={[{ value: "", label: "Tous les fournisseurs" }, ...supplierOptions]}
              placeholder="Tous les fournisseurs"
              onValueChange={(val) => setSearchSupplierId(val)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="prices-filter-product">
              Filtrer par produit
            </label>
            <SearchableSelect
              id="prices-filter-product"
              value={searchProductId}
              options={[{ value: "", label: "Tous les produits" }, ...productOptions]}
              placeholder="Tous les produits"
              onValueChange={(val) => setSearchProductId(val)}
            />
          </div>
        </div>
        <label
          className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--slate-700)]"
          title={`Affiche uniquement les prix non mis a jour depuis plus de ${stalePriceDays} jours`}
        >
          <input
            type="checkbox"
            checked={staleOnly}
            onChange={(event) => setStaleOnly(event.target.checked)}
          />
          Prix anciens seulement (non mis a jour depuis {stalePriceDays} jours)
        </label>

        {error ? <div className="alert alert-error mt-4">{error}</div> : null}
        {success ? <div className="alert alert-success mt-4">{success}</div> : null}

        {!isLoading && items.length > 0 ? (
          <p className="mt-4 text-xs text-[var(--slate-500)]">
            Affichage de {displayedItems.length} prix{staleOnly && items.length !== displayedItems.length ? ` sur ${items.length} charges` : ""}
          </p>
        ) : null}

        <div className="mt-2 table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Produit</th>
                <th>Prix</th>
                <th>Validite</th>
                <th>Mis a jour le</th>
                <th title="Indique si le prix n'a pas ete mis a jour depuis longtemps">Fraicheur</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--slate-500)]">
                    Chargement...
                  </td>
                </tr>
              ) : displayedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--slate-500)]">
                    Aucun prix fournisseur.
                  </td>
                </tr>
              ) : (
                displayedItems.map((item) => {
                  const stale = isPriceStale(
                    {
                      updatedAt: item.updated_at ?? null,
                      createdAt: item.created_at ?? null,
                    },
                    stalePriceDays
                  );

                  return (
                    <tr key={item.id}>
                      <td className="text-sm text-[var(--slate-700)]">
                        {supplierMap.get(item.supplier_id) ?? item.supplier_id}
                      </td>
                      <td className="text-sm text-[var(--slate-700)]">
                        {productMap.get(item.product_id ?? item.catalogue_item_id ?? "") ??
                          item.product_id ?? item.catalogue_item_id}
                      </td>
                      <td className="font-medium text-[var(--slate-900)]">
                        {typeof item.unit_price_cents === "number"
                          ? formatEUR(item.unit_price_cents)
                          : "-"}
                        {item.currency ? ` ${item.currency}` : ""}
                      </td>
                      <td>
                        {item.valid_from || item.valid_to ? (
                          <>{formatDate(item.valid_from)} {"\u2192"} {item.valid_to ? formatDate(item.valid_to) : "(illimite)"}</>
                        ) : (
                          <span className="text-[var(--slate-400)]">Non definie</span>
                        )}
                      </td>
                      <td>{formatDate(item.updated_at ?? item.created_at)}</td>
                      <td>
                        {stale ? (
                          <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Prix ancien
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section ref={formSectionRef} className="dashboard-card p-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">
          {editingId ? "Modifier un prix fournisseur" : "Ajouter un prix fournisseur"}
        </h2>
        {formError ? <div className="alert alert-error mt-2">{formError}</div> : null}
        {formSuccess ? <div className="alert alert-success mt-2">{formSuccess}</div> : null}

        <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="form-label" htmlFor="price-supplier-id">
              Fournisseur
            </label>
            <SearchableSelect
              id="price-supplier-id"
              value={formState.supplier_id}
              options={supplierOptions}
              placeholder="Rechercher un fournisseur..."
              required
              onValueChange={(val) => setFormState((p) => ({ ...p, supplier_id: val }))}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-product-id">
              Produit
            </label>
            <SearchableSelect
              id="price-product-id"
              value={formState.product_id}
              options={productOptions}
              placeholder="Rechercher un produit..."
              required
              onValueChange={(val) => setFormState((p) => ({ ...p, product_id: val }))}
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
            <select
              id="price-currency"
              className="form-input"
              value={formState.currency}
              onChange={(e) => setFormState((p) => ({ ...p, currency: e.target.value }))}
            >
              <option value="EUR">EUR - Euro</option>
              <option value="USD">USD - Dollar US</option>
              <option value="GBP">GBP - Livre sterling</option>
            </select>
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
              placeholder="ex: Devis, Catalogue, Site web..."
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
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowBulkJson((prev) => !prev)}
        >
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Mode avance</h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Collez un tableau JSON pour creer plusieurs prix en une seule fois.
            </p>
          </div>
          <span className="text-[var(--slate-400)] text-lg">{showBulkJson ? "\u25B2" : "\u25BC"}</span>
        </button>

        {showBulkJson ? (
          <>
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
                {isBulkRunning ? "Traitement..." : "Lancer la creation en masse"}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
