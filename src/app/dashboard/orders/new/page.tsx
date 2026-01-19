"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  computeLineTotals,
  computeOrderTotals,
} from "@/lib/order-calculations";
import { formatEUR, parseEuroToCents } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SupplierOption = { id: string; name: string };
type SiteOption = { id: string; name: string; project_code: string | null };
type ProductOption = {
  id: string;
  designation: string;
  reference: string | null;
  unit_price_cents: number;
  tax_rate_bp: number;
};

type DraftItem = {
  key: string;
  productId: string | null;
  reference: string;
  designation: string;
  quantity: number;
  unitPriceEuros: string;
  taxRateBp: number;
};

const TAX_RATE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "0%", value: 0 },
  { label: "5,5%", value: 550 },
  { label: "10%", value: 1000 },
  { label: "20%", value: 2000 },
];

function taxLabelFromBp(taxRateBp: number) {
  const match = TAX_RATE_OPTIONS.find((x) => x.value === taxRateBp);
  if (match) return match.label;
  return `${(taxRateBp / 100).toFixed(2)}%`;
}

function euroInputFromCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function newDraftItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productId: null,
    reference: "",
    designation: "",
    quantity: 1,
    unitPriceEuros: "",
    taxRateBp: 2000,
  };
}

export default function NewOrderPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [supplierId, setSupplierId] = useState<string>("");
  const [deliverySiteId, setDeliverySiteId] = useState<string>("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchSuppliers = useCallback(async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as SupplierOption[];
  }, [supabase]);

  const fetchSites = useCallback(async () => {
    const { data, error } = await supabase
      .from("delivery_sites")
      .select("id, name, project_code")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as SiteOption[];
  }, [supabase]);

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, designation, reference, unit_price_cents, tax_rate_bp")
      .eq("is_active", true)
      .order("designation", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as ProductOption[];
  }, [supabase]);

  const {
    data: suppliers = [],
    error: suppliersError,
    isLoading: isSuppliersLoading,
  } = useSWR<SupplierOption[]>("po-suppliers", fetchSuppliers, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const {
    data: sites = [],
    error: sitesError,
    isLoading: isSitesLoading,
  } = useSWR<SiteOption[]>("po-sites", fetchSites, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const {
    data: products = [],
    error: productsError,
    isLoading: isProductsLoading,
  } = useSWR<ProductOption[]>("po-products", fetchProducts, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const loadError = suppliersError ?? sitesError ?? productsError;
  const isLoading = isSuppliersLoading || isSitesLoading || isProductsLoading;
  const displayError = formError ?? (loadError ? loadError.message : null);

  function applyProductToItem(itemKey: string, productId: string) {
    if (!productId) {
      setItems((prev) =>
        prev.map((item) =>
          item.key === itemKey ? { ...item, productId: null } : item
        )
      );
      return;
    }

    const product = products.find((p) => p.id === productId);
    if (!product) return;

    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== itemKey) return item;
        return {
          ...item,
          productId: product.id,
          reference: product.reference ?? "",
          designation: product.designation,
          unitPriceEuros: euroInputFromCents(product.unit_price_cents),
          taxRateBp: product.tax_rate_bp,
        };
      })
    );
  }

  function removeItem(itemKey: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i.key !== itemKey);
      return next.length === 0 ? [newDraftItem()] : next;
    });
  }

  const computed = items.map((item) => {
    const unitPriceCents = parseEuroToCents(item.unitPriceEuros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      return {
        key: item.key,
        valid: false as const,
        unitPriceCents: 0,
        lineTotalHtCents: 0,
        lineTaxCents: 0,
        lineTotalTtcCents: 0,
      };
    }

    const totals = computeLineTotals({
      quantity: item.quantity,
      unitPriceHtCents: unitPriceCents,
      taxRateBp: item.taxRateBp,
    });

    return {
      key: item.key,
      valid: true as const,
      unitPriceCents,
      ...totals,
    };
  });

  const validLineTotals = computed.filter((item) => item.valid);
  const orderTotals = computeOrderTotals(
    validLineTotals.map((item) => ({
      lineTotalHtCents: item.lineTotalHtCents,
      lineTaxCents: item.lineTaxCents,
      lineTotalTtcCents: item.lineTotalTtcCents,
    }))
  );

  async function onCreateOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!supplierId || !deliverySiteId) {
      setFormError("Selectionnez un fournisseur et un chantier.");
      return;
    }

    const invalid = computed.find((x) => !x.valid);
    if (invalid) {
      setFormError("Un des prix est invalide.");
      return;
    }

    const cleanedItems = items
      .map((item) => {
        const computedLine = computed.find((x) => x.key === item.key);
        return {
          key: item.key,
          productId: item.productId,
          reference: item.reference.trim() || null,
          designation: item.designation.trim(),
          quantity: item.quantity,
          taxRateBp: item.taxRateBp,
          unitPriceCents: computedLine?.unitPriceCents ?? 0,
        };
      })
      .filter((item) => item.designation.length > 0 && item.quantity > 0);

    if (cleanedItems.length === 0) {
      setFormError("Ajoutez au moins une ligne de commande.");
      return;
    }

    setCreating(true);

    const response = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        deliverySiteId,
        expectedDeliveryDate: expectedDeliveryDate || null,
        notes: notes.trim() || null,
        items: cleanedItems,
      }),
    });

    setCreating(false);

    let result: { id?: string; error?: string } | null = null;
    try {
      result = (await response.json()) as { id?: string; error?: string };
    } catch {
      result = null;
    }

    if (!response.ok || !result?.id) {
      setFormError(result?.error ?? "Impossible de creer le bon.");
      return;
    }

    router.push(`/dashboard/orders/${result.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Nouveau bon de commande
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Selectionnez le fournisseur, le chantier et ajoutez les lignes.
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          href="/dashboard/orders"
        >
          Annuler
        </Link>
      </div>

      {displayError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {displayError}
        </p>
      ) : null}

      <form className="space-y-6" onSubmit={onCreateOrder}>
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold">Informations</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Fournisseur</span>
              <select
                className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 disabled:opacity-60"
                disabled={isLoading}
                required
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                <option value="">- Selectionner -</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Chantier</span>
              <select
                className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 disabled:opacity-60"
                disabled={isLoading}
                required
                value={deliverySiteId}
                onChange={(event) => setDeliverySiteId(event.target.value)}
              >
                <option value="">- Selectionner -</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.project_code ? `${site.project_code} - ` : ""}
                    {site.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Livraison souhaitee</span>
              <input
                className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                type="date"
                value={expectedDeliveryDate}
                onChange={(event) => setExpectedDeliveryDate(event.target.value)}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Notes</span>
              <textarea
                className="mt-1 min-h-[96px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                placeholder="Informations complementaires"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
            <h2 className="text-sm font-semibold">Lignes</h2>
            <button
              className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              onClick={() => setItems((prev) => [...prev, newDraftItem()])}
              type="button"
            >
              Ajouter une ligne
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-6 py-3">Produit</th>
                  <th className="px-6 py-3">Reference</th>
                  <th className="px-6 py-3">Designation</th>
                  <th className="px-6 py-3">Qt</th>
                  <th className="px-6 py-3">Prix HT (EUR)</th>
                  <th className="px-6 py-3">TVA</th>
                  <th className="px-6 py-3 text-right">Total TTC</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {items.map((item) => {
                  const amounts = computed.find((x) => x.key === item.key);
                  const lineTotal = amounts?.lineTotalTtcCents ?? 0;

                  return (
                    <tr key={item.key} className="align-top">
                      <td className="px-6 py-4">
                        <select
                          className="h-10 w-56 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          value={item.productId ?? ""}
                          onChange={(event) =>
                            applyProductToItem(item.key, event.target.value)
                          }
                        >
                          <option value="">-</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.reference
                                ? `${product.reference} - `
                                : ""}
                              {product.designation}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4">
                        <input
                          className="h-10 w-32 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          placeholder="REF"
                          value={item.reference}
                          onChange={(event) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === item.key
                                  ? { ...x, reference: event.target.value }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          className="h-10 w-72 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          placeholder="Designation"
                          required
                          value={item.designation}
                          onChange={(event) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === item.key
                                  ? { ...x, designation: event.target.value }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          className="h-10 w-20 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          min={1}
                          step={1}
                          type="number"
                          value={item.quantity}
                          onChange={(event) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === item.key
                                  ? {
                                      ...x,
                                      quantity: Math.max(
                                        1,
                                        Number(event.target.value || 1)
                                      ),
                                    }
                                  : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-6 py-4">
                        <input
                          className="h-10 w-28 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          inputMode="decimal"
                          placeholder="0,00"
                          required
                          value={item.unitPriceEuros}
                          onChange={(event) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === item.key
                                  ? { ...x, unitPriceEuros: event.target.value }
                                  : x
                              )
                            )
                          }
                        />
                        {amounts && !amounts.valid ? (
                          <p className="mt-1 text-xs text-red-700">
                            Prix invalide
                          </p>
                        ) : null}
                      </td>
                      <td className="px-6 py-4">
                        <select
                          className="h-10 w-24 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
                          value={item.taxRateBp}
                          onChange={(event) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === item.key
                                  ? {
                                      ...x,
                                      taxRateBp: Number(event.target.value),
                                    }
                                  : x
                              )
                            )
                          }
                        >
                          {TAX_RATE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-zinc-600">
                          {taxLabelFromBp(item.taxRateBp)}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        {formatEUR(lineTotal)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                          onClick={() => removeItem(item.key)}
                          type="button"
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-zinc-200 px-6 py-4">
            <div className="ml-auto grid max-w-sm gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Total HT</span>
                <span className="font-medium">
                  {formatEUR(orderTotals.totalHtCents)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">TVA</span>
                <span className="font-medium">
                  {formatEUR(orderTotals.totalTaxCents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-semibold">Total TTC</span>
                <span className="font-semibold">
                  {formatEUR(orderTotals.totalTtcCents)}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          <button
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={creating}
            type="submit"
          >
            {creating ? "Creation..." : "Creer le bon"}
          </button>
        </div>
      </form>
    </div>
  );
}
