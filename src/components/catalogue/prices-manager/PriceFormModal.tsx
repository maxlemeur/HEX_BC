"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierPrice } from "@/components/catalogue/types";
import type { EnrichedPrice, SupplierPriceFormState } from "@/components/catalogue/prices-manager/types";
import { EMPTY_FORM, toEuroInput } from "@/components/catalogue/prices-manager/utils";
import { Modal } from "@/components/ui-legacy/Modal";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui-legacy/SearchableSelect";
import { useToast } from "@/components/ui-legacy/Toast";
import { parseEuroToCents } from "@/lib/money";

type PriceFormModalProps = {
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

function toFormState(
  item: EnrichedPrice | null,
  defaultProductId: string | null
): SupplierPriceFormState {
  if (!item) {
    return { ...EMPTY_FORM, product_id: defaultProductId ?? "" };
  }

  return {
    supplier_id: item.supplier_id ?? "",
    product_id: item.product_id ?? item.catalogue_item_id ?? "",
    unit_price_euros: toEuroInput(item.unit_price_cents),
    currency: item.currency ?? "EUR",
    valid_from: item.valid_from ?? "",
    valid_to: item.valid_to ?? "",
    source: item.source ?? "",
    notes: item.notes ?? "",
  };
}

export function PriceFormModal({
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
}: Readonly<PriceFormModalProps>) {
  const toast = useToast();
  const [formState, setFormState] = useState<SupplierPriceFormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const editingId = item?.id ?? null;
  const isEditing = editingId !== null;

  useEffect(() => {
    if (!open) {
      setFormState(EMPTY_FORM);
      setIsSaving(false);
      setFormError(null);
      return;
    }

    setFormState(toFormState(item, defaultProductId));
    setIsSaving(false);
    setFormError(null);
  }, [defaultProductId, item, open]);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  const title = useMemo(
    () => (isEditing ? "Modifier un prix fournisseur" : "Ajouter un prix fournisseur"),
    [isEditing]
  );

  const description = useMemo(
    () =>
      isEditing
        ? "Mettez à jour les informations du prix fournisseur."
        : "Renseignez les informations du nouveau prix.",
    [isEditing]
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitPriceCents = parseEuroToCents(formState.unit_price_euros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setFormError("Prix unitaire invalide.");
      return;
    }

    if (!formState.supplier_id.trim() || !formState.product_id.trim()) {
      setFormError("Le fournisseur et le produit sont requis.");
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      const payload = {
        supplier_id: formState.supplier_id.trim(),
        product_id: formState.product_id.trim(),
        unit_price_cents: unitPriceCents,
        currency: formState.currency.trim().toUpperCase() || "EUR",
        valid_from: formState.valid_from || null,
        valid_to: formState.valid_to || null,
        source: formState.source.trim() || null,
        notes: formState.notes.trim() || null,
      };

      if (editingId) {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", id: editingId, item: payload }),
        });
        toast.success({ title: "Prix fournisseur mis à jour." });
      } else {
        await fetchApi<{ item: SupplierPrice }>("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", item: payload }),
        });
        toast.success({ title: "Prix fournisseur créé." });
      }

      handleClose();
      await onSaved();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer le prix fournisseur."
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <Modal.Content className="max-w-4xl">
        <Modal.Header>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-blue)]/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--brand-blue)"
                strokeWidth="1.75"
              >
                {isEditing ? (
                  <>
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </>
                ) : (
                  <>
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </>
                )}
              </svg>
            </div>
            <div>
              <Modal.Title>{title}</Modal.Title>
              <p className="text-sm text-[var(--slate-500)]">{description}</p>
            </div>
          </div>
        </Modal.Header>

        <form className="grid gap-5 sm:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="form-label" htmlFor="price-supplier-id">Fournisseur *</label>
            <SearchableSelect
              id="price-supplier-id"
              value={formState.supplier_id}
              options={supplierOptions}
              placeholder="Rechercher un fournisseur..."
              isLoading={isSupplierLoading}
              onQueryChange={onSupplierQueryChange}
              required
              onValueChange={(value) =>
                setFormState((previous) => ({ ...previous, supplier_id: value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-product-id">Produit *</label>
            <SearchableSelect
              id="price-product-id"
              value={formState.product_id}
              options={productOptions}
              placeholder="Rechercher un produit..."
              isLoading={isProductLoading}
              onQueryChange={onProductQueryChange}
              required
              onValueChange={(value) =>
                setFormState((previous) => ({ ...previous, product_id: value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-unit-price">Prix unitaire HT *</label>
            <div className="relative">
              <input
                id="price-unit-price"
                className="form-input pr-12"
                inputMode="decimal"
                value={formState.unit_price_euros}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    unit_price_euros: event.target.value,
                  }))
                }
                placeholder="0,00"
                required
              />
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-[var(--slate-400)]"
                aria-hidden="true"
              >
                EUR
              </span>
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="price-currency">Devise</label>
            <select
              id="price-currency"
              className="form-input form-select"
              value={formState.currency}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, currency: event.target.value }))
              }
            >
              <option value="EUR">EUR - Euro</option>
              <option value="USD">USD - Dollar US</option>
              <option value="GBP">GBP - Livre sterling</option>
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="price-valid-from">Valide du</label>
            <input
              id="price-valid-from"
              type="date"
              className="form-input"
              value={formState.valid_from}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, valid_from: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-valid-to">Valide au</label>
            <input
              id="price-valid-to"
              type="date"
              className="form-input"
              value={formState.valid_to}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, valid_to: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-source">Source</label>
            <input
              id="price-source"
              className="form-input"
              value={formState.source}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, source: event.target.value }))
              }
              placeholder="ex: Devis, Catalogue, Site web..."
            />
          </div>

          <div>
            <label className="form-label" htmlFor="price-notes">Notes</label>
            <input
              id="price-notes"
              className="form-input"
              value={formState.notes}
              onChange={(event) =>
                setFormState((previous) => ({ ...previous, notes: event.target.value }))
              }
            />
          </div>

          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 pt-2">
            {formError ? (
              <div className="alert alert-error flex-1">
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
                {formError}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              <button
                className="btn btn-secondary"
                onClick={handleClose}
                type="button"
                disabled={isSaving}
              >
                Annuler
              </button>
              <button className="btn btn-primary" disabled={isSaving} type="submit">
                {isSaving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    Enregistrement...
                  </>
                ) : isEditing ? (
                  "Mettre à jour"
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
                    Ajouter
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
