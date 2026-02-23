"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { fetchApi } from "@/components/catalogue/api";
import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";
import type { SupplierPrice } from "@/components/catalogue/types";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { FilterConfig, SortOption } from "@/components/TableFilterBar";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/Toast";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { priceFreshnessLevel } from "@/lib/catalogue/stale-prices";
import { formatEUR, parseEuroToCents } from "@/lib/money";

type PricesListResponse = {
  items: SupplierPrice[];
};

type EnrichedPrice = SupplierPrice & {
  _supplierName: string;
  _productName: string;
  _freshnessLevel: "fresh" | "aging" | "stale";
  _ageDays: number;
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
const LOOKUP_PAGE_SIZE = 1000;

// --- Helpers ---

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

// --- Freshness badge ---

function FreshnessBadge({ level, ageDays }: { level: "fresh" | "aging" | "stale"; ageDays: number }) {
  if (level === "fresh") {
    return (
      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        À jour
      </span>
    );
  }
  if (level === "aging") {
    return (
      <span className="inline-flex rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
        Vieillissant ({ageDays}j)
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      Ancien ({ageDays}j)
    </span>
  );
}

// --- Component ---

export function PricesManager() {
  const toast = useToast();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // --- Lookups ---
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; designation: string; reference?: string | null }[]>([]);

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

  const loadLookups = useCallback(async () => {
    async function fetchAllLookupRows<T>(
      fetchPage: (from: number, to: number) => PromiseLike<{
        data: T[] | null;
        error: { message?: string | null } | null;
      }>
    ): Promise<T[]> {
      const allRows: T[] = [];
      let offset = 0;

      while (true) {
        const { data, error } = await fetchPage(offset, offset + LOOKUP_PAGE_SIZE - 1);
        if (error) {
          throw new Error(error.message ?? "Impossible de charger les referentiels.");
        }

        const pageRows = data ?? [];
        allRows.push(...pageRows);

        if (pageRows.length < LOOKUP_PAGE_SIZE) {
          return allRows;
        }

        offset += LOOKUP_PAGE_SIZE;
      }
    }

    const [supplierRows, productRows] = await Promise.all([
      fetchAllLookupRows<{ id: string; name: string }>((from, to) =>
        supabase
          .from("suppliers")
          .select("id, name")
          .order("name")
          .range(from, to)
      ),
      fetchAllLookupRows<{ id: string; designation: string; reference?: string | null }>(
        (from, to) =>
          supabase
            .from("products")
            .select("id, designation, reference")
            .order("designation")
            .range(from, to)
      ),
    ]);
    setSuppliers(supplierRows);
    setProducts(productRows);
    return {
      suppliers: supplierRows,
      products: productRows,
    };
  }, [supabase]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  // --- SWR data fetching ---
  const fetchPrices = useCallback(async () => {
    const data = await fetchApi<PricesListResponse>("/api/prices?limit=400");
    return data.items ?? [];
  }, []);

  const {
    data: rawItems = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<SupplierPrice[]>("supplier-prices", fetchPrices, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  // Enrich items with resolved names and freshness for TableFilterBar
  const enrichedItems = useMemo<EnrichedPrice[]>(() => {
    const now = new Date();
    return rawItems.map((item) => {
      const { level, ageDays } = priceFreshnessLevel(
        { updatedAt: item.updated_at ?? null, createdAt: item.created_at ?? null },
        now
      );
      return {
        ...item,
        _supplierName: supplierMap.get(item.supplier_id) ?? item.supplier_id,
        _productName: productMap.get(item.product_id ?? item.catalogue_item_id ?? "") ?? item.product_id ?? item.catalogue_item_id ?? "",
        _freshnessLevel: level,
        _ageDays: ageDays,
      };
    });
  }, [rawItems, supplierMap, productMap]);

  // --- TableFilterBar state ---
  const [displayedItems, setDisplayedItems] = useState<EnrichedPrice[]>([]);

  // --- Form state ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formState, setFormState] = useState<SupplierPriceFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // --- Delete confirmation state ---
  const [deleteTarget, setDeleteTarget] = useState<EnrichedPrice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- CSV import collapsible ---
  const [isCsvOpen, setIsCsvOpen] = useState(false);

  // --- Bulk JSON ---
  const [showBulkJson, setShowBulkJson] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
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

  // --- Stats ---
  const stats = useMemo(() => {
    const total = enrichedItems.length;
    const fresh = enrichedItems.filter((i) => i._freshnessLevel === "fresh").length;
    const stale = enrichedItems.filter((i) => i._freshnessLevel === "stale").length;
    const uniqueSuppliers = new Set(enrichedItems.map((i) => i.supplier_id)).size;
    return { total, fresh, stale, uniqueSuppliers };
  }, [enrichedItems]);

  // --- Form handlers ---

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setFormError(null);
    setIsSaving(false);
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }, []);

  const openCreateForm = useCallback(() => {
    setFormError(null);
    setIsSaving(false);
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setIsFormOpen(true);
  }, []);

  const openEditForm = useCallback((item: EnrichedPrice) => {
    setFormError(null);
    setIsSaving(false);
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
    setIsFormOpen(true);
  }, []);

  useEffect(() => {
    if (!isFormOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFormOpen]);

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

    try {
      const payload = {
        supplier_id: formState.supplier_id.trim(),
        product_id: formState.product_id.trim(),
        unit_price_cents: unitPriceCents,
        currency: formState.currency.trim().toUpperCase() || "EUR",
        valid_from: formState.valid_from || null,
        valid_to: formState.valid_to || null,
        source: formState.source.trim() || null,
        notes: formState.notes.trim() || null,
      };

      if (editingId) {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", id: editingId, item: payload }),
        });
        toast.success({ title: "Prix fournisseur mis à jour." });
      } else {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", item: payload }),
        });
        toast.success({ title: "Prix fournisseur créé." });
      }

      closeForm();
      await mutate();
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

  // --- Delete handler ---

  async function confirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      await fetchApi<{ deleted_id: string }>("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: deleteTarget.id }),
      });

      toast.success({ title: "Prix fournisseur supprimé." });
      setDeleteTarget(null);
      await mutate();
    } catch (deleteError) {
      toast.error({
        title: "Erreur",
        description: deleteError instanceof Error ? deleteError.message : "Impossible de supprimer le prix fournisseur.",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  // --- Bulk create ---

  async function onBulkCreate() {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(bulkPayload);
    } catch {
      toast.error({ title: "Le JSON saisi est invalide." });
      return;
    }

    setIsBulkRunning(true);

    try {
      const result = await fetchApi<{ created_count: number; mode: string }>("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-create", items: parsedPayload }),
      });

      toast.success({ title: `Création en masse terminée : ${result.created_count} ligne(s) créée(s).` });
      await mutate();
    } catch (bulkError) {
      toast.error({
        title: "Erreur",
        description: bulkError instanceof Error ? bulkError.message : "Impossible d'exécuter la création en masse.",
      });
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
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
              onImported={() => void mutate()}
              onLookupsUpdated={loadLookups}
              lookups={{ suppliers, products }}
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
            <p className="mt-1 text-lg font-semibold text-red-600">{stats.stale}</p>
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

      {/* Table card */}
      <div className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Liste des prix fournisseurs
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
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            {loadError instanceof Error ? loadError.message : "Impossible de charger les prix fournisseur."}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Produit</th>
                <th>Prix HT</th>
                <th>Validité</th>
                <th>Mis à jour le</th>
                <th title="Indique si le prix n'a pas été mis à jour depuis longtemps">Fraîcheur</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                        <span className="text-[var(--slate-500)]">Chargement...</span>
                      </div>
                    ) : enrichedItems.length === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth="1.5">
                            <path d="M2 17 12 22 22 17" />
                            <path d="M2 12 12 17 22 12" />
                            <path d="M12 2 2 7 12 12 22 7Z" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun prix fournisseur</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">
                            Ajoutez un prix manuellement ou importez un fichier CSV pour démarrer.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm mt-2"
                          onClick={openCreateForm}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </svg>
                          Ajouter un prix
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth="1.5">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun résultat</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Modifiez vos filtres pour voir plus de résultats.</p>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                displayedItems.map((item, index) => (
                  <tr
                    key={item.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 0.03}s` }}
                  >
                    <td className="font-semibold text-[var(--slate-800)]">
                      {item._supplierName}
                    </td>
                    <td className="text-sm text-[var(--slate-700)]">
                      {item._productName}
                    </td>
                    <td className="font-mono font-medium text-[var(--slate-900)]">
                      {typeof item.unit_price_cents === "number"
                        ? formatEUR(item.unit_price_cents)
                        : "-"}
                      {item.currency && item.currency !== "EUR" ? ` ${item.currency}` : ""}
                    </td>
                    <td className="text-sm">
                      {item.valid_from || item.valid_to ? (
                        <>{formatDate(item.valid_from)} {"\u2192"} {item.valid_to ? formatDate(item.valid_to) : "(illimitée)"}</>
                      ) : (
                        <span className="text-[var(--slate-400)]">Non définie</span>
                      )}
                    </td>
                    <td className="text-sm">{formatDate(item.updated_at ?? item.created_at)}</td>
                    <td>
                      <FreshnessBadge level={item._freshnessLevel} ageDays={item._ageDays} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEditForm(item)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setDeleteTarget(item)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
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

        {!isLoading && rawItems.length >= 400 ? (
          <div className="border-t border-[var(--slate-200)] px-6 py-3 text-xs text-[var(--slate-500)]">
            Limite de 400 résultats atteinte. Utilisez les filtres pour affiner votre recherche.
          </div>
        ) : null}
      </div>

      {/* Bulk JSON section */}
      <section className="dashboard-card p-6">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowBulkJson((prev) => !prev)}
        >
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Mode avancé</h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Collez un tableau JSON pour créer plusieurs prix en une seule fois.
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
                {isBulkRunning ? "Traitement..." : "Lancer la création en masse"}
              </button>
            </div>
          </>
        ) : null}
      </section>

      {/* Create / Edit Modal */}
      <Modal.Root open={isFormOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <Modal.Content className="max-w-4xl">
          <Modal.Header>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-blue)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.75">
                  {editingId ? (
                    <>
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </>
                  ) : (
                    <>
                      <path d="M5 12h14" />
                      <path d="M12 5v14" />
                    </>
                  )}
                </svg>
              </div>
              <div>
                <Modal.Title>
                  {editingId ? "Modifier un prix fournisseur" : "Ajouter un prix fournisseur"}
                </Modal.Title>
                <p className="text-sm text-[var(--slate-500)]">
                  {editingId
                    ? "Mettez à jour les informations du prix fournisseur."
                    : "Renseignez les informations du nouveau prix."}
                </p>
              </div>
            </div>
          </Modal.Header>

          <form className="grid gap-5 sm:grid-cols-2" onSubmit={onSubmit}>
            <div>
              <label className="form-label" htmlFor="price-supplier-id">Fournisseur *</label>
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
              <label className="form-label" htmlFor="price-product-id">Produit *</label>
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
              <label className="form-label" htmlFor="price-unit-price">Prix unitaire HT *</label>
              <div className="relative">
                <input
                  id="price-unit-price"
                  className="form-input pr-12"
                  inputMode="decimal"
                  value={formState.unit_price_euros}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, unit_price_euros: event.target.value }))
                  }
                  placeholder="0,00"
                  required
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--slate-400)]" aria-hidden="true">
                  EUR
                </span>
              </div>
            </div>

            <div>
              <label className="form-label" htmlFor="price-currency">Devise</label>
              <select
                id="price-currency"
                className="form-input form-select"
                value={formState.currency}
                onChange={(e) => setFormState((p) => ({ ...p, currency: e.target.value }))}
              >
                <option value="EUR">EUR - Euro</option>
                <option value="USD">USD - Dollar US</option>
                <option value="GBP">GBP - Livre sterling</option>
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="price-valid-from">Valide du</label>
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
              <label className="form-label" htmlFor="price-valid-to">Valide au</label>
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
              <label className="form-label" htmlFor="price-source">Source</label>
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
              <label className="form-label" htmlFor="price-notes">Notes</label>
              <input
                id="price-notes"
                className="form-input"
                value={formState.notes}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, notes: event.target.value }))
                }
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 pt-2">
              {formError ? (
                <div className="alert alert-error flex-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                  onClick={closeForm}
                  type="button"
                  disabled={isSaving}
                >
                  Annuler
                </button>
                <button
                  className="btn btn-primary"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                      Enregistrement...
                    </>
                  ) : editingId ? (
                    "Mettre à jour"
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </svg>
                      Ajouter
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </Modal.Content>
      </Modal.Root>

      {/* Delete confirmation modal */}
      <Modal.Root open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <Modal.Content className="max-w-md">
          <Modal.Header>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--danger)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.75">
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </div>
              <div>
                <Modal.Title>Confirmer la suppression</Modal.Title>
                <p className="text-sm text-[var(--slate-500)]">Cette action est irréversible.</p>
              </div>
            </div>
          </Modal.Header>

          {deleteTarget ? (
            <Modal.Body>
              <p className="text-sm text-[var(--slate-700)]">
                Voulez-vous supprimer le prix de{" "}
                <strong>{deleteTarget._supplierName}</strong> pour{" "}
                <strong>{deleteTarget._productName}</strong>{" "}
                ({typeof deleteTarget.unit_price_cents === "number" ? formatEUR(deleteTarget.unit_price_cents) : "-"}) ?
              </p>
            </Modal.Body>
          ) : null}

          <Modal.Footer>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                  Suppression...
                </>
              ) : (
                "Supprimer"
              )}
            </button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </div>
  );
}
