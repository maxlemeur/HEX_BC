"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";
import { ServerTableFilterBar } from "@/components/TableFilterBar";
import type {
  FilterConfig,
  FilterState,
  FilterValue,
  SortDirection,
  SortOption,
} from "@/components/TableFilterBar";
import { BulkJsonPanel } from "@/components/catalogue/prices-manager/BulkJsonPanel";
import { DeletePriceModal } from "@/components/catalogue/prices-manager/DeletePriceModal";
import { SupplierCatalogItemModal } from "@/components/catalogue/prices-manager/SupplierCatalogItemModal";
import { SupplierOfferFormModal } from "@/components/catalogue/prices-manager/SupplierOfferFormModal";
import { PricesTable } from "@/components/catalogue/prices-manager/PricesTable";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { usePriceLookups } from "@/components/catalogue/prices-manager/usePriceLookups";
import { useSupplierPricesList } from "@/components/catalogue/prices-manager/useSupplierPricesList";
import { ProductPriceTemplateImport } from "@/components/products/ProductPriceTemplateImport";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template";

// --- Filter & Sort config ---

const FRESHNESS_FILTER_OPTIONS = [
  { value: "fresh", label: "À jour (< 30j)" },
  { value: "aging", label: "Vieillissant (30-90j)" },
  { value: "stale", label: "Ancien (> 90j)" },
];

const PRICES_FILTERS: FilterConfig[] = [
  {
    // La clé doit correspondre au paramètre d'URL lu/écrit ailleurs
    // (searchParams.getAll("freshness"), filterState.freshness) : sinon le
    // filtre de fraîcheur ne s'applique jamais et n'apparaît pas comme actif.
    type: "multi-select",
    key: "freshness",
    label: "Fraîcheur",
    placeholder: "Toutes",
    options: FRESHNESS_FILTER_OPTIONS,
  },
];

const PRICES_SORT_OPTIONS: SortOption[] = [
  { key: "supplier", label: "Fournisseur", defaultDirection: "asc" },
  { key: "product", label: "Produit", defaultDirection: "asc" },
  { key: "unit_price_cents", label: "Prix HT" },
  { key: "updated_at", label: "Dernière MAJ", defaultDirection: "desc" },
];

const PRICE_PAGE_SIZES = [25, 50, 100] as const;

// --- Component ---

