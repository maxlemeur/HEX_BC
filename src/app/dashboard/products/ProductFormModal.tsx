"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangleIcon, ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { ProductAliases } from "@/components/products/ProductAliases";
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
import {
  missingProductValidationFields,
  productValidationMessage,
  type ProductCatalogueStatus,
  type ProductValidationField,
} from "@/lib/catalogue/product-validation";
import { parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A supply type of the tenant, as `/api/catalogue?view=page` lists them. */
export type ProductSupplyType = { id: string; code: string; name: string };

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
  catalogue_status?: ProductCatalogueStatus;
  supply_type_id?: string | null;
  reliability_score?: number | null;
  _supplyTypeName?: string | null;
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
  /** Left out when a draft has no unit yet: the stored value is kept instead of a made-up "u". */
  unit?: string;
  unit_price_cents: number;
  is_active: boolean;
  supply_type_id: string | null;
  /** Only ever "validated", and only from the draft form: the server stamps who validated and when. */
  catalogue_status?: Extract<ProductCatalogueStatus, "validated">;
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
  supply_type_id: string;
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
  /** Supply types of the tenant; the form can add one, since a tenant may have none. */
  supplyTypes?: readonly ProductSupplyType[];
  onSupplyTypeCreated?: (supplyType: ProductSupplyType) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ProductPayload) => Promise<void> | void;
};

const KNOWN_UNITS = ["u", "ml", "m2", "kg", "h"];

const DRAFT_STATUS_ID = "product-draft-status";

const VALIDATION_HINT_IDS: Record<ProductValidationField, string> = {
  product_type: "product-type-validation-hint",
  material: "product-material-validation-hint",
  unit: "product-unit-validation-hint",
  supply_type_id: "product-supply-type-validation-hint",
};

const MISSING_FOR_VALIDATION_CLASS = "border-warning-border bg-warning-light";

/** Says in words, not only in colour, that a field blocks the validation of a draft. */
function ValidationHint({ field }: Readonly<{ field: ProductValidationField }>) {
  return (
    <p
      id={VALIDATION_HINT_IDS[field]}
      className="flex items-center gap-1 text-xs font-medium text-warning"
    >
      <AlertTriangleIcon aria-hidden="true" className="size-3.5 shrink-0" />
      À renseigner pour valider l’article.
    </p>
  );
}

function describedBy(...ids: Array<string | false | null | undefined>) {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
}

