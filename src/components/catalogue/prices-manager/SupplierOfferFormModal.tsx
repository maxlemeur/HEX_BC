"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type {
  SupplierCatalogItem,
  SupplierPrice,
} from "@/components/catalogue/types";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { toEuroInput } from "@/components/catalogue/prices-manager/utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/components/ui-legacy/Toast";
import { parseEuroToCents } from "@/lib/money";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";
import { maxPriceValidTo, resolvePriceValidity } from "@/lib/catalogue/price-validity";
import { ProductReferenceSuggestion } from "@/components/products/ProductReferenceSuggestion";
import { useOptionalUserContext } from "@/components/UserContext";

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
  transport_mode: "included" | "excluded" | "";
  zero_price_kind: "included" | "free" | "";
  estimate_unit_code: string;
  units_per_purchase_unit: string;
  purchase_rounding: "none" | "ceil" | "";
  valid_from: string;
  valid_to: string;
  source: string;
  notes: string;
};

type SupplierOfferFormModalProps = {
  open: boolean;
  item: EnrichedPrice | null;
  supplierOptions: ComboboxOption[];
  productOptions: ComboboxOption[];
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
  transport_mode: "",
  zero_price_kind: "",
  estimate_unit_code: "",
  units_per_purchase_unit: "",
  purchase_rounding: "",
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
    return { ...EMPTY_PRICE, ...resolvePriceValidity(), product_id: defaultProductId ?? "" };
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
    transport_mode: item.transport_mode === "included" || item.transport_mode === "excluded" ? item.transport_mode : "",
    zero_price_kind: item.zero_price_kind === "included" || item.zero_price_kind === "free" ? item.zero_price_kind : "",
    estimate_unit_code: item.estimate_unit_code ?? "",
    units_per_purchase_unit: typeof item.estimate_units_per_purchase_unit === "number"
      ? String(item.estimate_units_per_purchase_unit).replace(".", ",") : "",
    purchase_rounding: item.purchase_rounding === "none" || item.purchase_rounding === "ceil" ? item.purchase_rounding : "",
    valid_from: item.valid_from ?? "",
    valid_to: item.valid_to ?? maxPriceValidTo(item.valid_from || new Date().toISOString().slice(0, 10)),
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
  const userContext = useOptionalUserContext();
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
  const canEditTransport = userContext?.profile?.tenant_role === "admin" && Boolean(catalogItem);
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
            : "Impossible de vérifier la fiche fournisseur.",
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
    setPriceDraft((current) => {
      if (key === "valid_from" && value) {
        const previousMaximum = current.valid_from ? maxPriceValidTo(current.valid_from) : "";
        return {
          ...current,
          valid_from: value,
          valid_to: !current.valid_to || current.valid_to === previousMaximum
            ? maxPriceValidTo(value)
            : current.valid_to,
        };
      }
      return { ...current, [key]: value };
    });
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
      setFormError("La quantité minimale doit être supérieure à zéro.");
      return;
    }
    // 2.9: a conversion to the purchase unit is declared whole, or not at all.
    const unitsPerPurchaseUnitText = priceDraft.units_per_purchase_unit.trim().replace(",", ".");
    const unitsPerPurchaseUnit = Number(unitsPerPurchaseUnitText);
    const declaresConversion = Boolean(priceDraft.estimate_unit_code || unitsPerPurchaseUnitText || priceDraft.purchase_rounding);
    if (declaresConversion && (!priceDraft.estimate_unit_code || !priceDraft.purchase_rounding ||
      !/^\d+(?:\.\d{1,6})?$/.test(unitsPerPurchaseUnitText) || !(unitsPerPurchaseUnit > 0))) {
      setFormError("La conversion exige l'unité du devis, une quantité par unité d'achat positive (six décimales au plus) et un arrondi.");
      return;
    }
    if (!isHttpUrl(priceDraft.product_url)) {
      setFormError("L'URL fournisseur doit commencer par http:// ou https://.");
      return;
    }
    if (supplierMode === "existing" && !priceDraft.supplier_id) {
      setFormError(
        "Sélectionnez un fournisseur existant ou créez-en un nouveau.",
      );
      return;
    }
    if (supplierMode === "new" && !supplierDraft.name.trim()) {
      setFormError("Le nom du nouveau fournisseur est obligatoire.");
      return;
    }
    if (productMode === "existing" && !priceDraft.product_id) {
      setFormError("Sélectionnez un article existant ou créez-en un nouveau.");
      return;
    }
    if (productMode === "new" && !productDraft.designation.trim()) {
      setFormError("La désignation du nouvel article est obligatoire.");
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
        ...resolvePriceValidity(priceDraft.valid_from, priceDraft.valid_to),
        source: nullableText(priceDraft.source),
        notes: nullableText(priceDraft.notes),
      };

      if (editingId) {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: catalogItem ? "update-offer" : "update",
            id: editingId,
            item: {
              ...price,
              ...(catalogItem ? {
                ...(canEditTransport && (priceDraft.transport_mode || null) !== (item?.transport_mode ?? null)
                  ? { transport_mode: priceDraft.transport_mode || null } : {}),
                // A7: only an offer at 0 € may be marked; any other price leaves it unmarked.
                zero_price_kind: unitPriceCents === 0 ? priceDraft.zero_price_kind || null : null,
                estimate_unit_code: declaresConversion ? priceDraft.estimate_unit_code : null,
                estimate_units_per_purchase_unit: declaresConversion ? unitsPerPurchaseUnit : null,
                purchase_rounding: declaresConversion ? priceDraft.purchase_rounding || null : null,
                ...(nullableText(priceDraft.supplier_sku) !== (catalogItem.supplier_sku ?? null)
                  ? { supplier_sku: nullableText(priceDraft.supplier_sku) } : {}),
                ...(nullableText(priceDraft.product_url) !== (catalogItem.product_url ?? null)
                  ? { product_url: nullableText(priceDraft.product_url) } : {}),
              } : {}),
            },
          }),
        });
        toast.success({ title: "Offre fournisseur mise à jour." });
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
                    },
                  }),
              supplier_sku: nullableText(priceDraft.supplier_sku),
              product_url: nullableText(priceDraft.product_url),
              ...price,
            },
          }),
        });
        toast.success({ title: "Fournisseur et tarif ajoutés à l'article." });
      }

      handleClose();
      await onSaved();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Impossible d’enregistrer l’offre fournisseur.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSaving) handleClose();
      }}
    >
      <DialogContent
        size="xl"
        className="max-h-[min(94dvh,calc(100dvh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-5xl sm:p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-14 sm:px-6 sm:py-5">
          <DialogTitle>
            {isEditing
              ? "Modifier l’offre fournisseur"
              : "Ajouter un fournisseur / tarif"}
          </DialogTitle>
          <DialogDescription>
            L’article porte les caractéristiques communes ; la référence et l’URL appartiennent
            au fournisseur.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <DialogBody className="min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-5 sm:px-6">
            <section className="rounded-lg border border-border p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    1. Article commun
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Désignation et caractéristiques partagées par tous les
                    fournisseurs.
                  </p>
                </div>
                {!isEditing && !defaultProductId ? (
                  <Button
                    variant="outline"
                    size="md"
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
                      ? "Créer un nouvel article"
                      : "Choisir un article existant"}
                  </Button>
                ) : null}
              </div>

              {productMode === "existing" ? (
                <Field className="gap-1.5">
                  <FieldLabel
                    htmlFor="offer-product-id"
                    className="text-xs font-semibold text-foreground-secondary"
                  >
                    Article *
                  </FieldLabel>
                  <Combobox
                    id="offer-product-id"
                    value={priceDraft.product_id}
                    options={productOptions}
                    placeholder="Rechercher une désignation ou une référence…"
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
                    <p className="text-xs text-muted-foreground">
                      Article retenu : {selectedProductLabel}
                    </p>
                  ) : null}
                </Field>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <TextField
                    label="Référence interne"
                    value={productDraft.reference}
                    onChange={(value) => updateProduct("reference", value)}
                  />
                  <div className="md:col-span-2 lg:col-span-4">
                    <ProductReferenceSuggestion
                      enabled={open && productMode === "new"}
                      value={productDraft.reference}
                      onUse={(reference) => updateProduct("reference", reference)}
                    />
                  </div>
                  <TextField
                    className="lg:col-span-3"
                    label="Désignation *"
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
                    label="Matière"
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
                    label="Unité"
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
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    2. Fournisseur
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Un seul fournisseur et une seule référence pour cet article.
                  </p>
                </div>
                {!isEditing ? (
                  <Button
                    variant="outline"
                    size="md"
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
                      ? "Créer un nouveau fournisseur"
                      : "Choisir un fournisseur existant"}
                  </Button>
                ) : null}
              </div>

              {supplierMode === "existing" ? (
                <Field className="gap-1.5">
                  <FieldLabel
                    htmlFor="offer-supplier-id"
                    className="text-xs font-semibold text-foreground-secondary"
                  >
                    Fournisseur *
                  </FieldLabel>
                  <Combobox
                    id="offer-supplier-id"
                    value={priceDraft.supplier_id}
                    options={supplierOptions}
                    placeholder="Rechercher un fournisseur…"
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
                </Field>
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
                    label="Téléphone"
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
                  label="Référence fournisseur"
                  value={priceDraft.supplier_sku}
                  disabled={(!isEditing && Boolean(catalogItem)) || (isEditing && !catalogItem)}
                  onChange={(value) => updatePrice("supplier_sku", value)}
                />
                <TextField
                  label="URL fournisseur"
                  type="url"
                  value={priceDraft.product_url}
                  disabled={(!isEditing && Boolean(catalogItem)) || (isEditing && !catalogItem)}
                  onChange={(value) => updatePrice("product_url", value)}
                />
              </div>
              {isCatalogItemLoading ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Vérification de la fiche existante...
                </p>
              ) : null}
              {catalogItem ? (
                <p className="mt-2 rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-xs text-foreground">
                  {isEditing
                    ? "La référence fournisseur et l’URL sont partagées par les tarifs de cet article chez ce fournisseur. Seul le tarif ouvert est modifié."
                    : "La référence fournisseur et l’URL de la fiche existante seront réutilisées. Pour les changer, ouvrez une offre depuis la liste."}
                </p>
              ) : null}
            </section>

            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">
                3. Tarif
              </h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <TextField
                  label="Prix unitaire HT *"
                  value={priceDraft.unit_price_euros}
                  onChange={(value) => updatePrice("unit_price_euros", value)}
                />
                <SelectField
                  label="Unité"
                  value={priceDraft.unit}
                  onChange={(value) => updatePrice("unit", value)}
                />
                <TextField
                  label="Quantité minimale"
                  value={priceDraft.min_quantity}
                  onChange={(value) => updatePrice("min_quantity", value)}
                />
                {catalogItem ? (
                  <>
                    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
                      Unité du devis
                      <NativeSelect
                        value={priceDraft.estimate_unit_code}
                        onChange={(event) => updatePrice("estimate_unit_code", event.target.value)}
                      >
                        <option value="">Aucune conversion</option>
                        {MEASUREMENT_UNITS.filter((unit) => unit.active).map((unit) => (
                          <option key={unit.code} value={unit.code}>{unit.code} — {unit.label}</option>
                        ))}
                      </NativeSelect>
                    </label>
                    <TextField
                      label="Quantité par unité d'achat"
                      value={priceDraft.units_per_purchase_unit}
                      onChange={(value) => updatePrice("units_per_purchase_unit", value)}
                    />
                    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
                      {"Arrondi à l'unité d'achat"}
                      <NativeSelect
                        value={priceDraft.purchase_rounding}
                        onChange={(event) =>
                          updatePrice("purchase_rounding", event.target.value as PriceDraft["purchase_rounding"])
                        }
                      >
                        <option value="">—</option>
                        <option value="none">Quantité exacte</option>
                        <option value="ceil">Unités entières (arrondi supérieur)</option>
                      </NativeSelect>
                    </label>
                  </>
                ) : null}
                {catalogItem && parseEuroToCents(priceDraft.unit_price_euros) === 0 ? (
                  <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
                    Offre à 0 €
                    <NativeSelect
                      value={priceDraft.zero_price_kind}
                      onChange={(event) =>
                        updatePrice("zero_price_kind", event.target.value as PriceDraft["zero_price_kind"])
                      }
                    >
                      <option value="">Non marquée : exclue des prix</option>
                      <option value="included">Inclus</option>
                      <option value="free">Gratuit</option>
                    </NativeSelect>
                  </label>
                ) : null}
                <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
                  Devise
                  <NativeSelect
                    value={priceDraft.currency}
                    onChange={(event) =>
                      updatePrice("currency", event.target.value)
                    }
                  >
                    <option value="EUR">EUR - Euro</option>
                    <option value="USD">USD - Dollar US</option>
                    <option value="GBP">GBP - Livre sterling</option>
                  </NativeSelect>
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
                  min={priceDraft.valid_from || undefined}
                  max={priceDraft.valid_from ? maxPriceValidTo(priceDraft.valid_from) : undefined}
                  onChange={(value) => updatePrice("valid_to", value)}
                />
                <TextField
                  label="Source"
                  value={priceDraft.source}
                  onChange={(value) => updatePrice("source", value)}
                />
                {isEditing ? (
                  <div>
                    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
                      Transport
                      <NativeSelect
                        aria-label="Transport"
                        value={priceDraft.transport_mode}
                        disabled={!canEditTransport}
                        onChange={(event) =>
                          updatePrice("transport_mode", event.target.value as PriceDraft["transport_mode"])
                        }
                      >
                        <option value="">À préciser</option>
                        <option value="included">Inclus</option>
                        <option value="excluded">Exclu</option>
                      </NativeSelect>
                    </label>
                    {!canEditTransport ? <p className="mt-1 text-xs text-muted-foreground">
                      Un administrateur peut préciser les conditions de transport.
                    </p> : null}
                  </div>
                ) : null}
                <TextField
                  label="Notes"
                  value={priceDraft.notes}
                  onChange={(value) => updatePrice("notes", value)}
                />
              </div>
            </section>

            <p className="text-xs text-muted-foreground">
              Validité maximale : six mois à partir de la date de début. Une fin non renseignée est calculée automatiquement.
            </p>
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
          </DialogBody>

          <DialogFooter className="mt-0 shrink-0 border-t border-border px-5 py-4 sm:px-6">
            <Button variant="outline" size="lg" disabled={isSaving} onClick={handleClose}>
              Annuler
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={isCatalogItemLoading}
              loading={isSaving}
            >
              {isEditing ? "Enregistrer l’offre" : "Ajouter le fournisseur / tarif"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = "",
  type = "text",
  disabled = false,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
  min?: string;
  max?: string;
}) {
  return (
    <label
      className={`flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary ${className}`}
    >
      {label}
      <Input
        type={type}
        value={value}
        disabled={disabled}
        min={min}
        max={max}
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
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold text-foreground-secondary">
      {label}
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="u">Unité (u)</option>
        <option value="ml">Mètre linéaire (ml)</option>
        <option value="m2">Mètre carré (m²)</option>
        <option value="kg">Kilogramme (kg)</option>
        <option value="h">Heure (h)</option>
      </NativeSelect>
    </label>
  );
}
