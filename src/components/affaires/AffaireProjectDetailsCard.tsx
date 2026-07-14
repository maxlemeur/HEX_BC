"use client";

import { ProjectIcon, PROJECT_ICONS, type ProjectIconKey } from "@/components/affaires/ProjectIconPicker";

export type AffaireProjectDetailsValues = {
  projectName: string;
  clientName: string;
  reference: string;
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
  onReferenceChange?: (value: string) => void;
  onEdit?: () => void;
  footer?: React.ReactNode;
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
  onEdit,
  footer,
}: Readonly<AffaireProjectDetailsCardProps>) {
  const defaultIcon = (
    <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-transparent px-3 py-2">
      <ProjectIcon iconKey={iconKey} size={44} className="text-[var(--slate-400)]" />
      <span className="text-[10px] font-medium text-[var(--slate-500)]">
        {PROJECT_ICONS[iconKey]?.label}
      </span>
    </div>
  );

  if (mode === "edit") {
    return (
      <section className="animate-fade-in space-y-5">
        <div className="flex items-stretch gap-4">
          {iconSlot ?? defaultIcon}
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-4 lg:grid-cols-[7fr_3fr]">
            {/* Project name — left column, flex to align bottom border */}
            <div className="flex flex-col lg:row-span-2">
              <label
                htmlFor="details-project-name"
                className="text-2xl font-semibold uppercase tracking-wider text-[var(--slate-700)]"
              >
                Nom du projet <span className="text-[var(--danger)]">*</span>
              </label>
              <div className="relative mt-1 flex flex-1 items-end">
                <input
                  id="details-project-name"
                  type="text"
                  value={values.projectName}
                  onChange={(e) => onProjectNameChange?.(e.target.value)}
                  placeholder="Ex : Residence Les Jardins — Lot CVC"
                  className={`w-full border-0 border-b-2 bg-transparent pb-2 text-3xl font-semibold text-[var(--slate-900)] placeholder:text-[var(--slate-400)] focus:outline-none transition-colors ${
                    projectNameError
                      ? "border-[var(--danger)]"
                      : "border-[var(--slate-200)] focus:border-[var(--brand-blue)]"
                  }`}
                  aria-required="true"
                />
              </div>
              {projectNameError && (
                <p className="mt-1.5 text-xs font-medium text-[var(--danger)]" role="alert">
                  {projectNameError}
                </p>
              )}
            </div>

            {/* Client — right column, top */}
            <div>
              <label
                htmlFor="details-client"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--slate-700)]"
              >
                Client
              </label>
              <input
                id="details-client"
                type="text"
                value={values.clientName}
                onChange={(e) => onClientNameChange?.(e.target.value)}
                placeholder="Nom du client (optionnel)"
                className="mt-2 w-full border-0 border-b-2 border-[var(--slate-200)] bg-transparent pb-2 text-base font-medium text-[var(--slate-900)] placeholder:text-[var(--slate-400)] transition-colors focus:border-[var(--brand-blue)] focus:outline-none"
              />
            </div>

            {/* Reference — right column, bottom */}
            <div>
              <label
                htmlFor="details-reference"
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--slate-700)]"
              >
                Reference
              </label>
              <input
                id="details-reference"
                type="text"
                value={values.reference}
                onChange={(e) => onReferenceChange?.(e.target.value)}
                placeholder="Ref. projet (optionnel)"
                className="mt-2 w-full border-0 border-b-2 border-[var(--slate-200)] bg-transparent pb-2 text-base font-medium text-[var(--slate-900)] placeholder:text-[var(--slate-400)] transition-colors focus:border-[var(--brand-blue)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div role="alert" className="alert alert-error text-sm">
            {errorMessage}
          </div>
        ) : null}

        {footer ? <div>{footer}</div> : null}
      </section>
    );
  }

  const projectTypeLabel = PROJECT_ICONS[iconKey]?.label ?? "Projet";

  return (
    <section className="relative animate-fade-in rounded-xl border border-[var(--slate-200)] border-l-4 border-l-[var(--brand-orange)] bg-white px-4 py-5 shadow-sm sm:px-5 lg:px-6 lg:py-6">
      {onEdit ? (
        <button
          type="button"
          className="absolute right-4 top-4 min-h-11 rounded-lg px-2.5 text-sm font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-50)] hover:text-[var(--brand-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2 sm:right-5 lg:right-6 lg:top-5"
          onClick={onEdit}
        >
          Modifier la fiche
        </button>
      ) : null}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-8">
        <div className="min-w-0">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--slate-50)] text-[var(--slate-400)] sm:h-[4.5rem] sm:w-[4.5rem]">
              <ProjectIcon iconKey={iconKey} size={42} />
            </div>

            <div className="min-w-0 pr-28 sm:pr-32 lg:pr-0">
              <h1 className="truncate font-display text-2xl font-semibold tracking-tight text-[var(--slate-900)] sm:text-3xl">
                {renderValue(values.projectName, "Non renseigne")}
              </h1>
              <p className="mt-1 text-sm font-medium text-[var(--slate-500)]">
                {projectTypeLabel}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 divide-x divide-[var(--slate-200)] border-t border-[var(--slate-200)] pt-4 lg:ml-[5.5rem] lg:flex lg:divide-x-0 lg:border-t-0 lg:pt-0">
            <div className="min-w-0 pr-4 lg:pr-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Client
              </dt>
              <dd className="mt-1 truncate text-sm font-medium text-[var(--slate-700)]">
                {renderValue(values.clientName, "Non renseigne")}
              </dd>
            </div>
            <div className="min-w-0 pl-4 lg:border-l lg:border-[var(--slate-200)] lg:pl-5">
              <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Référence
              </dt>
              <dd className="mt-1 truncate text-sm font-medium text-[var(--slate-700)]">
                {renderValue(values.reference, "Non renseignée")}
              </dd>
            </div>
          </dl>
        </div>

        {footer ? (
          <div className="w-full min-w-0 lg:w-auto lg:min-w-[34rem]">
            {footer}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div role="alert" className="alert alert-error mt-4 text-sm">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}