export function PricesManager({
  embedded = false,
  productId = null,
}: {
  embedded?: boolean;
  productId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EnrichedPrice | null>(null);
  // --- Delete confirmation state ---
  const [deleteTarget, setDeleteTarget] = useState<EnrichedPrice | null>(null);

  const [supplierItemTarget, setSupplierItemTarget] = useState<EnrichedPrice | null>(null);
  // --- CSV import collapsible ---
  const [isCsvOpen, setIsCsvOpen] = useState(embedded);
  const [isTemplateImportOpen, setIsTemplateImportOpen] = useState(false);
  const querySearch = searchParams.get("q") ?? "";
  const [searchState, setSearchState] = useState(() => ({
    querySearch,
    value: querySearch,
  }));
  const searchInput =
    searchState.querySearch === querySearch ? searchState.value : querySearch;
  const setSearchInput = useCallback(
    (value: string) =>
      setSearchState((current) =>
        current.querySearch === querySearch && current.value === value
          ? current
          : { querySearch, value }
      ),
    [querySearch]
  );
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(searchParams.get("size") ?? "25", 10);
  const pageSize = PRICE_PAGE_SIZES.includes(sizeParam as (typeof PRICE_PAGE_SIZES)[number])
    ? (sizeParam as (typeof PRICE_PAGE_SIZES)[number])
    : 25;
  const sort = PRICES_SORT_OPTIONS.some((option) => option.key === searchParams.get("sort"))
    ? searchParams.get("sort")!
    : "updated_at";
  const direction: SortDirection = searchParams.get("dir") === "asc" ? "asc" : "desc";
  const freshnessFilters = searchParams.getAll("freshness");
  const supplierId = searchParams.get("supplier_id");

  const updateUrl = useCallback(
    (
      updates: Record<string, string | string[] | null>,
      options: { replace?: boolean; resetPage?: boolean } = {}
    ) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((entry) => next.append(key, entry));
        else if (value) next.set(key, value);
      }
      if (options.resetPage !== false) next.delete("page");
      const href = next.size > 0 ? `${pathname}?${next.toString()}` : pathname;
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (searchInput === querySearch) return;
    const timeout = window.setTimeout(
      () => updateUrl({ q: searchInput || null }, { replace: true }),
      300
    );
    return () => window.clearTimeout(timeout);
  }, [querySearch, searchInput, updateUrl]);

  const queryString = useMemo(() => {
    const query = new URLSearchParams({
      view: "page",
      page: String(page),
      size: String(pageSize),
      sort,
      dir: direction,
    });
    if (querySearch) query.set("q", querySearch);
    freshnessFilters.forEach((value) => query.append("freshness", value));
    if (productId) query.set("product_id", productId);
    if (supplierId) query.set("supplier_id", supplierId);
    return query.toString();
  }, [direction, freshnessFilters, page, pageSize, productId, querySearch, sort, supplierId]);

  const { data, items, pagination, stats, loadError, isLoading, isValidating, refresh } =
    useSupplierPricesList({ queryString });
  const selectedSupplierId = editingItem?.supplier_id ?? null;
  const selectedProductId = editingItem?.product_id ?? productId;
  const {
    lookups,
    supplierOptions,
    productOptions,
    isSupplierLoading,
    isProductLoading,
    isImportLookupsLoading,
    searchSuppliers,
    searchProducts,
    reloadLookups,
  } = usePriceLookups({
    formOpen: isFormOpen || Boolean(productId),
    importOpen: isCsvOpen,
    selectedSupplierId,
    selectedProductId,
  });
  const focusedProductName = productId
    ? items.find((item) => item.product_id === productId)?._productName ??
      productOptions.find((option) => option.value === productId)?.label ??
      null
    : null;
  const totalItems = pagination?.totalItems ?? 0;
  const totalPages = Math.max(pagination?.totalPages ?? 0, 1);
  const filterState: FilterState = { freshness: freshnessFilters };

  const handleFilterChange = useCallback(
    (key: string, value: FilterValue) => {
      if (Array.isArray(value)) updateUrl({ [key]: value });
      else if (typeof value === "string") updateUrl({ [key]: value || null });
    },
    [updateUrl]
  );

  function closeForm() {
    setIsFormOpen(false);
    setEditingItem(null);
  }

  function openCreateForm() {
    setEditingItem(null);
    setIsFormOpen(true);
  }

  function openEditForm(item: EnrichedPrice) {
    setEditingItem(item);
    setIsFormOpen(true);
  }

  const handleImported = useCallback(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  function openSupplierItemForm(item: EnrichedPrice) {
    setSupplierItemTarget(item);
  }

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <h1 className="page-title">Prix fournisseurs</h1>
            <p className="page-description">
              Gérez les tarifs de vos fournisseurs. Ajoutez-les un par un ou importez-les en masse depuis un fichier CSV.
            </p>
          </div>
          <button
            className="btn btn-primary btn-lg w-full shrink-0 sm:w-auto"
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
            Ajouter un fournisseur / tarif
          </button>
        </div>
      ) : null}

      {productId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <div>
            <span className="font-semibold">Tarifs du produit :</span>{" "}
            {focusedProductName ?? "chargement du produit..."}
          </div>
          <Link className="btn btn-secondary btn-sm" href="/dashboard/products">Retour aux produits</Link>
        </div>
      ) : null}

      {!embedded ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-950">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-3xl">
              <h2 className="font-semibold">Modèle officiel produits + tarifs</h2>
              <p className="mt-1 text-emerald-800">
                Faites compléter un seul fichier par vos équipes, contrôlez son aperçu, puis enregistrez les produits et les prix fournisseurs ensemble.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="btn btn-secondary btn-sm" href={TEMPLATE_FILE_URL} download>
                Télécharger le modèle
              </a>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => setIsTemplateImportOpen(true)}
              >
                Importer le modèle
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* CSV Import - collapsible */}
      <section className="dashboard-card overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center justify-between px-6 py-4 text-left"
          onClick={() => setIsCsvOpen((prev) => !prev)}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-blue)]/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--slate-800)]">
                Importer un fichier de prix (CSV)
              </h2>
              <p className="text-xs text-[var(--slate-500)]">
                Importez vos prix depuis un fichier CSV avec un assistant guide en 5 etapes.
              </p>
            </div>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--slate-400)"
            strokeWidth="2"
            className={`transition-transform ${isCsvOpen ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {isCsvOpen ? (
          <div className="border-t border-[var(--slate-200)]">
            {isImportLookupsLoading ? (
              <p className="px-6 py-8 text-sm text-[var(--slate-500)]" role="status">
                Chargement des référentiels pour l’import...
              </p>
            ) : (
              <PriceBookCsvImport
                onImported={handleImported}
                onLookupsUpdated={reloadLookups}
                lookups={lookups}
              />
            )}
          </div>
        ) : null}
      </section>

      {/* Stats cards */}
      {data && stats.total > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Total prix</p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">À jour</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{stats.fresh}</p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Anciens (&gt; 90j)</p>
            <p className="mt-1 text-lg font-semibold text-danger">{stats.stale}</p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Fournisseurs couverts</p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">{stats.uniqueSuppliers}</p>
          </div>
        </div>
      ) : null}

      <ServerTableFilterBar
        searchValue={searchInput}
        searchPlaceholder="Rechercher par fournisseur ou produit..."
        filterState={filterState}
        filters={PRICES_FILTERS}
        sortOptions={PRICES_SORT_OPTIONS}
        sortState={{ key: sort, direction }}
        filteredCount={totalItems}
        totalCount={stats.total}
        resultCountLabel="prix fournisseur"
        isPending={isValidating || searchInput !== querySearch}
        onSearchChange={setSearchInput}
        onFilterChange={handleFilterChange}
        onSortChange={(key, nextDirection) =>
          updateUrl({ sort: key, dir: nextDirection ?? "asc" })
        }
        onClearAll={() => {
          setSearchInput("");
          updateUrl({ q: null, freshness: null });
        }}
      />

      <PricesTable
        items={items}
        filteredItemsCount={totalItems}
        totalItemsCount={stats.total}
        isLoading={isLoading}
        loadError={loadError}
        isValidating={isValidating}
        onRefresh={() => void refresh()}
        onCreate={openCreateForm}
        onEdit={openEditForm}
        onDelete={setDeleteTarget}
        page={page}
        onEditSupplierItem={openSupplierItemForm}
        pageSize={pageSize}
        pageSizes={PRICE_PAGE_SIZES}
        totalPages={totalPages}
        onPageChange={(nextPage) =>
          updateUrl({ page: String(nextPage) }, { resetPage: false })
        }
        onPageSizeChange={(nextPageSize) => updateUrl({ size: String(nextPageSize) })}
      />

      <BulkJsonPanel onCompleted={refresh} />

      <SupplierOfferFormModal
        open={isFormOpen}
        item={editingItem}
        supplierOptions={supplierOptions}
        productOptions={productOptions}
        isSupplierLoading={isSupplierLoading}
        isProductLoading={isProductLoading}
        onSupplierQueryChange={searchSuppliers}
        onProductQueryChange={searchProducts}
        defaultProductId={productId}
        onClose={closeForm}
        onSaved={refresh}
      />

      <SupplierCatalogItemModal
        item={supplierItemTarget}
        onClose={() => setSupplierItemTarget(null)}
        onSaved={refresh}
      />

      <DeletePriceModal
        open={deleteTarget !== null}
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
      />

      <ProductPriceTemplateImport
        open={isTemplateImportOpen}
        onClose={() => setIsTemplateImportOpen(false)}
        onImported={async () => {
          await Promise.all([refresh(), reloadLookups()]);
        }}
      />
    </div>
  );
}
