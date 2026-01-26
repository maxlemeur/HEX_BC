"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { formatEUR, parseEuroToCents } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Product = {
  id: string;
  created_at: string;
  reference: string | null;
  designation: string;
  unit_price_cents: number;
  tax_rate_bp: number;
  is_active: boolean;
};

const TAX_RATE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "0%", value: 0 },
  { label: "5,5%", value: 550 },
  { label: "10%", value: 1000 },
  { label: "20%", value: 2000 },
];

// Filter options for TVA
const TAX_FILTER_OPTIONS = TAX_RATE_OPTIONS.map((opt) => ({
  value: String(opt.value),
  label: opt.label,
}));

// Filter configuration
const PRODUCTS_FILTERS: FilterConfig[] = [
  {
    type: "multi-select",
    key: "tax_rate_bp",
    label: "Taux TVA",
    placeholder: "Tous les taux",
    options: TAX_FILTER_OPTIONS,
  },
];

// Sort options
const PRODUCTS_SORT_OPTIONS: SortOption[] = [
  { key: "designation", label: "Designation", defaultDirection: "asc" },
  { key: "unit_price_cents", label: "Prix HT" },
  { key: "created_at", label: "Date d'ajout", defaultDirection: "desc" },
];

function taxLabelFromBp(taxRateBp: number) {
  const match = TAX_RATE_OPTIONS.find((x) => x.value === taxRateBp);
  if (match) return match.label;
  return `${(taxRateBp / 100).toFixed(2)}%`;
}

