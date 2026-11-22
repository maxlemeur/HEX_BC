"use client";

import { PencilIcon, Plus, Trash2 } from "lucide-react";

import { ProjectIcon, PROJECT_ICONS, type ProjectIconKey } from "@/components/affaires/ProjectIconPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AFFAIRE_SITE_CONTACT_NAME_MAX,
  AFFAIRE_SITE_CONTACT_PHONE_MAX,
  AFFAIRE_SITE_CONTACT_ROLE_MAX,
  AFFAIRE_SITE_CONTACTS_MAX,
  affaireSiteContactText,
  type AffaireSiteContact,
} from "@/lib/affaires/site-contacts";

export type AffaireProjectDetailsValues = {
  projectName: string;
  clientName: string;
  reference: string;
  siteAddress?: string;
  /** TI-691: the people to call on site; rows being typed may be incomplete until they are saved. */
  siteContacts?: AffaireSiteContactDraft[];
};

/** A contact row as typed: every field a string, an empty one left out when saved. */
export type AffaireSiteContactDraft = { name: string; role: string; phone: string };

export function toSiteContactDrafts(contacts: readonly AffaireSiteContact[] | undefined): AffaireSiteContactDraft[] {
  return (contacts ?? []).map((contact) => ({ name: contact.name, role: contact.role ?? "", phone: contact.phone ?? "" }));
}

const CONTACT_INPUT =
  "w-full min-w-0 border-0 border-b-2 border-border bg-transparent pb-1.5 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none";

