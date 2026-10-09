"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL,
  type GeneratedOuvrageSubdetailEditorComponent,
  type GeneratedOuvrageSubdetailUiState,
  describeGeneratedOuvrageMissingFields,
  formatGeneratedOuvrageLotLabel,
  getGeneratedOuvrageParentReadiness,
  isGeneratedOuvrageReadyForInsert,
  type CandidateEdits,
  type ExistingSection,
  type UiGeneratedOuvrageCandidate,
} from "./generated-ouvrage-types";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

const GeneratedOuvrageSubdetailEditor = dynamic(
  () =>
    import("./GeneratedOuvrageSubdetailEditor").then((module) => module.GeneratedOuvrageSubdetailEditor),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted-foreground">
        Chargement du sous-détail…
      </div>
    ),
  }
);

type GeneratedOuvrageCandidateCardProps = {
  candidate: UiGeneratedOuvrageCandidate;
  existingSections: ExistingSection[];
  onToggleSelect: (candidateId: string) => void;
  onStartEdit: (candidateId: string) => void;
  onSaveEdit: (candidateId: string, edits: CandidateEdits) => void;
  onCancelEdit: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
  onOpenSubdetail: (candidateId: string) => void;
  onSaveSubdetail: (
    candidateId: string,
    components: GeneratedOuvrageSubdetailEditorComponent[]
  ) => Promise<void> | void;
  subdetailState: GeneratedOuvrageSubdetailUiState | null;
  isRejecting: boolean;
};

const AI_STATUS_CONFIG = {
  certain: { variant: "success" as const, label: "Certain" },
  plausible: { variant: "warning" as const, label: "Plausible" },
  question: { variant: "danger" as const, label: "À clarifier" },
} as const;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  text: "Texte",
  cctp: "CCTP",
  history: "Historique",
  library: "Bibliothèque",
};

/** Native checkbox kept for keyboard, `toBeChecked` and Playwright `check()`. */
const NATIVE_CHECKBOX_CLASS =
  "mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm accent-primary disabled:cursor-not-allowed disabled:opacity-50";

const GUIDANCE_CLASS = "mt-2 rounded-lg border px-3 py-2.5 text-xs";

type NextStep = "parent" | "subdetail" | "select" | "ready";

function getNextStep(
  parentReady: boolean,
  subdetailReviewed: boolean,
  selected: boolean
): NextStep {
  if (!parentReady) return "parent";
  if (!subdetailReviewed) return "subdetail";
  if (!selected) return "select";
  return "ready";
}

