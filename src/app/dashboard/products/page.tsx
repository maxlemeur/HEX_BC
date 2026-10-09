"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { PlusIcon, RefreshCwIcon, TagsIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { ServerTableFilterBar } from "@/components/TableFilterBar";
import type {
  FilterConfig,
  FilterState,
  FilterValue,
  SortDirection,
  SortOption,
} from "@/components/TableFilterBar";
import { ProductCatalogueMenu } from "@/components/products/ProductCatalogueMenu";
import { ProductCsvImport } from "@/components/products/ProductCsvImport";
import { ProductPriceTemplateImport } from "@/components/products/ProductPriceTemplateImport";
import { ProductReferencePricePanel } from "@/components/products/ProductReferencePricePanel";
import { ProductsPagination } from "@/components/products/ProductsPagination";
import { ProductsTable } from "@/components/products/ProductsTable";
import type { ProductCatalogueCounters, ProductView } from "@/components/products/product-view";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

import {
  ProductFormModal,
  type ProductPayload,
  type ProductRecord,
} from "./ProductFormModal";

type ProductPageResponse = {
  items: ProductView[];
  pagination: {
    page: number;
    size: 25 | 50 | 100;
    totalItems: number;
    totalPages: number;
  };
  counters: ProductCatalogueCounters;
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
type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];

const EMPTY_COUNTERS: ProductCatalogueCounters = {
  active: 0,
  covered: 0,
  withoutSupplierPrice: 0,
  stale: 0,
};

