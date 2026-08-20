"use client";

import { useMemo, useState } from "react";

import { Modal } from "@/components/ui-legacy/Modal";
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
  /** Familles dÃ©jÃ  utilisÃ©es dans le rÃ©fÃ©rentiel, proposÃ©es en autocomplÃ©tion. */
  categorySuggestions?: readonly string[];
  /** MatiÃ¨res dÃ©jÃ  utilisÃ©es dans le rÃ©fÃ©rentiel, proposÃ©es en autocomplÃ©tion. */
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
      setLocalError("La dÃ©signation est obligatoire.");
      return;
    }

    const rawPrice = form.unit_price_euros.trim();
    const unitPriceCents =
      rawPrice.length === 0 ? 0 : parseEuroToCents(rawPrice);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setLocalError("Le prix de rÃ©fÃ©rence doit Ãªtre un montant positif ou nul.");
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

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        className="max-h-[92vh] max-w-3xl overflow-hidden p-0"
        closeOnEscapeKey={!isSaving}
        closeOnOverlayClick={!isSaving}
      >
        <div className="border-b border-[var(--slate-200)] px-6 py-5">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>{title}</Modal.Title>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                Une dÃ©signation suffit pour crÃ©er lâ€™article. Tout le reste peut
                Ãªtre complÃ©tÃ© plus tard.
              </p>
            </div>
            <Modal.Close
              disabled={isSaving}
              aria-label="Fermer le formulaire produit"
            >
              Fermer
            </Modal.Close>
          </Modal.Header>
        </div>

        <form onSubmit={handleSubmit}>
          <Modal.Body className="max-h-[calc(92vh-10rem)] overflow-y-auto px-6 py-5">
            <fieldset className="grid gap-4 md:grid-cols-2">
              <legend className="col-span-full mb-1 text-sm font-semibold text-[var(--slate-800)]">
                Identification
              </legend>

              <div>
                <label className="form-label" htmlFor="product-reference">
                  RÃ©fÃ©rence
                </label>
                <input
                  id="product-reference"
                  className="form-input"
                  autoComplete="off"
                  placeholder="Ex. Tub.I4S.50"
                  value={form.reference}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reference: event.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Sert au rapprochement automatique avec les DPGF et les imports
                  fournisseurs.
                </p>
              </div>

              <div>
                <label className="form-label" htmlFor="product-designation">
                  DÃ©signation *
                </label>
                <input
                  id="product-designation"
                  className="form-input"
                  autoComplete="off"
                  placeholder="Ex. Tube inox 304L DN50"
                  required
                  value={form.designation}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      designation: event.target.value,
                    }))
                  }
                />
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="col-span-full mb-1 text-sm font-semibold text-[var(--slate-800)]">
                Classement
              </legend>
              <p className="col-span-full -mt-1 mb-1 text-xs text-[var(--slate-500)]">
                Ces trois champs pilotent les filtres du rÃ©fÃ©rentiel.
              </p>

              <div>
                <label className="form-label" htmlFor="product-category">
                  Famille
                </label>
                <input
                  id="product-category"
                  className="form-input"
                  list={
                    categoryOptions.length > 0
                      ? "product-category-options"
                      : undefined
                  }
                  placeholder="Ex. Tuyauterie"
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                />
                {categoryOptions.length > 0 ? (
                  <datalist id="product-category-options">
                    {categoryOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                ) : null}
              </div>

              <div>
                <label className="form-label" htmlFor="product-material">
                  MatiÃ¨re
                </label>
                <input
                  id="product-material"
                  className="form-input"
                  list={
                    materialOptions.length > 0
                      ? "product-material-options"
                      : undefined
                  }
                  placeholder="Ex. Inox"
                  value={form.material}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      material: event.target.value,
                    }))
                  }
                />
                {materialOptions.length > 0 ? (
                  <datalist id="product-material-options">
                    {materialOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                ) : null}
              </div>

              <div>
                <label className="form-label" htmlFor="product-unit">
                  UnitÃ©
                </label>
                <select
                  id="product-unit"
                  className="form-input form-select"
                  value={form.unit}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      unit: event.target.value,
                    }))
                  }
                >
                  <option value="u">UnitÃ© (u)</option>
                  <option value="ml">MÃ¨tre linÃ©aire (ml)</option>
                  <option value="m2">MÃ¨tre carrÃ© (mÂ²)</option>
                  <option value="kg">Kilogramme (kg)</option>
                  <option value="h">Heure (h)</option>
                </select>
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-1 text-sm font-semibold text-[var(--slate-800)]">
                Prix de rÃ©fÃ©rence
              </legend>

              <div className="sm:max-w-sm">
                <label className="form-label" htmlFor="product-price">
                  Prix de rÃ©fÃ©rence HT
                </label>
                <div className="relative">
                  <input
                    id="product-price"
                    className="form-input pr-12"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.unit_price_euros}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        unit_price_euros: event.target.value,
                      }))
                    }
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[var(--slate-400)]">
                    EUR
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  {product?._referencePriceSourceOrderId
                    ? "Ce montant vient du dernier achat confirmÃ©. Le modifier le remplace par une saisie interne."
                    : "Laissez vide si vous ne le connaissez pas : le dernier achat confirmÃ© prendra le relais."}
                </p>
              </div>
            </fieldset>

            <details
              className="group mt-6 overflow-hidden rounded-xl border border-[var(--slate-200)]"
              open={showTechnicalDetails}
              onToggle={(event) =>
                setShowTechnicalDetails(event.currentTarget.open)
              }
            >
              <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-[var(--slate-50)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)] [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--slate-800)]">
                    DÃ©tails techniques (optionnel)
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--slate-500)]">
                    AmÃ©liorent la recherche et les suggestions de tarifs.
                  </span>
                </span>
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--slate-500)] transition-transform duration-200 group-open:rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>

              <div className="grid gap-4 border-t border-[var(--slate-200)] px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="form-label" htmlFor="product-type">
                    Type dâ€™article
                  </label>
                  <input
                    id="product-type"
                    className="form-input"
                    placeholder="Ex. Tube, coude, tÃ©"
                    value={form.product_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        product_type: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="product-grade">
                    Nuance
                  </label>
                  <input
                    id="product-grade"
                    className="form-input"
                    placeholder="Ex. 304L"
                    value={form.grade}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        grade: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="product-dimensions">
                    Dimensions
                  </label>
                  <input
                    id="product-dimensions"
                    className="form-input"
                    placeholder="Ex. DN50 Â· 60,3 Ã— 2"
                    value={form.dimensions}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dimensions: event.target.value,
                      }))
                    }
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="product-standard">
                    Norme
                  </label>
                  <input
                    id="product-standard"
                    className="form-input"
                    placeholder="Ex. EN 10217-7"
                    value={form.standard}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        standard: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </details>

            {isEditing ? (
              <label className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-sm text-[var(--slate-700)]">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                Produit actif et proposÃ© dans les recherches et chiffrages
              </label>
            ) : null}

            {localError || error ? (
              <div className="alert alert-error mt-5" role="alert">
                {localError ?? error}
              </div>
            ) : null}
          </Modal.Body>

          <Modal.Footer className="mt-0 border-t border-[var(--slate-200)] px-6 py-4">
            <Modal.Close className="btn btn-secondary" disabled={isSaving}>
              Annuler
            </Modal.Close>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving
                ? "Enregistrement..."
                : isEditing
                  ? "Enregistrer"
                  : "Ajouter le produit"}
            </button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
