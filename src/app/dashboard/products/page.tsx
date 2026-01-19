"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

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

function taxLabelFromBp(taxRateBp: number) {
  const match = TAX_RATE_OPTIONS.find((x) => x.value === taxRateBp);
  if (match) return match.label;
  return `${(taxRateBp / 100).toFixed(2)}%`;
}

export default function ProductsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [reference, setReference] = useState("");
  const [designation, setDesignation] = useState("");
  const [unitPriceEuros, setUnitPriceEuros] = useState("");
  const [taxRateBp, setTaxRateBp] = useState<number>(2000);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Produits</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Catalogue des produits (prix, TVA, reference).
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Ajouter un produit</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={onCreateProduct}>
          <label className="block">
            <span className="text-sm font-medium">Reference</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="REF-001"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Designation</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              placeholder="Produit"
              required
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Prix unitaire (EUR)</span>
            <input
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              inputMode="decimal"
              placeholder="12,50"
              required
              value={unitPriceEuros}
              onChange={(event) => setUnitPriceEuros(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">TVA</span>
            <select
              className="mt-1 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
              value={taxRateBp}
              onChange={(event) => setTaxRateBp(Number(event.target.value))}
            >
              {TAX_RATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            {formError ? (
              <p className="text-sm text-red-700">{formError}</p>
            ) : (
              <span />
            )}
            <button
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={creating}
              type="submit"
            >
              {creating ? "Ajout..." : "Ajouter"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-sm font-semibold">Liste</h2>
          <button
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isValidating}
            onClick={() => void mutate()}
            type="button"
          >
            {isValidating ? "Chargement..." : "Rafraichir"}
          </button>
        </div>

        {loadError ? (
          <p className="border-b border-zinc-200 px-6 py-3 text-sm text-red-700">
            {loadError.message}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-6 py-3">Designation</th>
                <th className="px-6 py-3">Reference</th>
                <th className="px-6 py-3">Prix</th>
                <th className="px-6 py-3">TVA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {products.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-zinc-600" colSpan={4}>
                    {isLoading
                      ? "Chargement..."
                      : "Aucun produit pour le moment."}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4 font-medium">
                      {product.designation}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {product.reference ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {formatEUR(product.unit_price_cents)}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {taxLabelFromBp(product.tax_rate_bp)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
