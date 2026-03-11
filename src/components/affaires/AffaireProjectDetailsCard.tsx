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

  // View mode — fiche style matching the creation page
  return (
    <section className="animate-fade-in">
      <div className="flex items-stretch gap-4">
        {iconSlot ?? defaultIcon}
        <div className="grid min-w-0 flex-1 gap-x-6 gap-y-4 lg:grid-cols-[7fr_3fr]">
          {/* Project name + toolbar — left column */}
          <div className="flex flex-col lg:row-span-2">
            <p className="w-full text-3xl font-semibold text-[var(--slate-900)]">
              {renderValue(values.projectName, "Non renseigne")}
            </p>
            {footer ? <div className="mt-3">{footer}</div> : null}
          </div>

          {/* Client — right column, top */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
              Client
            </p>
            <p className="mt-2 border-b-2 border-transparent pb-2 text-base font-medium text-[var(--slate-700)]">
              {renderValue(values.clientName, "Non renseigne")}
            </p>
          </div>

          {/* Reference — right column, bottom */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
              Reference
            </p>
            <p className="mt-2 border-b-2 border-transparent pb-2 text-base font-medium text-[var(--slate-700)]">
              {renderValue(values.reference, "Non renseignee")}
            </p>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div role="alert" className="alert alert-error mt-4 text-sm">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}
