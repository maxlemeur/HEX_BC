import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteOrderButton } from "@/components/DeleteOrderButton";
import { type DevisItem } from "@/components/DevisList";
import { DevisManager } from "@/components/DevisManager";
import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import {
  PurchaseOrderDocument,
  type SupplierData,
  type DeliverySiteData,
  type OrderItemData,
} from "@/components/PurchaseOrderDocument";
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

type UserProfile = {
  full_name: string;
  job_title: string | null;
  phone: string | null;
  work_email: string | null;
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
  profiles: UserProfile | null;
};

type PurchaseOrderItem = {
  id: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  line_total_ht_cents: number;
};

export default async function OrderPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const itemsPromise = supabase
    .from("purchase_order_items")
    .select(
      "id, designation, reference, quantity, unit_price_ht_cents, tax_rate_bp, line_total_ht_cents"
    )
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  const devisPromise = supabase
    .from("purchase_order_devis")
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  const { data: orderData, error: orderError } = await supabase
    .from("purchase_orders")
    .select(
      "id, reference, order_number, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, currency, suppliers ( name, address, city, postal_code, country, email, phone, contact_name, siret, vat_number, payment_terms ), delivery_sites ( name, project_code, address, city, postal_code, contact_name, contact_phone ), profiles ( full_name, job_title, phone, work_email )"
    )
    .eq("id", id)
    .single();

  if (orderError || !orderData) {
    notFound();
  }

  const order = orderData as unknown as PurchaseOrder;

  const [itemsResult, devisResult] = await Promise.all([
    itemsPromise,
    devisPromise,
  ]);

  const items = (itemsResult.data ?? []) as unknown as PurchaseOrderItem[];
  const supplierDb = order.suppliers;
  const deliverySiteDb = order.delivery_sites;
  const userProfile = order.profiles;

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
    designation: item.designation,
    reference: item.reference,
    quantity: item.quantity,
    unitPriceHtCents: item.unit_price_ht_cents,
    lineTotalHtCents: item.line_total_ht_cents,
  }));

  const devisRecords = devisResult.error ? [] : devisResult.data ?? [];
  const devisItems: DevisItem[] = await Promise.all(
    devisRecords.map(async (record) => {
      const { data: signedData } = await supabase.storage
        .from("devis")
        .createSignedUrl(record.storage_path, 60 * 10);

      return {
        id: record.id,
        name: record.name,
        originalFilename: record.original_filename,
        fileSizeBytes: record.file_size_bytes,
        mimeType: record.mime_type,
        createdAt: record.created_at,
        position: record.position,
        downloadUrl: signedData?.signedUrl ?? null,
      };
    })
  );

  return (
    <div className="min-h-screen bg-[var(--slate-100)]">
      {/* Action bar */}
      <div className="no-print sticky top-0 z-10 border-b border-[var(--slate-200)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          {/* Left: Back button and reference */}
          <div className="flex items-center gap-4">
            <Link
              className="btn btn-ghost btn-sm"
              href="/dashboard/orders"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Retour
            </Link>
            <div className="hidden h-6 w-px bg-[var(--slate-200)] sm:block" />
            <div className="hidden sm:block">
              <span className="text-sm font-medium text-[var(--slate-500)]">Bon de commande</span>
              <span className="ml-2 rounded-lg bg-[var(--brand-orange)]/10 px-2.5 py-1 font-mono text-sm font-bold text-[var(--brand-orange)]">
                {order.reference}
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Status updater */}
            <PurchaseOrderStatusUpdater
              orderId={order.id}
              status={order.status}
            />

            {/* Edit button - only for draft orders */}
            {order.status === "draft" && (
              <Link
                className="btn btn-accent"
                href={`/dashboard/orders/${order.id}/edit`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
                Modifier
              </Link>
            )}

            <Link
              className="btn btn-primary"
              href={`/dashboard/orders/${order.id}/print?print=1`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Imprimer / PDF
            </Link>

            {/* Delete button - only for draft orders */}
            {order.status === "draft" && (
              <DeleteOrderButton
                orderId={order.id}
                orderReference={order.reference}
              />
            )}
          </div>
        </div>
      </div>

      {/* Purchase Order Document */}
      <div className="py-8">
        <PurchaseOrderDocument
          editable={false}
          issuerName={userProfile?.full_name ?? "Utilisateur"}
          issuerRole={userProfile?.job_title ?? ""}
          issuerPhone={userProfile?.phone ?? undefined}
          issuerEmail={userProfile?.work_email ?? undefined}
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

      <div className="mx-auto w-full max-w-[210mm] px-4 pb-10">
        <DevisManager
          orderId={order.id}
          initialItems={devisItems}
          canManage={order.status === "draft"}
        />
      </div>
    </div>
  );
}