export default function ProductsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Form state
  const [reference, setReference] = useState("");
  const [designation, setDesignation] = useState("");
  const [unitPriceEuros, setUnitPriceEuros] = useState("");
  const [taxRateBp, setTaxRateBp] = useState<number>(2000);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const referenceFieldRef = useRef<HTMLInputElement | null>(null);

  // Filtered products state
  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Product[];
  }, [supabase]);

  const {
    data: products = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<Product[]>("products", fetchProducts, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setFormError(null);
    setCreating(false);
    setReference("");
    setDesignation("");
    setUnitPriceEuros("");
    setTaxRateBp(2000);
  }, []);

  const openCreateForm = useCallback(() => {
    setFormError(null);
    setCreating(false);
    setReference("");
    setDesignation("");
    setUnitPriceEuros("");
    setTaxRateBp(2000);
    setIsFormOpen(true);
  }, []);

  useEffect(() => {
    if (!isFormOpen) return;
    const timeout = window.setTimeout(() => {
      referenceFieldRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isFormOpen]);

  useEffect(() => {
    if (!isFormOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFormOpen]);

  useEffect(() => {
    if (!isFormOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) {
        closeForm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeForm, creating, isFormOpen]);

  async function onCreateProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const unitPriceCents = parseEuroToCents(unitPriceEuros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setFormError("Prix unitaire invalide.");
      return;
    }

    setCreating(true);

    const { error: insertError } = await supabase.from("products").insert({
      reference: reference.trim() || null,
      designation: designation.trim(),
      unit_price_cents: unitPriceCents,
      tax_rate_bp: taxRateBp,
      is_active: true,
    });

    setCreating(false);

    if (insertError) {
      setFormError(insertError.message);
      return;
    }

    setReference("");
    setDesignation("");
    setUnitPriceEuros("");
    setTaxRateBp(2000);
    await mutate();
    closeForm();
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Produits</h1>
          <p className="page-description">
            Catalogue des produits avec prix et taux de TVA.
          </p>
        </div>
        <button
          className="btn btn-primary btn-lg"
          type="button"
          onClick={openCreateForm}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Ajouter un produit
        </button>
      </div>

      {isFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => {
              if (!creating) closeForm();
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--success)]/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--success)"
                    strokeWidth="1.75"
                  >
                    <path d="m7.5 4.27 9 5.15" />
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                    <path d="m3.3 7 8.7 5 8.7-5" />
                    <path d="M12 22V12" />
                  </svg>
                </div>
                <div>
                  <h2 id="product-modal-title" className="text-lg font-semibold text-[var(--slate-800)]">
                    Ajouter un produit
                  </h2>
                  <p className="text-sm text-[var(--slate-500)]">
                    Renseignez les informations du nouveau produit.
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={closeForm}
                disabled={creating}
              >
                Fermer
              </button>
            </div>

            <form className="grid gap-5 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-4" onSubmit={onCreateProduct}>
              <div>
                <label className="form-label" htmlFor="product-reference">Reference</label>
                <input
                  ref={referenceFieldRef}
                  id="product-reference"
                  name="reference"
                  autoComplete="off"
                  className="form-input"
                  placeholder="REF-001"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-1">
                <label className="form-label" htmlFor="product-designation">Designation *</label>
                <input
                  id="product-designation"
                  name="designation"
                  autoComplete="off"
                  className="form-input"
                  placeholder="Nom du produit"
                  required
                  value={designation}
                  onChange={(event) => setDesignation(event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-price">Prix unitaire HT</label>
                <div className="relative">
                  <input
                    id="product-price"
                    name="unit-price"
                    autoComplete="off"
                    className="form-input pr-12"
                    inputMode="decimal"
                    placeholder="12,50"
                    required
                    value={unitPriceEuros}
                    onChange={(event) => setUnitPriceEuros(event.target.value)}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--slate-400)]" aria-hidden="true">
                    EUR
                  </span>
                </div>
              </div>

              <div>
                <label className="form-label" htmlFor="product-tax">Taux TVA</label>
                <select
                  id="product-tax"
                  name="tax-rate"
                  className="form-input form-select"
                  value={taxRateBp}
                  onChange={(event) => setTaxRateBp(Number(event.target.value))}
                >
                  {TAX_RATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-4 pt-2">
                {formError ? (
                  <div className="alert alert-error flex-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m15 9-6 6" />
                      <path d="m9 9 6 6" />
                    </svg>
                    {formError}
                  </div>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-3">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={closeForm}
                    disabled={creating}
                  >
                    Annuler
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={creating}
                    type="submit"
                  >
                    {creating ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                        Ajout en cours...
                      </>
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                        Ajouter le produit
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Filter Bar */}
      <TableFilterBar
        data={products}
        onDataChange={setDisplayedProducts}
        search={{
          placeholder: "Rechercher par designation ou reference...",
          fields: ["designation", "reference"],
        }}
        filters={PRODUCTS_FILTERS}
        sortOptions={PRODUCTS_SORT_OPTIONS}
        resultCountLabel="produits"
        showResultCount
      />

      {/* Table card */}
      <div className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Catalogue produits
          </h2>
          <button
            className="btn btn-secondary btn-sm"
            disabled={isValidating}
            onClick={() => void mutate()}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={isValidating ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {isValidating ? "Chargement..." : "Actualiser"}
          </button>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            {loadError.message}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Designation</th>
                <th>Reference</th>
                <th className="text-right">Prix HT</th>
                <th className="text-center">TVA</th>
              </tr>
            </thead>
            <tbody>
              {displayedProducts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--success)]"></div>
                        <span className="text-[var(--slate-500)]">Chargement...</span>
                      </div>
                    ) : products.length === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <path d="m7.5 4.27 9 5.15" />
                            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                            <path d="m3.3 7 8.7 5 8.7-5" />
                            <path d="M12 22V12" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun produit</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Cliquez sur le bouton Ajouter un produit pour demarrer.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun resultat</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Modifiez vos filtres pour voir plus de resultats.</p>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                displayedProducts.map((product, index) => (
                  <tr
                    key={product.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 0.03}s` }}
                  >
                    <td className="font-semibold text-[var(--slate-800)]">
                      {product.designation}
                    </td>
                    <td>
                      {product.reference ? (
                        <span className="inline-flex items-center rounded-md bg-[var(--slate-100)] px-2 py-1 font-mono text-xs font-medium text-[var(--slate-600)]">
                          {product.reference}
                        </span>
                      ) : (
                        <span className="text-[var(--slate-400)]">-</span>
                      )}
                    </td>
                    <td className="text-right font-mono font-semibold text-[var(--slate-800)]">
                      {formatEUR(product.unit_price_cents)}
                    </td>
                    <td className="text-center">
                      <span className="inline-flex items-center rounded-full bg-[var(--success)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--success)]">
                        {taxLabelFromBp(product.tax_rate_bp)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
