import { notFound } from "next/navigation";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PrintButton } from "@/components/PrintButton";
import { PrintTitle } from "@/components/PrintTitle";
import {
  PurchaseOrderDocument,
  type SupplierData,
  type DeliverySiteData,
  type OrderItemData,
} from "@/components/PurchaseOrderDocument";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { assertCompletePurchaseOrderSnapshot } from "@/lib/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OrderDocumentViewport } from "../../_components/OrderDocumentViewport";

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
  edit_revision: number;
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
  profiles: UserProfile | null;
  purchase_order_items: PurchaseOrderItem[];
};

type PurchaseOrderItem = {
  id: string;
  designation: string;
  reference: string | null;
  quantity: number;
  unit: string | null;
  price_unit: string | null;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  line_total_ht_cents: number;
  position: number;
};

function formatPrintDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().split("T")[0];
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

export default async function OrderPrintPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ print?: string }>;
}>) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const autoPrint =
    resolvedSearchParams?.print === "1" ||
    resolvedSearchParams?.print === "true";
  const supabase = await createSupabaseServerClient();

  const { data: orderData, error: orderError } = await supabase
    .from("purchase_orders")
    .select(
      "id, edit_revision, reference, order_number, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, currency, suppliers ( name, address, city, postal_code, country, email, phone, contact_name, siret, vat_number, payment_terms ), delivery_sites ( name, project_code, address, city, postal_code, contact_name, contact_phone ), profiles ( full_name, job_title, phone, work_email ), purchase_order_items(id, designation, reference, quantity, unit, price_unit, unit_price_ht_cents, tax_rate_bp, line_total_ht_cents, position)"
    )
    .eq("id", id)
    .single();

  if (orderError || !orderData) {
    notFound();
  }

  const order = orderData as unknown as PurchaseOrder;
  try {
    await assertCompletePurchaseOrderSnapshot(supabase, id, order.edit_revision, order.purchase_order_items.length);
  } catch (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Lecture du bon de commande interrompue" />
        <Alert variant="danger">
          {error instanceof Error ? error.message : "Lecture incomplète ou modifiée. Rechargez la commande."}
        </Alert>
        <Link href="/dashboard/orders" className="mt-4 inline-block text-sm font-medium text-primary underline">
          Retour à la liste des commandes
        </Link>
      </div>
    );
  }

  const items = [...order.purchase_order_items].sort((left, right) => left.position - right.position);
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
    unit: item.unit,
    priceUnit: item.price_unit,
    unitPriceHtCents: item.unit_price_ht_cents,
    lineTotalHtCents: item.line_total_ht_cents,
  }));

  const supplierName = supplier?.name ?? "fournisseur";
  const orderNumberLabel = order.reference || String(order.order_number);
  const projectCode = deliverySite?.project_code ?? "";
  const orderDate = formatPrintDate(order.order_date);
  const rawTitle = [supplierName, orderNumberLabel, projectCode, orderDate]
    .filter(Boolean)
    .join("_");
  const printTitle = sanitizeFilename(rawTitle);

  return (
    <div className="mx-auto max-w-5xl print:max-w-none">
      <PrintTitle title={printTitle} />
      <PageHeader
        className="no-print"
        breadcrumbs={[
          { label: "Bons de commande", href: "/dashboard/orders" },
          { label: order.reference, href: `/dashboard/orders/${order.id}` },
          { label: "Impression" },
        ]}
        title="Aperçu avant impression"
        meta={
          <Badge variant="outline" className="font-mono">
            {order.reference}
          </Badge>
        }
        actions={<PrintButton autoPrint={autoPrint} />}
      />

      <OrderDocumentViewport label={`Bon de commande ${order.reference}, aperçu avant impression`}>
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
      <div className="print-page-footer" aria-hidden>
        <span className="print-page-counter" />
      </div>
    </div>
  );
}
