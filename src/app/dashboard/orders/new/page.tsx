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

type ProductOption = {
  id: string;
  designation: string;
  reference: string | null;
  unit_price_cents: number;
  tax_rate_bp: number;
};

type DraftItem = {
  key: string;
  productId: string | null;
  reference: string;
  designation: string;
  quantity: number;
  unitPriceEuros: string;
  taxRateBp: number;
};

function euroInputFromCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function newDraftItem(): DraftItem {
  return {
    key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    productId: null,
    reference: "",
    designation: "",
    quantity: 1,
    unitPriceEuros: "",
    taxRateBp: 2000,
  };
}

export default function NewOrderPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [supplierId, setSupplierId] = useState<string>("");
  const [deliverySiteId, setDeliverySiteId] = useState<string>("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [items, setItems] = useState<DraftItem[]>([newDraftItem()]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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

  const fetchProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("id, designation, reference, unit_price_cents, tax_rate_bp")
      .eq("is_active", true)
      .order("designation", { ascending: true });

    if (error) throw error;
    return (data ?? []) as ProductOption[];
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

  const {
    data: products = [],
    error: productsError,
    isLoading: isProductsLoading,
  } = useSWR<ProductOption[]>("po-products", fetchProducts, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const loadError = suppliersError ?? sitesError ?? productsError;
  const isLoading = isSuppliersLoading || isSitesLoading || isProductsLoading;
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

  function applyProductToItem(itemKey: string, productId: string) {
    if (!productId) {
      setItems((prev) =>
        prev.map((item) =>
          item.key === itemKey ? { ...item, productId: null } : item
        )
      );
      return;
    }

    const product = products.find((p) => p.id === productId);
    if (!product) return;

    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== itemKey) return item;
        return {
          ...item,
          productId: product.id,
          reference: product.reference ?? "",
          designation: product.designation,
          unitPriceEuros: euroInputFromCents(product.unit_price_cents),
          taxRateBp: product.tax_rate_bp,
        };
      })
    );
  }

  function handleItemChange(key: string, field: string, value: string | number) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item;
        if (field === "reference") return { ...item, reference: String(value) };
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
      reference: item.reference || null,
      designation: item.designation,
      quantity: item.quantity,
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
          productId: item.productId,
          reference: item.reference.trim() || null,
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
    <div className="min-h-screen bg-slate-200">
      {/* Action bar - sticky at top */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-center gap-4 bg-slate-200/95 py-4 backdrop-blur-sm">
        <button
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand-orange px-8 text-sm font-bold text-white shadow-xl transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={creating || isLoading}
          form="order-form"
          type="submit"
        >
          {creating ? "Creation..." : "Creer le bon de commande"}
        </button>
        <Link
          className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-200 bg-white px-6 text-sm font-medium text-zinc-900 transition-all hover:bg-zinc-50"
          href="/dashboard/orders"
        >
          Annuler
        </Link>
      </div>

      {/* Error message */}
      {displayError && (
        <div className="mx-auto max-w-4xl px-4 pb-4">
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {displayError}
          </p>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="mx-auto max-w-4xl px-4 pb-4">
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Chargement des donnees...
          </p>
        </div>
      )}

      {/* WYSIWYG Document */}
      <form id="order-form" onSubmit={onCreateOrder}>
        <PurchaseOrderDocument
          editable={true}
          issuerName="Thomas Dupont"
          issuerRole="Charge d'affaires"
          orderDate={new Date().toISOString()}
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
          productOptions={products}
          onProductSelect={applyProductToItem}
          totalHtCents={orderTotals.totalHtCents}
          totalTaxCents={orderTotals.totalTaxCents}
          totalTtcCents={orderTotals.totalTtcCents}
        />
      </form>
    </div>
  );
}
