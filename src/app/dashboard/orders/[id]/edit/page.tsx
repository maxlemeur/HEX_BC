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
import { parseOrderQuantityInput } from "@/lib/purchase-orders/quantities";
import { assertCompletePurchaseOrderSnapshot } from "@/lib/purchase-orders";
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
  id: string | null;
  productId: string | null;
  reference: string | null;
  sourceLinked: boolean;
  originalQuantity: number | null;
  originalUnitPriceCents: number | null;
  originalUnit: string | null;
  originalPriceUnit: string | null;
  designation: string;
  quantityInput: string;
  unitInput: string;
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
  source_estimate_version_id: string | null;
  edit_revision: number;
  purchase_order_items: ExistingItem[];
};

type ExistingItem = {
  id: string;
  product_id: string | null;
  reference: string | null;
  source_estimate_item_id: string | null;
  source_selected_supplier_price_id: string | null;
  is_source_linked: boolean;
  unit: string | null;
  price_unit: string | null;
  position: number;
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
    id: null,
    productId: null,
    reference: null,
    sourceLinked: false,
    originalQuantity: null,
    originalUnitPriceCents: null,
    originalUnit: null,
    originalPriceUnit: null,
    designation: "",
    quantityInput: "1",
    unitInput: "",
    unitPriceEuros: "",
    taxRateBp: 2000,
  };
}

