"use client";

import dynamic from "next/dynamic";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/Badge";
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

const GeneratedOuvrageSubdetailEditor = dynamic(
  () =>
    import("./GeneratedOuvrageSubdetailEditor").then((module) => module.GeneratedOuvrageSubdetailEditor),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Chargement du sous-detail...
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
  question: { variant: "error" as const, label: "A clarifier" },
} as const;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  text: "Texte",
  cctp: "CCTP",
  history: "Historique",
  library: "Bibliotheque",
};

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
    { label: "Completer la ligne", done: parentReady },
    { label: "Valider le sous-detail", done: subdetailReviewed },
    { label: "Selectionner", done: selected },
  ];

  const activeIndex = steps.findIndex((s) => !s.done);

  return (
    <div
      className="flex flex-wrap items-center gap-1 mt-2 text-xs"
      aria-label="Etapes de preparation"
    >
      {steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <svg
              className="h-3 w-3 text-slate-300 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06-1.06L9.44 8.5 6.22 5.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap transition-colors",
              step.done
                ? "bg-emerald-50 text-emerald-700"
                : i === activeIndex
                  ? "bg-amber-50 text-amber-800 font-medium ring-1 ring-amber-200/60"
                  : "bg-slate-50 text-slate-400"
            )}
          >
            {step.done ? (
              <svg
                className="h-3 w-3 shrink-0"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
            ) : (
              <span
                className="h-3 w-3 flex items-center justify-center text-[10px] font-bold shrink-0"
                aria-hidden="true"
              >
                {i + 1}
              </span>
            )}
            {step.label}
          </span>
        </Fragment>
      ))}
    </div>
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
          "rounded-lg border p-4 opacity-60",
          isInserted ? "border-success/30 bg-success/5" : "border-slate-200 bg-slate-50"
        )}
        data-testid={`candidate-card-${candidate.candidateId}`}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-slate-500">
            {candidate.editedDesignation}
          </span>
          <Badge variant={isInserted ? "success" : "error"} size="sm">
            {isInserted ? "Insere" : "Rejete"}
          </Badge>
        </div>
        {candidate.editedUnit && (
          <p className="text-xs text-slate-400 mt-1">
            Unite proposee : {candidate.editedUnit}
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
            ? "border-emerald-200 bg-emerald-50/30"
            : "border-slate-200"
      )}
      data-testid={`candidate-card-${candidate.candidateId}`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="checkbox checkbox-sm mt-0.5"
          checked={candidate.selected}
          onChange={() => onToggleSelect(candidate.candidateId)}
          aria-label={`Selectionner ${candidate.designation}`}
          disabled={selectionDisabled}
        />
        <div className="flex-1 min-w-0">
          {/* Header: designation + AI confidence */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {candidate.editedDesignation}
            </span>
            <Badge variant={aiStatusConfig.variant} size="sm">
              {aiStatusConfig.label}
            </Badge>
            {insertReady && candidate.selected && (
              <Badge variant="success" size="sm">
                Pret a inserer
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
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5">
              <p className="text-xs font-medium text-amber-900">
                Cet ouvrage n&apos;est pas pret a etre insere.
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Il manque : {missingFieldsLabel}.
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Cliquez sur &laquo;&nbsp;Completer la ligne&nbsp;&raquo; ci-dessous.
              </p>
            </div>
          )}
          {nextStep === "subdetail" && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2.5">
              <p className="text-xs font-medium text-blue-900">
                Ligne complete. Validez le sous-detail pour debloquer l&apos;insertion.
              </p>
            </div>
          )}
          {nextStep === "select" && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
              <p className="text-xs font-medium text-emerald-800">
                Ouvrage pret. Selectionnez-le pour l&apos;ajouter au devis.
              </p>
            </div>
          )}

          {/* Metadata - hidden when parent incomplete to reduce density */}
          {parentReadiness.isReady && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
              {candidate.editedUnit && (
                <span>Unite : {candidate.editedUnit}</span>
              )}
              {candidate.editedQuantity != null && (
                <span>Quantite : {candidate.editedQuantity}</span>
              )}
              <span>
                Lot :{" "}
                {formatGeneratedOuvrageLotLabel({
                  lotId: candidate.editedLotId,
                  existingSections,
                })}
              </span>
              <span>
                Confiance : {Math.round(candidate.confidence * 100)}%
              </span>
            </div>
          )}

          {/* Reasoning - hidden when parent incomplete */}
          {candidate.reasoning && parentReadiness.isReady && (
            <p className="text-xs text-slate-400 mt-1 italic">
              {candidate.reasoning}
            </p>
          )}

          {/* Sources remain available in review mode, including incomplete candidates. */}
          {candidate.sources.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setProvenanceOpen((p) => !p)}
              >
                {provenanceOpen
                  ? "Masquer les sources"
                  : `Voir les sources (${candidate.sources.length})`}
              </button>
              {provenanceOpen && <SourceList sources={candidate.sources} />}
            </div>
          )}

          {/* Action buttons - primary CTA adapts to current step */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Primary CTA - changes based on next required step */}
            {nextStep === "parent" && (
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => onStartEdit(candidate.candidateId)}
              >
                Completer la ligne
              </button>
            )}
            {nextStep === "subdetail" && (
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={handleOpenSubdetail}
              >
                Valider le sous-detail
              </button>
            )}
            {nextStep === "select" && (
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => onToggleSelect(candidate.candidateId)}
              >
                Selectionner pour insertion
              </button>
            )}

            {/* Divider between primary and secondary */}
            {nextStep !== "ready" && (
              <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
            )}

            {/* Select/deselect - hidden when it's the primary CTA or parent incomplete */}
            {parentReadiness.isReady && nextStep !== "select" && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => onToggleSelect(candidate.candidateId)}
              >
                {candidate.selected ? "Deselectionner" : "Selectionner"}
              </button>
            )}

            {/* Subdetail toggle - hidden when it's the primary CTA or parent incomplete */}
            {parentReadiness.isReady && nextStep !== "subdetail" && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  setSubdetailOpen((open) => !open);
                  if (!subdetailState?.data && subdetailState?.status !== "loading") {
                    onOpenSubdetail(candidate.candidateId);
                  }
                }}
              >
                {subdetailOpen
                  ? "Masquer le sous-detail"
                  : candidate.subdetailReviewed
                    ? "Revoir le sous-detail"
                    : "Sous-detail"}
              </button>
            )}

            {/* Edit - hidden when "Completer la ligne" is already the primary CTA */}
            {nextStep !== "parent" && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => onStartEdit(candidate.candidateId)}
              >
                Modifier
              </button>
            )}

            {/* Reject - always available */}
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => onReject(candidate.candidateId)}
              disabled={isRejecting}
            >
              Rejeter
            </button>
          </div>

          {/* Subdetail editor - only shown when parent is ready */}
          {subdetailOpen && parentReadiness.isReady ? (
            <div aria-live="polite">
              {subdetailState?.status === "loading" ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Generation du sous-detail compose en cours...
                </div>
              ) : null}
              {subdetailState?.status === "error" ? (
                <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
                  {subdetailState.errorMessage}
                </div>
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
        <p className="text-xs font-medium text-slate-700">
          Completez la ligne pour debloquer la selection et l&apos;insertion.
        </p>
        <div>
          <label className="label text-xs font-medium">
            Designation
            {!designation.trim() && (
              <span className="text-error ml-1">*</span>
            )}
          </label>
          <input
            type="text"
            className={cn(
              "input input-bordered input-sm w-full",
              !designation.trim() && "input-warning"
            )}
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            data-testid="edit-designation"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs font-medium">
              Unite
              {!unit.trim() && (
                <span className="text-error ml-1">*</span>
              )}
            </label>
            <input
              type="text"
              className={cn(
                "input input-bordered input-sm w-full",
                !unit.trim() && "input-warning"
              )}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ex: m2, ml, u, kg"
              data-testid="edit-unit"
            />
          </div>
          <div>
            <label className="label text-xs font-medium">
              Quantite
              {(!quantity.trim() || !(Number.parseFloat(quantity.replace(",", ".")) > 0)) && (
                <span className="text-error ml-1">*</span>
              )}
            </label>
            <input
              type="text"
              className={cn(
                "input input-bordered input-sm w-full",
                (!quantity.trim() || !(Number.parseFloat(quantity.replace(",", ".")) > 0)) && "input-warning"
              )}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="ex: 12.5"
              data-testid="edit-quantity"
            />
          </div>
        </div>
        <div>
          <label className="label text-xs font-medium">Lot</label>
          <select
            className="select select-bordered select-sm w-full"
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
          </select>
        </div>

        {/* Live readiness feedback */}
        {parentReadiness.isReady ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Ligne complete. Validez pour passer a l&apos;etape suivante.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Renseignez les champs marques * pour completer la ligne.
          </div>
        )}

        {candidate.sources.length > 0 && (
          <div>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={onToggleProvenance}
            >
              {provenanceOpen
                ? "Masquer les sources"
                : `Voir les sources (${candidate.sources.length})`}
            </button>
            {provenanceOpen && <SourceList sources={candidate.sources} />}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={handleSave}
            disabled={!designation.trim()}
          >
            {parentReadiness.isReady ? "Valider la ligne" : "Enregistrer"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onCancel(candidate.candidateId)}
          >
            Annuler
          </button>
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
          className="rounded border border-slate-100 bg-white p-2 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <Badge variant="info" size="sm">
              {SOURCE_TYPE_LABELS[src.type] ?? src.type}
            </Badge>
            <span className="font-medium">{src.label}</span>
          </div>
          {src.excerpt && (
            <p className="mt-1 text-slate-400 line-clamp-2">{src.excerpt}</p>
          )}
          {src.sourceFileName && (
            <p className="mt-0.5 text-slate-400">
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
