"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import {
  PurchaseOrderDocument,
  type OrderItemData,
  type SupplierData,
  type DeliverySiteData,
} from "@/components/PurchaseOrderDocument";
import {
  computeLineTotals,
  computeOrderTotals,
} from "@/lib/order-calculations";
import { parseEuroToCents } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

type UserProfile = {
  full_name: string;
  job_title: string | null;
  phone: string | null;
  work_email: string | null;
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

export default function EditOrderPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [supplierId, setSupplierId] = useState<string>("");
  const [deliverySiteId, setDeliverySiteId] = useState<string>("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [orderDate, setOrderDate] = useState<string>("");
  const [reference, setReference] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // User profile for document header
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    async function loadUserProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("full_name, job_title, phone, work_email")
        .eq("id", user.id)
        .single();

      if (data) {
        setUserProfile(data as unknown as UserProfile);
      }
    }

    loadUserProfile();
  }, [supabase]);

  // Fetch existing order
  const fetchOrder = useCallback(async () => {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, reference, order_date, expected_delivery_date, notes, supplier_id, delivery_site_id, status")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data as ExistingOrder;
  }, [supabase, id]);

  const fetchOrderItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("purchase_order_items")
      .select("id, designation, quantity, unit_price_ht_cents, tax_rate_bp")
      .eq("purchase_order_id", id)
      .order("position", { ascending: true });

    if (error) throw error;
    return (data ?? []) as ExistingItem[];
  }, [supabase, id]);

  const { data: order, error: orderError, isLoading: isOrderLoading } = useSWR(
    `edit-order-${id}`,
    fetchOrder
  );

  const { data: orderItems, error: itemsError, isLoading: isItemsLoading } = useSWR(
    `edit-order-items-${id}`,
    fetchOrderItems
  );

  // Initialize form with existing data
  useEffect(() => {
    if (order && orderItems && !initialized) {
      setSupplierId(order.supplier_id);
      setDeliverySiteId(order.delivery_site_id);
      setExpectedDeliveryDate(order.expected_delivery_date ?? "");
      setNotes(order.notes ?? "");
      setOrderDate(order.order_date);
      setReference(order.reference);
      setItems(
        orderItems.length > 0
          ? orderItems.map(existingItemToDraft)
          : [newDraftItem()]
      );
      setInitialized(true);
    }
  }, [order, orderItems, initialized]);

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
  const displayError = formError ?? (loadError ? (loadError as Error).message : null);

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

    if (!isDraft) {
      setFormError("Seuls les bons de commande en brouillon peuvent etre modifies.");
      return;
    }

    if (!supplierId || !deliverySiteId) {
      setFormError("Selectionnez un fournisseur et un chantier.");
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

    const response = await fetch(`/api/purchase-orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        deliverySiteId,
        expectedDeliveryDate: expectedDeliveryDate || null,
        notes: notes.trim() || null,
        items: cleanedItems,
      }),
    });

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

  // Show error if order is not draft
  if (order && !isDraft) {
    return (
      <div className="min-h-screen bg-[var(--slate-100)]">
        <div className="border-b border-[var(--slate-200)] bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
            <Link
              className="btn btn-ghost btn-sm"
              href={`/dashboard/orders/${id}`}
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
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <div className="alert alert-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            Seuls les bons de commande en brouillon peuvent etre modifies.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--slate-100)]">
      {/* Action bar - sticky at top */}
      <div className="no-print sticky top-0 z-10 border-b border-[var(--slate-200)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          {/* Left: Back and title */}
          <div className="flex items-center gap-4">
            <Link
              className="btn btn-ghost btn-sm"
              href={`/dashboard/orders/${id}`}
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
              Annuler
            </Link>
            <div className="hidden h-6 w-px bg-[var(--slate-200)] sm:block" />
            <span className="hidden text-sm font-semibold text-[var(--slate-700)] sm:block">
              Modifier le bon de commande
            </span>
            {reference && (
              <span className="hidden rounded-lg bg-[var(--brand-orange)]/10 px-2.5 py-1 font-mono text-sm font-bold text-[var(--brand-orange)] sm:inline-block">
                {reference}
              </span>
            )}
          </div>

          {/* Right: Save button */}
          <button
            className="btn btn-accent btn-lg"
            disabled={saving || isLoading || !initialized}
            form="order-form"
            type="submit"
          >
            {saving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                Enregistrement...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Enregistrer
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error message */}
      {displayError && (
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <div className="alert alert-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            {displayError}
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <div className="alert alert-info">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--info)]/30 border-t-[var(--info)]"></div>
            Chargement des donnees...
          </div>
        </div>
      )}

      {/* WYSIWYG Document */}
      {initialized && (
        <form id="order-form" onSubmit={onSaveOrder} className="py-8">
          <PurchaseOrderDocument
            editable={true}
            issuerName={userProfile?.full_name ?? "Chargement..."}
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
            expectedDeliveryDate={expectedDeliveryDate}
            onExpectedDeliveryDateChange={setExpectedDeliveryDate}
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
        </form>
      )}
    </div>
  );
}
