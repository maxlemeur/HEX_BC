"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { ProductCsvImport } from "@/components/products/ProductCsvImport";
import { priceFreshnessLevel, type PriceFreshnessLevel } from "@/lib/catalogue/stale-prices";
import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  ProductFormModal,
  type ProductPayload,
  type ProductRecord,
} from "./ProductFormModal";

type SupplierPriceRow = {
  id: string;
  product_id: string;
  supplier_id: string;
  unit_price_cents: number;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
};

type ProductPageData = {
  products: ProductRecord[];
  supplierPrices: SupplierPriceRow[];
  suppliers: SupplierRow[];
};

type ProductView = ProductRecord & {
  _status: "active" | "archived";
  _priceStatus: "none" | PriceFreshnessLevel;
  _supplierPriceCount: number;
  _bestSupplierPriceCents: number | null;
  _bestSupplierName: string | null;
  _bestSupplierPriceUpdatedAt: string | null;
};

const PRODUCT_SORT_OPTIONS: SortOption[] = [
  { key: "designation", label: "Désignation", defaultDirection: "asc" },
  { key: "material", label: "Matière", defaultDirection: "asc" },
  { key: "unit_price_cents", label: "Prix de référence" },
  { key: "_bestSupplierPriceCents", label: "Meilleur prix fournisseur" },
  { key: "updated_at", label: "Dernière modification", defaultDirection: "desc" },
];

const PRICE_STATUS_OPTIONS = [
  { value: "fresh", label: "Prix à jour (< 30 j)" },
  { value: "aging", label: "Prix vieillissant (30–90 j)" },
  { value: "stale", label: "Prix ancien (> 90 j)" },
  { value: "none", label: "Sans prix fournisseur" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Actifs" },
  { value: "archived", label: "Archivés" },
];

function taxLabelFromBp(taxRateBp: number) {
  if (taxRateBp % 100 === 0) return `${taxRateBp / 100} %`;
  return `${(taxRateBp / 100).toFixed(1).replace(".", ",")} %`;
}

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
  )
    .sort((left, right) => left.localeCompare(right, "fr"))
    .map((value) => ({ value, label: value }));
}

function isCurrentlyValidPrice(price: SupplierPriceRow, today: string) {
  if (price.is_active === false) return false;
  if (price.valid_from && price.valid_from > today) return false;
  if (price.valid_to && price.valid_to < today) return false;
  return true;
}

function freshnessLabel(status: ProductView["_priceStatus"]) {
  switch (status) {
    case "fresh":
      return "À jour";
    case "aging":
      return "À surveiller";
    case "stale":
      return "À revalider";
    default:
      return "Sans prix";
  }
}

