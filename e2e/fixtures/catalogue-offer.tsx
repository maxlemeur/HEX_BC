import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UserProvider } from "../../src/components/UserContext";
import { ToastProvider } from "../../src/components/ui-legacy/Toast";
import { SupplierOfferFormModal } from "../../src/components/catalogue/prices-manager/SupplierOfferFormModal";

const offer = {
  id: "44444444-4444-4444-8444-444444444444",
  supplier_id: "22222222-2222-4222-8222-222222222222",
  product_id: "33333333-3333-4333-8333-333333333333",
  supplier_catalog_item_id: "55555555-5555-4555-8555-555555555555",
  supplier_sku: "AL-018", product_url: "https://example.test/alpha",
  unit: "m", min_quantity: 5, unit_price_cents: 1000, currency: "EUR",
  valid_from: "2026-10-02", valid_to: "2027-04-02",
  transport_mode: "included" as const,
  _supplierName: "Fournisseur Alpha", _productName: "Tube de démonstration",
  _freshnessLevel: "fresh" as const, _ageDays: 0,
};

function CatalogueOfferFixture() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  const tenantRole = new URLSearchParams(window.location.search).get("role") === "engineer" ? "engineer" : "admin";
  return <UserProvider initialUserEmail="fixture@example.test" initialProfile={{
    id: "11111111-1111-4111-8111-111111111111", full_name: "Fixture",
    phone: null, job_title: null, work_email: null, role: "admin", ui_mode: "expert",
    tenant_id: "66666666-6666-4666-8666-666666666666", tenant_role: tenantRole,
  }}><ToastProvider>
    <main><h1>Fixture locale d’offre fournisseur</h1>{saved && <p role="status">Offre enregistrée</p>}</main>
    <SupplierOfferFormModal open={open} item={offer}
      supplierOptions={[{ value: offer.supplier_id, label: offer._supplierName }]}
      productOptions={[{ value: offer.product_id, label: offer._productName }]}
      onClose={() => setOpen(false)} onSaved={() => setSaved(true)} />
  </ToastProvider></UserProvider>;
}

createRoot(document.getElementById("root")!).render(<CatalogueOfferFixture />);
