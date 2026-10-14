"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { PlusIcon } from "lucide-react";

import {
  PurchaseOrderDocument,
  type OrderItemData,
  type SupplierData,
  type DeliverySiteData,
} from "@/components/PurchaseOrderDocument";
import {
  DeliverySiteCreateModal,
  type DeliverySiteCreateResult,
} from "@/components/DeliverySiteCreateModal";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { SupplierCreateModal, type SupplierCreateResult } from "@/components/SupplierCreateModal";
import { Alert } from "@/components/ui/alert";
import { useUserContext } from "@/components/UserContext";
import {
  computeLineTotals,
  computeOrderTotals,
} from "@/lib/order-calculations";
import { parseEuroToCents } from "@/lib/money";
import { parseOrderQuantityInput } from "@/lib/purchase-orders/quantities";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { OrderDocumentViewport } from "../_components/OrderDocumentViewport";
import { OrderFormActions } from "../_components/OrderFormActions";
import { useDeliveryDateState } from "../_components/use-delivery-date-state";

type SupplierOption = SupplierCreateResult;

type SiteOption = DeliverySiteCreateResult;

type DraftItem = {
  key: string;
  designation: string;
  quantityInput: string;
  unitInput: string;
  unitPriceEuros: string;
  taxRateBp: number;
};

function newDraftItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    designation: "",
    quantityInput: "1",
    unitInput: "",
    unitPriceEuros: "",
    taxRateBp: 2000,
  };
}

export default function NewOrderPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile: userProfile } = useUserContext();

  const [supplierId, setSupplierId] = useState<string>("");
  const [deliverySiteId, setDeliverySiteId] = useState<string>("");
  const deliveryDate = useDeliveryDateState();
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [isDeliverySiteModalOpen, setIsDeliverySiteModalOpen] = useState(false);

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
    mutate: mutateSuppliers,
  } = useSWR<SupplierOption[]>("po-suppliers-full", fetchSuppliers, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const {
    data: sites = [],
    error: sitesError,
    isLoading: isSitesLoading,
    mutate: mutateSites,
  } = useSWR<SiteOption[]>("po-sites-full", fetchSites, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const loadError = suppliersError ?? sitesError;
  const isLoading = isSuppliersLoading || isSitesLoading;

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

  const handleSupplierCreated = useCallback(
    (supplier: SupplierCreateResult) => {
      setSupplierId(supplier.id);
      mutateSuppliers(
        (current = []) => {
          const exists = current.some((item) => item.id === supplier.id);
          if (exists) return current;
          return [...current, supplier].sort((a, b) => a.name.localeCompare(b.name));
        },
        { revalidate: true }
      );
    },
    [mutateSuppliers]
  );

  const handleDeliverySiteCreated = useCallback(
    (site: DeliverySiteCreateResult) => {
      setDeliverySiteId(site.id);
      mutateSites(
        (current = []) => {
          const exists = current.some((item) => item.id === site.id);
          if (exists) return current;
          return [...current, site].sort((a, b) => a.name.localeCompare(b.name));
        },
        { revalidate: true }
      );
    },
    [mutateSites]
  );

  function handleItemChange(key: string, field: string, value: string | number) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        if (field === "designation") return { ...item, designation: String(value) };
        if (field === "quantity") return { ...item, quantityInput: String(value) };
        if (field === "unit") return { ...item, unitInput: String(value) };
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
    let error: string | null = !item.designation.trim()
      ? "renseignez la désignation."
      : quantity === null
        ? "saisissez une quantité de 0,001 à 2 147 483 647, avec au maximum trois décimales."
        : !item.unitInput.trim()
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
    quantity: computed[index].quantity ?? 0,
    quantityInput: item.quantityInput,
    unit: item.unitInput || null,
    priceUnit: item.unitInput.trim() || null,
    unitPriceInput: item.unitPriceEuros,
    unitPriceHtCents: computed[index].unitPriceCents ?? 0,
    lineTotalHtCents: computed[index].lineTotalHtCents,
    validationError: computed[index].error,
  }));

  async function onCreateOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

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
      productId: null,
      reference: null,
      designation: item.designation.trim(),
      quantity: computed[index].quantity!,
      unit: item.unitInput.trim() || null,
      taxRateBp: item.taxRateBp,
      unitPriceCents: computed[index].unitPriceCents!,
    }));

    if (cleanedItems.length === 0) {
      setFormError("Ajoutez au moins une ligne de commande.");
      return;
    }

    setCreating(true);

    let response: Response;
    try {
      response = await fetch("/api/purchase-orders", {
        method: "POST",
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
      setCreating(false);
      setFormError("Impossible de créer le bon de commande : vérifiez votre connexion.");
      return;
    }

    setCreating(false);

    let result: { id?: string; error?: string } | null = null;
    try {
      result = (await response.json()) as { id?: string; error?: string };
    } catch {
      result = null;
    }

    if (!response.ok || !result?.id) {
      setFormError(result?.error ?? "Impossible de créer le bon de commande.");
      return;
    }

    router.push(`/dashboard/orders/${result.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Bons de commande", href: "/dashboard/orders" },
          { label: "Nouveau" },
        ]}
        title="Nouveau bon de commande"
        description="Choisissez le fournisseur et le chantier, puis saisissez les lignes à commander directement sur le document."
      />

      {loadError ? (
        <Alert variant="danger" className="mb-4">
          {loadError.message}
        </Alert>
      ) : null}

      {isLoading ? (
        <LoadingState label="Chargement des fournisseurs et des chantiers…" className="py-4" />
      ) : null}

      <form noValidate id="order-form" onSubmit={onCreateOrder} aria-label="Nouveau bon de commande">
        <OrderDocumentViewport label="Bon de commande à compléter">
          <PurchaseOrderDocument
            editable={true}
            issuerName={userProfile?.full_name ?? "Chargement…"}
            issuerRole={userProfile?.job_title ?? ""}
            issuerPhone={userProfile?.phone ?? undefined}
            issuerEmail={userProfile?.work_email ?? undefined}
            orderDate={new Date().toISOString()}
            supplier={selectedSupplier}
            supplierId={supplierId}
            onSupplierChange={setSupplierId}
            supplierOptions={suppliers.map((s) => ({ id: s.id, name: s.name }))}
            onSupplierCreate={() => setIsSupplierModalOpen(true)}
            isSupplierCreateDisabled={creating || isLoading}
            deliverySite={selectedSite}
            deliverySiteId={deliverySiteId}
            onDeliverySiteChange={setDeliverySiteId}
            siteOptions={sites.map((s) => ({
              id: s.id,
              name: s.name,
              project_code: s.project_code,
            }))}
            onDeliverySiteCreate={() => setIsDeliverySiteModalOpen(true)}
            isDeliverySiteCreateDisabled={creating || isLoading}
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

        <OrderFormActions
          cancelHref="/dashboard/orders"
          submitLabel="Créer le bon de commande"
          submitIcon={<PlusIcon aria-hidden="true" />}
          loading={creating}
          disabled={isLoading || totalsError !== null}
          error={totalsError ?? formError}
        />
      </form>

      <SupplierCreateModal
        open={isSupplierModalOpen}
        onClose={() => setIsSupplierModalOpen(false)}
        onCreated={handleSupplierCreated}
      />
      <DeliverySiteCreateModal
        open={isDeliverySiteModalOpen}
        onClose={() => setIsDeliverySiteModalOpen(false)}
        onCreated={handleDeliverySiteCreated}
      />
    </div>
  );
}
