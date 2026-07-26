"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
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

const COUNTRY_OPTIONS = [
  { value: "France", label: "France" },
  { value: "Belgique", label: "Belgique" },
  { value: "Luxembourg", label: "Luxembourg" },
  { value: "Suisse", label: "Suisse" },
  { value: "Autre", label: "Autre" },
];

export function SupplierCreateModal({ open, onClose, onCreated }: SupplierCreateModalProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;

    queueMicrotask(() => {
      setFormState(EMPTY_FORM);
      setFormError(null);
      setIsSubmitting(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      nameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

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
      setFormError(error?.message ?? "Impossible de créer le fournisseur.");
      return;
    }

    onCreated?.(data);
    onClose();
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Modal.Content className="max-w-4xl overflow-hidden p-0" closeOnOverlayClick={!isSubmitting}>
        <div className="border-b border-[var(--slate-200)] px-6 py-4">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>Nouveau fournisseur</Modal.Title>
              <p className="text-sm text-[var(--slate-500)]">
                Ajoutez un fournisseur sans quitter le bon de commande.
              </p>
            </div>
            <Modal.Close disabled={isSubmitting} />
          </Modal.Header>
        </div>

        <form
          className="grid max-h-[calc(90vh-80px)] gap-5 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={onSubmit}
        >
          <div className="sm:col-span-2 lg:col-span-3">
            <Input
              ref={nameRef}
              id="modal-supplier-name"
              name="organization"
              autoComplete="organization"
              label="Nom *"
              placeholder="Nom de l'entreprise"
              required
              value={formState.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <Input
            id="modal-supplier-contact"
            name="contact-name"
            autoComplete="name"
            label="Contact"
            placeholder="Nom du contact"
            value={formState.contact_name}
            onChange={(event) => updateField("contact_name", event.target.value)}
          />

          <Input
            id="modal-supplier-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            label="Telephone"
            placeholder="01 00 00 00 00"
            value={formState.phone}
            onChange={(event) => updateField("phone", event.target.value)}
          />

          <Input
            id="modal-supplier-email"
            name="email"
            inputMode="email"
            autoComplete="email"
            label="Email"
            placeholder="contact@fournisseur.fr"
            type="email"
            value={formState.email}
            onChange={(event) => updateField("email", event.target.value)}
          />

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-semibold text-[var(--slate-700)]" htmlFor="modal-supplier-address">
              Adresse
            </label>
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

          <Input
            id="modal-supplier-postal"
            name="postal-code"
            autoComplete="postal-code"
            label="Code postal"
            placeholder="78120"
            value={formState.postal_code}
            onChange={(event) => updateField("postal_code", event.target.value)}
          />

          <Input
            id="modal-supplier-city"
            name="city"
            autoComplete="address-level2"
            label="Ville"
            placeholder="Rambouillet"
            value={formState.city}
            onChange={(event) => updateField("city", event.target.value)}
          />

          <Select
            id="modal-supplier-country"
            name="country"
            label="Pays"
            options={COUNTRY_OPTIONS}
            value={formState.country}
            onValueChange={(nextValue) => updateField("country", nextValue)}
          />

          <Input
            id="modal-supplier-siret"
            name="siret"
            autoComplete="off"
            label="SIRET"
            placeholder="123 456 789 00000"
            value={formState.siret}
            onChange={(event) => updateField("siret", event.target.value)}
          />

          <Input
            id="modal-supplier-vat"
            name="vat-number"
            autoComplete="off"
            label="TVA intracommunautaire"
            placeholder="FR12345678901"
            value={formState.vat_number}
            onChange={(event) => updateField("vat_number", event.target.value)}
          />

          <Input
            id="modal-supplier-payment"
            name="payment-terms"
            autoComplete="off"
            label="Conditions de paiement"
            placeholder="A 30 jours fin de mois"
            value={formState.payment_terms}
            onChange={(event) => updateField("payment_terms", event.target.value)}
          />

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 sm:col-span-2 lg:col-span-3">
            {formError ? (
              <div className="alert alert-error flex-1" role="alert">
                {formError}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              <Button variant="secondary" type="button" disabled={isSubmitting} onClick={onClose}>
                Annuler
              </Button>
              <Button loading={isSubmitting} type="submit">
                {isSubmitting ? "Enregistrement..." : "Ajouter"}
              </Button>
            </div>
          </div>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
