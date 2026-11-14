import Link from "next/link";
import { notFound } from "next/navigation";

import { PencilIcon, PrinterIcon } from "lucide-react";

import { DeleteOrderButton } from "@/components/DeleteOrderButton";
import { type DevisItem } from "@/components/DevisList";
import { DevisManager } from "@/components/DevisManager";
import { PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import { OrderLifecycle, type OrderLifecycleLine } from "@/components/purchase-orders/OrderLifecycle";
import { OrderSendButton, OrderSendHistory } from "@/components/purchase-orders/OrderSend";
import {
  PurchaseOrderDocument,
  type SupplierData,
  type DeliverySiteData,
  type OrderItemData,
} from "@/components/PurchaseOrderDocument";
import {
  affaireHref,
  deliveryModeOf,
  orderRequestOrigin,
  storedLineDocumentFields,
  storedOrderAffaire,
  type StoredOrderLineFields,
} from "@/components/purchase-orders/order-lines";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { COMPANY_INFO } from "@/lib/company-info";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";
import { readOutgoingEmailRouting } from "@/lib/email/outgoing-routing";
import { assertCompletePurchaseOrderSnapshot } from "@/lib/purchase-orders";
import { parisToday } from "@/lib/purchase-orders/lifecycle";
import {
  defaultSendMessage,
  defaultSendSubject,
  purchaseOrderPdfFilename,
  type PurchaseOrderSendRecord,
  type PurchaseOrderSendRouting,
} from "@/lib/purchase-orders/send";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { OrderLineHistory } from "../_components/OrderLineHistory";
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
  edit_revision: number;
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
  /** TI-691: the affaire of an order made from a material request, and how it is delivered without a site. */
  project_id: string | null;
  delivery_mode: string | null;
  estimate_projects: { name: string; site_address: string | null } | null;
  purchase_order_items: PurchaseOrderItem[];
};

type PurchaseOrderItem = StoredOrderLineFields & {
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

/** Where the server's e-mails go, for the send dialog to say before sending; never the test mailbox itself. */
function sendRouting(): PurchaseOrderSendRouting {
  if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_FROM?.trim()) return "unconfigured";
  try {
    return readOutgoingEmailRouting().mode;
  } catch {
    return "unconfigured";
  }
}