function existingItemToDraft(item: ExistingItem): DraftItem {
  return {
    key: item.id,
    designation: item.designation,
    id: item.id,
    productId: item.product_id,
    reference: item.reference,
    sourceLinked: item.is_source_linked,
    originalQuantity: item.quantity,
    originalUnitPriceCents: item.unit_price_ht_cents,
    originalUnit: item.unit,
    originalPriceUnit: item.price_unit,
    quantityInput: String(item.quantity),
    unitInput: item.unit ?? "",
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
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const initialized = initializedId === id;
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);

  // Fetch existing order
  const fetchOrder = useCallback(async () => {
    if (!id) throw new Error("Identifiant du bon de commande manquant.");
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, reference, order_date, expected_delivery_date, notes, supplier_id, delivery_site_id, status, source_estimate_version_id, edit_revision, purchase_order_items(id, product_id, reference, source_estimate_item_id, source_selected_supplier_price_id, is_source_linked, designation, quantity, unit, price_unit, unit_price_ht_cents, tax_rate_bp, position)")
      .eq("id", id)
      .single();

    if (error) throw error;
    await assertCompletePurchaseOrderSnapshot(supabase, id, data.edit_revision, data.purchase_order_items.length);
    return data as ExistingOrder;
  }, [supabase, id]);

  const { data: order, error: orderError, isLoading: isOrderLoading, isValidating: isOrderValidating } = useSWR(
    id ? `edit-order-${id}` : null,
    fetchOrder,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  // Initialize form with existing data
  useEffect(() => {
    if (!id || !order || order.id !== id || initialized || isOrderValidating || orderError) return;
    let canceled = false;
    const orderItems = [...order.purchase_order_items].sort((left, right) => left.position - right.position);

    queueMicrotask(() => {
      if (canceled) return;
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
      setExpectedRevision(order.edit_revision);
      setRevisionConflict(false);
      setFormError(null);
      setInitializedId(id);
    });
    return () => { canceled = true; };
  }, [id, order, initialized, isOrderValidating, orderError, resetDeliveryDate]);

  // Check if order is draft
  const isDraft = order?.status === "draft";
  const supplierReadOnly = Boolean(
    order?.source_estimate_version_id || order?.purchase_order_items.some((item) => item.is_source_linked)
  );

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

  const loadError = orderError ?? suppliersError ?? sitesError;
  const isLoading = isSuppliersLoading || isSitesLoading || isOrderLoading || isOrderValidating;

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
        if (field === "quantity") return { ...item, quantityInput: String(value) };
        if (field === "unit" && !(item.sourceLinked && item.originalUnit !== null)) return { ...item, unitInput: String(value) };
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

  // Keep every row, including invalid input, until the user corrects or removes it.
  const computed = items.map((item) => {
    const quantity = parseOrderQuantityInput(item.quantityInput);
    const unitPriceCents = parseEuroToCents(item.unitPriceEuros);
    const needsUnitConfirmation = item.originalQuantity !== null &&
      (quantity !== item.originalQuantity || unitPriceCents !== item.originalUnitPriceCents);
    const unitRequired = item.id === null || item.originalUnit !== null || needsUnitConfirmation;
    let error: string | null = !item.designation.trim()
      ? "renseignez la désignation."
      : quantity === null
        ? "saisissez une quantité de 0,001 à 2 147 483 647, avec au maximum trois décimales."
        : unitRequired && !item.unitInput.trim()
          ? "confirmez l’unité avant de créer la ligne ou de modifier sa quantité ou son prix."
          : unitPriceCents === null || unitPriceCents < 0
            ? "renseignez un prix unitaire HT valide."
            : null;
    let totals = { lineTotalHtCents: 0, lineTaxCents: 0, lineTotalTtcCents: 0 };
    if (!error && quantity !== null && unitPriceCents !== null) {
      try {
        totals = computeLineTotals({ quantity, unitPriceHtCents: unitPriceCents, taxRateBp: item.taxRateBp });
      } catch {
        error = "le montant dépasse la limite autorisée. Réduisez la quantité ou le prix.";
      }
    }
    return { quantity, unitPriceCents, error, ...totals };
  });

  const invalidLineIndex = computed.findIndex((line) => line.error);
  let totalsError = invalidLineIndex >= 0
    ? `Ligne ${invalidLineIndex + 1} : ${computed[invalidLineIndex].error}`
    : null;
  let orderTotals = { totalHtCents: 0, totalTaxCents: 0, totalTtcCents: 0 };
  if (!totalsError) {
    try {
      orderTotals = computeOrderTotals(computed);
    } catch {
      totalsError = "Le total de la commande dépasse la limite autorisée.";
    }
  }

  const documentItems: OrderItemData[] = items.map((item, index) => ({
    key: item.key,
    designation: item.designation,
    reference: item.reference,
    unitReadOnly: item.sourceLinked && item.originalUnit !== null,
    quantity: computed[index].quantity ?? 0,
    quantityInput: item.quantityInput,
    unit: item.unitInput || null,
    priceUnit: item.unitInput === item.originalUnit ? item.originalPriceUnit : item.unitInput.trim() || null,
    unitPriceInput: item.unitPriceEuros,
    unitPriceHtCents: computed[index].unitPriceCents ?? 0,
    lineTotalHtCents: computed[index].lineTotalHtCents,
    validationError: computed[index].error,
  }));

  async function onSaveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (saving || revisionConflict) return;

    if (!Number.isSafeInteger(expectedRevision) || expectedRevision === null || expectedRevision < 0) {
      setFormError("Rechargez la commande pour vérifier sa version avant d’enregistrer.");
      return;
    }

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

    const invalidIndex = computed.findIndex((line) => line.error);
    if (invalidIndex >= 0 || totalsError) {
      setFormError(invalidIndex >= 0 ? `Ligne ${invalidIndex + 1} : ${computed[invalidIndex].error}` : totalsError);
      return;
    }

    const cleanedItems = items.map((item, index) => ({
      ...(item.id ? { id: item.id } : {}),
      productId: item.productId,
      reference: item.reference,
      designation: item.designation.trim(),
      quantity: computed[index].quantity!,
      unit: item.unitInput === item.originalUnit ? item.originalUnit : item.unitInput.trim() || null,
      taxRateBp: item.taxRateBp,
      unitPriceCents: computed[index].unitPriceCents!,
    }));

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
          expectedRevision,
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

    if (response.status === 409) {
      setRevisionConflict(true);
      setFormError("Cette commande a changé depuis votre ouverture. Rechargez-la et relisez les lignes avant de réappliquer vos modifications.");
      return;
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

      {initialized && !orderError && !isOrderValidating ? (
        <form noValidate id="order-form" onSubmit={onSaveOrder} aria-label={`Modifier le bon de commande ${reference}`}>
          {items.some((item) => item.sourceLinked) ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Les lignes issues du devis gardent leur origine et leur unité connue. Les corrections de quantité ou de prix sont historisées ; retirer une ligne ne rend pas le besoin disponible pour un nouvel achat.
            </p>
          ) : null}
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
              supplierReadOnly={supplierReadOnly}
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
              totalsPending={totalsError !== null}
            />
          </OrderDocumentViewport>

          {revisionConflict ? (
            <Alert variant="warning" className="mb-4">
              <AlertTitle>Relecture nécessaire</AlertTitle>
              <AlertDescription>
                Votre saisie reste affichée. Le rechargement remplacera cette saisie par la dernière version enregistrée.{" "}
                <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>
                  Recharger la commande
                </button>
              </AlertDescription>
            </Alert>
          ) : null}

          <OrderFormActions
            cancelHref={detailHref}
            submitLabel="Enregistrer"
            submitIcon={<SaveIcon aria-hidden="true" />}
            loading={saving}
            disabled={isLoading || revisionConflict || totalsError !== null}
            error={totalsError ?? formError}
          />
        </form>
      ) : null}
    </div>
  );
}
