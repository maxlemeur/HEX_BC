"use client";

import type {
  StepErrors,
  WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { RefObject } from "react";

type ProjectStepProps = {
  data: WizardData;
  errors: StepErrors;
  projectId?: string;
  projectNameInputRef: RefObject<HTMLInputElement | null>;
  updateField: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
};

export function ProjectStep({
  data,
  errors,
  projectId,
  projectNameInputRef,
  updateField,
}: ProjectStepProps) {
  if (projectId) {
    return (
      <div className="grid gap-6">
        <p className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-sm text-foreground-secondary">
          Version ajoutée au projet existant.
        </p>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="wiz-title">Titre de la version</FieldLabel>
          <Input
            id="wiz-title"
            ref={projectNameInputRef}
            placeholder="Titre de la version (optionnel)"
            value={data.title}
            onChange={(event) => updateField("title", event.target.value)}
            autoFocus
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <FieldLabel htmlFor="wiz-project-name">
          Nom du projet <span aria-hidden="true">*</span>
        </FieldLabel>
        <Input
          id="wiz-project-name"
          ref={projectNameInputRef}
          placeholder="Nom du projet"
          value={data.projectName}
          aria-required="true"
          aria-invalid={errors.projectName ? true : undefined}
          aria-describedby={errors.projectName ? "wiz-project-name-error" : undefined}
          onChange={(event) => updateField("projectName", event.target.value)}
        />
        {errors.projectName && (
          <FieldError id="wiz-project-name-error" className="text-danger">
            {errors.projectName}
          </FieldError>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-client-name">Client</FieldLabel>
        <Input
          id="wiz-client-name"
          placeholder="Nom du client"
          value={data.clientName}
          onChange={(event) => updateField("clientName", event.target.value)}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-reference">Référence projet</FieldLabel>
        <Input
          id="wiz-reference"
          placeholder="Référence projet (optionnelle)"
          value={data.reference}
          aria-describedby="wiz-reference-hint"
          onChange={(event) => updateField("reference", event.target.value)}
        />
        <FieldDescription id="wiz-reference-hint" className="text-xs">
          La référence du devis sera générée automatiquement.
        </FieldDescription>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <FieldLabel htmlFor="wiz-title">Titre de la version</FieldLabel>
        <Input
          id="wiz-title"
          placeholder="Titre de la version (optionnel)"
          value={data.title}
          onChange={(event) => updateField("title", event.target.value)}
        />
      </div>
    </div>
  );
}
