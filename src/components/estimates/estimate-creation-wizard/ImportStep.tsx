"use client";

import Link from "next/link";

import {
  PROJECT_FAMILY_OPTIONS,
  formatDateLabel,
  type EstimateCreationResourcesState,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";

type ImportStepProps = {
  data: WizardData;
  errors: StepErrors;
  projectId?: string;
  resources: EstimateCreationResourcesState;
  updateField: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
};

function resolveProjectFamilyLabel(value: string) {
  if (!value) return "Non renseignée";
  return PROJECT_FAMILY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

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
      <div
        role="group"
        aria-labelledby="wiz-creation-mode-label"
        className="flex min-w-0 flex-col gap-2"
      >
        <span id="wiz-creation-mode-label" className="text-sm font-medium text-foreground">
          Mode de création
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={data.creationMode === "blank" ? "primary" : "outline"}
            size="md"
            aria-pressed={data.creationMode === "blank"}
            onClick={() => updateField("creationMode", "blank")}
          >
            Nouveau (vide)
          </Button>
          <Button
            variant={
              !templateModeDisabled && data.creationMode === "template"
                ? "primary"
                : "outline"
            }
            size="md"
            aria-pressed={!templateModeDisabled && data.creationMode === "template"}
            onClick={() => {
              if (!templateModeDisabled) {
                updateField("creationMode", "template");
              }
            }}
            disabled={templateModeDisabled}
            aria-describedby={templateModeUnavailable ? "wiz-template-unavailable" : undefined}
          >
            Depuis un modèle
          </Button>
          <Link
            className={buttonVariants({ variant: "ghost", size: "md" })}
            href="/dashboard/estimates/templates"
          >
            Modèles de chiffrage
          </Link>
        </div>
        {templateModeUnavailable && (
          <p id="wiz-template-unavailable" className="text-xs text-muted-foreground">
            Aucun modèle disponible actuellement. Création en mode Nouveau (vide).
          </p>
        )}
      </div>

      {data.creationMode === "template" && (
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="wiz-template-id">Modèle (10 plus récents)</FieldLabel>
          <NativeSelect
            id="wiz-template-id"
            value={data.selectedTemplateId}
            onChange={(event) => updateField("selectedTemplateId", event.target.value)}
            disabled={isLoadingTemplates || templates.length === 0}
            aria-invalid={errors.selectedTemplateId ? true : undefined}
            aria-describedby={
              errors.selectedTemplateId ? "wiz-template-id-error" : undefined
            }
          >
            {templates.length === 0 ? (
              <option value="">
                {isLoadingTemplates
                  ? "Chargement…"
                  : "Aucun modèle disponible"}
              </option>
            ) : (
              <>
                <option value="">Sélectionnez un modèle</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.itemCount} lignes ·{" "}
                    {formatDateLabel(template.createdAt)}
                  </option>
                ))}
              </>
            )}
          </NativeSelect>
          {errors.selectedTemplateId && (
            <FieldError id="wiz-template-id-error" className="text-danger">
              {errors.selectedTemplateId}
            </FieldError>
          )}
          {templatesError && (
            <Alert variant="danger" className="mt-1">
              {templatesError}
            </Alert>
          )}
        </div>
      )}

      <section
        aria-labelledby="wiz-dpgf-import-title"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h3 id="wiz-dpgf-import-title" className="text-sm font-semibold text-foreground">
          Import DPGF (optionnel)
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {projectId
            ? "Si une source DPGF est liée à cette affaire, vous pouvez pré-remplir automatiquement la version."
            : "Le pré-remplissage depuis un DPGF source est disponible depuis une affaire existante liée à un import DPGF."}
        </p>
        {projectId && isLoadingLinkedDpgfSource ? (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Vérification de la source DPGF liée…
          </p>
        ) : null}
        {projectId && linkedDpgfSourceError ? (
          <Alert variant="danger" className="mt-3 text-xs">
            {linkedDpgfSourceError}
          </Alert>
        ) : null}
        {projectId && hasLinkedDpgfSource && linkedDpgfSource ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Source détectée : {linkedDpgfSource.filename} ({linkedDpgfSource.mappedRowCount} ligne(s) importable(s)).
          </p>
        ) : null}
        <div
          role="group"
          aria-labelledby="wiz-dpgf-import-title"
          className="mt-3 grid gap-2 sm:grid-cols-2"
        >
          <Button
            variant={data.dpgfImportMode === "none" ? "primary" : "outline"}
            size="md"
            aria-pressed={data.dpgfImportMode === "none"}
            onClick={() => updateField("dpgfImportMode", "none")}
          >
            Démarrer sans DPGF
          </Button>
          <Button
            variant={data.dpgfImportMode === "source" ? "primary" : "outline"}
            size="md"
            aria-pressed={data.dpgfImportMode === "source"}
            onClick={() => updateField("dpgfImportMode", "source")}
            disabled={!hasLinkedDpgfSource || isLoadingLinkedDpgfSource}
          >
            DPGF source à importer
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">
          {data.dpgfImportMode === "source"
            ? "La version sera créée avec les lignes du DPGF source lié."
            : "Aucun pré-remplissage depuis le DPGF source à la création."}
        </p>
      </section>

      <section
        aria-labelledby="wiz-summary-title"
        className="rounded-lg border border-border-subtle bg-surface-subtle p-4"
      >
        <h3 id="wiz-summary-title" className="mb-3 text-sm font-semibold text-foreground">
          Récapitulatif
        </h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Projet</dt>
            <dd className="break-words font-medium text-foreground">
              {projectId ? "Projet existant" : data.projectName || "—"}
            </dd>
          </div>
          {data.clientName && (
            <div className="min-w-0">
              <dt className="text-muted-foreground">Client</dt>
              <dd className="break-words font-medium text-foreground">{data.clientName}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium text-foreground">{formatDateLabel(data.dateDevis)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Marge</dt>
            <dd className="font-medium text-foreground">
              {data.marginMode === "tiered"
                ? "Par tranche"
                : data.marginBp
                  ? `${(Number(data.marginBp) / 100).toFixed(1)}%`
                  : "Non définie"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">TVA</dt>
            <dd className="font-medium text-foreground">
              {Number(data.taxRateBp) > 0
                ? `${(Number(data.taxRateBp) / 100).toFixed(1)}%`
                : "Pas de TVA"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mode</dt>
            <dd className="font-medium text-foreground">
              {data.creationMode === "template"
                ? "Depuis un modèle"
                : "Nouveau (vide)"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Famille de projet</dt>
            <dd className="font-medium text-foreground">
              {resolveProjectFamilyLabel(data.projectFamily)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Import DPGF</dt>
            <dd className="font-medium text-foreground">
              {data.dpgfImportMode === "source"
                ? "Source DPGF à importer après création"
                : "Aucun import au démarrage"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
