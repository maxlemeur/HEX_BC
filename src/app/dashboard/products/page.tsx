"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { fetchApi } from "@/components/catalogue/api";
import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { ServerTableFilterBar } from "@/components/TableFilterBar";
import type {
  FilterConfig,
  FilterState,
  FilterValue,
  SortDirection,
  SortOption,
} from "@/components/TableFilterBar";
import { ProductCsvImport } from "@/components/products/ProductCsvImport";
import { ProductPriceTemplateImport } from "@/components/products/ProductPriceTemplateImport";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template";
import type { PriceFreshnessLevel } from "@/lib/catalogue/stale-prices";
import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  ProductFormModal,
  type ProductPayload,
  type ProductRecord,
} from "./ProductFormModal";

type ProductView = ProductRecord & {
  _status: "active" | "archived";
  _priceStatus: "none" | PriceFreshnessLevel;
  _supplierPriceCount: number;
  _bestSupplierPriceCents: number | null;
  _bestSupplierName: string | null;
  _bestSupplierPriceUpdatedAt: string | null;
};

type ProductPageResponse = {
  items: ProductView[];
  pagination: {
    page: number;
    size: 25 | 50 | 100;
    totalItems: number;
    totalPages: number;
  };
  counters: {
    active: number;
    covered: number;
    withoutSupplierPrice: number;
    stale: number;
  };
  facets: {
    materials: string[];
    categories: string[];
    units: string[];
  };
};