export default async function OrderPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const devisPromise = supabase
    .from("purchase_order_devis")
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  // TI-691, delivery 3b-1: how an order of an affaire was ordered and received (read like the order itself).
  const confirmationPromise = supabase
    .from("purchase_order_confirmations")
    .select("document_id, supplier_reference")
    .eq("purchase_order_id", id)
    .maybeSingle();
  const receptionPromise = supabase
    .from("purchase_order_receptions")
    .select("received_on, note")
    .eq("purchase_order_id", id)
    .maybeSingle();

  // The sends of the order to its supplier by e-mail, the latest first (read like the order itself).
  const sendsPromise = supabase
    .from("purchase_order_sends")
    .select("id, status, recipient, subject, redirected, requested_by_name, requested_at, settled_at")
    .eq("purchase_order_id", id)
    .order("requested_at", { ascending: false })
    .limit(20);

  // The member who would send it signs the proposed message (not always the order's author).
  const viewerPromise = supabase.auth.getUser().then(async ({ data }) => data.user
    ? (await supabase.from("profiles").select("full_name, work_email").eq("id", data.user.id).maybeSingle()).data
    : null);

  const { data: orderData, error: orderError } = await supabase
    .from("purchase_orders")
    .select(
      "id, edit_revision, reference, order_number, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, currency, project_id, delivery_mode, estimate_projects ( name, site_address ), suppliers ( name, address, city, postal_code, country, email, phone, contact_name, siret, vat_number, payment_terms ), delivery_sites ( name, project_code, address, city, postal_code, contact_name, contact_phone ), profiles ( full_name, job_title, phone, work_email ), purchase_order_items(id, designation, reference, quantity, unit, price_unit, unit_price_ht_cents, tax_rate_bp, line_total_ht_cents, position, line_kind, price_per, imputation, overhead_category, material_request_line_id, material_request_lines ( position, request_id, material_requests ( project_id, requested_on ) ))"
    )
    .eq("id", id)
    .single();

  if (orderError || !orderData) {
    notFound();
  }

  const order = orderData as unknown as PurchaseOrder;
  const fromRequest = order.project_id !== null;
  const affaire = storedOrderAffaire(order.estimate_projects);
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

  const devisResult = await devisPromise;

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
    ...storedLineDocumentFields(item, { fromRequest, onScreen: true }),
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
  const [{ data: confirmationRow }, { data: receptionRow }, { data: sendRows }, viewer] =
    await Promise.all([confirmationPromise, receptionPromise, sendsPromise, viewerPromise]);
  // A send in flight is not history yet: the page shows what is settled.
  const sends = ((sendRows ?? []) as PurchaseOrderSendRecord[]).filter((send) => send.status !== "sending");
  const sendHistory = <OrderSendHistory sends={sends} />;
  const sendAction = isDraft ? (
    <OrderSendButton
      orderId={order.id}
      reference={order.reference}
      editRevision={order.edit_revision}
      supplierName={supplier?.name ?? null}
      supplierEmail={supplier?.email?.trim() || null}
      defaultSubject={defaultSendSubject({ reference: order.reference, companyName: COMPANY_INFO.name })}
      defaultMessage={defaultSendMessage({
        reference: order.reference,
        affaireName: affaire?.name ?? null,
        expectedDeliveryDate: order.expected_delivery_date,
        // A profile whose name is an e-mail address signs with a name, as on the document.
        issuerName: normalizeDocumentIssuerDisplay({
          issuerName: viewer?.full_name, issuerEmail: viewer?.work_email, fallbackName: "",
        }).displayName || null,
      })}
      attachmentFilename={purchaseOrderPdfFilename(order.reference)}
      routing={sendRouting()}
      primary={fromRequest}
    />
  ) : null;
  const lifecycleLines: OrderLifecycleLine[] = items.map((item) => ({
    id: item.id,
    position: item.position,
    designation: item.designation,
    quantity: Number(item.quantity),
    unit: item.unit,
    unitPriceHtCents: item.unit_price_ht_cents,
    pricePer: item.price_per ?? 1,
    taxRateBp: item.tax_rate_bp,
    kind: item.line_kind === "shipping" || item.line_kind === "discount" ? item.line_kind : "article",
    fromRequest: Boolean(item.material_request_line_id),
  }));

  // TI-691: an order of an affaire leads back to the request it comes from, through its affaire.
  const origin = order.project_id ? orderRequestOrigin(order.project_id, items) : null;
  const breadcrumbs = order.project_id && affaire
    ? [
        { label: "Affaires", href: "/dashboard/affaires" },
        { label: affaire.name, href: affaireHref(order.project_id) },
        // The request's own trail: Affaires › affaire › Achats › request.
        ...(origin && origin.label !== "Achats"
          ? [{ label: "Achats", href: `${affaireHref(order.project_id)}/demandes-materiel` }]
          : []),
        ...(origin ? [origin] : []),
        { label: order.reference },
      ]
    : [
        { label: "Bons de commande", href: "/dashboard/orders" },
        { label: order.reference },
      ];
  // On an order of an affaire, the step's action leads; the page's own actions stay quiet.
  const quietAction = buttonVariants({ variant: "outline", size: "lg" });

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader
        className="no-print"
        breadcrumbs={breadcrumbs}
        eyebrow="Bon de commande"
        title={<span className="font-mono">{order.reference}</span>}
        meta={
          <>
            <span className={statusClass(order.status)}>{statusLabel(order.status)}</span>
            {supplier ? <span className="font-medium text-foreground-secondary">{supplier.name}</span> : null}
            {order.expected_delivery_date ? (
              <>
                <span aria-hidden="true" className="text-subtle-foreground">·</span>
                <span className="text-muted-foreground">
                  Livraison : {formatOrderDate(order.expected_delivery_date)}
                </span>
              </>
            ) : null}
            {order.project_id && affaire ? (
              <>
                <span aria-hidden="true" className="text-subtle-foreground">·</span>
                <Link
                  href={affaireHref(order.project_id)}
                  className="font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Affaire : {affaire.name}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {fromRequest ? null : <PurchaseOrderStatusUpdater orderId={order.id} status={order.status} />}
            {fromRequest ? null : sendAction}
            {isDraft ? (
              <Link
                className={fromRequest ? quietAction : buttonVariants({ variant: "accent", size: "lg" })}
                href={`/dashboard/orders/${order.id}/edit`}
              >
                <PencilIcon aria-hidden="true" />
                Modifier
              </Link>
            ) : null}
            <Link
              className={fromRequest ? quietAction : buttonVariants({ variant: "primary", size: "lg" })}
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

      {fromRequest ? (
        <div className="no-print mx-auto mb-4 w-full max-w-[210mm]">
          <OrderLifecycle
            orderId={order.id}
            reference={order.reference}
            status={order.status}
            editRevision={order.edit_revision}
            orderDate={order.order_date}
            expectedDeliveryDate={order.expected_delivery_date}
            lines={lifecycleLines}
            documents={devisRecords.map((record) => ({ id: record.id, name: record.name }))}
            confirmation={confirmationRow ? {
              documentId: confirmationRow.document_id,
              documentName: devisRecords.find((record) => record.id === confirmationRow.document_id)?.name ?? "document joint",
              supplierReference: confirmationRow.supplier_reference,
            } : null}
            reception={receptionRow ? { receivedOn: receptionRow.received_on, note: receptionRow.note } : null}
            today={parisToday()}
            sendAction={sendAction}
            sendHistory={sendHistory}
            sentAsTest={sends.find((send) => send.status === "sent")?.redirected === true}
          />
        </div>
      ) : sends.length > 0 ? (
        <div className="no-print mx-auto mb-4 w-full max-w-[210mm]">{sendHistory}</div>
      ) : null}

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
          affaire={affaire}
          deliveryMode={deliveryModeOf(order.delivery_mode)}
          expectedDeliveryDate={order.expected_delivery_date}
          notes={order.notes}
          items={orderItems}
          totalHtCents={order.total_ht_cents}
          totalTaxCents={order.total_tax_cents}
          totalTtcCents={order.total_ttc_cents}
        />
      </OrderDocumentViewport>

      <OrderLineHistory orderId={order.id} />

      <div className="no-print mx-auto mt-4 w-full max-w-[210mm]">
        <DevisManager
          orderId={order.id}
          initialItems={devisItems}
          canManage={canManageDevis}
          // TI-691: the supplier's quote is joined on the request; here, what proves and follows the order.
          hint={fromRequest
            ? "Confirmation du fournisseur, bon de livraison… Le devis du fournisseur se joint sur la demande."
            : undefined}
        />
      </div>
    </div>
  );
}
