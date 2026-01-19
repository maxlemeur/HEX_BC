"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import useSWR from "swr";

import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type PurchaseOrderListRow = {
  id: string;
  reference: string;
  status: PurchaseOrderStatus;
  expected_delivery_date: string | null;
  total_ttc_cents: number;
  suppliers: { name: string } | { name: string }[] | null;
  delivery_sites: { name: string } | { name: string }[] | null;
};

function statusLabel(status: PurchaseOrderStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyee";
    case "confirmed":
      return "Confirmee";
    case "received":
      return "Recue";
    case "canceled":
      return "Annulee";
    default:
      return status;
  }
}

function relatedName(value: PurchaseOrderListRow["suppliers"]) {
  if (!value) return "-";
  if (Array.isArray(value)) return value[0]?.name ?? "-";
  return value.name;
}

export default function OrdersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select(
        "id, reference, status, expected_delivery_date, total_ttc_cents, suppliers ( name ), delivery_sites ( name )"
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as unknown as PurchaseOrderListRow[];
  }, [supabase]);

  const {
    data: orders = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<PurchaseOrderListRow[]>("purchase-orders", fetchOrders, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Bons de commande
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Gere les achats fournisseurs.
          </p>
        </div>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          href="/dashboard/orders/new"
        >
          Nouveau bon
        </Link>
      </div>

      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError.message}
        </p>
      ) : null}

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

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
              <tr>
                <th className="px-6 py-3">Reference</th>
                <th className="px-6 py-3">Fournisseur</th>
                <th className="px-6 py-3">Chantier</th>
                <th className="px-6 py-3">Date livraison</th>
                <th className="px-6 py-3">Statut</th>
                <th className="px-6 py-3 text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {orders.length === 0 ? (
                <tr>
                  <td className="px-6 py-6 text-zinc-600" colSpan={6}>
                    {isLoading
                      ? "Chargement..."
                      : "Aucun bon de commande pour le moment."}
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="hover:bg-zinc-50">
                    <td className="px-6 py-4 font-medium">
                      <Link
                        className="hover:underline"
                        href={`/dashboard/orders/${order.id}`}
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {relatedName(order.suppliers)}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {relatedName(order.delivery_sites)}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {order.expected_delivery_date ?? "-"}
                    </td>
                    <td className="px-6 py-4 text-zinc-700">
                      {statusLabel(order.status)}
                    </td>
                    <td className="px-6 py-4 text-right text-zinc-700">
                      {formatEUR(order.total_ttc_cents)}
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
