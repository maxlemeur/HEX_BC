"use client";

import { useMemo, useState } from "react";

import { Modal } from "@/components/ui/Modal";
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
  tax_rate_bp: number;
  is_active: boolean;
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
  tax_rate_bp: number;
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
  tax_rate_bp: number;
  is_active: boolean;
};

type ProductFormModalProps = {
  open: boolean;
  product: ProductRecord | null;
  isSaving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ProductPayload) => Promise<void> | void;
};

const TAX_RATE_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "5,5 %", value: 550 },
  { label: "10 %", value: 1000 },
  { label: "20 %", value: 2000 },
] as const;

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
    unit_price_euros: euroInputFromCents(product?.unit_price_cents ?? 0),
    tax_rate_bp: product?.tax_rate_bp ?? 2000,
    is_active: product?.is_active ?? true,
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ProductFormModal({
  open,
  product,
  isSaving,
  error,
  onOpenChange,
  onSubmit,
}: Readonly<ProductFormModalProps>) {
  const [form, setForm] = useState<ProductFormState>(() => initialFormState(product));
  const [localError, setLocalError] = useState<string | null>(null);
  const isEditing = product !== null;

  const title = useMemo(
    () => (isEditing ? "Modifier le produit" : "Ajouter un produit"),
    [isEditing]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const designation = form.designation.trim();
    if (!designation) {
      setLocalError("La désignation est obligatoire.");
      return;
    }

    const unitPriceCents = parseEuroToCents(form.unit_price_euros);
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
      tax_rate_bp: form.tax_rate_bp,
      is_active: form.is_active,
    });
  }

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        className="max-h-[92vh] max-w-4xl overflow-hidden p-0"
        closeOnEscapeKey={!isSaving}
        closeOnOverlayClick={!isSaving}
      >
        <div className="border-b border-[var(--slate-200)] px-6 py-5">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>{title}</Modal.Title>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                Identifiez précisément l’article, son unité et son prix interne de référence.
              </p>
            </div>
            <Modal.Close disabled={isSaving} aria-label="Fermer le formulaire produit">
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
                <label className="form-label" htmlFor="product-reference">Référence</label>
                <input
                  id="product-reference"
                  className="form-input"
                  autoComplete="off"
                  placeholder="Ex. Tub.I4S.50"
                  value={form.reference}
                  onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-designation">Désignation *</label>
                <input
                  id="product-designation"
                  className="form-input"
                  autoComplete="off"
                  placeholder="Ex. Tube inox 304L DN50"
                  required
                  value={form.designation}
                  onChange={(event) => setForm((current) => ({ ...current, designation: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-category">Famille</label>
                <input
                  id="product-category"
                  className="form-input"
                  placeholder="Ex. Tuyauterie"
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-type">Type d’article</label>
                <input
                  id="product-type"
                  className="form-input"
                  placeholder="Ex. Tube, coude, té"
                  value={form.product_type}
                  onChange={(event) => setForm((current) => ({ ...current, product_type: event.target.value }))}
                />
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <legend className="col-span-full mb-1 text-sm font-semibold text-[var(--slate-800)]">
                Caractéristiques métier
              </legend>

              <div>
                <label className="form-label" htmlFor="product-material">Matière</label>
                <input
                  id="product-material"
                  className="form-input"
                  placeholder="Ex. Inox"
                  value={form.material}
                  onChange={(event) => setForm((current) => ({ ...current, material: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-grade">Nuance</label>
                <input
                  id="product-grade"
                  className="form-input"
                  placeholder="Ex. 304L"
                  value={form.grade}
                  onChange={(event) => setForm((current) => ({ ...current, grade: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-dimensions">Dimensions</label>
                <input
                  id="product-dimensions"
                  className="form-input"
                  placeholder="Ex. DN50 · 60,3 × 2"
                  value={form.dimensions}
                  onChange={(event) => setForm((current) => ({ ...current, dimensions: event.target.value }))}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="product-standard">Norme</label>
                <input
                  id="product-standard"
                  className="form-input"
                  placeholder="Ex. EN 10217-7"
                  value={form.standard}
                  onChange={(event) => setForm((current) => ({ ...current, standard: event.target.value }))}
                />
              </div>
            </fieldset>

            <fieldset className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <legend className="col-span-full mb-1 text-sm font-semibold text-[var(--slate-800)]">
                Unité et prix de référence
              </legend>

              <div>
                <label className="form-label" htmlFor="product-unit">Unité *</label>
                <select
                  id="product-unit"
                  className="form-input form-select"
                  value={form.unit}
                  onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
                >
                  <option value="u">Unité (u)</option>
                  <option value="ml">Mètre linéaire (ml)</option>
                  <option value="m2">Mètre carré (m²)</option>
                  <option value="kg">Kilogramme (kg)</option>
                  <option value="h">Heure (h)</option>
                </select>
              </div>

              <div className="sm:col-span-1 lg:col-span-2">
                <label className="form-label" htmlFor="product-price">Prix de référence HT *</label>
                <div className="relative">
                  <input
                    id="product-price"
                    className="form-input pr-12"
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    value={form.unit_price_euros}
                    onChange={(event) => setForm((current) => ({ ...current, unit_price_euros: event.target.value }))}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[var(--slate-400)]">
                    EUR
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Valeur interne utilisée par défaut avant comparaison des fournisseurs.
                </p>
              </div>

              <div>
                <label className="form-label" htmlFor="product-tax">TVA</label>
                <select
                  id="product-tax"
                  className="form-input form-select"
                  value={form.tax_rate_bp}
                  onChange={(event) => setForm((current) => ({ ...current, tax_rate_bp: Number(event.target.value) }))}
                >
                  {TAX_RATE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </fieldset>

            {isEditing ? (
              <label className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3 text-sm text-[var(--slate-700)]">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                />
                Produit actif et proposé dans les recherches et chiffrages
              </label>
            ) : null}

            {localError || error ? (
              <div className="alert alert-error mt-5" role="alert">{localError ?? error}</div>
            ) : null}
          </Modal.Body>

          <Modal.Footer className="mt-0 border-t border-[var(--slate-200)] px-6 py-4">
            <Modal.Close className="btn btn-secondary" disabled={isSaving}>Annuler</Modal.Close>
            <button className="btn btn-primary" type="submit" disabled={isSaving}>
              {isSaving ? "Enregistrement..." : isEditing ? "Enregistrer" : "Ajouter le produit"}
            </button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
