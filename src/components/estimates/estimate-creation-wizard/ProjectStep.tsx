"use client";

import type {
  StepErrors,
  WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
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
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm text-slate-600">
            Version ajoutee au projet existant.
          </p>
        </div>
        <div>
          <label className="form-label" htmlFor="wiz-title">
            Titre de la version
          </label>
          <input
            id="wiz-title"
            ref={projectNameInputRef}
            className="form-input"
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
      <div className="sm:col-span-2">
        <label className="form-label" htmlFor="wiz-project-name">
          Nom du projet *
        </label>
        <input
          id="wiz-project-name"
          ref={projectNameInputRef}
          className={`form-input ${errors.projectName ? "border-[var(--error)]" : ""}`}
          placeholder="Nom du projet"
          value={data.projectName}
          onChange={(event) => updateField("projectName", event.target.value)}
        />
        {errors.projectName && (
          <p className="mt-1 text-sm text-[var(--error)]">{errors.projectName}</p>
        )}
      </div>

      <div>
        <label className="form-label" htmlFor="wiz-client-name">
          Client
        </label>
        <input
          id="wiz-client-name"
          className="form-input"
          placeholder="Nom du client"
          value={data.clientName}
          onChange={(event) => updateField("clientName", event.target.value)}
        />
      </div>

      <div>
        <label className="form-label" htmlFor="wiz-reference">
          Reference projet
        </label>
        <input
          id="wiz-reference"
          className="form-input"
          placeholder="Référence projet (optionnelle)"
          value={data.reference}
          onChange={(event) => updateField("reference", event.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          La reference du devis sera generee automatiquement.
        </p>
      </div>

      <div className="sm:col-span-2">
        <label className="form-label" htmlFor="wiz-title">
          Titre de la version
        </label>
        <input
          id="wiz-title"
          className="form-input"
          placeholder="Titre de la version (optionnel)"
          value={data.title}
          onChange={(event) => updateField("title", event.target.value)}
        />
      </div>
    </div>
  );
}
