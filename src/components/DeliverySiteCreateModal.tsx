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
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type DeliverySiteCreateResult = {
  id: string;
  name: string;
  project_code: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type DeliverySiteFormState = {
  name: string;
  project_code: string;
  address: string;
  city: string;
  postal_code: string;
  contact_name: string;
  contact_phone: string;
};

type DeliverySiteCreateModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (site: DeliverySiteCreateResult) => void;
};

const EMPTY_FORM: DeliverySiteFormState = {
  name: "",
  project_code: "",
  address: "",
  city: "",
  postal_code: "",
  contact_name: "",
  contact_phone: "",
};

export function DeliverySiteCreateModal({
  open,
  onClose,
  onCreated,
}: DeliverySiteCreateModalProps) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [formState, setFormState] = useState<DeliverySiteFormState>(EMPTY_FORM);
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

  function updateField<K extends keyof DeliverySiteFormState>(
    key: K,
    value: DeliverySiteFormState[K]
  ) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const name = formState.name.trim();
    if (!name) {
      setFormError("Le nom du chantier est obligatoire.");
      return;
    }

    setIsSubmitting(true);

    const payload = {
      name,
      project_code: formState.project_code.trim() || null,
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      contact_phone: formState.contact_phone.trim() || null,
      is_active: true,
    };

    const { data, error } = await supabase
      .from("delivery_sites")
      .insert(payload)
      .select("id, name, project_code, address, postal_code, city, contact_name, contact_phone")
      .single();

    setIsSubmitting(false);

    if (error || !data) {
      setFormError(error?.message ?? "Impossible de créer le chantier.");
      return;
    }

    onCreated?.(data);
    onClose();
  }

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose();
        }
      }}
    >
      <DialogContent size="lg" initialFocus={nameRef}>
        <DialogHeader>
          <DialogTitle>Nouveau chantier</DialogTitle>
          <DialogDescription>Ajoutez une adresse de livraison sans quitter le bon de commande.</DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-col gap-5" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="modal-site-name">
                Nom du chantier <span aria-hidden="true" className="text-danger">*</span>
              </FieldLabel>
              <Input
                ref={nameRef}
                id="modal-site-name"
                name="site-name"
                autoComplete="organization"
                placeholder="BBD2"
                required
                value={formState.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-site-project-code">Code projet</FieldLabel>
              <Input
                id="modal-site-project-code"
                name="project-code"
                autoComplete="off"
                placeholder="BBD2"
                value={formState.project_code}
                onChange={(event) => updateField("project_code", event.target.value)}
              />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="modal-site-address">Adresse</FieldLabel>
              <Textarea
                id="modal-site-address"
                name="street-address"
                autoComplete="street-address"
                placeholder="Adresse complète"
                className="min-h-20"
                value={formState.address}
                onChange={(event) => updateField("address", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-site-postal">Code postal</FieldLabel>
              <Input
                id="modal-site-postal"
                name="postal-code"
                autoComplete="postal-code"
                placeholder="78120"
                value={formState.postal_code}
                onChange={(event) => updateField("postal_code", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-site-city">Ville</FieldLabel>
              <Input
                id="modal-site-city"
                name="city"
                autoComplete="address-level2"
                placeholder="Rambouillet"
                value={formState.city}
                onChange={(event) => updateField("city", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-site-contact">Contact sur site</FieldLabel>
              <Input
                id="modal-site-contact"
                name="contact-name"
                autoComplete="name"
                placeholder="Nom du contact"
                value={formState.contact_name}
                onChange={(event) => updateField("contact_name", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="modal-site-phone">Téléphone</FieldLabel>
              <Input
                id="modal-site-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="01 00 00 00 00"
                value={formState.contact_phone}
                onChange={(event) => updateField("contact_phone", event.target.value)}
              />
            </Field>
          </div>

          {formError ? <Alert variant="danger">{formError}</Alert> : null}

          <DialogFooter className="mt-0">
            <Button variant="outline" size="lg" type="button" disabled={isSubmitting} onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" size="lg" loading={isSubmitting} type="submit">
              Ajouter le chantier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
