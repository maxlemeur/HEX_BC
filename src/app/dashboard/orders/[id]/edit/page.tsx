"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { SaveIcon } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import {
  PurchaseOrderDocument,
  type OrderItemData,
  type SupplierData,
  type DeliverySiteData,
} from "@/components/PurchaseOrderDocument";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUserContext } from "@/components/UserContext";
import {
  computeLineTotals,
  computeOrderTotals,
} from "@/lib/order-calculations";
import { parseEuroToCents } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { OrderDocumentViewport } from "../../_components/OrderDocumentViewport";
import { OrderFormActions } from "../../_components/OrderFormActions";
import { useDeliveryDateState } from "../../_components/use-delivery-date-state";

type SupplierOption = {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
};

type SiteOption = {
  id: string;
  name: string;
  project_code: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type DraftItem = {
  key: string;
  designation: string;
  quantity: number;
  unitPriceEuros: string;
  taxRateBp: number;
};

type ExistingOrder = {
  id: string;
  reference: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  supplier_id: string;
  delivery_site_id: string;
  status: string;
};

type ExistingItem = {
  id: string;
  designation: string;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
};

function euroInputFromCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function newDraftItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    designation: "",
    quantity: 1,
    unitPriceEuros: "",
    taxRateBp: 2000,
  };
}

function existingItemToDraft(item: ExistingItem): DraftItem {
  return {
    key: item.id,
    designation: item.designation,
    quantity: item.quantity,
    unitPriceEuros: euroInputFromCents(item.unit_price_ht_cents),
    taxRateBp: item.tax_rate_bp,
  };
}

