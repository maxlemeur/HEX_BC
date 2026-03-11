"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export type AffaireProjectDetailsValues = {
  projectName: string;
  clientName: string;
  reference: string;
};

type AffaireProjectDetailsAction = {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
};

type AffaireProjectDetailsCardProps = {
  mode: "view" | "edit";
  title?: string;
  description?: string;
  values: AffaireProjectDetailsValues;
  projectNameError?: string | null;
  errorMessage?: string | null;
  primaryAction?: AffaireProjectDetailsAction;
  secondaryAction?: AffaireProjectDetailsAction;
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
  title = "Informations affaire",
  description,
  values,
  projectNameError,
  errorMessage,
  primaryAction,
  secondaryAction,
  onProjectNameChange,
  onClientNameChange,
  onReferenceChange,
  footer,
}: Readonly<AffaireProjectDetailsCardProps>) {
  return (
    <section className="dashboard-card p-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-[var(--slate-500)]">{description}</p>
          ) : null}
        </div>
        {mode === "view" && primaryAction ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={primaryAction.onClick}
            loading={primaryAction.loading}
            disabled={primaryAction.disabled}
          >
            {primaryAction.label}
          </Button>
        ) : null}
      </div>

      {mode === "edit" ? (
        <div className="mt-4 space-y-4">
          <Input
            label="Nom du projet *"
            placeholder="Ex: Residence Les Jardins"
            value={values.projectName}
            onChange={(event) => onProjectNameChange?.(event.target.value)}
            error={projectNameError ?? undefined}
            aria-required="true"
          />
          <Input
            label="Client"
            placeholder="Nom du client (optionnel)"
            value={values.clientName}
            onChange={(event) => onClientNameChange?.(event.target.value)}
          />
          <Input
            label="Reference"
            placeholder="Ref. projet (optionnel)"
            value={values.reference}
            onChange={(event) => onReferenceChange?.(event.target.value)}
          />
          {errorMessage ? (
            <div role="alert" className="alert alert-error text-sm">
              {errorMessage}
            </div>
          ) : null}
          {footer ? <div>{footer}</div> : null}
          {(secondaryAction || primaryAction) ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {secondaryAction ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled}
                >
                  {secondaryAction.label}
                </Button>
              ) : null}
              {primaryAction ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={primaryAction.onClick}
                  loading={primaryAction.loading}
                  disabled={primaryAction.disabled}
                >
                  {primaryAction.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
              Projet
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
              {renderValue(values.projectName, "Non renseigne")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
              Client
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
              {renderValue(values.clientName, "Non renseigne")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
              Reference
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
              {renderValue(values.reference, "Non renseignee")}
            </p>
          </div>
          {errorMessage ? (
            <div role="alert" className="alert alert-error md:col-span-3 text-sm">
              {errorMessage}
            </div>
          ) : null}
          {footer ? <div className="md:col-span-3">{footer}</div> : null}
        </div>
      )}
    </section>
  );
}