const PRODUCT_SORT_OPTIONS: SortOption[] = [
  { key: "designation", label: "Désignation", defaultDirection: "asc" },
  { key: "material", label: "Matière", defaultDirection: "asc" },
  { key: "unit_price_cents", label: "Prix de référence" },
  { key: "best_supplier_price_cents", label: "Meilleur prix fournisseur" },
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

const PRODUCT_PAGE_SIZES = [25, 50, 100] as const;

function taxLabelFromBp(taxRateBp: number) {
  if (taxRateBp % 100 === 0) return `${taxRateBp / 100} %`;
  return `${(taxRateBp / 100).toFixed(1).replace(".", ",")} %`;
}

function toOptions(values: string[]) {
  return values.map((value) => ({ value, label: value }));
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTemplateImportOpen, setIsTemplateImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const querySearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(querySearch);
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(searchParams.get("size") ?? "25", 10);
  const pageSize = PRODUCT_PAGE_SIZES.includes(sizeParam as (typeof PRODUCT_PAGE_SIZES)[number])
    ? (sizeParam as (typeof PRODUCT_PAGE_SIZES)[number])
    : 25;
  const sort = PRODUCT_SORT_OPTIONS.some((option) => option.key === searchParams.get("sort"))
    ? searchParams.get("sort")!
    : "designation";
  const direction: SortDirection = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const materialFilters = searchParams.getAll("material");
  const categoryFilters = searchParams.getAll("category");
  const unitFilters = searchParams.getAll("unit");
  const priceStatusFilters = searchParams.getAll("price_status");
  const statusFilters = searchParams.getAll("status");

  const updateUrl = useCallback(
    (
      updates: Record<string, string | string[] | null>,
      options: { replace?: boolean; resetPage?: boolean } = {}
    ) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (Array.isArray(value)) {
          value.forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      if (options.resetPage !== false) next.delete("page");
      const href = next.size > 0 ? `${pathname}?${next.toString()}` : pathname;
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    setSearchInput(querySearch);
  }, [querySearch]);

  useEffect(() => {
    if (searchInput === querySearch) return;
    const timeout = window.setTimeout(() => {
      updateUrl({ q: searchInput || null }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [querySearch, searchInput, updateUrl]);

  const apiUrl = useMemo(() => {
    const query = new URLSearchParams({
      view: "page",
      page: String(page),
      size: String(pageSize),
      sort,
      dir: direction,
    });
    if (querySearch) query.set("q", querySearch);
    materialFilters.forEach((value) => query.append("material", value));
    categoryFilters.forEach((value) => query.append("category", value));
    unitFilters.forEach((value) => query.append("unit", value));
    priceStatusFilters.forEach((value) => query.append("price_status", value));
    statusFilters.forEach((value) => query.append("status", value));
    return `/api/catalogue?${query.toString()}`;
  }, [
    categoryFilters,
    direction,
    materialFilters,
    page,
    pageSize,
    priceStatusFilters,
    querySearch,
    sort,
    statusFilters,
    unitFilters,
  ]);

  const {
    data,
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<ProductPageResponse>(apiUrl, fetchApi, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    keepPreviousData: true,
  });

  const products = data?.items ?? [];
  const totalItems = data?.pagination.totalItems ?? 0;
  const totalPages = Math.max(data?.pagination.totalPages ?? 0, 1);
  const globalTotal = (data?.counters.covered ?? 0) + (data?.counters.withoutSupplierPrice ?? 0);

  const productFilters = useMemo<FilterConfig[]>(
    () => [
      {
        type: "multi-select",
        key: "material",
        label: "Matière",
        placeholder: "Toutes les matières",
        options: toOptions(data?.facets.materials ?? []),
      },
      {
        type: "multi-select",
        key: "category",
        label: "Famille",
        placeholder: "Toutes les familles",
        options: toOptions(data?.facets.categories ?? []),
      },
      {
        type: "multi-select",
        key: "unit",
        label: "Unité",
        placeholder: "Toutes les unités",
        options: toOptions(data?.facets.units ?? []),
      },
      {
        type: "multi-select",
        key: "price_status",
        label: "État des prix",
        placeholder: "Tous les prix",
        options: PRICE_STATUS_OPTIONS,
      },
      {
        type: "multi-select",
        key: "status",
        label: "Statut",
        placeholder: "Tous les statuts",
        options: STATUS_OPTIONS,
      },
    ],
    [data?.facets.categories, data?.facets.materials, data?.facets.units]
  );

  const stats = data?.counters ?? { active: 0, covered: 0, withoutSupplierPrice: 0, stale: 0 };
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, totalItems);
  const filterState: FilterState = {
    material: materialFilters,
    category: categoryFilters,
    unit: unitFilters,
    price_status: priceStatusFilters,
    status: statusFilters,
  };

  const handleFilterChange = useCallback(
    (key: string, value: FilterValue) => {
      if (Array.isArray(value)) updateUrl({ [key]: value });
      else if (typeof value === "string") updateUrl({ [key]: value || null });
    },
    [updateUrl]
  );

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

  function openTemplateImport() {
    setSuccessMessage(null);
    setFormError(null);
    setIsTemplateImportOpen(true);
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

      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0 max-w-3xl">
          <h1 className="page-title">Produits & prix de référence</h1>
          <p className="page-description">
            Structurez vos articles métier, puis rattachez les tarifs réels de chaque fournisseur.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <button className="btn btn-primary btn-lg w-full sm:w-auto" type="button" onClick={openCreateForm}>
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

      <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <p className="font-semibold">Import guidé : produits et tarifs fournisseurs</p>
            <p className="mt-1 text-emerald-800">
              Transmettez le modèle officiel à vos équipes, puis importez le fichier complété. Le contenu est contrôlé avant l’enregistrement.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-secondary btn-sm" href={TEMPLATE_FILE_URL} download>
              Télécharger le modèle
            </a>
            <button className="btn btn-primary btn-sm" type="button" onClick={openTemplateImport}>
              Importer le modèle
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={openCsvImport}>
              Import CSV produits
            </button>
          </div>
        </div>
      </section>

      {successMessage ? <div className="alert alert-success mb-5" role="status">{successMessage}</div> : null}
      {!isFormOpen && formError ? <div className="alert alert-error mb-5" role="alert">{formError}</div> : null}

      {data ? (
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

      <ServerTableFilterBar
        searchValue={searchInput}
        searchPlaceholder="Rechercher une référence, une matière, une nuance ou une dimension..."
        filterState={filterState}
        filters={productFilters}
        sortOptions={PRODUCT_SORT_OPTIONS}
        sortState={{ key: sort, direction }}
        filteredCount={totalItems}
        totalCount={globalTotal}
        resultCountLabel="produits"
        isPending={isValidating || searchInput !== querySearch}
        onSearchChange={setSearchInput}
        onFilterChange={handleFilterChange}
        onSortChange={(key, nextDirection) =>
          updateUrl({ sort: key, dir: nextDirection ?? "asc" })
        }
        onClearAll={() => {
          setSearchInput("");
          updateUrl({
            q: null,
            material: null,
            category: null,
            unit: null,
            price_status: null,
            status: null,
          });
        }}
      />

      <div
        className={`dashboard-card overflow-hidden transition-opacity ${isValidating && data ? "opacity-70" : ""}`}
        aria-busy={isValidating}
      >
        <div className="flex flex-col gap-3 border-b border-[var(--slate-200)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">Base articles</h2>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              {totalItems > 0
                ? `${pageStart}–${pageEnd} sur ${totalItems} produits`
                : "Identité produit, prix interne et couverture fournisseurs."}
            </p>
          </div>
          <button className="btn btn-secondary btn-sm min-h-11 w-full sm:min-h-0 sm:w-auto" disabled={isValidating} onClick={() => void mutate()} type="button">
            {isValidating ? "Actualisation..." : "Actualiser"}
          </button>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4" role="alert">
            {loadError instanceof Error ? loadError.message : "Impossible de charger la base produits."}
          </div>
        ) : null}

        <div className="divide-y divide-[var(--slate-200)] xl:hidden">
          {isLoading && !data ? (
            <div className="py-12 text-center text-sm text-[var(--slate-500)]">
              Chargement de la base produits...
            </div>
          ) : globalTotal === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-lg font-semibold text-[var(--slate-800)]">Construisez votre première base articles</p>
              <p className="mt-2 text-sm text-[var(--slate-500)]">
                Ajoutez un produit manuellement ou importez le modèle officiel.
              </p>
              <button className="btn btn-primary mt-5 min-h-11" type="button" onClick={openCreateForm}>
                Ajouter un produit
              </button>
            </div>
          ) : totalItems === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--slate-500)]">
              Aucun produit ne correspond aux filtres.
            </div>
          ) : (
            products.map((product) => (
              <article key={product.id} className={`p-4 sm:p-5 ${product.is_active ? "" : "opacity-60"}`}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold text-[var(--slate-900)]">
                      {product.designation}
                    </h3>
                    <p className="mt-1 break-words font-mono text-xs text-[var(--slate-500)] [overflow-wrap:anywhere]">
                      {product.reference || "Sans référence"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${freshnessClass(product._priceStatus)}`}>
                    {freshnessLabel(product._priceStatus)}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-[var(--slate-400)]">Classification</dt>
                    <dd className="mt-0.5 break-words font-medium text-[var(--slate-800)]">
                      {[product.material, product.grade].filter(Boolean).join(" ") || "Non renseignée"}
                    </dd>
                    <dd className="mt-0.5 break-words text-xs text-[var(--slate-500)]">
                      {[product.category, product.product_type].filter(Boolean).join(" · ") || "Sans famille"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--slate-400)]">Prix de référence</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-[var(--slate-900)]">
                      {formatEUR(product.unit_price_cents)} /{product.unit || "u"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--slate-400)]">Meilleur prix</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-emerald-700">
                      {product._bestSupplierPriceCents !== null
                        ? formatEUR(product._bestSupplierPriceCents)
                        : "Aucun tarif"}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-xs text-[var(--slate-400)]">Dimensions et norme</dt>
                    <dd className="mt-0.5 break-words text-[var(--slate-700)]">
                      {[product.dimensions, product.standard].filter(Boolean).join(" · ") || "Non renseignées"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[var(--slate-100)] pt-4">
                  <button className="btn btn-secondary btn-sm min-h-11" type="button" onClick={() => openEditForm(product)}>
                    Modifier
                  </button>
                  <Link className="btn btn-secondary btn-sm min-h-11" href={`/dashboard/prices?product_id=${encodeURIComponent(product.id)}`}>
                    Tarifs
                  </Link>
                  <button
                    className="btn btn-secondary btn-sm min-h-11"
                    type="button"
                    disabled={updatingStatusId === product.id}
                    onClick={() => void toggleArchive(product)}
                  >
                    {updatingStatusId === product.id ? "..." : product.is_active ? "Archiver" : "Restaurer"}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto xl:block">
          <table className="data-table min-w-[1180px]">
            <thead>
              <tr>
                <th scope="col">Produit</th>
                <th scope="col">Classification</th>
                <th scope="col">Dimensions</th>
                <th scope="col" className="text-right">Prix de référence</th>
                <th scope="col">Meilleur prix fournisseur</th>
                <th scope="col">État du prix</th>
                <th scope="col" className="text-center">TVA</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <tr><td colSpan={8} className="py-12 text-center text-[var(--slate-500)]">Chargement de la base produits...</td></tr>
              ) : globalTotal === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center">
                    <div className="mx-auto max-w-lg">
                      <p className="text-lg font-semibold text-[var(--slate-800)]">Construisez votre première base articles</p>
                      <p className="mt-2 text-sm text-[var(--slate-500)]">
                        Ajoutez un produit manuellement ou partez du modèle officiel pour importer produits et tarifs.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button className="btn btn-primary" type="button" onClick={openCreateForm}>Ajouter un produit</button>
                        <a className="btn btn-secondary" href={TEMPLATE_FILE_URL} download>Télécharger le modèle</a>
                        <button className="btn btn-secondary" type="button" onClick={openTemplateImport}>Importer le modèle</button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : totalItems === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-[var(--slate-500)]">Aucun produit ne correspond aux filtres.</td></tr>
              ) : (
                products.map((product) => (
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

        {totalItems > 0 ? (
          <div className="flex flex-col gap-4 border-t border-[var(--slate-200)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
              <span>Afficher</span>
              {PRODUCT_PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${
                    pageSize === size
                      ? "bg-[var(--slate-900)] text-white"
                      : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
                  }`}
                  onClick={() => updateUrl({ size: String(size) })}
                >
                  {size}
                </button>
              ))}
              <span>par page</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm min-h-11"
                disabled={page <= 1}
                onClick={() =>
                  updateUrl({ page: String(Math.max(1, page - 1)) }, { resetPage: false })
                }
              >
                Précédent
              </button>
              <span className="px-2 text-center text-xs text-[var(--slate-500)]">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm min-h-11"
                disabled={page >= totalPages}
                onClick={() =>
                  updateUrl({ page: String(Math.min(totalPages, page + 1)) }, { resetPage: false })
                }
              >
                Suivant
              </button>
            </div>
          </div>
        ) : null}
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
      <ProductPriceTemplateImport
        open={isTemplateImportOpen}
        onClose={() => setIsTemplateImportOpen(false)}
        onImported={async () => {
          await mutate();
          setSuccessMessage("Produits et tarifs importés, puis actualisés.");
        }}
      />
    </div>
  );
}
