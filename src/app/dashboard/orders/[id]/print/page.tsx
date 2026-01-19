import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/PrintButton";
import { COMPANY_INFO } from "@/lib/company-info";
import { formatEUR } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  status: "draft" | "sent" | "confirmed" | "received" | "canceled";
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
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function OrderPrintPage({
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
      "id, reference, designation, quantity, unit_price_ht_cents, tax_rate_bp, line_total_ht_cents"
    )
    .eq("purchase_order_id", order.id)
    .order("position", { ascending: true });

  const items = (itemsData ?? []) as unknown as PurchaseOrderItem[];
  const supplier = order.suppliers;
  const deliverySite = order.delivery_sites;

  return (
    <div className="min-h-screen bg-slate-200 print:bg-white">
      {/* Print controls - hidden in print */}
      <div className="no-print flex justify-center gap-4 py-6">
        <PrintButton />
        <Link
          className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-200 bg-white px-6 text-sm font-medium text-zinc-900 transition-all hover:bg-zinc-50"
          href={`/dashboard/orders/${order.id}`}
        >
          Retour
        </Link>
      </div>

      {/* A4 Document Page */}
      <div className="document-page relative mx-auto my-5 overflow-hidden bg-white p-[50px] shadow-2xl print:m-0 print:p-10 print:shadow-none">
        {/* Sidebar accent bar */}
        <div className="sidebar-accent print-color-adjust" />

        {/* Header */}
        <div className="mb-12 flex items-start justify-between">
          {/* Left: Logo and issuer info */}
          <div className="flex flex-col">
            <div className="mb-4">
              <Image
                src="/logo-hydro-express.jpg"
                alt="Hydro eXpress"
                width={200}
                height={80}
                className="h-20 w-auto"
                priority
              />
            </div>

            <div className="mt-6 text-sm">
              <p className="mb-2 font-bold italic text-gray-800 underline underline-offset-4">
                Emis par :
              </p>
              <p className="text-lg font-bold text-brand-blue">Thomas Dupont</p>
              <p className="text-sm italic text-slate-500">Chargé d&apos;affaires</p>
              <p className="mt-3 text-xs font-semibold italic text-gray-400">
                Le {formatDate(order.order_date)}
              </p>
            </div>
          </div>

          {/* Right: Company info box */}
          <div className="min-w-[280px] rounded-xl border border-slate-200 bg-brand-bg p-5 text-right">
            <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-brand-blue">
              {COMPANY_INFO.name}
            </h3>
            <p className="text-sm font-medium italic tracking-tight text-slate-600">
              {COMPANY_INFO.address.street}
            </p>
            <p className="text-sm font-medium italic tracking-tight text-slate-600">
              {COMPANY_INFO.address.postalCode} {COMPANY_INFO.address.city}
            </p>
            <div className="mt-2">
              <p className="text-sm font-medium italic tracking-tight text-slate-600">
                {COMPANY_INFO.phone.landline}
              </p>
              <p className="text-sm font-medium italic tracking-tight text-slate-600">
                {COMPANY_INFO.phone.mobile}
              </p>
            </div>
          </div>
        </div>

        {/* Document Title & Reference */}
        <div className="mb-10 text-center">
          <h2 className="mb-4 text-4xl font-black uppercase tracking-tight text-slate-800">
            Bon de Commande
          </h2>
          <p className="inline-block rounded-full border border-slate-100 bg-slate-50 px-8 py-2 font-mono text-sm uppercase tracking-widest text-slate-400">
            REF :{" "}
            <span className="font-bold text-brand-orange">{order.reference}</span>
          </p>
        </div>

        {/* Info Grid: Supplier + Delivery */}
        <div className="mb-8 grid grid-cols-2 gap-8">
          {/* Supplier Box */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-100 bg-brand-bg p-6">
            <div>
              <h4 className="mb-4 text-[10px] font-black italic uppercase tracking-widest text-brand-orange">
                Fournisseur
              </h4>
              <p className="mb-1 text-2xl font-extrabold text-brand-blue">
                {supplier?.name ?? "-"}
              </p>
              {supplier?.address && (
                <p className="font-medium text-slate-500">{supplier.address}</p>
              )}
              <p className="font-medium text-slate-500">
                {supplier?.postal_code} {supplier?.city}
              </p>
              {supplier?.contact_name && (
                <p className="mt-2 font-medium text-slate-500">
                  Contact: {supplier.contact_name}
                </p>
              )}
              {supplier?.phone && (
                <p className="font-medium text-slate-500">{supplier.phone}</p>
              )}
              {supplier?.email && (
                <p className="font-medium text-slate-500">{supplier.email}</p>
              )}
            </div>
          </div>

          {/* Delivery & Project Box */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h4 className="mb-4 text-[10px] font-black italic uppercase tracking-widest text-slate-400">
              Livraison & Projet
            </h4>
            <div className="space-y-4">
              {order.expected_delivery_date && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                    Date souhaitee :
                  </p>
                  <div className="delivery-badge-orange print-color-adjust">
                    <span className="text-lg font-black uppercase tracking-tight">
                      Le {formatDate(order.expected_delivery_date)}
                    </span>
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1 text-[10px] font-bold italic uppercase tracking-wide text-slate-400">
                  Chantier & Contacts :
                </p>
                <p className="mb-2 text-lg font-extrabold uppercase italic leading-tight text-brand-blue">
                  {deliverySite?.name ?? "-"}
                </p>
                <div className="text-sm font-medium italic leading-relaxed tracking-tight text-slate-600">
                  {deliverySite?.address && <p>{deliverySite.address}</p>}
                  <p>
                    {deliverySite?.postal_code} {deliverySite?.city}
                  </p>
                  {deliverySite?.contact_name && (
                    <p className="mt-1">
                      {deliverySite.contact_name}
                      {deliverySite.contact_phone &&
                        ` : ${deliverySite.contact_phone}`}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Notes / Instructions */}
        {order.notes && (
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
            <h4 className="mb-2 text-[10px] font-black uppercase tracking-widest text-brand-blue">
              Note / Instructions complementaires
            </h4>
            <p className="min-h-[40px] whitespace-pre-wrap text-sm italic text-slate-700">
              {order.notes}
            </p>
          </div>
        )}

        {/* Items Table */}
        <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="table-head bg-brand-blue text-left text-[10px] font-bold uppercase tracking-widest text-white print-color-adjust">
                <th className="px-6 py-4">Reference</th>
                <th className="px-6 py-4">Designation</th>
                <th className="px-6 py-4 text-center">Qte</th>
                <th className="px-6 py-4 text-right">P.U. HT</th>
                <th className="px-6 py-4 text-right">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-6 py-4 font-mono text-xs text-slate-400">
                    {item.reference ?? "-"}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-800">
                    {item.designation}
                  </td>
                  <td className="px-6 py-4 text-center font-bold">
                    {item.quantity}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {formatEUR(item.unit_price_ht_cents)}
                  </td>
                  <td className="px-6 py-4 text-right font-bold">
                    {formatEUR(item.line_total_ht_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Summary */}
        <div className="mb-8 flex justify-end">
          <div className="w-full max-w-[340px] space-y-3">
            {/* Total HT Badge */}
            <div className="delivery-badge-orange flex w-full items-center justify-between px-8 py-4 print-color-adjust">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">
                Total Net HT
              </span>
              <span className="text-3xl font-black">
                {formatEUR(order.total_ht_cents)}
              </span>
            </div>

            {/* TVA & TTC */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-6 py-3">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span>TVA</span>
                <span className="text-slate-600">
                  {formatEUR(order.total_tax_cents)}
                </span>
              </div>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span>Total TTC</span>
                <span className="text-slate-600">
                  {formatEUR(order.total_ttc_cents)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Confirmation Note */}
        <div className="note-container mb-12 rounded-r-2xl p-6 print-color-adjust">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <p className="text-lg font-bold italic leading-snug text-slate-700">
              Merci de confirmer la bonne prise en compte de ce bon de commande
              et de valider les dates de livraison le cas echeant.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-10 left-16 right-16 border-t border-slate-100 pt-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <p className="mb-1">{COMPANY_INFO.name}</p>
          <p>SIRET {COMPANY_INFO.legal.siret}</p>
        </div>
      </div>
    </div>
  );
}
