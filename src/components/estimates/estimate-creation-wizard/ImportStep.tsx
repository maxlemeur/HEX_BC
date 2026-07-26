"use client";

import Link from "next/link";

import {
  formatDateLabel,
  type EstimateCreationResourcesState,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

type ImportStepProps = {
  data: WizardData;
  errors: StepErrors;
  projectId?: string;
  resources: EstimateCreationResourcesState;
  updateField: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
};

export function ImportStep({
  data,
  errors,
  projectId,
  resources,
  updateField,
}: ImportStepProps) {
  const {
    templates,
    isLoadingTemplates,
    templatesError,
    linkedDpgfSource,
    isLoadingLinkedDpgfSource,
    linkedDpgfSourceError,
    templateModeDisabled,
    templateModeUnavailable,
    hasLinkedDpgfSource,
  } = resources;

  return (
    <div className="grid gap-6">
      <div>
        <span className="form-label">Mode de creation</span>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={
              data.creationMode === "blank"
                ? "btn btn-primary btn-sm"
                : "btn btn-secondary btn-sm"
            }
            onClick={() => updateField("creationMode", "blank")}
          >
            Nouveau (vide)
          </button>
          <button
            type="button"
            className={
              templateModeDisabled
                ? "btn btn-secondary btn-sm cursor-not-allowed opacity-60"
                : data.creationMode === "template"
                  ? "btn btn-primary btn-sm"
                  : "btn btn-secondary btn-sm"
            }
            onClick={() => {
              if (!templateModeDisabled) {
                updateField("creationMode", "template");
              }
            }}
            disabled={templateModeDisabled}
            aria-disabled={templateModeDisabled}
            title={
              templateModeUnavailable
                ? "Aucun modèle disponible pour le moment."
                : undefined
            }
          >
            Depuis un modèle
          </button>
          <Link
            className="btn btn-ghost btn-sm"
            href="/dashboard/estimates/templates"
          >
            Bibliothèque templates
          </Link>
        </div>
        {templateModeUnavailable && (
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            Aucun modele disponible actuellement. Creation en mode Nouveau (vide).
          </p>
        )}
      </div>

      {data.creationMode === "template" && (
        <div>
          <label className="form-label" htmlFor="wiz-template-id">
            Template (10 plus recents)
          </label>
          <select
            id="wiz-template-id"
            className={`form-input form-select ${errors.selectedTemplateId ? "border-[var(--error)]" : ""}`}
            value={data.selectedTemplateId}
            onChange={(event) => updateField("selectedTemplateId", event.target.value)}
            disabled={isLoadingTemplates || templates.length === 0}
          >
            {templates.length === 0 ? (
              <option value="">
                {isLoadingTemplates
                  ? "Chargement..."
                  : "Aucun template disponible"}
              </option>
            ) : (
              <>
                <option value="">Sélectionnez un template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} - {template.itemCount} lignes -{" "}
                    {formatDateLabel(template.createdAt)}
                  </option>
                ))}
              </>
            )}
          </select>
          {errors.selectedTemplateId && (
            <p className="mt-1 text-sm text-[var(--error)]">
              {errors.selectedTemplateId}
            </p>
          )}
          {templatesError && (
            <div className="alert alert-error mt-3">{templatesError}</div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-[var(--slate-200)] bg-white p-4">
        <h3 className="text-sm font-semibold text-[var(--slate-700)]">
          Import DPGF (optionnel)
        </h3>
        <p className="mt-2 text-sm text-[var(--slate-500)]">
          {projectId
            ? "Si une source DPGF est liee a cette affaire, vous pouvez pre-remplir automatiquement la version."
            : "Le pre-remplissage DPGF source est disponible depuis une affaire existante liee a un import DPGF."}
        </p>
        {projectId && isLoadingLinkedDpgfSource ? (
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            Verification de la source DPGF liee...
          </p>
        ) : null}
        {projectId && linkedDpgfSourceError ? (
          <div className="alert alert-error mt-3 text-xs">{linkedDpgfSourceError}</div>
        ) : null}
        {projectId && hasLinkedDpgfSource && linkedDpgfSource ? (
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            Source detectee: {linkedDpgfSource.filename} ({linkedDpgfSource.mappedRowCount} ligne(s) importable(s)).
          </p>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className={
              data.dpgfImportMode === "none"
                ? "btn btn-primary btn-sm justify-center"
                : "btn btn-secondary btn-sm justify-center"
            }
            onClick={() => updateField("dpgfImportMode", "none")}
          >
            Je demarre sans DPGF
          </button>
          <button
            type="button"
            className={
              data.dpgfImportMode === "source"
                ? "btn btn-primary btn-sm justify-center"
                : `btn btn-secondary btn-sm justify-center ${
                    !hasLinkedDpgfSource || isLoadingLinkedDpgfSource
                      ? "cursor-not-allowed opacity-60"
                      : ""
                  }`
            }
            onClick={() => updateField("dpgfImportMode", "source")}
            disabled={!hasLinkedDpgfSource || isLoadingLinkedDpgfSource}
          >
            DPGF source a importer
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--slate-500)]">
          {data.dpgfImportMode === "source"
            ? "La version sera creee avec les lignes du DPGF source lie."
            : "Aucun pre-remplissage DPGF source a la creation."}
        </p>
      </div>

      <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--slate-700)]">
          Récapitulatif
        </h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--slate-500)]">Projet</dt>
            <dd className="font-medium">
              {projectId ? "Projet existant" : data.projectName || "-"}
            </dd>
          </div>
          {data.clientName && (
            <div>
              <dt className="text-[var(--slate-500)]">Client</dt>
              <dd className="font-medium">{data.clientName}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--slate-500)]">Date</dt>
            <dd className="font-medium">{formatDateLabel(data.dateDevis)}</dd>
          </div>
          <div>
            <dt className="text-[var(--slate-500)]">Marge</dt>
            <dd className="font-medium">
              {data.marginMode === "tiered"
                ? "Par tranche"
                : data.marginBp
                  ? `${(Number(data.marginBp) / 100).toFixed(1)}%`
                  : "Non définie"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--slate-500)]">TVA</dt>
            <dd className="font-medium">
              {Number(data.taxRateBp) > 0
                ? `${(Number(data.taxRateBp) / 100).toFixed(1)}%`
                : "Pas de TVA"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--slate-500)]">Mode</dt>
            <dd className="font-medium">
              {data.creationMode === "template"
                ? "Depuis un modèle"
                : "Nouveau (vide)"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--slate-500)]">Famille de projet</dt>
            <dd className="font-medium">
              {data.projectFamily || "Non renseignee"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--slate-500)]">Import DPGF</dt>
            <dd className="font-medium">
              {data.dpgfImportMode === "source"
                ? "Source DPGF a importer apres creation"
                : "Aucun import au demarrage"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
