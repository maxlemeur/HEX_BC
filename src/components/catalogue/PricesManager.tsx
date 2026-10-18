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
import { SupplierOfferFormModal } from "@/components/catalogue/prices-manager/SupplierOfferFormModal";
import { PricesTable } from "@/components/catalogue/prices-manager/PricesTable";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { usePriceLookups } from "@/components/catalogue/prices-manager/usePriceLookups";
import { useSupplierPricesList } from "@/components/catalogue/prices-manager/useSupplierPricesList";
import { ProductPriceTemplateImport } from "@/components/products/ProductPriceTemplateImport";
import { ProductReferencePricePanel } from "@/components/products/ProductReferencePricePanel";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template-client";
import { ChevronDownIcon, DownloadIcon, FileSpreadsheetIcon, PlusIcon, UploadIcon } from "lucide-react";

// --- Filter & Sort config ---

const FRESHNESS_FILTER_OPTIONS = [
  { value: "fresh", label: "À jour (< 30 j)" },
  { value: "aging", label: "Vieillissant (30–90 j)" },
  { value: "stale", label: "Ancien (> 90 j)" },
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
  { key: "updated_at", label: "Dernière mise à jour", defaultDirection: "desc" },
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
    formOpen: (isFormOpen && editingItem === null) || (!isFormOpen && Boolean(productId)),
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


  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          className="mb-0 sm:mb-0"
          breadcrumbs={[
            { label: "Tarifs", href: "/dashboard/tarifs" },
            { label: "Prix fournisseurs" },
          ]}
          title="Prix fournisseurs"
          description="Gérez les tarifs de vos fournisseurs. Ajoutez-les un par un ou importez-les en masse depuis un fichier CSV."
          actions={
            <Button
              size="lg"
              className="w-full sm:w-auto"
              leftIcon={<PlusIcon aria-hidden="true" />}
              onClick={openCreateForm}
            >
              Ajouter un fournisseur / tarif
            </Button>
          }
        />
      ) : null}

      {productId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info-border bg-info-subtle px-4 py-3 text-sm text-foreground">
          <div className="min-w-0">
            <span className="font-semibold">Tarifs du produit :</span>{" "}
            {focusedProductName ?? "chargement du produit…"}
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "md" })}
            href={`/dashboard/products?product_id=${encodeURIComponent(productId)}`}
          >
            Retour à la fiche produit
          </Link>
        </div>
      ) : null}

      {productId ? <ProductReferencePricePanel key={productId} productId={productId} /> : null}

      {!embedded ? (
        <section
          aria-labelledby="price-template-title"
          className="rounded-lg border border-success-border bg-success-subtle px-4 py-4 text-sm sm:px-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-3xl">
              <h2 id="price-template-title" className="font-semibold text-foreground">
                Modèle officiel produits + tarifs
              </h2>
              <p className="mt-1 text-foreground-secondary">
                Faites compléter un seul fichier par vos équipes, contrôlez son aperçu, puis enregistrez les produits et les prix fournisseurs ensemble.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                className={buttonVariants({ variant: "outline", size: "md" })}
                href={TEMPLATE_FILE_URL}
                download
              >
                <DownloadIcon aria-hidden="true" />
                Télécharger le modèle
              </a>
              <Button
                size="md"
                leftIcon={<FileSpreadsheetIcon aria-hidden="true" />}
                onClick={() => setIsTemplateImportOpen(true)}
              >
                Importer le modèle
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* CSV Import - collapsible */}
      <section
        aria-labelledby="price-csv-import-title"
        className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <h2 id="price-csv-import-title" className="m-0">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-6"
            aria-expanded={isCsvOpen}
            aria-controls="price-csv-import-panel"
            onClick={() => setIsCsvOpen((prev) => !prev)}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <UploadIcon className="size-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  Importer un fichier de prix (CSV)
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  Importez vos prix depuis un fichier CSV avec un assistant guidé en 5 étapes.
                </span>
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={`size-5 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none ${isCsvOpen ? "rotate-180" : ""}`}
            />
          </button>
        </h2>

        {isCsvOpen ? (
          <div id="price-csv-import-panel" className="border-t border-border">
            {/* Stays mounted while lookups (re)load: unmounting would drop the chosen file and the import in progress. */}
            <PriceBookCsvImport
              onImported={handleImported}
              onLookupsUpdated={reloadLookups}
              lookups={lookups}
              isLookupsLoading={isImportLookupsLoading}
            />
          </div>
        ) : null}
      </section>

      {/* Stats cards */}
      {data && stats.total > 0 ? (
        <StatGrid label="Synthèse des prix fournisseurs">
          <StatCard label="Total prix" value={stats.total} />
          <StatCard label="À jour" value={stats.fresh} tone="success" />
          <StatCard label="Anciens (> 90 j)" value={stats.stale} tone="danger" />
          <StatCard label="Fournisseurs couverts" value={stats.uniqueSuppliers} />
        </StatGrid>
      ) : null}

      <ServerTableFilterBar
        searchValue={searchInput}
        searchPlaceholder="Rechercher par fournisseur ou produit…"
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
        supplierOptions={editingItem ? [{ value: editingItem.supplier_id, label: editingItem._supplierName }] : supplierOptions}
        productOptions={editingItem ? [{ value: editingItem.product_id, label: editingItem._productName }] : productOptions}
        isSupplierLoading={isSupplierLoading}
        isProductLoading={isProductLoading}
        onSupplierQueryChange={searchSuppliers}
        onProductQueryChange={searchProducts}
        defaultProductId={productId}
        onClose={closeForm}
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
