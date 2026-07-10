"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { BulkJsonPanel } from "@/components/catalogue/prices-manager/BulkJsonPanel";
import { DeletePriceModal } from "@/components/catalogue/prices-manager/DeletePriceModal";
import { PriceFormModal } from "@/components/catalogue/prices-manager/PriceFormModal";
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
    type: "multi-select",
    key: "_freshnessLevel",
    label: "Fraîcheur",
    placeholder: "Toutes",
    options: FRESHNESS_FILTER_OPTIONS,
  },
];

const PRICES_SORT_OPTIONS: SortOption[] = [
  { key: "_supplierName", label: "Fournisseur", defaultDirection: "asc" },
  { key: "_productName", label: "Produit", defaultDirection: "asc" },
  { key: "unit_price_cents", label: "Prix HT" },
  { key: "updated_at", label: "Dernière MAJ", defaultDirection: "desc" },
];

// --- Component ---

export function PricesManager({
  embedded = false,
  productId = null,
}: {
  embedded?: boolean;
  productId?: string | null;
}) {
  const { lookups, supplierMap, productMap, supplierOptions, productOptions, reloadLookups } =
    usePriceLookups();
  const { rawItems, enrichedItems, stats, loadError, isLoading, isValidating, refresh } =
    useSupplierPricesList({ supplierMap, productMap, productId });
  const focusedProductName = productId ? productMap.get(productId) ?? null : null;

  // --- TableFilterBar state ---
  const [displayedItems, setDisplayedItems] = useState<EnrichedPrice[]>([]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EnrichedPrice | null>(null);
  // --- Delete confirmation state ---
  const [deleteTarget, setDeleteTarget] = useState<EnrichedPrice | null>(null);

  // --- CSV import collapsible ---
  const [isCsvOpen, setIsCsvOpen] = useState(embedded);
  const [isTemplateImportOpen, setIsTemplateImportOpen] = useState(false);

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
        <div className="page-header flex items-start justify-between gap-6">
          <div>
            <h1 className="page-title">Prix fournisseurs</h1>
            <p className="page-description">
              Gérez les tarifs de vos fournisseurs. Ajoutez-les un par un ou importez-les en masse depuis un fichier CSV.
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
            Ajouter un prix
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
            <PriceBookCsvImport
              onImported={handleImported}
              onLookupsUpdated={reloadLookups}
              lookups={lookups}
            />
          </div>
        ) : null}
      </section>

      {/* Stats cards */}
      {!isLoading && enrichedItems.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Total prix</p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">À jour</p>
            <p className="mt-1 text-lg font-semibold text-emerald-600">{stats.fresh}</p>
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

      {/* TableFilterBar */}
      <TableFilterBar
        data={enrichedItems}
        onDataChange={setDisplayedItems}
        search={{
          placeholder: "Rechercher par fournisseur ou produit...",
          fields: ["_supplierName", "_productName"],
        }}
        filters={PRICES_FILTERS}
        sortOptions={PRICES_SORT_OPTIONS}
        resultCountLabel="prix fournisseur"
        showResultCount
      />

      <PricesTable
        items={displayedItems}
        totalItemsCount={enrichedItems.length}
        rawItemsCount={rawItems.length}
        isLoading={isLoading}
        loadError={loadError}
        isValidating={isValidating}
        onRefresh={() => void refresh()}
        onCreate={openCreateForm}
        onEdit={openEditForm}
        onDelete={setDeleteTarget}
      />

      <BulkJsonPanel onCompleted={refresh} />

      <PriceFormModal
        open={isFormOpen}
        item={editingItem}
        supplierOptions={supplierOptions}
        productOptions={productOptions}
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