function toOptions(values: string[]) {
  return values.map((value) => ({ value, label: value }));
}

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(
    null,
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [referenceProduct, setReferenceProduct] = useState<ProductRecord | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTemplateImportOpen, setIsTemplateImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requestedProductId = searchParams.get("product_id");
  const productReturnQuery = searchParams.toString();
  const [isOpeningProduct, setIsOpeningProduct] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const querySearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(querySearch);
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  const sizeParam = Number.parseInt(searchParams.get("size") ?? "25", 10);
  const pageSize: ProductPageSize = PRODUCT_PAGE_SIZES.includes(sizeParam as ProductPageSize)
    ? (sizeParam as ProductPageSize)
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
    if (!requestedProductId) return;
    let cancelled = false;
    setIsOpeningProduct(true);
    setFormError(null);
    void fetchApi<{ items: ProductRecord[] }>(
      `/api/catalogue?id=${encodeURIComponent(requestedProductId)}&include_inactive=true&limit=1`,
    ).then((response) => {
      if (cancelled) return;
      const product = response.items.find((item) => item.id === requestedProductId);
      if (!product) throw new Error("Ce produit est introuvable ou n’est plus accessible.");
      setEditingProduct(product);
      setIsFormOpen(true);
      const next = new URLSearchParams(productReturnQuery);
      next.delete("product_id");
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }).catch((error: unknown) => {
      if (!cancelled) {
        setFormError(error instanceof Error ? error.message : "Impossible d’ouvrir la fiche produit.");
      }
    }).finally(() => {
      if (!cancelled) setIsOpeningProduct(false);
    });
    return () => { cancelled = true; };
  }, [pathname, productReturnQuery, requestedProductId, router]);

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

  const stats = data?.counters ?? EMPTY_COUNTERS;
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
      const saved = await fetchApi<{ item: { reference?: string | null } }>("/api/products", {
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
        editingProduct
          ? "Produit mis à jour."
          : `Produit ajouté à la base.${saved.item.reference ? ` Référence : ${saved.item.reference}.` : ""}`,
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
      const confirmed = await confirm({
        title: `Archiver « ${product.designation} » ?`,
        description:
          "Il ne sera plus proposé dans les nouveaux chiffrages, mais son historique sera conservé. Vous pourrez le restaurer à tout moment.",
        confirmLabel: "Archiver",
        tone: "danger",
      });
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
        error instanceof Error ? error.message : "Mise à jour impossible.",
      );
    } finally {
      setUpdatingStatusId(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        className="sm:mb-6"
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Produits" },
        ]}
        title="Produits & prix de référence"
        meta={
          <Badge variant="outline" className="font-mono">
            {data ? `${stats.active.toLocaleString("fr-FR")} produits actifs` : "Chargement…"}
          </Badge>
        }
        actions={
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              size="lg"
              className="min-h-11 flex-1 sm:flex-none"
              leftIcon={<PlusIcon aria-hidden="true" />}
              onClick={openCreateForm}
            >
              Ajouter
            </Button>
            <ProductCatalogueMenu
              stats={stats}
              onTemplateImport={openTemplateImport}
              onCsvImport={openCsvImport}
            />
          </div>
        }
      />

      <div className="mb-5 space-y-3 empty:hidden">
        {isOpeningProduct ? (
          <LoadingState label="Ouverture de la fiche produit…" className="justify-start py-0" />
        ) : null}
        {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
        {!isFormOpen && formError ? <Alert variant="danger">{formError}</Alert> : null}
      </div>

      <ServerTableFilterBar
        compact
        searchValue={searchInput}
        searchPlaceholder="Rechercher une référence, une matière, une nuance ou une dimension…"
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

      <section
        aria-label="Base produits"
        className={cn(
          "min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card transition-opacity",
          isValidating && data && "opacity-70"
        )}
        aria-busy={isValidating}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
          <p className="min-w-0 text-xs text-muted-foreground">
            {totalItems > 0
              ? `${pageStart}–${pageEnd} sur ${totalItems.toLocaleString("fr-FR")} produits`
              : "Identité, caractéristiques et prix fournisseur."}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Link
              className={buttonVariants({
                variant: "ghost",
                size: "sm",
                className: "hidden min-h-10 text-primary sm:inline-flex",
              })}
              href="/dashboard/prices"
            >
              <TagsIcon aria-hidden="true" />
              Tarifs fournisseurs
            </Link>
            <IconButton
              variant="outline"
              size="icon-lg"
              label={isValidating ? "Actualisation en cours" : "Actualiser les produits"}
              disabled={isValidating}
              onClick={() => void mutate()}
              icon={
                <RefreshCwIcon
                  aria-hidden="true"
                  className={cn(isValidating && "animate-spin motion-reduce:animate-none")}
                />
              }
            />
          </div>
        </div>

        {loadError ? (
          <div className="p-4">
            <Alert variant="danger">
              {loadError instanceof Error
                ? loadError.message
                : "Impossible de charger la base produits."}
            </Alert>
          </div>
        ) : null}

        <ProductsTable
          products={products}
          isInitialLoading={isLoading && !data}
          isCatalogueEmpty={globalTotal === 0}
          totalItems={totalItems}
          updatingStatusId={updatingStatusId}
          onCreate={openCreateForm}
          onTemplateImport={openTemplateImport}
          onEdit={openEditForm}
          onReviewPrice={setReferenceProduct}
          onToggleArchive={(product) => void toggleArchive(product)}
        />

        {totalItems > 0 ? (
          <ProductsPagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            pageSizes={PRODUCT_PAGE_SIZES}
            onPageChange={(nextPage) =>
              updateUrl({ page: String(nextPage) }, { resetPage: false })
            }
            onPageSizeChange={(size) => updateUrl({ size: String(size) })}
          />
        ) : null}
      </section>

      <Dialog
        open={Boolean(referenceProduct)}
        onOpenChange={(open) => {
          if (!open) setReferenceProduct(null);
        }}
      >
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>{referenceProduct?.designation}</DialogTitle>
          </DialogHeader>
          {referenceProduct ? (
            <ProductReferencePricePanel
              key={referenceProduct.id}
              productId={referenceProduct.id}
              onValidated={() => {
                void mutate();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
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