/** The rows of « Contacts sur site »: a name, a role and one number each, added and removed in place. */
function SiteContactsEditor({
  contacts,
  onChange,
}: Readonly<{ contacts: AffaireSiteContactDraft[]; onChange: (next: AffaireSiteContactDraft[]) => void }>) {
  const update = (index: number, patch: Partial<AffaireSiteContactDraft>) =>
    onChange(contacts.map((contact, position) => (position === index ? { ...contact, ...patch } : contact)));
  return (
    <fieldset className="lg:col-span-2">
      <legend className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
        Contacts sur site
      </legend>
      <p className="mt-1 text-xs text-muted-foreground">
        Imprimés dans les instructions des bons de commande faits depuis les demandes de matériel de l’affaire.
      </p>
      {contacts.length > 0 ? (
        <ul aria-label="Contacts sur site" className="mt-2 space-y-2">
          {contacts.map((contact, index) => (
            <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto]">
              <input
                type="text"
                aria-label={`Nom, contact ${index + 1}`}
                value={contact.name}
                maxLength={AFFAIRE_SITE_CONTACT_NAME_MAX}
                placeholder="Nom"
                onChange={(event) => update(index, { name: event.target.value })}
                className={`${CONTACT_INPUT} max-sm:col-span-2`}
              />
              <input
                type="text"
                aria-label={`Rôle, contact ${index + 1}`}
                value={contact.role}
                maxLength={AFFAIRE_SITE_CONTACT_ROLE_MAX}
                placeholder="Rôle (facultatif)"
                onChange={(event) => update(index, { role: event.target.value })}
                className={`${CONTACT_INPUT} max-sm:col-span-2`}
              />
              <input
                type="tel"
                aria-label={`Téléphone, contact ${index + 1}`}
                value={contact.phone}
                maxLength={AFFAIRE_SITE_CONTACT_PHONE_MAX}
                placeholder="06 00 00 00 00"
                onChange={(event) => update(index, { phone: event.target.value })}
                className={CONTACT_INPUT}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer le contact ${index + 1}`}
                onClick={() => onChange(contacts.filter((_, position) => position !== index))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        disabled={contacts.length >= AFFAIRE_SITE_CONTACTS_MAX}
        onClick={() => onChange([...contacts, { name: "", role: "", phone: "" }])}
      >
        <Plus aria-hidden="true" />
        Ajouter un contact
      </Button>
    </fieldset>
  );
}

type AffaireProjectDetailsCardProps = {
  mode: "view" | "edit";
  title?: string;
  description?: string;
  values: AffaireProjectDetailsValues;
  iconKey?: ProjectIconKey;
  /** Override the default icon with a custom slot (e.g. ProjectIconPicker) */
  iconSlot?: React.ReactNode;
  projectNameError?: string | null;
  errorMessage?: string | null;
  onProjectNameChange?: (value: string) => void;
  onClientNameChange?: (value: string) => void;
  onSiteAddressChange?: (value: string) => void;
  onReferenceChange?: (value: string) => void;
  onSiteContactsChange?: (value: AffaireSiteContactDraft[]) => void;
  onEdit?: () => void;
  footer?: React.ReactNode;
  /** Page heading kept while the fiche is edited in place (the view mode renders the h1). */
  editHeading?: string;
};

function renderValue(value: string, fallback: string) {
  return value.trim().length > 0 ? value : fallback;
}

export function AffaireProjectDetailsCard({
  mode,
  values,
  iconKey = "building",
  iconSlot,
  projectNameError,
  errorMessage,
  onProjectNameChange,
  onClientNameChange,
  onReferenceChange,
  onSiteAddressChange,
  onSiteContactsChange,
  onEdit,
  footer,
  editHeading,
}: Readonly<AffaireProjectDetailsCardProps>) {
  const defaultIcon = (
    <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-transparent px-3 py-2">
      <ProjectIcon iconKey={iconKey} size={44} className="text-subtle-foreground" />
      <span className="text-micro font-medium text-muted-foreground">
        {PROJECT_ICONS[iconKey]?.label}
      </span>
    </div>
  );

  if (mode === "edit") {
    return (
      <section className="animate-fade-in space-y-5">
        {editHeading ? <h1 className="sr-only">{editHeading}</h1> : null}
        <div className="flex items-stretch gap-4">
          {iconSlot ?? defaultIcon}
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-4 lg:grid-cols-[7fr_3fr]">
            {/* Project name — left column, flex to align bottom border */}
            <div className="flex flex-col lg:row-span-2">
              <label
                htmlFor="details-project-name"
                className="text-2xl font-semibold uppercase tracking-wider text-foreground-secondary"
              >
                Nom du projet <span className="text-danger">*</span>
              </label>
              <div className="relative mt-1 flex flex-1 items-end">
                <input
                  id="details-project-name"
                  type="text"
                  value={values.projectName}
                  onChange={(e) => onProjectNameChange?.(e.target.value)}
                  placeholder="Ex : Résidence Les Jardins — Lot CVC"
                  className={`w-full border-0 border-b-2 bg-transparent pb-2 text-3xl font-semibold text-foreground placeholder:text-subtle-foreground focus:outline-none transition-colors ${
                    projectNameError
                      ? "border-danger"
                      : "border-border focus:border-primary"
                  }`}
                  aria-required="true"
                />
              </div>
              {projectNameError && (
                <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
                  {projectNameError}
                </p>
              )}
            </div>

            {/* Client — right column, top */}
            <div>
              <label
                htmlFor="details-client"
                className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary"
              >
                Client
              </label>
              <input
                id="details-client"
                type="text"
                value={values.clientName}
                onChange={(e) => onClientNameChange?.(e.target.value)}
                placeholder="Nom du client (optionnel)"
                className="mt-2 w-full border-0 border-b-2 border-border bg-transparent pb-2 text-base font-medium text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </div>

            {/* Reference — right column, bottom */}
            <div>
              <label
                htmlFor="details-reference"
                className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary"
              >
                Référence
              </label>
              <input
                id="details-reference"
                type="text"
                value={values.reference}
                onChange={(e) => onReferenceChange?.(e.target.value)}
                placeholder="Réf. projet (optionnel)"
                className="mt-2 w-full border-0 border-b-2 border-border bg-transparent pb-2 text-base font-medium text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </div>
            {onSiteAddressChange ? (
              <div className="lg:col-span-2">
                <label htmlFor="details-site-address" className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
                  Adresse du chantier
                </label>
                <textarea id="details-site-address" value={values.siteAddress ?? ""}
                  onChange={(event) => onSiteAddressChange(event.target.value)}
                  maxLength={1000} rows={3} placeholder="Rue, code postal et ville"
                  className="mt-2 w-full rounded-lg border border-border bg-transparent p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            ) : null}
            {onSiteContactsChange ? (
              <SiteContactsEditor contacts={values.siteContacts ?? []} onChange={onSiteContactsChange} />
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <Alert variant="danger">
            <AlertDescription className="text-danger">{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {footer ? <div>{footer}</div> : null}
      </section>
    );
  }

  const projectTypeLabel = PROJECT_ICONS[iconKey]?.label ?? "Projet";
  const facts = [
    { label: "Client", value: values.clientName, fallback: "Non renseigné", cell: "border-r" },
    { label: "Référence", value: values.reference, fallback: "Non renseignée", cell: "sm:border-r" },
    ...(values.siteAddress !== undefined
      ? [{ label: "Adresse du chantier", value: values.siteAddress, fallback: "Non renseignée", cell: "col-span-2 border-t sm:col-span-1 sm:border-t-0" }]
      : []),
    ...(values.siteContacts !== undefined
      ? [{
          label: "Contacts sur site",
          value: values.siteContacts
            .filter((contact) => contact.name.trim())
            .map((contact) => affaireSiteContactText({
              name: contact.name.trim(),
              role: contact.role.trim() || undefined,
              phone: contact.phone.trim() || undefined,
            }))
            .join("\n"),
          fallback: "Aucun",
          cell: "col-span-2 border-t sm:col-span-3",
        }]
      : []),
  ];

  // Laid out like a drawing's title block: identity, ruled facts, then the affaire's actions.
  return (
    <section className="animate-fade-in rounded-xl border border-border border-l-4 border-l-brand-orange bg-surface shadow-sm">
      <div className="flex items-start gap-3 px-4 pb-4 pt-5 sm:gap-4 sm:px-5 lg:px-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/5 text-primary sm:size-14">
          <ProjectIcon iconKey={iconKey} size={30} className="shrink-0" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-micro font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Affaire · {projectTypeLabel}
          </p>
          <h1 className="mt-1 line-clamp-3 break-words font-display text-2xl font-semibold tracking-tight text-foreground sm:line-clamp-1 sm:text-3xl">
            {renderValue(values.projectName, "Non renseigné")}
          </h1>
        </div>
        {onEdit ? (
          <Button
            variant="ghost"
            size="md"
            className="-mr-2 size-11 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3.5"
            leftIcon={<PencilIcon aria-hidden="true" />}
            onClick={onEdit}
          >
            <span className="sr-only sm:not-sr-only">Modifier la fiche</span>
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 border-t border-border sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        {facts.map((fact) => {
          const filled = fact.value.trim().length > 0;
          return (
            <div
              key={fact.label}
              className={`min-w-0 border-border px-4 py-3 sm:px-5 lg:px-6 ${fact.cell}`}
            >
              <dt className="font-mono text-micro font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {fact.label}
              </dt>
              <dd
                className={`mt-1 whitespace-pre-line break-words text-sm ${
                  filled ? "font-medium text-foreground" : "italic text-subtle-foreground"
                }`}
              >
                {renderValue(fact.value, fact.fallback)}
              </dd>
            </div>
          );
        })}
      </dl>

      {footer ? (
        <div className="min-w-0 rounded-bl-lg rounded-br-[11px] border-t border-border bg-surface-subtle px-4 py-3 sm:px-5 lg:px-6">
          {footer}
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="danger" className="mx-4 mb-4 sm:mx-5 lg:mx-6">
          <AlertDescription className="text-danger">{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
