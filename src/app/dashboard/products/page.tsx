"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ArchiveIcon,
  DownloadIcon,
  EllipsisIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TagsIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template-client";
import type { PriceFreshnessLevel } from "@/lib/catalogue/stale-prices";
import { formatEUR } from "@/lib/money";

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
  _referencePriceSourceOrderId: string | null;
  _referencePriceSourceOrderReference: string | null;
  _referencePriceSourceSupplierName: string | null;
  _referencePriceSourceDate: string | null;
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
  {
    key: "updated_at",
    label: "Dernière modification",
    defaultDirection: "desc",
  },
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

function formatDateOnly(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value ?? "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function referencePriceSourceLabel(product: ProductView) {
  if (!product._referencePriceSourceOrderId) return "Saisie interne";

  const source = [
    product._referencePriceSourceSupplierName,
    product._referencePriceSourceOrderReference,
    formatDateOnly(product._referencePriceSourceDate),
  ].filter(Boolean);

  return `Dernier achat confirmé${source.length > 0 ? ` · ${source.join(" · ")}` : ""}`;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(
    null,
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTemplateImportOpen, setIsTemplateImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const querySearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(querySearch);
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  const sizeParam = Number.parseInt(searchParams.get("size") ?? "25", 10);
  const pageSize = PRODUCT_PAGE_SIZES.includes(
    sizeParam as (typeof PRODUCT_PAGE_SIZES)[number],
  )
    ? (sizeParam as (typeof PRODUCT_PAGE_SIZES)[number])
    : 25;
  const sort = PRODUCT_SORT_OPTIONS.some(
    (option) => option.key === searchParams.get("sort"),
  )
    ? searchParams.get("sort")!
    : "designation";
  const direction: SortDirection =
    searchParams.get("dir") === "desc" ? "desc" : "asc";
  const materialFilters = searchParams.getAll("material");
  const categoryFilters = searchParams.getAll("category");
  const unitFilters = searchParams.getAll("unit");
  const priceStatusFilters = searchParams.getAll("price_status");
  const statusFilters = searchParams.getAll("status");

  const updateUrl = useCallback(
    (
      updates: Record<string, string | string[] | null>,
      options: { replace?: boolean; resetPage?: boolean } = {},
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
    [pathname, router, searchParams],
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
  const globalTotal =
    (data?.counters.covered ?? 0) + (data?.counters.withoutSupplierPrice ?? 0);

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
    [data?.facets.categories, data?.facets.materials, data?.facets.units],
  );

  const stats = data?.counters ?? {
    active: 0,
    covered: 0,
    withoutSupplierPrice: 0,
    stale: 0,
  };
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
    [updateUrl],
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

    try {
      await fetchApi("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingProduct
            ? { action: "update", id: editingProduct.id, item: payload }
            : { action: "create", item: payload },
        ),
      });
      await mutate();
      setIsFormOpen(false);
      setEditingProduct(null);
      setSuccessMessage(
        editingProduct ? "Produit mis à jour." : "Produit ajouté à la base.",
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Enregistrement impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleArchive(product: ProductRecord) {
    const nextIsActive = !product.is_active;
    if (!nextIsActive) {
      const confirmed = window.confirm(
        `Archiver « ${product.designation} » ? Il ne sera plus proposé dans les nouveaux chiffrages, mais son historique sera conservé.`,
      );
      if (!confirmed) return;
    }

    setUpdatingStatusId(product.id);
    setSuccessMessage(null);
    try {
      await fetchApi("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: product.id,
          item: { is_active: nextIsActive },
        }),
      });
      await mutate();
      setSuccessMessage(
        nextIsActive ? "Produit restauré." : "Produit archivé.",
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Mise a jour impossible.",
      );
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <HubBreadcrumb
        hubHref="/dashboard/referentiel"
        hubLabel="Référentiel"
        currentLabel="Produits"
      />

      <div className="page-header product-catalogue-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <h1 className="page-title flex flex-wrap items-baseline gap-2">
          <span>Produits</span>
          <span className="font-mono text-base font-medium tracking-normal text-[var(--slate-400)]">
            · {data ? stats.active.toLocaleString("fr-FR") : "…"}
          </span>
        </h1>

        <div className="flex w-full gap-2 sm:w-auto">
          <button
            className="btn btn-primary btn-lg min-h-11 flex-1 sm:flex-none"
            type="button"
            onClick={openCreateForm}
          >
            Ajouter
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Ouvrir les actions du catalogue"
              className="btn btn-secondary btn-lg min-h-11 min-w-11 !px-0"
            >
              <EllipsisIcon aria-hidden="true" className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="!w-80 max-w-[calc(100vw-2rem)] p-2"
              sideOffset={8}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-wide">
                  État du catalogue
                </DropdownMenuLabel>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-2 pb-2 text-xs text-[var(--slate-500)]">
                  <div>
                    <dt>Actifs</dt>
                    <dd className="font-mono font-semibold text-[var(--slate-800)]">
                      {stats.active.toLocaleString("fr-FR")}
                    </dd>
                  </div>
                  <div>
                    <dt>Couverts</dt>
                    <dd className="font-mono font-semibold text-emerald-700">
                      {stats.covered.toLocaleString("fr-FR")}
                    </dd>
                  </div>
                  <div>
                    <dt>Sans tarif</dt>
                    <dd className="font-mono font-semibold text-amber-700">
                      {stats.withoutSupplierPrice.toLocaleString("fr-FR")}
                    </dd>
                  </div>
                  <div>
                    <dt>À revalider</dt>
                    <dd className="font-mono font-semibold text-rose-700">
                      {stats.stale.toLocaleString("fr-FR")}
                    </dd>
                  </div>
                </dl>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5">
                  <InfoIcon aria-hidden="true" className="size-4" />
                  Règle de prix actuelle
                </DropdownMenuLabel>
                <p className="px-2 pb-2 text-xs leading-relaxed text-[var(--slate-500)]">
                  Le prix de référence reprend le dernier achat confirmé. À
                  défaut, la saisie interne est utilisée. Les autres offres
                  restent dans les tarifs fournisseurs.
                </p>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1.5 text-[11px] uppercase tracking-wide">
                  Imports
                </DropdownMenuLabel>
                <DropdownMenuItem
                  className="min-h-10 px-2"
                  onClick={openTemplateImport}
                >
                  <UploadIcon aria-hidden="true" />
                  Importer produits et tarifs
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-10 px-2"
                  onClick={openCsvImport}
                >
                  <FileSpreadsheetIcon aria-hidden="true" />
                  Importer un CSV produits
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-10 px-2"
                  render={<a download href={TEMPLATE_FILE_URL} />}
                >
                  <DownloadIcon aria-hidden="true" />
                  Télécharger le modèle
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="min-h-10 px-2"
                render={<Link href="/dashboard/suppliers" />}
              >
                <UsersIcon aria-hidden="true" />
                Gérer les fournisseurs
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-10 px-2"
                render={<Link href="/dashboard/prices" />}
              >
                <TagsIcon aria-hidden="true" />
                Voir tous les tarifs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {successMessage ? (
        <div className="alert alert-success mb-5" role="status">
          {successMessage}
        </div>
      ) : null}
      {!isFormOpen && formError ? (
        <div className="alert alert-error mb-5" role="alert">
          {formError}
        </div>
      ) : null}

      <ServerTableFilterBar
        compact
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
        <div className="flex items-center justify-between gap-3 border-b border-[var(--slate-200)] px-3 py-2.5 sm:px-4">
          <p className="min-w-0 text-xs text-[var(--slate-500)]">
            {totalItems > 0
              ? `${pageStart}–${pageEnd} sur ${totalItems.toLocaleString("fr-FR")} produits`
              : "Identité, caractéristiques et prix fournisseur."}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              className="hidden min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[var(--brand-blue)] transition-colors hover:bg-[var(--slate-50)] sm:inline-flex"
              href="/dashboard/prices"
            >
              <TagsIcon aria-hidden="true" className="size-4" />
              Tarifs fournisseurs
            </Link>
            <button
              aria-label={
                isValidating
                  ? "Actualisation en cours"
                  : "Actualiser les produits"
              }
              className="inline-flex size-10 items-center justify-center rounded-lg border border-[var(--slate-200)] text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-50)] hover:text-[var(--slate-800)] disabled:cursor-wait disabled:opacity-60"
              disabled={isValidating}
              onClick={() => void mutate()}
              type="button"
            >
              <RefreshCwIcon
                aria-hidden="true"
                className={`size-4 ${isValidating ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4" role="alert">
            {loadError instanceof Error
              ? loadError.message
              : "Impossible de charger la base produits."}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="data-table product-catalogue-table table-fixed md:table-auto">
            <thead>
              <tr>
                <th className="hidden w-36 lg:table-cell" scope="col">
                  Référence
                </th>
                <th className="w-[38%] sm:w-auto" scope="col">
                  Désignation
                </th>
                <th className="hidden min-[700px]:table-cell" scope="col">
                  Caractéristiques
                </th>
                <th className="w-[26%] text-right sm:w-auto" scope="col">
                  Prix
                </th>
                <th className="w-[20%] sm:w-auto" scope="col">
                  État
                </th>
                <th className="w-12 text-right" scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && !data ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-12 text-center text-[var(--slate-500)]"
                  >
                    Chargement de la base produits...
                  </td>
                </tr>
              ) : globalTotal === 0 ? (
                <tr>
                  <td colSpan={6} className="py-14 text-center">
                    <div className="mx-auto max-w-lg">
                      <p className="text-lg font-semibold text-[var(--slate-800)]">
                        Construisez votre première base articles
                      </p>
                      <p className="mt-2 text-sm text-[var(--slate-500)]">
                        Ajoutez un produit manuellement ou partez du modèle
                        officiel pour importer produits et tarifs.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-3">
                        <button
                          className="btn btn-primary"
                          type="button"
                          onClick={openCreateForm}
                        >
                          Ajouter un produit
                        </button>
                        <a
                          className="btn btn-secondary"
                          href={TEMPLATE_FILE_URL}
                          download
                        >
                          Télécharger le modèle
                        </a>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          onClick={openTemplateImport}
                        >
                          Importer le modèle
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : totalItems === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-12 text-center text-[var(--slate-500)]"
                  >
                    Aucun produit ne correspond aux filtres.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className={product.is_active ? undefined : "opacity-60"}
                  >
                    <td className="hidden lg:table-cell">
                      <span className="break-all font-mono text-xs text-[var(--slate-600)]">
                        {product.reference || "Sans référence"}
                      </span>
                    </td>
                    <td>
                      <div className="break-words text-sm font-semibold leading-snug text-[var(--slate-900)]">
                        {product.designation}
                      </div>
                      <div className="mt-1 break-all font-mono text-[10px] text-[var(--slate-500)] lg:hidden">
                        {product.reference || "Sans référence"}
                      </div>
                      {!product.is_active ? (
                        <span className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                          Archivé
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden min-[700px]:table-cell">
                      <div className="font-medium text-[var(--slate-800)]">
                        {[product.material, product.grade]
                          .filter(Boolean)
                          .join(" ") || "Non renseigné"}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--slate-500)]">
                        {[
                          product.category,
                          product.product_type,
                          product.dimensions,
                          product.standard,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Sans caractéristique"}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="whitespace-nowrap font-mono text-xs font-semibold text-[var(--slate-900)] sm:text-sm">
                        {formatEUR(product.unit_price_cents)}
                        <span className="ml-1 text-[10px] font-normal text-[var(--slate-500)] sm:text-xs">
                          /{product.unit || "u"}
                        </span>
                      </div>
                      <div className="mt-0.5 hidden text-xs text-[var(--slate-500)] md:block">
                        {referencePriceSourceLabel(product)}
                      </div>
                      {product._bestSupplierPriceCents !== null ? (
                        <div className="mt-1 text-[10px] text-emerald-700 sm:text-xs">
                          Fournisseur{" "}
                          {formatEUR(product._bestSupplierPriceCents)}
                          <span className="hidden lg:inline">
                            {` · ${product._bestSupplierName || "Non renseigné"}`}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-[10px] text-[var(--slate-400)] sm:text-xs">
                          Aucun tarif
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-flex max-w-full rounded-full px-2 py-1 text-[10px] font-semibold leading-tight sm:px-2.5 sm:text-xs ${freshnessClass(product._priceStatus)}`}
                      >
                        {freshnessLabel(product._priceStatus)}
                      </span>
                    </td>
                    <td className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`Actions pour ${product.designation}`}
                          className="inline-flex size-11 items-center justify-center rounded-lg text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)]"
                        >
                          <EllipsisIcon aria-hidden="true" className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="!w-48 p-1.5"
                          sideOffset={4}
                        >
                          <DropdownMenuItem
                            className="min-h-10 px-2"
                            onClick={() => openEditForm(product)}
                          >
                            <PencilIcon aria-hidden="true" />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-10 px-2"
                            render={
                              <Link
                                href={`/dashboard/prices?product_id=${encodeURIComponent(product.id)}`}
                              />
                            }
                          >
                            <TagsIcon aria-hidden="true" />
                            Voir les tarifs
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="min-h-10 px-2"
                            disabled={updatingStatusId === product.id}
                            onClick={() => void toggleArchive(product)}
                          >
                            {product.is_active ? (
                              <ArchiveIcon aria-hidden="true" />
                            ) : (
                              <RotateCcwIcon aria-hidden="true" />
                            )}
                            {updatingStatusId === product.id
                              ? "Mise à jour..."
                              : product.is_active
                                ? "Archiver"
                                : "Restaurer"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
                  updateUrl(
                    { page: String(Math.max(1, page - 1)) },
                    { resetPage: false },
                  )
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
                  updateUrl(
                    { page: String(Math.min(totalPages, page + 1)) },
                    { resetPage: false },
                  )
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
        categorySuggestions={data?.facets.categories}
        materialSuggestions={data?.facets.materials}
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
