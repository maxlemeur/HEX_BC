"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";

import { ProductReferenceSuggestion } from "@/components/products/ProductReferenceSuggestion";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { parseEuroToCents } from "@/lib/money";

export type ProductRecord = {
  id: string;
  created_at: string;
  updated_at?: string | null;
  reference: string | null;
  designation: string;
  category?: string | null;
  product_type?: string | null;
  material?: string | null;
  grade?: string | null;
  dimensions?: string | null;
  standard?: string | null;
  unit?: string | null;
  unit_price_cents: number;
  reference_quantity?: number | null;
  reference_transport_mode?: string | null;
  reference_price_validation_id?: string | null;
  is_active: boolean;
  _referencePriceSourceOrderId?: string | null;
  _referencePriceSourceOrderReference?: string | null;
  _referencePriceSourceSupplierName?: string | null;
  _referencePriceSourceDate?: string | null;
};

export type ProductPayload = {
  reference: string | null;
  designation: string;
  category: string | null;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  unit: string;
  unit_price_cents: number;
  is_active: boolean;
};

type ProductFormState = {
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
  is_active: boolean;
};

type ProductFormModalProps = {
  open: boolean;
  product: ProductRecord | null;
  isSaving: boolean;
  error: string | null;
  /** Familles déjà utilisées dans le référentiel, proposées en autocomplétion. */
  categorySuggestions?: readonly string[];
  /** Matières déjà utilisées dans le référentiel, proposées en autocomplétion. */
  materialSuggestions?: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ProductPayload) => Promise<void> | void;
};

function euroInputFromCents(value: number) {
  return (value / 100).toFixed(2).replace(".", ",");
}