function initialUnit(product: ProductRecord | null) {
  if (product?.unit?.trim()) return product.unit;
  // A draft without a unit must show it: validation needs one, and a default "u" would hide the gap.
  return product?.catalogue_status === "draft" ? "" : "u";
}

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
    unit: initialUnit(product),
    // A la creation le prix reste vide : il vaut 0 par defaut et sera de toute
    // facon remplace par le dernier achat confirme.
    unit_price_euros: product
      ? euroInputFromCents(product.unit_price_cents)
      : "",
    is_active: product?.is_active ?? true,
    supply_type_id: product?.supply_type_id ?? "",
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
  supplyTypes,
  onSupplyTypeCreated,
  onOpenChange,
  onSubmit,
}: Readonly<ProductFormModalProps>) {
  const [form, setForm] = useState<ProductFormState>(() =>
    initialFormState(product),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const isEditing = product !== null;
  const isDraft = product?.catalogue_status === "draft";
  // The article type lives in the technical details and a draft needs it: they start unfolded.
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(
    () => hasTechnicalDetails(product) || isDraft,
  );
  const [submitIntent, setSubmitIntent] = useState<"save" | "validate">("save");
  const [createdSupplyTypes, setCreatedSupplyTypes] = useState<ProductSupplyType[]>([]);
  const [isSupplyTypeCreationOpen, setIsSupplyTypeCreationOpen] = useState(false);
  const [newSupplyTypeName, setNewSupplyTypeName] = useState("");
  const [supplyTypeError, setSupplyTypeError] = useState<string | null>(null);
  const [isCreatingSupplyType, setIsCreatingSupplyType] = useState(false);
  const supplyTypeSelectRef = useRef<HTMLSelectElement>(null);

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

  const supplyTypeOptions = useMemo(() => {
    const byId = new Map<string, ProductSupplyType>();
    for (const supplyType of [...(supplyTypes ?? []), ...createdSupplyTypes]) {
      byId.set(supplyType.id, supplyType);
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "fr"));
  }, [createdSupplyTypes, supplyTypes]);

  // The rule of the server, applied to what is typed: only a draft is held back by it.
  const missingForValidation = useMemo(
    () =>
      isDraft
        ? missingProductValidationFields({
            product_type: form.product_type,
            material: form.material,
            unit: form.unit,
            supply_type_id: form.supply_type_id,
          })
        : [],
    [form.material, form.product_type, form.supply_type_id, form.unit, isDraft],
  );
  const blocksValidation = (field: ProductValidationField) => missingForValidation.includes(field);
  const canValidate = isDraft && missingForValidation.length === 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const wantsValidation =
      submitter instanceof HTMLButtonElement && submitter.value === "validate";
    if (wantsValidation && !canValidate) return;

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

    const unit = form.unit.trim();
    setSubmitIntent(wantsValidation ? "validate" : "save");

    await onSubmit({
      reference: nullableText(form.reference),
      designation,
      category: nullableText(form.category),
      product_type: nullableText(form.product_type),
      material: nullableText(form.material),
      grade: nullableText(form.grade),
      dimensions: nullableText(form.dimensions),
      standard: nullableText(form.standard),
      ...(unit || !isDraft ? { unit: unit || "u" } : {}),
      unit_price_cents: unitPriceCents,
      is_active: form.is_active,
      supply_type_id: form.supply_type_id || null,
      ...(wantsValidation ? { catalogue_status: "validated" as const } : {}),
    });
  }

  async function createSupplyType() {
    const name = newSupplyTypeName.trim();
    if (!name || isCreatingSupplyType) return;

    setIsCreatingSupplyType(true);
    setSupplyTypeError(null);
    try {
      const { item } = await fetchApi<{ item: ProductSupplyType }>("/api/catalogue/supply-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setCreatedSupplyTypes((current) => [...current, item]);
      setField("supply_type_id", item.id);
      setNewSupplyTypeName("");
      setIsSupplyTypeCreationOpen(false);
      onSupplyTypeCreated?.(item);
      supplyTypeSelectRef.current?.focus();
    } catch (error) {
      setSupplyTypeError(
        error instanceof Error ? error.message : "Création du type de fourniture impossible.",
      );
    } finally {
      setIsCreatingSupplyType(false);
    }
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
            {isDraft ? (
              <Alert variant="warning" id={DRAFT_STATUS_ID}>
                <p className="font-semibold">
                  Brouillon : cet article n’est pas proposé dans les chiffrages tant qu’il n’est pas validé.
                </p>
                <p className="mt-1">
                  {missingForValidation.length > 0
                    ? productValidationMessage(missingForValidation)
                    : "Le type d’article, la matière, l’unité et le type de fourniture sont renseignés : l’article peut être validé."}
                </p>
              </Alert>
            ) : null}

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
                    className={cn(blocksValidation("material") && MISSING_FOR_VALIDATION_CLASS)}
                    aria-describedby={describedBy(
                      blocksValidation("material") && VALIDATION_HINT_IDS.material,
                    )}
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
                  {blocksValidation("material") ? <ValidationHint field="material" /> : null}
                </div>

                <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
                  <FieldLabel htmlFor="product-supply-type">Type de fourniture</FieldLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <NativeSelect
                      ref={supplyTypeSelectRef}
                      id="product-supply-type"
                      wrapperClassName="sm:flex-1"
                      className={cn(
                        blocksValidation("supply_type_id") && MISSING_FOR_VALIDATION_CLASS,
                      )}
                      aria-describedby={describedBy(
                        supplyTypeOptions.length === 0 && "product-supply-type-empty-hint",
                        blocksValidation("supply_type_id") && VALIDATION_HINT_IDS.supply_type_id,
                      )}
                      value={form.supply_type_id}
                      onChange={(event) => setField("supply_type_id", event.target.value)}
                    >
                      <option value="">Non classé</option>
                      {supplyTypeOptions.map((supplyType) => (
                        <option key={supplyType.id} value={supplyType.id}>
                          {supplyType.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="shrink-0"
                      leftIcon={<PlusIcon aria-hidden="true" />}
                      aria-expanded={isSupplyTypeCreationOpen}
                      aria-controls="product-supply-type-creation"
                      onClick={() => {
                        setSupplyTypeError(null);
                        setIsSupplyTypeCreationOpen((current) => !current);
                      }}
                    >
                      Nouveau type
                    </Button>
                  </div>
                  {supplyTypeOptions.length === 0 ? (
                    <FieldDescription id="product-supply-type-empty-hint" className="text-xs">
                      Aucun type de fourniture n’existe encore. Créez-en un avec « Nouveau type ».
                    </FieldDescription>
                  ) : null}
                  {blocksValidation("supply_type_id") ? (
                    <ValidationHint field="supply_type_id" />
                  ) : null}
                  {isSupplyTypeCreationOpen ? (
                    <div
                      id="product-supply-type-creation"
                      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-3"
                    >
                      <FieldLabel htmlFor="product-new-supply-type">
                        Nom du nouveau type de fourniture
                      </FieldLabel>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="product-new-supply-type"
                          autoFocus
                          autoComplete="off"
                          maxLength={80}
                          placeholder="Ex. Tuyauterie inox"
                          aria-invalid={supplyTypeError ? true : undefined}
                          aria-describedby={describedBy(
                            supplyTypeError && "product-new-supply-type-error",
                          )}
                          value={newSupplyTypeName}
                          onChange={(event) => setNewSupplyTypeName(event.target.value)}
                          onKeyDown={(event) => {
                            // Enter creates the type; it must never submit the article form around it.
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            void createSupplyType();
                          }}
                        />
                        <Button
                          type="button"
                          size="lg"
                          className="shrink-0"
                          loading={isCreatingSupplyType}
                          disabled={newSupplyTypeName.trim().length === 0}
                          onClick={() => void createSupplyType()}
                        >
                          Créer
                        </Button>
                      </div>
                      {supplyTypeError ? (
                        <p
                          id="product-new-supply-type-error"
                          role="alert"
                          className="text-xs font-medium text-danger"
                        >
                          {supplyTypeError}
                        </p>
                      ) : null}
                    </div>
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
                    className={cn(blocksValidation("unit") && MISSING_FOR_VALIDATION_CLASS)}
                    aria-describedby={describedBy(
                      blocksValidation("unit") && VALIDATION_HINT_IDS.unit,
                    )}
                    value={form.unit}
                    onChange={(event) => setField("unit", event.target.value)}
                  >
                    {isDraft ? <option value="">À renseigner</option> : null}
                    <option value="u">Unité (u)</option>
                    <option value="ml">Mètre linéaire (ml)</option>
                    <option value="m2">Mètre carré (m²)</option>
                    <option value="kg">Kilogramme (kg)</option>
                    <option value="h">Heure (h)</option>
                    {/* An imported unit outside the usual list is shown as it is, not as the first option. */}
                    {form.unit && !KNOWN_UNITS.includes(form.unit) ? (
                      <option value={form.unit}>{form.unit}</option>
                    ) : null}
                  </NativeSelect>
                  {blocksValidation("unit") ? <ValidationHint field="unit" /> : null}
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
                    className={cn(blocksValidation("product_type") && MISSING_FOR_VALIDATION_CLASS)}
                    aria-describedby={describedBy(
                      blocksValidation("product_type") && VALIDATION_HINT_IDS.product_type,
                    )}
                    value={form.product_type}
                    onChange={(event) => setField("product_type", event.target.value)}
                  />
                  {blocksValidation("product_type") ? <ValidationHint field="product_type" /> : null}
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

            {product ? <ProductAliases productId={product.id} /> : null}

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
            {isDraft ? (
              <>
                {/* First submit button of the form: Enter in a field saves the draft, it never validates. */}
                <Button
                  type="submit"
                  variant="outline"
                  size="lg"
                  disabled={isSaving}
                  loading={isSaving && submitIntent === "save"}
                >
                  Enregistrer
                </Button>
                {/* Stays focusable when disabled, so the reason (the draft notice) can be read. */}
                <Button
                  type="submit"
                  name="intent"
                  value="validate"
                  size="lg"
                  focusableWhenDisabled
                  disabled={!canValidate || isSaving}
                  loading={isSaving && submitIntent === "validate"}
                  aria-describedby={canValidate ? undefined : DRAFT_STATUS_ID}
                >
                  Enregistrer et valider
                </Button>
              </>
            ) : (
              <Button type="submit" size="lg" loading={isSaving}>
                {isEditing ? "Enregistrer" : "Ajouter le produit"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
