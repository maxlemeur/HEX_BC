"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Input } from "@/components/ui-legacy/Input";
import { Modal } from "@/components/ui-legacy/Modal";
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

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      nameRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
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
      setFormError(error?.message ?? "Impossible de creer le chantier.");
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
      <Modal.Content className="max-w-3xl overflow-hidden p-0" closeOnOverlayClick={!isSubmitting}>
        <div className="border-b border-[var(--slate-200)] px-6 py-4">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>Nouveau chantier</Modal.Title>
              <p className="text-sm text-[var(--slate-500)]">
                Ajoutez une adresse de livraison sans quitter le bon de commande.
              </p>
            </div>
            <Modal.Close disabled={isSubmitting} />
          </Modal.Header>
        </div>

        <form
          className="grid max-h-[calc(90vh-80px)] gap-5 overflow-y-auto p-6 sm:grid-cols-2"
          onSubmit={onSubmit}
        >
          <Input
            ref={nameRef}
            id="modal-site-name"
            name="site-name"
            autoComplete="organization"
            label="Nom du chantier *"
            placeholder="BBD2"
            required
            value={formState.name}
            onChange={(event) => updateField("name", event.target.value)}
          />

          <Input
            id="modal-site-project-code"
            name="project-code"
            autoComplete="off"
            label="Code projet"
            placeholder="BBD2"
            value={formState.project_code}
            onChange={(event) => updateField("project_code", event.target.value)}
          />

          <div className="space-y-1.5 sm:col-span-2">
            <label className="block text-xs font-semibold text-[var(--slate-700)]" htmlFor="modal-site-address">
              Adresse
            </label>
            <textarea
              id="modal-site-address"
              name="street-address"
              autoComplete="street-address"
              className="form-input form-textarea"
              placeholder="Adresse complete"
              value={formState.address}
              onChange={(event) => updateField("address", event.target.value)}
            />
          </div>

          <Input
            id="modal-site-postal"
            name="postal-code"
            autoComplete="postal-code"
            label="Code postal"
            placeholder="78120"
            value={formState.postal_code}
            onChange={(event) => updateField("postal_code", event.target.value)}
          />

          <Input
            id="modal-site-city"
            name="city"
            autoComplete="address-level2"
            label="Ville"
            placeholder="Rambouillet"
            value={formState.city}
            onChange={(event) => updateField("city", event.target.value)}
          />

          <Input
            id="modal-site-contact"
            name="contact-name"
            autoComplete="name"
            label="Contact sur site"
            placeholder="Nom du contact"
            value={formState.contact_name}
            onChange={(event) => updateField("contact_name", event.target.value)}
          />

          <Input
            id="modal-site-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            label="Telephone"
            placeholder="01 00 00 00 00"
            value={formState.contact_phone}
            onChange={(event) => updateField("contact_phone", event.target.value)}
          />

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 sm:col-span-2">
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