function initialFormState(product: ProductRecord | null): ProductFormState {
  return {
    reference: product?.reference ?? "",
    designation: product?.designation ?? "",
    category: product?.category ?? "",
    product_type: product?.product_type ?? "",
    material: product?.material ?? "",
    grade: product?.grade ?? "",
    dimensions: product?.dimensions ?? "",
    standard: product?.standard ?? "",
    unit: product?.unit ?? "u",
    // A la creation le prix reste vide : il vaut 0 par defaut et sera de toute
    // facon remplace par le dernier achat confirme.
    unit_price_euros: product
      ? euroInputFromCents(product.unit_price_cents)
      : "",
    is_active: product?.is_active ?? true,
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Les details techniques restent deplies si le produit en porte deja. */
function hasTechnicalDetails(product: ProductRecord | null) {
  if (!product) return false;
  return Boolean(
    product.product_type ||
      product.grade ||
      product.dimensions ||
      product.standard,
  );
}

function normalizeSuggestions(values: readonly string[] | undefined) {
  return (values ?? []).filter((value) => value.trim().length > 0);
}

export function ProductFormModal({
  open,
  product,
  isSaving,
  error,
  categorySuggestions,
  materialSuggestions,
  onOpenChange,
  onSubmit,
}: Readonly<ProductFormModalProps>) {
  const [form, setForm] = useState<ProductFormState>(() =>
    initialFormState(product),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(() =>
    hasTechnicalDetails(product),
  );
  const isEditing = product !== null;

  const title = useMemo(
    () => (isEditing ? "Modifier le produit" : "Ajouter un produit"),
    [isEditing],
  );

  const categoryOptions = useMemo(
    () => normalizeSuggestions(categorySuggestions),
    [categorySuggestions],
  );
  const materialOptions = useMemo(
    () => normalizeSuggestions(materialSuggestions),
    [materialSuggestions],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const designation = form.designation.trim();
    if (!designation) {
      setLocalError("La désignation est obligatoire.");
      return;
    }

    const rawPrice = form.unit_price_euros.trim();
    const unitPriceCents =
      rawPrice.length === 0 ? 0 : parseEuroToCents(rawPrice);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setLocalError("Le prix de référence doit être un montant positif ou nul.");
      return;
    }

    await onSubmit({
      reference: nullableText(form.reference),
      designation,
      category: nullableText(form.category),
      product_type: nullableText(form.product_type),
      material: nullableText(form.material),
      grade: nullableText(form.grade),
      dimensions: nullableText(form.dimensions),
      standard: nullableText(form.standard),
      unit: form.unit.trim() || "u",
      unit_price_cents: unitPriceCents,
      is_active: form.is_active,
    });
  }

  function setField<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog disablePointerDismissal open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" showCloseButton={false} className="gap-0 p-0 sm:p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
          <DialogHeader className="pr-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Une désignation suffit pour créer l’article. Tout le reste peut être complété plus tard.
            </DialogDescription>
          </DialogHeader>
          <DialogClose
            disabled={isSaving}
            aria-label="Fermer le formulaire produit"
            render={<Button variant="ghost" size="icon-sm" className="shrink-0" />}
          >
            <XIcon aria-hidden="true" />
          </DialogClose>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="min-h-0 flex-1 gap-6 overflow-y-auto px-5 py-5 sm:px-6">
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">Identification</legend>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-reference">Référence</FieldLabel>
                  <Input
                    id="product-reference"
                    autoComplete="off"
                    placeholder="Ex. Tub.I4S.50"
                    aria-describedby="product-reference-hint"
                    value={form.reference}
                    onChange={(event) => setField("reference", event.target.value)}
                  />
                  <FieldDescription id="product-reference-hint" className="text-xs">
                    Référence interne de l’article, distincte des références fournisseur.
                  </FieldDescription>
                  <ProductReferenceSuggestion
                    enabled={open && !isEditing}
                    value={form.reference}
                    onUse={(reference) => setField("reference", reference)}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-designation">Désignation *</FieldLabel>
                  <Input
                    id="product-designation"
                    autoComplete="off"
                    placeholder="Ex. Tube inox 304L DN50"
                    required
                    value={form.designation}
                    onChange={(event) => setField("designation", event.target.value)}
                  />
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-foreground">Classement</legend>
              <p className="mt-1 text-xs text-muted-foreground">
                Ces deux champs pilotent les filtres du référentiel.
              </p>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-category">Famille</FieldLabel>
                  <Input
                    id="product-category"
                    list={categoryOptions.length > 0 ? "product-category-options" : undefined}
                    placeholder="Ex. Tuyauterie"
                    value={form.category}
                    onChange={(event) => setField("category", event.target.value)}
                  />
                  {categoryOptions.length > 0 ? (
                    <datalist id="product-category-options">
                      {categoryOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-material">Matière</FieldLabel>
                  <Input
                    id="product-material"
                    list={materialOptions.length > 0 ? "product-material-options" : undefined}
                    placeholder="Ex. Inox"
                    value={form.material}
                    onChange={(event) => setField("material", event.target.value)}
                  />
                  {materialOptions.length > 0 ? (
                    <datalist id="product-material-options">
                      {materialOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-foreground">
                Unité et prix de référence
              </legend>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-unit">Unité</FieldLabel>
                  <NativeSelect
                    id="product-unit"
                    value={form.unit}
                    onChange={(event) => setField("unit", event.target.value)}
                  >
                    <option value="u">Unité (u)</option>
                    <option value="ml">Mètre linéaire (ml)</option>
                    <option value="m2">Mètre carré (m²)</option>
                    <option value="kg">Kilogramme (kg)</option>
                    <option value="h">Heure (h)</option>
                  </NativeSelect>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-price">Prix de référence HT</FieldLabel>
                  <div className="relative">
                    <Input
                      id="product-price"
                      className="pr-12"
                      readOnly={isEditing}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-describedby="product-price-hint"
                      value={form.unit_price_euros}
                      onChange={(event) => setField("unit_price_euros", event.target.value)}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-subtle-foreground"
                    >
                      EUR
                    </span>
                  </div>
                  <FieldDescription id="product-price-hint" className="text-xs">
                    {isEditing
                      ? "Utilisez « Examiner le prix » dans le catalogue pour valider une moyenne fournisseur ou justifier un autre prix."
                      : "Prix initial facultatif. Les offres fournisseurs permettront ensuite de proposer une référence à valider."}
                  </FieldDescription>
                </div>
              </div>
            </fieldset>

            <details
              className="group border-t border-border pt-4"
              open={showTechnicalDetails}
              onToggle={(event) => setShowTechnicalDetails(event.currentTarget.open)}
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    Détails techniques (optionnel)
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Améliorent la recherche et les suggestions de tarifs.
                  </span>
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-type">Type d’article</FieldLabel>
                  <Input
                    id="product-type"
                    placeholder="Ex. Tube, coude, té"
                    value={form.product_type}
                    onChange={(event) => setField("product_type", event.target.value)}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-grade">Nuance</FieldLabel>
                  <Input
                    id="product-grade"
                    placeholder="Ex. 304L"
                    value={form.grade}
                    onChange={(event) => setField("grade", event.target.value)}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-dimensions">Dimensions</FieldLabel>
                  <Input
                    id="product-dimensions"
                    placeholder="Ex. DN50 · 60,3 × 2"
                    value={form.dimensions}
                    onChange={(event) => setField("dimensions", event.target.value)}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <FieldLabel htmlFor="product-standard">Norme</FieldLabel>
                  <Input
                    id="product-standard"
                    placeholder="Ex. EN 10217-7"
                    value={form.standard}
                    onChange={(event) => setField("standard", event.target.value)}
                  />
                </div>
              </div>
            </details>

            {isEditing ? (
              <label className="flex items-center gap-3 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={form.is_active}
                  onChange={(event) => setField("is_active", event.target.checked)}
                />
                Produit actif et proposé dans les recherches et chiffrages
              </label>
            ) : null}

            {localError || error ? <Alert variant="danger">{localError ?? error}</Alert> : null}
          </DialogBody>

          <DialogFooter className="mt-0 border-t border-border px-5 py-4 sm:px-6">
            <DialogClose
              disabled={isSaving}
              render={<Button variant="outline" size="lg" />}
            >
              Annuler
            </DialogClose>
            <Button type="submit" size="lg" loading={isSaving}>
              {isEditing ? "Enregistrer" : "Ajouter le produit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