function ReadinessStepper({
  parentReady,
  subdetailReviewed,
  selected,
}: {
  parentReady: boolean;
  subdetailReviewed: boolean;
  selected: boolean;
}) {
  const steps = [
    { label: "Compléter la ligne", done: parentReady },
    { label: "Valider le sous-détail", done: subdetailReviewed },
    { label: "Sélectionner", done: selected },
  ];

  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <ol
      className="mt-2 flex flex-wrap items-center gap-1 text-xs"
      aria-label="Étapes de préparation"
    >
      {steps.map((step, i) => (
        <li
          key={step.label}
          className="flex items-center gap-1"
          aria-current={i === activeIndex ? "step" : undefined}
        >
          {i > 0 && (
            <ChevronRightIcon className="size-3 shrink-0 text-subtle-foreground" aria-hidden="true" />
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
              step.done
                ? "bg-success-subtle text-success"
                : i === activeIndex
                  ? "bg-warning-subtle font-medium text-warning ring-1 ring-warning-border"
                  : "bg-surface-subtle text-muted-foreground"
            )}
          >
            {step.done ? (
              <CheckIcon className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <span
                className="flex size-3 shrink-0 items-center justify-center text-micro font-bold"
                aria-hidden="true"
              >
                {i + 1}
              </span>
            )}
            {step.label}
            {step.done ? <span className="sr-only"> (terminé)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function GeneratedOuvrageCandidateCard({
  candidate,
  existingSections,
  onToggleSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onReject,
  onOpenSubdetail,
  onSaveSubdetail,
  subdetailState,
  isRejecting,
}: GeneratedOuvrageCandidateCardProps) {
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [subdetailOpen, setSubdetailOpen] = useState(false);
  const isResolved = candidate.resolutionStatus !== "pending";
  const isInserted = candidate.resolutionStatus === "inserted";
  const aiStatusConfig = AI_STATUS_CONFIG[candidate.status];
  const parentReadiness = getGeneratedOuvrageParentReadiness(candidate);
  const insertReady = isGeneratedOuvrageReadyForInsert(candidate);
  const selectionDisabled = !parentReadiness.isReady;
  const missingFieldsLabel = describeGeneratedOuvrageMissingFields(
    parentReadiness.missingFields
  );
  const nextStep = getNextStep(
    parentReadiness.isReady,
    candidate.subdetailReviewed,
    candidate.selected
  );

  if (isResolved) {
    return (
      <div
        className={cn(
          "rounded-lg border p-4",
          isInserted ? "border-success-border bg-success-subtle" : "border-border bg-surface-subtle"
        )}
        data-testid={`candidate-card-${candidate.candidateId}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {candidate.editedDesignation}
          </span>
          <Badge variant={isInserted ? "success" : "danger"} size="sm">
            {isInserted ? "Inséré" : "Rejeté"}
          </Badge>
        </div>
        {candidate.editedUnit && (
          <p className="mt-1 text-xs text-muted-foreground">
            Unité proposée : {candidate.editedUnit}
          </p>
        )}
      </div>
    );
  }

  if (candidate.isEditing) {
    return (
      <EditMode
        candidate={candidate}
        existingSections={existingSections}
        onSave={onSaveEdit}
        onCancel={onCancelEdit}
        provenanceOpen={provenanceOpen}
        onToggleProvenance={() => setProvenanceOpen((p) => !p)}
      />
    );
  }

  const handleOpenSubdetail = () => {
    setSubdetailOpen(true);
    if (!subdetailState?.data && subdetailState?.status !== "loading") {
      onOpenSubdetail(candidate.candidateId);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        candidate.selected
          ? "border-primary/40 bg-primary/5"
          : nextStep === "ready"
            ? "border-success-border bg-success-subtle"
            : "border-border bg-surface"
      )}
      data-testid={`candidate-card-${candidate.candidateId}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className={NATIVE_CHECKBOX_CLASS}
          checked={candidate.selected}
          onChange={() => onToggleSelect(candidate.candidateId)}
          aria-label={`Sélectionner ${candidate.designation}`}
          disabled={selectionDisabled}
        />
        <div className="min-w-0 flex-1">
          {/* Header: designation + AI confidence */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {candidate.editedDesignation}
            </span>
            <Badge variant={aiStatusConfig.variant} size="sm">
              {aiStatusConfig.label}
            </Badge>
            {insertReady && candidate.selected && (
              <Badge variant="success" size="sm">
                Prêt à insérer
              </Badge>
            )}
          </div>

          {/* Readiness stepper */}
          <ReadinessStepper
            parentReady={parentReadiness.isReady}
            subdetailReviewed={candidate.subdetailReviewed}
            selected={candidate.selected}
          />

          {/* Actionable guidance block */}
          {nextStep === "parent" && (
            <div className={cn(GUIDANCE_CLASS, "border-warning-border bg-warning-subtle")}>
              <p className="font-medium text-warning">
                Cet ouvrage n&apos;est pas prêt à être inséré.
              </p>
              <p className="mt-0.5 text-foreground-secondary">
                Il manque : {missingFieldsLabel}.
              </p>
              <p className="mt-1 text-foreground-secondary">
                Cliquez sur &laquo;&nbsp;Compléter la ligne&nbsp;&raquo; ci-dessous.
              </p>
            </div>
          )}
          {nextStep === "subdetail" && (
            <div className={cn(GUIDANCE_CLASS, "border-info-border bg-info-subtle")}>
              <p className="font-medium text-info">
                Ligne complète. Validez le sous-détail pour débloquer l&apos;insertion.
              </p>
            </div>
          )}
          {nextStep === "select" && (
            <div className={cn(GUIDANCE_CLASS, "border-success-border bg-success-subtle")}>
              <p className="font-medium text-success">
                Ouvrage prêt. Sélectionnez-le pour l&apos;ajouter au devis.
              </p>
            </div>
          )}

          {/* Metadata - hidden when parent incomplete to reduce density */}
          {parentReadiness.isReady && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {candidate.editedUnit && (
                <span>Unité : {candidate.editedUnit}</span>
              )}
              {candidate.editedQuantity != null && (
                <span>Quantité : {candidate.editedQuantity}</span>
              )}
              <span>
                Lot :{" "}
                {formatGeneratedOuvrageLotLabel({
                  lotId: candidate.editedLotId,
                  existingSections,
                })}
              </span>
              <span>
                Confiance : {`${Math.round(candidate.confidence * 100)} %`}
              </span>
            </div>
          )}

          {/* Reasoning - hidden when parent incomplete */}
          {candidate.reasoning && parentReadiness.isReady && (
            <p className="mt-1 text-xs text-muted-foreground italic">
              {candidate.reasoning}
            </p>
          )}

          {/* Sources remain available in review mode, including incomplete candidates. */}
          {candidate.sources.length > 0 && (
            <div className="mt-2">
              <Button
                type="button"
                variant="link"
                size="xs"
                aria-expanded={provenanceOpen}
                onClick={() => setProvenanceOpen((p) => !p)}
              >
                {provenanceOpen
                  ? "Masquer les sources"
                  : `Voir les sources (${candidate.sources.length})`}
              </Button>
              {provenanceOpen && <SourceList sources={candidate.sources} />}
            </div>
          )}

          {/* Action buttons - primary CTA adapts to current step */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Primary CTA - changes based on next required step */}
            {nextStep === "parent" && (
              <Button
                type="button"
                variant="primary"
                size="xs"
                onClick={() => onStartEdit(candidate.candidateId)}
              >
                Compléter la ligne
              </Button>
            )}
            {nextStep === "subdetail" && (
              <Button
                type="button"
                variant="primary"
                size="xs"
                onClick={handleOpenSubdetail}
              >
                Valider le sous-détail
              </Button>
            )}
            {nextStep === "select" && (
              <Button
                type="button"
                variant="primary"
                size="xs"
                onClick={() => onToggleSelect(candidate.candidateId)}
              >
                Sélectionner pour insertion
              </Button>
            )}

            {/* Divider between primary and secondary */}
            {nextStep !== "ready" && (
              <span className="h-4 w-px bg-border" aria-hidden="true" />
            )}

            {/* Select/deselect - hidden when it's the primary CTA or parent incomplete */}
            {parentReadiness.isReady && nextStep !== "select" && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onToggleSelect(candidate.candidateId)}
              >
                {candidate.selected ? "Désélectionner" : "Sélectionner"}
              </Button>
            )}

            {/* Subdetail toggle - hidden when it's the primary CTA or parent incomplete */}
            {parentReadiness.isReady && nextStep !== "subdetail" && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={subdetailOpen}
                onClick={() => {
                  setSubdetailOpen((open) => !open);
                  if (!subdetailState?.data && subdetailState?.status !== "loading") {
                    onOpenSubdetail(candidate.candidateId);
                  }
                }}
              >
                {subdetailOpen
                  ? "Masquer le sous-détail"
                  : candidate.subdetailReviewed
                    ? "Revoir le sous-détail"
                    : "Sous-détail"}
              </Button>
            )}

            {/* Edit - hidden when "Compléter la ligne" is already the primary CTA */}
            {nextStep !== "parent" && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onStartEdit(candidate.candidateId)}
              >
                Modifier
              </Button>
            )}

            {/* Reject - always available */}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-danger hover:bg-danger-subtle hover:text-danger"
              onClick={() => onReject(candidate.candidateId)}
              disabled={isRejecting}
            >
              Rejeter
            </Button>
          </div>

          {/* Subdetail editor - only shown when parent is ready */}
          {subdetailOpen && parentReadiness.isReady ? (
            <div aria-live="polite">
              {subdetailState?.status === "loading" ? (
                <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4 text-sm text-muted-foreground">
                  Génération du sous-détail composé en cours…
                </div>
              ) : null}
              {subdetailState?.status === "error" ? (
                <Alert variant="danger" className="mt-4">
                  {subdetailState.errorMessage}
                </Alert>
              ) : null}
              {subdetailState?.data ? (
                <GeneratedOuvrageSubdetailEditor
                  candidateLabel={candidate.editedDesignation}
                  subdetail={subdetailState.data}
                  isSaving={subdetailState.status === "saving"}
                  onSave={(components) =>
                    onSaveSubdetail(candidate.candidateId, components)
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RequiredMark({ missing }: { missing: boolean }) {
  if (!missing) return null;
  return (
    <span className="text-danger" aria-hidden="true">
      *
    </span>
  );
}

function EditMode({
  candidate,
  existingSections,
  onSave,
  onCancel,
  provenanceOpen,
  onToggleProvenance,
}: {
  candidate: UiGeneratedOuvrageCandidate;
  existingSections: ExistingSection[];
  onSave: (candidateId: string, edits: CandidateEdits) => void;
  onCancel: (candidateId: string) => void;
  provenanceOpen: boolean;
  onToggleProvenance: () => void;
}) {
  const fieldId = useId();
  const [designation, setDesignation] = useState(candidate.editedDesignation);
  const [unit, setUnit] = useState(candidate.editedUnit ?? "");
  const [quantity, setQuantity] = useState(
    candidate.editedQuantity != null ? String(candidate.editedQuantity) : ""
  );
  const [lotId, setLotId] = useState(candidate.editedLotId ?? "");

  const parentReadiness = getGeneratedOuvrageParentReadiness({
    editedDesignation: designation.trim(),
    editedUnit: unit.trim() || null,
    editedQuantity: quantity.trim()
      ? Number.parseFloat(quantity.replace(",", "."))
      : null,
  });

  const designationMissing = !designation.trim();
  const unitMissing = !unit.trim();
  const quantityMissing =
    !quantity.trim() || !(Number.parseFloat(quantity.replace(",", ".")) > 0);

  const handleSave = () => {
    const parsedQty = quantity.trim()
      ? Number.parseFloat(quantity.replace(",", "."))
      : null;
    onSave(candidate.candidateId, {
      designation: designation.trim(),
      unit: unit.trim() || null,
      quantity:
        parsedQty != null && Number.isFinite(parsedQty) ? parsedQty : null,
      lotId: lotId || null,
    });
  };

  return (
    <div
      className="rounded-lg border border-primary/40 bg-primary/5 p-4"
      data-testid={`candidate-card-${candidate.candidateId}`}
    >
      <div className="space-y-3">
        <p className="text-xs font-medium text-foreground-secondary">
          Complétez la ligne pour débloquer la sélection et l&apos;insertion.
        </p>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${fieldId}-designation`} className="text-xs">
            Désignation
            <RequiredMark missing={designationMissing} />
          </FieldLabel>
          <Input
            id={`${fieldId}-designation`}
            type="text"
            size="sm"
            className={cn(designationMissing && "border-warning-border")}
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            aria-required="true"
            data-testid="edit-designation"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${fieldId}-unit`} className="text-xs">
              Unité
              <RequiredMark missing={unitMissing} />
            </FieldLabel>
            <Input
              id={`${fieldId}-unit`}
              type="text"
              size="sm"
              className={cn(unitMissing && "border-warning-border")}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ex. : m2, ml, u, kg"
              aria-required="true"
              data-testid="edit-unit"
            />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor={`${fieldId}-quantity`} className="text-xs">
              Quantité
              <RequiredMark missing={quantityMissing} />
            </FieldLabel>
            <Input
              id={`${fieldId}-quantity`}
              type="text"
              size="sm"
              className={cn(quantityMissing && "border-warning-border")}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="ex. : 12,5"
              aria-required="true"
              data-testid="edit-quantity"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${fieldId}-lot`} className="text-xs">
            Lot
          </FieldLabel>
          <NativeSelect
            id={`${fieldId}-lot`}
            size="sm"
            value={lotId}
            onChange={(e) => setLotId(e.target.value)}
            data-testid="edit-lot"
          >
            <option value="">{GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL}</option>
            {existingSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.path}
              </option>
            ))}
          </NativeSelect>
        </div>

        {/* Live readiness feedback */}
        {parentReadiness.isReady ? (
          <p className="rounded-lg border border-success-border bg-success-subtle px-3 py-2 text-xs text-success">
            Ligne complète. Validez pour passer à l&apos;étape suivante.
          </p>
        ) : (
          <p className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-xs text-warning">
            Renseignez les champs marqués * pour compléter la ligne.
          </p>
        )}

        {candidate.sources.length > 0 && (
          <div>
            <Button
              type="button"
              variant="link"
              size="xs"
              aria-expanded={provenanceOpen}
              onClick={onToggleProvenance}
            >
              {provenanceOpen
                ? "Masquer les sources"
                : `Voir les sources (${candidate.sources.length})`}
            </Button>
            {provenanceOpen && <SourceList sources={candidate.sources} />}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            size="xs"
            onClick={handleSave}
            disabled={designationMissing}
          >
            {parentReadiness.isReady ? "Valider la ligne" : "Enregistrer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onCancel(candidate.candidateId)}
          >
            Annuler
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceList({
  sources,
}: {
  sources: UiGeneratedOuvrageCandidate["sources"];
}) {
  return (
    <ul className="mt-2 space-y-1.5">
      {sources.map((src) => (
        <li
          key={src.sourceFragmentId}
          className="rounded-md border border-border-subtle bg-surface p-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="info" size="sm">
              {SOURCE_TYPE_LABELS[src.type] ?? src.type}
            </Badge>
            <span className="font-medium text-foreground">{src.label}</span>
          </div>
          {src.excerpt && (
            <p className="mt-1 line-clamp-2 text-muted-foreground">{src.excerpt}</p>
          )}
          {src.sourceFileName && (
            <p className="mt-0.5 text-muted-foreground">
              Fichier : {src.sourceFileName}
              {src.sourcePageFrom != null &&
                ` (p. ${src.sourcePageFrom}${src.sourcePageTo != null && src.sourcePageTo !== src.sourcePageFrom ? `-${src.sourcePageTo}` : ""})`}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
