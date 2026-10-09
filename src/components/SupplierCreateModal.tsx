"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}
    >
      <DialogContent size="xl" initialFocus={nameRef}>
        <DialogHeader>
          <DialogTitle>Nouveau fournisseur</DialogTitle>
          <DialogDescription>Ajoutez un fournisseur sans quitter le bon de commande.</DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-col gap-5" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field className="sm:col-span-2 lg:col-span-3">
              <FieldLabel htmlFor="modal-supplier-name">
                Nom <span aria-hidden="true" className="text-danger">*</span>
              </FieldLabel>
              <Input
                ref={nameRef}
                id="modal-supplier-name"
                name="organization"
                autoComplete="organization"
                placeholder="Nom de l’entreprise"
                required
                value={formState.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-contact">Contact</FieldLabel>
              <Input
                id="modal-supplier-contact"
                name="contact-name"
                autoComplete="name"
                placeholder="Nom du contact"
                value={formState.contact_name}
                onChange={(event) => updateField("contact_name", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-phone">Téléphone</FieldLabel>
              <Input
                id="modal-supplier-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="01 00 00 00 00"
                value={formState.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-email">Email</FieldLabel>
              <Input
                id="modal-supplier-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="contact@fournisseur.fr"
                value={formState.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </Field>

            <Field className="sm:col-span-2 lg:col-span-3">
              <FieldLabel htmlFor="modal-supplier-address">Adresse</FieldLabel>
              <Textarea
                id="modal-supplier-address"
                name="street-address"
                autoComplete="street-address"
                placeholder="Adresse complète"
                className="min-h-20"
                value={formState.address}
                onChange={(event) => updateField("address", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-postal">Code postal</FieldLabel>
              <Input
                id="modal-supplier-postal"
                name="postal-code"
                autoComplete="postal-code"
                placeholder="78120"
                value={formState.postal_code}
                onChange={(event) => updateField("postal_code", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-city">Ville</FieldLabel>
              <Input
                id="modal-supplier-city"
                name="city"
                autoComplete="address-level2"
                placeholder="Rambouillet"
                value={formState.city}
                onChange={(event) => updateField("city", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-country">Pays</FieldLabel>
              <NativeSelect
                id="modal-supplier-country"
                name="country"
                value={formState.country}
                onChange={(event) => updateField("country", event.target.value)}
              >
                {COUNTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-siret">SIRET</FieldLabel>
              <Input
                id="modal-supplier-siret"
                name="siret"
                autoComplete="off"
                placeholder="123 456 789 00000"
                value={formState.siret}
                onChange={(event) => updateField("siret", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-vat">TVA intracommunautaire</FieldLabel>
              <Input
                id="modal-supplier-vat"
                name="vat-number"
                autoComplete="off"
                placeholder="FR12345678901"
                value={formState.vat_number}
                onChange={(event) => updateField("vat_number", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-supplier-payment">Conditions de paiement</FieldLabel>
              <Input
                id="modal-supplier-payment"
                name="payment-terms"
                autoComplete="off"
                placeholder="À 30 jours fin de mois"
                value={formState.payment_terms}
                onChange={(event) => updateField("payment_terms", event.target.value)}
              />
            </Field>
          </div>

          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <DialogFooter className="mt-0">
            <Button variant="outline" size="lg" type="button" disabled={isSubmitting} onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" size="lg" loading={isSubmitting} type="submit">
              Ajouter le fournisseur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
