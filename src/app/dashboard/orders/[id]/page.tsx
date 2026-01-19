import Link from "next/link";
import { notFound } from "next/navigation";

import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import { formatEUR } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type Supplier = {
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  siret: string | null;
  vat_number: string | null;
  payment_terms: string | null;
};

type DeliverySite = {
  name: string;
  project_code: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type PurchaseOrder = {
  id: string;
  reference: string;
  order_number: number;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  currency: string;
  suppliers: Supplier | null;
  delivery_sites: DeliverySite | null;
};

type PurchaseOrderItem = {
  id: string;
  reference: string | null;
  designation: string;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
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

export default async function OrderPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: orderData, error: orderError } = await supabase
    .from("purchase_orders")
    .select(
      "id, reference, order_number, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, currency, suppliers ( name, address, city, postal_code, country, email, phone, contact_name, siret, vat_number, payment_terms ), delivery_sites ( name, project_code, address, city, postal_code, contact_name, contact_phone )"
    )
    .eq("id", id)
    .single();

  if (orderError || !orderData) {
    notFound();
  }

  const order = orderData as unknown as PurchaseOrder;

  const { data: itemsData } = await supabase
    .from("purchase_order_items")
    .select(
      "id, reference, designation, quantity, unit_price_ht_cents, tax_rate_bp, line_total_ht_cents, line_tax_cents, line_total_ttc_cents"
    )
    .eq("purchase_order_id", order.id)
    .order("position", { ascending: true });

  const items = (itemsData ?? []) as unknown as PurchaseOrderItem[];
  const supplier = order.suppliers;
  const deliverySite = order.delivery_sites;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Bon de commande
            </h1>
            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700">
              {statusLabel(order.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            Reference : {order.reference}
          </p>
          <p className="text-sm text-zinc-600">
            Numero : {order.order_number}
          </p>
          <p className="text-sm text-zinc-600">Date : {order.order_date}</p>
          <p className="text-sm text-zinc-600">
            Livraison : {order.expected_delivery_date ?? "-"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            href={`/dashboard/orders/${order.id}/print`}
          >
            Imprimer / PDF
          </Link>
          <Link
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            href="/dashboard/orders"
          >
            Retour
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-sm font-semibold">Statut</h2>
        <div className="mt-3">
          <PurchaseOrderStatusUpdater
            orderId={order.id}
            status={order.status}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold">Lignes</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3 text-right">Qt</th>
                  <th className="px-4 py-3 text-right">Prix HT</th>
                  <th className="px-4 py-3 text-right">TVA</th>
                  <th className="px-4 py-3 text-right">Total TTC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3">
                      {item.reference ?? "-"}
                    </td>
                    <td className="px-4 py-3">{item.designation}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">
                      {formatEUR(item.unit_price_ht_cents)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(item.tax_rate_bp / 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatEUR(item.line_total_ttc_cents)}
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-zinc-600" colSpan={6}>
                      Aucune ligne.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-6 ml-auto grid max-w-sm gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">Total HT</span>
              <span className="font-medium">
                {formatEUR(order.total_ht_cents)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">TVA</span>
              <span className="font-medium">
                {formatEUR(order.total_tax_cents)}
              </span>
            </div>
            <div className="flex items-center justify-between text-base">
              <span className="font-semibold">Total TTC</span>
              <span className="font-semibold">
                {formatEUR(order.total_ttc_cents)}
              </span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold">Fournisseur</h2>
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-medium">{supplier?.name ?? "-"}</p>
            <p className="text-zinc-700">
              {supplier?.contact_name ?? "-"}
            </p>
            <p className="text-zinc-700">{supplier?.email ?? "-"}</p>
            <p className="text-zinc-700">{supplier?.phone ?? "-"}</p>
            {supplier?.address ? (
              <pre className="whitespace-pre-wrap text-zinc-700">
                {supplier.address}
              </pre>
            ) : (
              <p className="text-zinc-700">-</p>
            )}
            <p className="text-zinc-700">
              {supplier?.postal_code ?? ""} {supplier?.city ?? ""}
            </p>
            <p className="text-zinc-700">{supplier?.country ?? ""}</p>
            <p className="text-zinc-700">SIRET : {supplier?.siret ?? "-"}</p>
            <p className="text-zinc-700">
              TVA : {supplier?.vat_number ?? "-"}
            </p>
            <p className="text-zinc-700">
              Paiement : {supplier?.payment_terms ?? "-"}
            </p>
          </div>

          <h2 className="mt-6 text-sm font-semibold">Chantier</h2>
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-medium">{deliverySite?.name ?? "-"}</p>
            <p className="text-zinc-700">
              Code : {deliverySite?.project_code ?? "-"}
            </p>
            <p className="text-zinc-700">
              {deliverySite?.contact_name ?? "-"}
            </p>
            <p className="text-zinc-700">
              {deliverySite?.contact_phone ?? "-"}
            </p>
            {deliverySite?.address ? (
              <pre className="whitespace-pre-wrap text-zinc-700">
                {deliverySite.address}
              </pre>
            ) : (
              <p className="text-zinc-700">-</p>
            )}
            <p className="text-zinc-700">
              {deliverySite?.postal_code ?? ""} {deliverySite?.city ?? ""}
            </p>
          </div>

          {order.notes ? (
            <>
              <h3 className="mt-6 text-sm font-semibold">Notes</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                {order.notes}
              </p>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
