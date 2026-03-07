"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

import {
  GENERATED_OUVRAGE_FALLBACK_SECTION_LABEL,
  formatGeneratedOuvrageLotLabel,
  type CandidateEdits,
  type ExistingSection,
  type UiGeneratedOuvrageCandidate,
} from "./generated-ouvrage-types";

type GeneratedOuvrageCandidateCardProps = {
  candidate: UiGeneratedOuvrageCandidate;
  existingSections: ExistingSection[];
  onToggleSelect: (candidateId: string) => void;
  onStartEdit: (candidateId: string) => void;
  onSaveEdit: (candidateId: string, edits: CandidateEdits) => void;
  onCancelEdit: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
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

export function GeneratedOuvrageCandidateCard({
  candidate,
  existingSections,
  onToggleSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onReject,
  isRejecting,
}: GeneratedOuvrageCandidateCardProps) {
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const isResolved = candidate.resolutionStatus !== "pending";
  const isInserted = candidate.resolutionStatus === "inserted";
  const aiStatusConfig = AI_STATUS_CONFIG[candidate.status];

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

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        candidate.selected ? "border-primary/40 bg-primary/5" : "border-slate-200"
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
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {candidate.editedDesignation}
            </span>
            <Badge variant={aiStatusConfig.variant} size="sm">
              {aiStatusConfig.label}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
            {candidate.editedUnit && (
              <span>Unite proposee : {candidate.editedUnit}</span>
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

          {candidate.reasoning && (
            <p className="text-xs text-slate-400 mt-1 italic">
              {candidate.reasoning}
            </p>
          )}

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

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onToggleSelect(candidate.candidateId)}
            >
              {candidate.selected ? "Deselectionner" : "Selectionner"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onStartEdit(candidate.candidateId)}
            >
              Modifier
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => onReject(candidate.candidateId)}
              disabled={isRejecting}
            >
              Rejeter
            </button>
          </div>
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
        <div>
          <label className="label text-xs font-medium">Designation</label>
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            data-testid="edit-designation"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs font-medium">Unite proposee</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              data-testid="edit-unit"
            />
          </div>
          <div>
            <label className="label text-xs font-medium">Quantite</label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
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
            Valider
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
