"use client";

import { PencilIcon } from "lucide-react";

import { ProjectIcon, PROJECT_ICONS, type ProjectIconKey } from "@/components/affaires/ProjectIconPicker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type AffaireProjectDetailsValues = {
  projectName: string;
  clientName: string;
  reference: string;
  siteAddress?: string;
};

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

  return (
    <section className="relative animate-fade-in rounded-xl border border-border border-l-4 border-l-brand-orange bg-surface px-4 py-5 shadow-sm sm:px-5 lg:px-6 lg:py-6">
      {onEdit ? (
        <Button
          variant="ghost"
          size="md"
          className="absolute right-2 top-3 size-11 px-0 sm:right-5 sm:top-4 sm:h-9 sm:w-auto sm:px-3.5 lg:right-6 lg:top-5"
          leftIcon={<PencilIcon aria-hidden="true" />}
          onClick={onEdit}
        >
          <span className="sr-only sm:not-sr-only">Modifier la fiche</span>
        </Button>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8">
        <div className="min-w-0">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-subtle text-subtle-foreground sm:h-[4.5rem] sm:w-[4.5rem]">
              <ProjectIcon iconKey={iconKey} size={42} />
            </div>

            <div className="min-w-0 pr-8 sm:pr-40 lg:pr-0">
              <h1 className="line-clamp-3 break-words font-display text-2xl font-semibold tracking-tight text-foreground sm:line-clamp-1 sm:text-3xl">
                {renderValue(values.projectName, "Non renseigné")}
              </h1>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {projectTypeLabel}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 divide-x divide-border border-t border-border pt-4 lg:ml-[5.5rem] lg:flex lg:divide-x-0 lg:border-t-0 lg:pt-0">
            <div className="min-w-0 pr-4 lg:pr-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Client
              </dt>
              <dd className="mt-1 truncate text-sm font-medium text-foreground-secondary">
                {renderValue(values.clientName, "Non renseigné")}
              </dd>
            </div>
            <div className="min-w-0 pl-4 lg:border-l lg:border-border lg:pl-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Référence
              </dt>
              <dd className="mt-1 truncate text-sm font-medium text-foreground-secondary">
                {renderValue(values.reference, "Non renseignée")}
              </dd>
            </div>
          </dl>
          {values.siteAddress !== undefined ? (
            <div className="mt-4 lg:ml-[5.5rem]">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Adresse du chantier</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground-secondary">{renderValue(values.siteAddress, "Non renseignée")}</p>
            </div>
          ) : null}
        </div>

        {footer ? (
          <div className="w-full min-w-0 lg:w-auto lg:min-w-[34rem]">
            {footer}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <Alert variant="danger" className="mt-4">
          <AlertDescription className="text-danger">{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