export default function EditOrderPage() {
  const params = useParams();
  const rawId = params?.["id"];
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile: userProfile } = useUserContext();

  const [supplierId, setSupplierId] = useState<string>("");
  const [deliverySiteId, setDeliverySiteId] = useState<string>("");
  const deliveryDate = useDeliveryDateState();
  const resetDeliveryDate = deliveryDate.reset;
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [orderDate, setOrderDate] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Fetch existing order
  const fetchOrder = useCallback(async () => {
    if (!id) throw new Error("Identifiant du bon de commande manquant.");
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, reference, order_date, expected_delivery_date, notes, supplier_id, delivery_site_id, status")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data as ExistingOrder;
  }, [supabase, id]);

  const fetchOrderItems = useCallback(async () => {
    if (!id) throw new Error("Identifiant du bon de commande manquant.");
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select("id, designation, quantity, unit_price_ht_cents, tax_rate_bp")
      .eq("purchase_order_id", id)
      .order("position", { ascending: true });

    if (error) throw error;
    return (data ?? []) as ExistingItem[];
  }, [supabase, id]);

  const { data: order, error: orderError, isLoading: isOrderLoading } = useSWR(
    id ? `edit-order-${id}` : null,
    fetchOrder
  );

  const { data: orderItems, error: itemsError, isLoading: isItemsLoading } = useSWR(
    id ? `edit-order-items-${id}` : null,
    fetchOrderItems
  );

  // Initialize form with existing data
  useEffect(() => {
    if (!order || !orderItems || initialized) return;

    queueMicrotask(() => {
      setSupplierId(order.supplier_id);
      setDeliverySiteId(order.delivery_site_id);
      resetDeliveryDate(order.expected_delivery_date);
      setNotes(order.notes ?? "");
      setOrderDate(order.order_date);
      setReference(order.reference);
      setItems(
        orderItems.length > 0
          ? orderItems.map(existingItemToDraft)
          : [newDraftItem()]
      );
      setInitialized(true);
    });
  }, [order, orderItems, initialized, resetDeliveryDate]);

  // Check if order is draft
  const isDraft = order?.status === "draft";

  const fetchSuppliers = useCallback(async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, address, postal_code, city, contact_name, phone, email")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as SupplierOption[];
  }, [supabase]);

  const fetchSites = useCallback(async () => {
    const { data, error } = await supabase
      .from("delivery_sites")
      .select("id, name, project_code, address, postal_code, city, contact_name, contact_phone")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    return (data ?? []) as SiteOption[];
  }, [supabase]);

  const {
    data: suppliers = [],
    error: suppliersError,
    isLoading: isSuppliersLoading,
  } = useSWR<SupplierOption[]>("po-suppliers-full", fetchSuppliers, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const {
    data: sites = [],
    error: sitesError,
    isLoading: isSitesLoading,
  } = useSWR<SiteOption[]>("po-sites-full", fetchSites, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const loadError = suppliersError ?? sitesError ?? orderError ?? itemsError;
  const isLoading = isSuppliersLoading || isSitesLoading || isOrderLoading || isItemsLoading;

  // Get selected supplier and site data
  const selectedSupplier: SupplierData | null = useMemo(() => {
    if (!supplierId) return null;
    const s = suppliers.find((x) => x.id === supplierId);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      address: s.address,
      postal_code: s.postal_code,
      city: s.city,
      contact_name: s.contact_name,
      phone: s.phone,
      email: s.email,
    };
  }, [supplierId, suppliers]);

  const selectedSite: DeliverySiteData | null = useMemo(() => {
    if (!deliverySiteId) return null;
    const s = sites.find((x) => x.id === deliverySiteId);
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      project_code: s.project_code,
      address: s.address,
      postal_code: s.postal_code,
      city: s.city,
      contact_name: s.contact_name,
      contact_phone: s.contact_phone,
    };
  }, [deliverySiteId, sites]);

  function handleItemChange(key: string, field: string, value: string | number) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        if (field === "designation") return { ...item, designation: String(value) };
        if (field === "quantity") return { ...item, quantity: Math.max(1, Number(value) || 1) };
        if (field === "unitPriceEuros") return { ...item, unitPriceEuros: String(value) };
        return item;
      })
    );
  }

  function removeItem(itemKey: string) {
    setItems((prev) => {
      const next = prev.filter((i) => i.key !== itemKey);
      return next.length === 0 ? [newDraftItem()] : next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, newDraftItem()]);
  }

  // Compute line totals
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

  // Map items for the document component
  const documentItems: OrderItemData[] = items.map((item) => {
    const comp = computed.find((c) => c.key === item.key);
    return {
      key: item.key,
      designation: item.designation,
      quantity: item.quantity,
      unitPriceInput: item.unitPriceEuros,
      unitPriceHtCents: comp?.unitPriceCents ?? 0,
      lineTotalHtCents: comp?.lineTotalHtCents ?? 0,
    };
  });

  async function onSaveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!id) {
      setFormError("Identifiant du bon de commande manquant.");
      return;
    }

    if (!isDraft) {
      setFormError("Seuls les bons de commande en brouillon peuvent être modifiés.");
      return;
    }

    if (!supplierId || !deliverySiteId) {
      setFormError("Sélectionnez un fournisseur et un chantier.");
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

    setSaving(true);

    let response: Response;
    try {
      response = await fetch(`/api/purchase-orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          deliverySiteId,
          expectedDeliveryDate: deliveryDate.payloadValue,
          notes: notes.trim() || null,
          items: cleanedItems,
        }),
      });
    } catch {
      setSaving(false);
      setFormError("Impossible d’enregistrer le bon de commande : vérifiez votre connexion.");
      return;
    }

    setSaving(false);

    let result: { success?: boolean; error?: string } | null = null;
    try {
      result = (await response.json()) as { success?: boolean; error?: string };
    } catch {
      result = null;
    }

    if (!response.ok || !result?.success) {
      setFormError(result?.error ?? "Impossible de modifier le bon.");
      return;
    }

    router.push(`/dashboard/orders/${id}`);
    router.refresh();
  }

  const detailHref = id ? `/dashboard/orders/${id}` : "/dashboard/orders";
  const displayReference = reference || order?.reference || "";
  const breadcrumbs = [
    { label: "Bons de commande", href: "/dashboard/orders" },
    ...(displayReference ? [{ label: displayReference, href: detailHref }] : []),
    { label: "Modifier" },
  ];

  // Only draft orders can be edited.
  if (order && !isDraft) {
    return (
      <div className="mx-auto max-w-5xl animate-fade-in">
        <PageHeader
          breadcrumbs={breadcrumbs}
          eyebrow="Modification"
          title={<span className="font-mono">{order.reference}</span>}
        />
        <Alert variant="warning">
          <AlertTitle>Ce bon de commande n’est plus modifiable.</AlertTitle>
          <AlertDescription>
            Seuls les bons de commande en brouillon peuvent être modifiés.{" "}
            <Link href={detailHref} className="font-medium text-primary underline underline-offset-4">
              Retour au bon de commande
            </Link>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Modification"
        title={
          displayReference ? <span className="font-mono">{displayReference}</span> : "Modifier le bon de commande"
        }
        description="Modifiez le fournisseur, le chantier ou les lignes, puis enregistrez le brouillon."
      />

      {loadError ? (
        <Alert variant="danger" className="mb-4">
          {(loadError as Error).message}
        </Alert>
      ) : null}

      {isLoading ? <LoadingState label="Chargement du bon de commande…" className="py-4" /> : null}

      {initialized ? (
        <form id="order-form" onSubmit={onSaveOrder} aria-label={`Modifier le bon de commande ${reference}`}>
          <OrderDocumentViewport label={`Bon de commande ${reference} en cours de modification`}>
            <PurchaseOrderDocument
              editable={true}
              issuerName={userProfile?.full_name ?? "Chargement…"}
              issuerRole={userProfile?.job_title ?? ""}
              issuerPhone={userProfile?.phone ?? undefined}
              issuerEmail={userProfile?.work_email ?? undefined}
              orderDate={orderDate || new Date().toISOString()}
              reference={reference}
              supplier={selectedSupplier}
              supplierId={supplierId}
              onSupplierChange={setSupplierId}
              supplierOptions={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              deliverySite={selectedSite}
              deliverySiteId={deliverySiteId}
              onDeliverySiteChange={setDeliverySiteId}
              siteOptions={sites.map((s) => ({
                id: s.id,
                name: s.name,
                project_code: s.project_code,
              }))}
              expectedDeliveryDate={deliveryDate.documentValue}
              onExpectedDeliveryDateChange={deliveryDate.onDocumentChange}
              notes={notes}
              onNotesChange={setNotes}
              items={documentItems}
              onItemChange={handleItemChange}
              onItemRemove={removeItem}
              onItemAdd={addItem}
              totalHtCents={orderTotals.totalHtCents}
              totalTaxCents={orderTotals.totalTaxCents}
              totalTtcCents={orderTotals.totalTtcCents}
            />
          </OrderDocumentViewport>

          <OrderFormActions
            cancelHref={detailHref}
            submitLabel="Enregistrer"
            submitIcon={<SaveIcon aria-hidden="true" />}
            loading={saving}
            disabled={isLoading}
            error={formError}
          />
        </form>
      ) : null}
    </div>
  );
}
