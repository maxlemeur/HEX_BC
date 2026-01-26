"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type SupplierCreateResult = {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
};

type SupplierFormState = {
  name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  contact_name: string;
  siret: string;
  vat_number: string;
  payment_terms: string;
};

type SupplierCreateModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (supplier: SupplierCreateResult) => void;
};

const EMPTY_FORM: SupplierFormState = {
  name: "",
  address: "",
  city: "",
  postal_code: "",
  country: "France",
  email: "",
  phone: "",
  contact_name: "",
  siret: "",
  vat_number: "",
  payment_terms: "",
};

export function SupplierCreateModal({ open, onClose, onCreated }: SupplierCreateModalProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormState(EMPTY_FORM);
    setFormError(null);
    setIsSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      nameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, isSubmitting]);

  function updateField<K extends keyof SupplierFormState>(key: K, value: SupplierFormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const name = formState.name.trim();
    if (!name) {
      setFormError("Le nom du fournisseur est obligatoire.");
      return;
    }

    setIsSubmitting(true);

    const payload = {
      name,
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      country: formState.country.trim() || null,
      email: formState.email.trim() || null,
      phone: formState.phone.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      siret: formState.siret.trim() || null,
      vat_number: formState.vat_number.trim() || null,
      payment_terms: formState.payment_terms.trim() || null,
      is_active: true,
    };

    const { data, error } = await supabase
      .from("suppliers")
      .insert(payload)
      .select("id, name, address, postal_code, city, contact_name, phone, email")
      .single();

    setIsSubmitting(false);

    if (error || !data) {
      setFormError(error?.message ?? "Impossible de creer le fournisseur.");
      return;
    }

    onCreated?.(data);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto px-4 py-6">
      <div
        className="fixed inset-0 bg-slate-900/40"
        onClick={() => {
          if (!isSubmitting) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-modal-title"
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <div>
            <h2 id="supplier-modal-title" className="text-lg font-semibold text-[var(--slate-800)]">
              Nouveau fournisseur
            </h2>
            <p className="text-sm text-[var(--slate-500)]">
              Ajoutez un fournisseur sans quitter le bon de commande.
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Fermer
          </button>
        </div>

        <form className="grid max-h-[calc(90vh-80px)] gap-5 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="form-label" htmlFor="modal-supplier-name">Nom *</label>
            <input
              ref={nameRef}
              id="modal-supplier-name"
              name="organization"
              autoComplete="organization"
              className="form-input"
              placeholder="Nom de l'entreprise"
              required
              value={formState.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-contact">Contact</label>
            <input
              id="modal-supplier-contact"
              name="contact-name"
              autoComplete="name"
              className="form-input"
              placeholder="Nom du contact"
              value={formState.contact_name}
              onChange={(event) => updateField("contact_name", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-phone">Telephone</label>
            <input
              id="modal-supplier-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              className="form-input"
              placeholder="01 00 00 00 00"
              value={formState.phone}
              onChange={(event) => updateField("phone", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-email">Email</label>
            <input
              id="modal-supplier-email"
              name="email"
              className="form-input"
              inputMode="email"
              autoComplete="email"
              placeholder="contact@fournisseur.fr"
              type="email"
              value={formState.email}
              onChange={(event) => updateField("email", event.target.value)}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="form-label" htmlFor="modal-supplier-address">Adresse</label>
            <textarea
              id="modal-supplier-address"
              name="street-address"
              autoComplete="street-address"
              className="form-input form-textarea"
              placeholder="Adresse complete"
              value={formState.address}
              onChange={(event) => updateField("address", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-postal">Code postal</label>
            <input
              id="modal-supplier-postal"
              name="postal-code"
              autoComplete="postal-code"
              className="form-input"
              placeholder="78120"
              value={formState.postal_code}
              onChange={(event) => updateField("postal_code", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-city">Ville</label>
            <input
              id="modal-supplier-city"
              name="city"
              autoComplete="address-level2"
              className="form-input"
              placeholder="Rambouillet"
              value={formState.city}
              onChange={(event) => updateField("city", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-country">Pays</label>
            <input
              id="modal-supplier-country"
              name="country"
              autoComplete="country-name"
              className="form-input"
              placeholder="France"
              value={formState.country}
              onChange={(event) => updateField("country", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-siret">SIRET</label>
            <input
              id="modal-supplier-siret"
              name="siret"
              autoComplete="off"
              className="form-input"
              placeholder="123 456 789 00000"
              value={formState.siret}
              onChange={(event) => updateField("siret", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-vat">TVA intracommunautaire</label>
            <input
              id="modal-supplier-vat"
              name="vat-number"
              autoComplete="off"
              className="form-input"
              placeholder="FR12345678901"
              value={formState.vat_number}
              onChange={(event) => updateField("vat_number", event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="modal-supplier-payment">Conditions de paiement</label>
            <input
              id="modal-supplier-payment"
              name="payment-terms"
              autoComplete="off"
              className="form-input"
              placeholder="A 30 jours fin de mois"
              value={formState.payment_terms}
              onChange={(event) => updateField("payment_terms", event.target.value)}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center justify-between gap-4 pt-2">
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
                onClick={onClose}
                type="button"
                disabled={isSubmitting}
              >
                Annuler
              </button>
              <button
                className="btn btn-primary"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    Enregistrement...
                  </>
                ) : (
                  "Ajouter"
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
