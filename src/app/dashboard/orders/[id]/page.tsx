import Link from "next/link";
import { notFound } from "next/navigation";

import { PencilIcon, PrinterIcon } from "lucide-react";

import { DeleteOrderButton } from "@/components/DeleteOrderButton";
import { type DevisItem } from "@/components/DevisList";
import { DevisManager } from "@/components/DevisManager";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import {
  PurchaseOrderDocument,
  type SupplierData,
  type DeliverySiteData,
  type OrderItemData,
} from "@/components/PurchaseOrderDocument";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OrderDocumentViewport } from "../_components/OrderDocumentViewport";
import { formatOrderDate, statusClass, statusLabel } from "../_components/orders-model";

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
  const canManageDevis = order.status !== "canceled";

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

  const isDraft = order.status === "draft";

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader
        className="no-print"
        breadcrumbs={[
          { label: "Bons de commande", href: "/dashboard/orders" },
          { label: order.reference },
        ]}
        eyebrow="Bon de commande"
        title={<span className="font-mono">{order.reference}</span>}
        meta={
          <>
            <span className={statusClass(order.status)}>{statusLabel(order.status)}</span>
            {supplier ? <span className="font-medium text-foreground-secondary">{supplier.name}</span> : null}
            <span aria-hidden="true" className="text-subtle-foreground">·</span>
            <span className="text-muted-foreground">
              Livraison : {formatOrderDate(order.expected_delivery_date)}
            </span>
          </>
        }
        actions={
          <>
            <PurchaseOrderStatusUpdater orderId={order.id} status={order.status} />
            {isDraft ? (
              <Link
                className={buttonVariants({ variant: "accent", size: "lg" })}
                href={`/dashboard/orders/${order.id}/edit`}
              >
                <PencilIcon aria-hidden="true" />
                Modifier
              </Link>
            ) : null}
            <Link
              className={buttonVariants({ variant: "primary", size: "lg" })}
              href={`/dashboard/orders/${order.id}/print?print=1`}
            >
              <PrinterIcon aria-hidden="true" />
              Imprimer / PDF
            </Link>
            {isDraft ? (
              <DeleteOrderButton orderId={order.id} orderReference={order.reference} />
            ) : null}
          </>
        }
      />

      <OrderDocumentViewport label={`Bon de commande ${order.reference}`}>
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
      </OrderDocumentViewport>

      <div className="no-print mx-auto mt-4 w-full max-w-[210mm]">
        <DevisManager
          orderId={order.id}
          initialItems={devisItems}
          canManage={canManageDevis}
        />
      </div>
    </div>
  );
}