function freshnessClass(status: ProductView["_priceStatus"]) {
  switch (status) {
    case "fresh":
      return "bg-emerald-50 text-emerald-700";
    case "aging":
      return "bg-amber-50 text-amber-700";
    case "stale":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export default function ProductsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [displayedProducts, setDisplayedProducts] = useState<ProductView[]>([]);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const fetchPageData = useCallback(async (): Promise<ProductPageData> => {
    const [productsResult, pricesResult, suppliersResult] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase
        .from("supplier_pricebook")
        .select("id, product_id, supplier_id, unit_price_cents, valid_from, valid_to, is_active, created_at, updated_at")
        .limit(5000),
      supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
    ]);

    if (productsResult.error) throw productsResult.error;
    if (pricesResult.error) throw pricesResult.error;
    if (suppliersResult.error) throw suppliersResult.error;

    return {
      products: (productsResult.data ?? []) as ProductRecord[],
      supplierPrices: (pricesResult.data ?? []) as SupplierPriceRow[],
      suppliers: (suppliersResult.data ?? []) as SupplierRow[],
    };
  }, [supabase]);

  const {
    data = { products: [], supplierPrices: [], suppliers: [] },
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<ProductPageData>("products-page-with-pricing", fetchPageData, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const products = useMemo<ProductView[]>(() => {
    const supplierNames = new Map(data.suppliers.map((supplier) => [supplier.id, supplier.name]));
    const pricesByProduct = new Map<string, SupplierPriceRow[]>();
    const today = new Date().toISOString().slice(0, 10);

    for (const price of data.supplierPrices) {
      if (!isCurrentlyValidPrice(price, today)) continue;
      const rows = pricesByProduct.get(price.product_id) ?? [];
      rows.push(price);
      pricesByProduct.set(price.product_id, rows);
    }

    return data.products.map((product) => {
      const supplierPrices = pricesByProduct.get(product.id) ?? [];
      const bestPrice = supplierPrices.reduce<SupplierPriceRow | null>((best, candidate) => {
        if (!best || candidate.unit_price_cents < best.unit_price_cents) return candidate;
        return best;
      }, null);
      const freshness = bestPrice
        ? priceFreshnessLevel({
            updatedAt: bestPrice.updated_at ?? null,
            createdAt: bestPrice.created_at ?? null,
          }).level
        : "none";

      return {
        ...product,
        category: product.category ?? null,
        product_type: product.product_type ?? null,
        material: product.material ?? null,
        grade: product.grade ?? null,
        dimensions: product.dimensions ?? null,
        standard: product.standard ?? null,
        unit: product.unit ?? "u",
        _status: product.is_active ? "active" : "archived",
        _priceStatus: freshness,
        _supplierPriceCount: supplierPrices.length,
        _bestSupplierPriceCents: bestPrice?.unit_price_cents ?? null,
        _bestSupplierName: bestPrice ? supplierNames.get(bestPrice.supplier_id) ?? null : null,
        _bestSupplierPriceUpdatedAt: bestPrice?.updated_at ?? bestPrice?.created_at ?? null,
      };
    });
  }, [data.products, data.supplierPrices, data.suppliers]);

  const productFilters = useMemo<FilterConfig[]>(
    () => [
      {
        type: "multi-select",
        key: "material",
        label: "Matière",
        placeholder: "Toutes les matières",
        options: uniqueOptions(products.map((product) => product.material)),
      },
      {
        type: "multi-select",
        key: "category",
        label: "Famille",
        placeholder: "Toutes les familles",
        options: uniqueOptions(products.map((product) => product.category)),
      },
      {
        type: "multi-select",
        key: "unit",
        label: "Unité",
        placeholder: "Toutes les unités",
        options: uniqueOptions(products.map((product) => product.unit)),
      },
      {
        type: "multi-select",
        key: "_priceStatus",
        label: "État des prix",
        placeholder: "Tous les prix",
        options: PRICE_STATUS_OPTIONS,
      },
      {
        type: "multi-select",
        key: "_status",
        label: "Statut",
        placeholder: "Tous les statuts",
        options: STATUS_OPTIONS,
      },
    ],
    [products]
  );

  const stats = useMemo(() => {
    const active = products.filter((product) => product.is_active).length;
    const withoutSupplierPrice = products.filter((product) => product._priceStatus === "none").length;
    const stale = products.filter((product) => product._priceStatus === "stale").length;
    const covered = products.filter((product) => product._supplierPriceCount > 0).length;
    return { active, withoutSupplierPrice, stale, covered };
  }, [products]);

  function openCreateForm() {
    setEditingProduct(null);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openEditForm(product: ProductRecord) {
    setEditingProduct(product);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  }

  function openCsvImport() {
    setSuccessMessage(null);
    setFormError(null);
    setIsImportOpen(true);
  }

  function handleFormOpenChange(open: boolean) {
    if (isSaving) return;
    setIsFormOpen(open);
    if (!open) {
      setEditingProduct(null);
      setFormError(null);
    }
  }

  async function saveProduct(payload: ProductPayload) {
    setIsSaving(true);
    setFormError(null);
    setSuccessMessage(null);

    const query = editingProduct
      ? supabase.from("products").update(payload).eq("id", editingProduct.id)
      : supabase.from("products").insert(payload);
    const { error } = await query;

    if (error) {
      setFormError(error.message);
      setIsSaving(false);
      return;
    }

    await mutate();
    setIsSaving(false);
    setIsFormOpen(false);
    setEditingProduct(null);
    setSuccessMessage(editingProduct ? "Produit mis à jour." : "Produit ajouté à la base.");
  }

  async function toggleArchive(product: ProductRecord) {
    const nextIsActive = !product.is_active;
    if (!nextIsActive) {
      const confirmed = window.confirm(
        `Archiver « ${product.designation} » ? Il ne sera plus proposé dans les nouveaux chiffrages, mais son historique sera conservé.`
      );
      if (!confirmed) return;
    }

    setUpdatingStatusId(product.id);
    setSuccessMessage(null);
    const { error } = await supabase
      .from("products")
      .update({ is_active: nextIsActive })
      .eq("id", product.id);
    setUpdatingStatusId(null);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
    setSuccessMessage(nextIsActive ? "Produit restauré." : "Produit archivé.");
  }

  return (
    <div className="animate-fade-in">
      <HubBreadcrumb hubHref="/dashboard/referentiel" hubLabel="Référentiel" currentLabel="Produits" />

      <div className="page-header flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-3xl">
          <h1 className="page-title">Produits & prix de référence</h1>
          <p className="page-description">
            Structurez vos articles métier, puis rattachez les tarifs réels de chaque fournisseur.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-secondary btn-lg" type="button" onClick={openCsvImport}>
            Importer un CSV
          </button>
          <button className="btn btn-primary btn-lg" type="button" onClick={openCreateForm}>
            Ajouter un produit
          </button>
        </div>
      </div>

      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Deux niveaux de prix, un seul référentiel produit</p>
            <p className="mt-1 text-blue-800">
              Le prix de référence sert de valeur interne. Les offres datées d’Arcus, CEDEO ou d’autres fournisseurs restent dans les tarifs fournisseurs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="btn btn-secondary btn-sm" href="/dashboard/suppliers">Gérer les fournisseurs</Link>
            <Link className="btn btn-secondary btn-sm" href="/dashboard/prices">Voir tous les tarifs</Link>
          </div>
        </div>
      </section>

      {successMessage ? <div className="alert alert-success mb-5" role="status">{successMessage}</div> : null}
      {!isFormOpen && formError ? <div className="alert alert-error mb-5" role="alert">{formError}</div> : null}

      {!isLoading ? (
        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs du catalogue">
          <div className="dashboard-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">Produits actifs</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--slate-900)]">{stats.active}</p>
          </div>
          <div className="dashboard-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">Couverts par un fournisseur</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{stats.covered}</p>
          </div>
          <div className="dashboard-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">Sans prix fournisseur</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">{stats.withoutSupplierPrice}</p>
          </div>
          <div className="dashboard-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">Prix à revalider</p>
            <p className="mt-1 text-2xl font-semibold text-rose-700">{stats.stale}</p>
          </div>
        </section>
      ) : null}

      <TableFilterBar
        data={products}
        onDataChange={setDisplayedProducts}
        search={{
          placeholder: "Rechercher une référence, une matière, une nuance ou une dimension...",
          fields: [
            "designation",
            "reference",
            "category",
            "product_type",
            "material",
            "grade",
            "dimensions",
            "standard",
          ],
        }}
        filters={productFilters}
        sortOptions={PRODUCT_SORT_OPTIONS}
        resultCountLabel="produits"
        showResultCount
      />

      <div className="dashboard-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--slate-200)] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">Base articles</h2>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">Identité produit, prix interne et couverture fournisseurs.</p>
          </div>
          <button className="btn btn-secondary btn-sm" disabled={isValidating} onClick={() => void mutate()} type="button">
            {isValidating ? "Actualisation..." : "Actualiser"}
          </button>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4" role="alert">
            {loadError instanceof Error ? loadError.message : "Impossible de charger la base produits."}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="data-table min-w-[1180px]">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Classification</th>
                <th>Dimensions</th>
                <th className="text-right">Prix de référence</th>
                <th>Meilleur prix fournisseur</th>
                <th>État du prix</th>
                <th className="text-center">TVA</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="py-12 text-center text-[var(--slate-500)]">Chargement de la base produits...</td></tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center">
                    <div className="mx-auto max-w-lg">
                      <p className="text-lg font-semibold text-[var(--slate-800)]">Construisez votre première base articles</p>
                      <p className="mt-2 text-sm text-[var(--slate-500)]">
                        Ajoutez un produit manuellement ou importez votre grille Inox depuis un fichier CSV.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button className="btn btn-primary" type="button" onClick={openCreateForm}>Ajouter un produit</button>
                        <button className="btn btn-secondary" type="button" onClick={openCsvImport}>Importer un CSV</button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : displayedProducts.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-[var(--slate-500)]">Aucun produit ne correspond aux filtres.</td></tr>
              ) : (
                displayedProducts.map((product) => (
                  <tr key={product.id} className={product.is_active ? undefined : "opacity-60"}>
                    <td>
                      <div className="font-semibold text-[var(--slate-900)]">{product.designation}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--slate-500)]">
                        <span className="font-mono">{product.reference || "Sans référence"}</span>
                        {!product.is_active ? <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-700">Archivé</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="font-medium text-[var(--slate-800)]">
                        {[product.material, product.grade].filter(Boolean).join(" ") || "Non renseignée"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--slate-500)]">
                        {[product.category, product.product_type].filter(Boolean).join(" · ") || "Sans famille"}
                      </div>
                    </td>
                    <td>
                      <div className="text-[var(--slate-800)]">{product.dimensions || "-"}</div>
                      <div className="mt-1 text-xs text-[var(--slate-500)]">
                        {[product.standard, product.unit].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="text-right font-mono font-semibold text-[var(--slate-900)]">
                      {formatEUR(product.unit_price_cents)} <span className="text-xs font-normal text-[var(--slate-500)]">/{product.unit || "u"}</span>
                    </td>
                    <td>
                      {product._bestSupplierPriceCents !== null ? (
                        <>
                          <div className="font-mono font-semibold text-emerald-700">{formatEUR(product._bestSupplierPriceCents)}</div>
                          <div className="mt-1 text-xs text-[var(--slate-500)]">
                            {product._bestSupplierName || "Fournisseur"} · {product._supplierPriceCount} offre(s)
                          </div>
                        </>
                      ) : (
                        <span className="text-sm text-[var(--slate-400)]">Aucun tarif</span>
                      )}
                    </td>
                    <td>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${freshnessClass(product._priceStatus)}`}>
                        {freshnessLabel(product._priceStatus)}
                      </span>
                    </td>
                    <td className="text-center text-sm font-medium text-[var(--slate-700)]">{taxLabelFromBp(product.tax_rate_bp)}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => openEditForm(product)}>Modifier</button>
                        <Link className="btn btn-secondary btn-sm" href={`/dashboard/prices?product_id=${encodeURIComponent(product.id)}`}>
                          Tarifs
                        </Link>
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          disabled={updatingStatusId === product.id}
                          onClick={() => void toggleArchive(product)}
                        >
                          {updatingStatusId === product.id ? "..." : product.is_active ? "Archiver" : "Restaurer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ProductFormModal
        key={`${editingProduct?.id ?? "new"}:${isFormOpen ? "open" : "closed"}`}
        open={isFormOpen}
        product={editingProduct}
        isSaving={isSaving}
        error={formError}
        onOpenChange={handleFormOpenChange}
        onSubmit={saveProduct}
      />
      <ProductCsvImport
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={async () => {
          await mutate();
          setSuccessMessage("Base produits importée et actualisée.");
        }}
      />
    </div>
  );
}
