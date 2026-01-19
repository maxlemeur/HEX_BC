import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/PrintButton";
import {
  PurchaseOrderDocument,
  type SupplierData,
  type DeliverySiteData,
  type OrderItemData,
} from "@/components/PurchaseOrderDocument";
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
  const supplierDb = order.suppliers;
  const deliverySiteDb = order.delivery_sites;

  // Map database data to component types
  const supplier: SupplierData | null = supplierDb
    ? {
        name: supplierDb.name,
        address: supplierDb.address,
        postal_code: supplierDb.postal_code,
        city: supplierDb.city,
        contact_name: supplierDb.contact_name,
        phone: supplierDb.phone,
        email: supplierDb.email,
      }
    : null;

  const deliverySite: DeliverySiteData | null = deliverySiteDb
    ? {
        name: deliverySiteDb.name,
        project_code: deliverySiteDb.project_code,
        address: deliverySiteDb.address,
        postal_code: deliverySiteDb.postal_code,
        city: deliverySiteDb.city,
        contact_name: deliverySiteDb.contact_name,
        contact_phone: deliverySiteDb.contact_phone,
      }
    : null;

  const orderItems: OrderItemData[] = items.map((item) => ({
    key: item.id,
    reference: item.reference,
    designation: item.designation,
    quantity: item.quantity,
    unitPriceHtCents: item.unit_price_ht_cents,
    lineTotalHtCents: item.line_total_ht_cents,
  }));

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

      {/* Print Document */}
      <PurchaseOrderDocument
        editable={false}
        issuerName="Thomas Dupont"
        issuerRole="Charge d'affaires"
        orderDate={order.order_date}
        reference={order.reference}
        supplier={supplier}
        deliverySite={deliverySite}
        expectedDeliveryDate={order.expected_delivery_date}
        notes={order.notes}
        items={orderItems}
        totalHtCents={order.total_ht_cents}
        totalTaxCents={order.total_tax_cents}
        totalTtcCents={order.total_ttc_cents}
      />
    </div>
  );
}
