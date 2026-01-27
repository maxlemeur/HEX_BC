"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";

import {
  PurchaseOrderDocument,
  type OrderItemData,
  type SupplierData,
  type DeliverySiteData,
} from "@/components/PurchaseOrderDocument";
import { SupplierCreateModal, type SupplierCreateResult } from "@/components/SupplierCreateModal";
import { useUserContext } from "@/components/UserContext";
import {
  computeLineTotals,
  computeOrderTotals,
} from "@/lib/order-calculations";
import { parseEuroToCents } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SupplierOption = SupplierCreateResult;

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

function newDraftItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    designation: "",
    quantity: 1,
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
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);

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
  } = useSWR<SiteOption[]>("po-sites-full", fetchSites, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const loadError = suppliersError ?? sitesError;
  const isLoading = isSuppliersLoading || isSitesLoading;
  const displayError = formError ?? (loadError ? loadError.message : null);

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

  async function onCreateOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

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

    setCreating(true);

    const response = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        deliverySiteId,
        expectedDeliveryDate: expectedDeliveryDate || null,
        notes: notes.trim() || null,
        items: cleanedItems,
      }),
    });

    setCreating(false);

    let result: { id?: string; error?: string } | null = null;
    try {
      result = (await response.json()) as { id?: string; error?: string };
    } catch {
      result = null;
    }

    if (!response.ok || !result?.id) {
      setFormError(result?.error ?? "Impossible de creer le bon.");
      return;
    }

    router.push(`/dashboard/orders/${result.id}`);
    router.refresh();
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
              Annuler
            </Link>
            <div className="hidden h-6 w-px bg-[var(--slate-200)] sm:block" />
            <span className="hidden text-sm font-semibold text-[var(--slate-700)] sm:block">
              Nouveau bon de commande
            </span>
          </div>

          {/* Right: Create button */}
          <button
            className="btn btn-accent btn-lg"
            disabled={creating || isLoading}
            form="order-form"
            type="submit"
          >
            {creating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                Creation...
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
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
                Creer le bon
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
      <form id="order-form" onSubmit={onCreateOrder} className="py-8">
        <PurchaseOrderDocument
          editable={true}
          issuerName={userProfile?.full_name ?? "Chargement..."}
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
      <SupplierCreateModal
        open={isSupplierModalOpen}
        onClose={() => setIsSupplierModalOpen(false)}
        onCreated={handleSupplierCreated}
      />
    </div>
  );
}
