"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type {
  SupplierCatalogItem,
  SupplierPrice,
} from "@/components/catalogue/types";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { toEuroInput } from "@/components/catalogue/prices-manager/utils";
import { Modal } from "@/components/ui-legacy/Modal";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui-legacy/SearchableSelect";
import { useToast } from "@/components/ui-legacy/Toast";
import { parseEuroToCents } from "@/lib/money";

type EntityMode = "existing" | "new";

type SupplierDraft = {
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  postal_code: string;
  city: string;
  country: string;
  siret: string;
  vat_number: string;
  payment_terms: string;
};

type ProductDraft = {
  reference: string;
  designation: string;
  category: string;
  product_type: string;
  material: string;
  grade: string;
  dimensions: string;
  standard: string;
  unit: string;
  unit_price_euros: string;
  tax_rate_bp: number;
};

type PriceDraft = {
  supplier_id: string;
  product_id: string;
  supplier_sku: string;
  product_url: string;
  unit: string;
  min_quantity: string;
  unit_price_euros: string;
  currency: string;
  valid_from: string;
  valid_to: string;
  source: string;
  notes: string;
};

type SupplierOfferFormModalProps = {
  open: boolean;
  item: EnrichedPrice | null;
  supplierOptions: SearchableSelectOption[];
  productOptions: SearchableSelectOption[];
  isSupplierLoading?: boolean;
  isProductLoading?: boolean;
  defaultProductId?: string | null;
  onSupplierQueryChange?: (query: string) => void;
  onProductQueryChange?: (query: string) => void;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

const EMPTY_SUPPLIER: SupplierDraft = {
  name: "",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  postal_code: "",
  city: "",
  country: "France",
  siret: "",
  vat_number: "",
  payment_terms: "",
};

const EMPTY_PRODUCT: ProductDraft = {
  reference: "",
  designation: "",
  category: "",
  product_type: "",
  material: "",
  grade: "",
  dimensions: "",
  standard: "",
  unit: "u",
  unit_price_euros: "0,00",
  tax_rate_bp: 2000,
};

const EMPTY_PRICE: PriceDraft = {
  supplier_id: "",
  product_id: "",
  supplier_sku: "",
  product_url: "",
  unit: "u",
  min_quantity: "1",
  unit_price_euros: "",
  currency: "EUR",
  valid_from: "",
  valid_to: "",
  source: "",
  notes: "",
};

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function priceDraftFromItem(
  item: EnrichedPrice | null,
  defaultProductId: string | null,
): PriceDraft {
  if (!item) {
    return { ...EMPTY_PRICE, product_id: defaultProductId ?? "" };
  }

  return {
    supplier_id: item.supplier_id ?? "",
    product_id: item.product_id ?? item.catalogue_item_id ?? "",
    supplier_sku: item.supplier_sku ?? "",
    product_url: item.product_url ?? "",
    unit: item.unit ?? "u",
    min_quantity: String(item.min_quantity ?? 1),
    unit_price_euros: toEuroInput(item.unit_price_cents),
    currency: item.currency ?? "EUR",
    valid_from: item.valid_from ?? "",
    valid_to: item.valid_to ?? "",
    source: item.source ?? "",
    notes: item.notes ?? "",
  };
}

export function SupplierOfferFormModal({
  open,
  item,
  supplierOptions,
  productOptions,
  isSupplierLoading = false,
  isProductLoading = false,
  defaultProductId = null,
  onSupplierQueryChange,
  onProductQueryChange,
  onClose,
  onSaved,
}: Readonly<SupplierOfferFormModalProps>) {
  const toast = useToast();
  const [supplierMode, setSupplierMode] = useState<EntityMode>("existing");
  const [productMode, setProductMode] = useState<EntityMode>("existing");
  const [supplierDraft, setSupplierDraft] = useState(EMPTY_SUPPLIER);
  const [productDraft, setProductDraft] = useState(EMPTY_PRODUCT);
  const [priceDraft, setPriceDraft] = useState(EMPTY_PRICE);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [catalogItem, setCatalogItem] = useState<SupplierCatalogItem | null>(
    null,
  );
  const [isCatalogItemLoading, setIsCatalogItemLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const editingId = item?.id ?? null;
  const isEditing = editingId !== null;
  const selectedProductLabel = useMemo(
    () =>
      productOptions.find((option) => option.value === priceDraft.product_id)
        ?.label ??
      item?._productName ??
      null,
    [item?._productName, priceDraft.product_id, productOptions],
  );

  useEffect(() => {
    if (!open) return;
    setSupplierMode("existing");
    setProductMode("existing");
    setSupplierDraft(EMPTY_SUPPLIER);
    setProductDraft(EMPTY_PRODUCT);
    setPriceDraft(priceDraftFromItem(item, defaultProductId));
    setSupplierQuery("");
    setProductQuery("");
    setCatalogItem(
      item?.supplier_catalog_item_id
        ? {
            id: item.supplier_catalog_item_id,
            supplier_id: item.supplier_id,
            product_id: item.product_id,
            supplier_sku: item.supplier_sku,
            product_url: item.product_url,
          }
        : null,
    );
    setIsCatalogItemLoading(false);
    setIsSaving(false);
    setFormError(null);
  }, [defaultProductId, item, open]);

  useEffect(() => {
    if (
      !open ||
      isEditing ||
      supplierMode !== "existing" ||
      productMode !== "existing" ||
      !priceDraft.supplier_id ||
      !priceDraft.product_id
    ) {
      return;
    }

    let active = true;
    setIsCatalogItemLoading(true);
    setCatalogItem(null);

    const query = new URLSearchParams({
      view: "supplier-item",
      supplier_id: priceDraft.supplier_id,
      product_id: priceDraft.product_id,
    });

    void fetchApi<{ item: SupplierCatalogItem | null }>(
      `/api/prices?${query.toString()}`,
    )
      .then((result) => {
        if (!active) return;
        setCatalogItem(result.item);
        setPriceDraft((current) => ({
          ...current,
          supplier_sku: result.item?.supplier_sku ?? "",
          product_url: result.item?.product_url ?? "",
        }));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFormError(
          error instanceof Error
            ? error.message
            : "Impossible de vÃ©rifier la fiche fournisseur.",
        );
      })
      .finally(() => {
        if (active) setIsCatalogItemLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    isEditing,
    open,
    priceDraft.product_id,
    priceDraft.supplier_id,
    productMode,
    supplierMode,
  ]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  function updateSupplier<K extends keyof SupplierDraft>(
    key: K,
    value: SupplierDraft[K],
  ) {
    setSupplierDraft((current) => ({ ...current, [key]: value }));
  }

  function updateProduct<K extends keyof ProductDraft>(
    key: K,
    value: ProductDraft[K],
  ) {
    setProductDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePrice<K extends keyof PriceDraft>(
    key: K,
    value: PriceDraft[K],
  ) {
    setPriceDraft((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const unitPriceCents = parseEuroToCents(priceDraft.unit_price_euros);
    const minQuantity = Number(priceDraft.min_quantity.replace(",", "."));

    if (unitPriceCents === null || unitPriceCents < 0) {
      setFormError("Prix unitaire invalide.");
      return;
    }
    if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
      setFormError("La quantitÃ© minimale doit Ãªtre supÃ©rieure Ã  zÃ©ro.");
      return;
    }
    if (!isHttpUrl(priceDraft.product_url)) {
      setFormError("L'URL fournisseur doit commencer par http:// ou https://.");
      return;
    }
    if (supplierMode === "existing" && !priceDraft.supplier_id) {
      setFormError(
        "SÃ©lectionnez un fournisseur existant ou crÃ©ez-en un nouveau.",
      );
      return;
    }
    if (supplierMode === "new" && !supplierDraft.name.trim()) {
      setFormError("Le nom du nouveau fournisseur est obligatoire.");
      return;
    }
    if (productMode === "existing" && !priceDraft.product_id) {
      setFormError("SÃ©lectionnez un article existant ou crÃ©ez-en un nouveau.");
      return;
    }
    if (productMode === "new" && !productDraft.designation.trim()) {
      setFormError("La dÃ©signation du nouvel article est obligatoire.");
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const price = {
        unit: priceDraft.unit.trim() || "u",
        min_quantity: minQuantity,
        unit_price_cents: unitPriceCents,
        currency: priceDraft.currency.trim().toUpperCase() || "EUR",
        valid_from: priceDraft.valid_from || null,
        valid_to: priceDraft.valid_to || null,
        source: nullableText(priceDraft.source),
        notes: nullableText(priceDraft.notes),
      };

      if (editingId) {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            item: price,
          }),
        });
        toast.success({ title: "Prix fournisseur mis Ã  jour." });
      } else {
        const newProductPrice = parseEuroToCents(productDraft.unit_price_euros);
        if (productMode === "new" && newProductPrice === null) {
          setFormError("Le prix interne du nouvel article est invalide.");
          return;
        }

        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            item: {
              ...(supplierMode === "existing"
                ? { supplier_id: priceDraft.supplier_id }
                : {
                    new_supplier: {
                      ...supplierDraft,
                      address: nullableText(supplierDraft.address),
                      city: nullableText(supplierDraft.city),
                      postal_code: nullableText(supplierDraft.postal_code),
                      country: nullableText(supplierDraft.country),
                      email: nullableText(supplierDraft.email),
                      phone: nullableText(supplierDraft.phone),
                      contact_name: nullableText(supplierDraft.contact_name),
                      siret: nullableText(supplierDraft.siret),
                      vat_number: nullableText(supplierDraft.vat_number),
                      payment_terms: nullableText(supplierDraft.payment_terms),
                    },
                  }),
              ...(productMode === "existing"
                ? { product_id: priceDraft.product_id }
                : {
                    new_product: {
                      reference: nullableText(productDraft.reference),
                      designation: productDraft.designation.trim(),
                      category: nullableText(productDraft.category),
                      product_type: nullableText(productDraft.product_type),
                      material: nullableText(productDraft.material),
                      grade: nullableText(productDraft.grade),
                      dimensions: nullableText(productDraft.dimensions),
                      standard: nullableText(productDraft.standard),
                      unit: productDraft.unit.trim() || "u",
                      unit_price_cents: newProductPrice ?? 0,
                      tax_rate_bp: productDraft.tax_rate_bp,
                    },
                  }),
              supplier_sku: nullableText(priceDraft.supplier_sku),
              product_url: nullableText(priceDraft.product_url),
              ...price,
            },
          }),
        });
        toast.success({ title: "Fournisseur et tarif ajoutÃ©s Ã  l'article." });
      }

      handleClose();
      await onSaved();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer l'offre fournisseur.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && handleClose()}
    >
      <Modal.Content className="max-h-[94vh] max-w-5xl overflow-hidden p-0">
        <Modal.Header className="border-b border-[var(--slate-200)] px-6 py-5">
          <div>
            <Modal.Title>
              {isEditing
                ? "Modifier un tarif fournisseur"
                : "Ajouter un fournisseur / tarif"}
            </Modal.Title>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              L&apos;article porte les caractÃ©ristiques communes ; la rÃ©fÃ©rence
              et l&apos;URL appartiennent au fournisseur.
            </p>
          </div>
          <Modal.Close disabled={isSaving}>Fermer</Modal.Close>
        </Modal.Header>

        <form onSubmit={onSubmit}>
          <Modal.Body className="max-h-[calc(94vh-10rem)] space-y-5 overflow-y-auto px-6 py-5">
            <section className="rounded-xl border border-[var(--slate-200)] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                    1. Article commun
                  </h3>
                  <p className="text-xs text-[var(--slate-500)]">
                    DÃ©signation et caractÃ©ristiques partagÃ©es par tous les
                    fournisseurs.
                  </p>
                </div>
                {!isEditing && !defaultProductId ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => {
                      if (productMode === "existing") {
                        setProductMode("new");
                        setProductDraft((current) => ({
                          ...current,
                          designation: productQuery.trim(),
                        }));
                      } else {
                        setProductMode("existing");
                      }
                      setCatalogItem(null);
                    }}
                  >
                    {productMode === "existing"
                      ? "CrÃ©er un nouvel article"
                      : "Choisir un article existant"}
                  </button>
                ) : null}
              </div>

              {productMode === "existing" ? (
                <div>
                  <SearchableSelect
                    id="offer-product-id"
                    value={priceDraft.product_id}
                    label="Article *"
                    options={productOptions}
                    placeholder="Rechercher une dÃ©signation ou une rÃ©fÃ©rence..."
                    isLoading={isProductLoading}
                    disabled={isEditing || Boolean(defaultProductId)}
                    onQueryChange={(query) => {
                      setProductQuery(query);
                      onProductQueryChange?.(query);
                    }}
                    onValueChange={(value) => {
                      updatePrice("product_id", value);
                      setCatalogItem(null);
                    }}
                  />
                  {selectedProductLabel ? (
                    <p className="mt-2 text-xs text-[var(--slate-500)]">
                      Article retenu : {selectedProductLabel}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <TextField
                    label="RÃ©fÃ©rence interne"
                    value={productDraft.reference}
                    onChange={(value) => updateProduct("reference", value)}
                  />
                  <TextField
                    className="lg:col-span-3"
                    label="DÃ©signation *"
                    value={productDraft.designation}
                    onChange={(value) => updateProduct("designation", value)}
                  />
                  <TextField
                    label="Famille"
                    value={productDraft.category}
                    onChange={(value) => updateProduct("category", value)}
                  />
                  <TextField
                    label="Type d'article"
                    value={productDraft.product_type}
                    onChange={(value) => updateProduct("product_type", value)}
                  />
                  <TextField
                    label="MatiÃ¨re"
                    value={productDraft.material}
                    onChange={(value) => updateProduct("material", value)}
                  />
                  <TextField
                    label="Nuance"
                    value={productDraft.grade}
                    onChange={(value) => updateProduct("grade", value)}
                  />
                  <TextField
                    label="Dimensions"
                    value={productDraft.dimensions}
                    onChange={(value) => updateProduct("dimensions", value)}
                  />
                  <TextField
                    label="Norme"
                    value={productDraft.standard}
                    onChange={(value) => updateProduct("standard", value)}
                  />
                  <SelectField
                    label="UnitÃ©"
                    value={productDraft.unit}
                    onChange={(value) => updateProduct("unit", value)}
                  />
                  <TextField
                    label="Prix interne HT"
                    value={productDraft.unit_price_euros}
                    onChange={(value) =>
                      updateProduct("unit_price_euros", value)
                    }
                  />
                  <label className="space-y-1.5 text-xs font-semibold text-[var(--slate-700)]">
                    TVA
                    <select
                      className="form-input form-select"
                      value={productDraft.tax_rate_bp}
                      onChange={(event) =>
                        updateProduct("tax_rate_bp", Number(event.target.value))
                      }
                    >
                      <option value={0}>0 %</option>
                      <option value={550}>5,5 %</option>
                      <option value={1000}>10 %</option>
                      <option value={2000}>20 %</option>
                    </select>
                  </label>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-[var(--slate-200)] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                    2. Fournisseur
                  </h3>
                  <p className="text-xs text-[var(--slate-500)]">
                    Un seul fournisseur et une seule rÃ©fÃ©rence pour cet article.
                  </p>
                </div>
                {!isEditing ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => {
                      if (supplierMode === "existing") {
                        setSupplierMode("new");
                        setSupplierDraft((current) => ({
                          ...current,
                          name: supplierQuery.trim(),
                        }));
                      } else {
                        setSupplierMode("existing");
                      }
                      setCatalogItem(null);
                    }}
                  >
                    {supplierMode === "existing"
                      ? "CrÃ©er un nouveau fournisseur"
                      : "Choisir un fournisseur existant"}
                  </button>
                ) : null}
              </div>

              {supplierMode === "existing" ? (
                <SearchableSelect
                  id="offer-supplier-id"
                  value={priceDraft.supplier_id}
                  label="Fournisseur *"
                  options={supplierOptions}
                  placeholder="Rechercher un fournisseur..."
                  isLoading={isSupplierLoading}
                  disabled={isEditing}
                  onQueryChange={(query) => {
                    setSupplierQuery(query);
                    onSupplierQueryChange?.(query);
                  }}
                  onValueChange={(value) => {
                    updatePrice("supplier_id", value);
                    setCatalogItem(null);
                  }}
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    className="lg:col-span-3"
                    label="Nom *"
                    value={supplierDraft.name}
                    onChange={(value) => updateSupplier("name", value)}
                  />
                  <TextField
                    label="Contact"
                    value={supplierDraft.contact_name}
                    onChange={(value) => updateSupplier("contact_name", value)}
                  />
                  <TextField
                    label="TÃ©lÃ©phone"
                    value={supplierDraft.phone}
                    onChange={(value) => updateSupplier("phone", value)}
                  />
                  <TextField
                    label="Email"
                    type="email"
                    value={supplierDraft.email}
                    onChange={(value) => updateSupplier("email", value)}
                  />
                  <TextField
                    className="lg:col-span-3"
                    label="Adresse"
                    value={supplierDraft.address}
                    onChange={(value) => updateSupplier("address", value)}
                  />
                  <TextField
                    label="Code postal"
                    value={supplierDraft.postal_code}
                    onChange={(value) => updateSupplier("postal_code", value)}
                  />
                  <TextField
                    label="Ville"
                    value={supplierDraft.city}
                    onChange={(value) => updateSupplier("city", value)}
                  />
                  <TextField
                    label="Pays"
                    value={supplierDraft.country}
                    onChange={(value) => updateSupplier("country", value)}
                  />
                  <TextField
                    label="SIRET"
                    value={supplierDraft.siret}
                    onChange={(value) => updateSupplier("siret", value)}
                  />
                  <TextField
                    label="TVA intracommunautaire"
                    value={supplierDraft.vat_number}
                    onChange={(value) => updateSupplier("vat_number", value)}
                  />
                  <TextField
                    label="Conditions de paiement"
                    value={supplierDraft.payment_terms}
                    onChange={(value) => updateSupplier("payment_terms", value)}
                  />
                </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <TextField
                  label="RÃ©fÃ©rence fournisseur"
                  value={priceDraft.supplier_sku}
                  disabled={Boolean(catalogItem) || isEditing}
                  onChange={(value) => updatePrice("supplier_sku", value)}
                />
                <TextField
                  label="URL fournisseur"
                  type="url"
                  value={priceDraft.product_url}
                  disabled={Boolean(catalogItem) || isEditing}
                  onChange={(value) => updatePrice("product_url", value)}
                />
              </div>
              {isCatalogItemLoading ? (
                <p className="mt-2 text-xs text-[var(--slate-500)]">
                  VÃ©rification de la fiche existante...
                </p>
              ) : null}
              {catalogItem ? (
                <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  Cette fiche articleâ€“fournisseur existe dÃ©jÃ . Sa rÃ©fÃ©rence et
                  son URL seront rÃ©utilisÃ©es ; elles se modifient sÃ©parÃ©ment
                  depuis la liste.
                </p>
              ) : null}
            </section>

            <section className="rounded-xl border border-[var(--slate-200)] p-4">
              <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                3. Tarif
              </h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <TextField
                  label="Prix unitaire HT *"
                  value={priceDraft.unit_price_euros}
                  onChange={(value) => updatePrice("unit_price_euros", value)}
                />
                <SelectField
                  label="UnitÃ©"
                  value={priceDraft.unit}
                  onChange={(value) => updatePrice("unit", value)}
                />
                <TextField
                  label="QuantitÃ© minimale"
                  value={priceDraft.min_quantity}
                  onChange={(value) => updatePrice("min_quantity", value)}
                />
                <label className="space-y-1.5 text-xs font-semibold text-[var(--slate-700)]">
                  Devise
                  <select
                    className="form-input form-select"
                    value={priceDraft.currency}
                    onChange={(event) =>
                      updatePrice("currency", event.target.value)
                    }
                  >
                    <option value="EUR">EUR - Euro</option>
                    <option value="USD">USD - Dollar US</option>
                    <option value="GBP">GBP - Livre sterling</option>
                  </select>
                </label>
                <TextField
                  label="Valide du"
                  type="date"
                  value={priceDraft.valid_from}
                  onChange={(value) => updatePrice("valid_from", value)}
                />
                <TextField
                  label="Valide au"
                  type="date"
                  value={priceDraft.valid_to}
                  onChange={(value) => updatePrice("valid_to", value)}
                />
                <TextField
                  label="Source"
                  value={priceDraft.source}
                  onChange={(value) => updatePrice("source", value)}
                />
                <TextField
                  label="Notes"
                  value={priceDraft.notes}
                  onChange={(value) => updatePrice("notes", value)}
                />
              </div>
            </section>

            {formError ? (
              <div className="alert alert-error" role="alert">
                {formError}
              </div>
            ) : null}
          </Modal.Body>

          <Modal.Footer className="mt-0 border-t border-[var(--slate-200)] px-6 py-4">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={isSaving}
              onClick={handleClose}
            >
              Annuler
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={isSaving || isCatalogItemLoading}
            >
              {isSaving
                ? "Enregistrement..."
                : isEditing
                  ? "Mettre Ã  jour le tarif"
                  : "Ajouter le fournisseur / tarif"}
            </button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = "",
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
}) {
  return (
    <label
      className={`space-y-1.5 text-xs font-semibold text-[var(--slate-700)] ${className}`}
    >
      {label}
      <input
        className="form-input"
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-xs font-semibold text-[var(--slate-700)]">
      {label}
      <select
        className="form-input form-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="u">UnitÃ© (u)</option>
        <option value="ml">MÃ¨tre linÃ©aire (ml)</option>
        <option value="m2">MÃ¨tre carrÃ© (mÂ²)</option>
        <option value="kg">Kilogramme (kg)</option>
        <option value="h">Heure (h)</option>
      </select>
    </label>
  );
}
