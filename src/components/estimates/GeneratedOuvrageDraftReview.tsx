"use client";

import { Badge } from "@/components/ui/Badge";

import { GeneratedOuvrageCandidateCard } from "./GeneratedOuvrageCandidateCard";
import type {
  CandidateEdits,
  ExistingSection,
  GeneratedOuvrageSubdetailEditorComponent,
  GeneratedOuvrageSubdetailUiState,
  UiGeneratedOuvrageCandidate,
} from "./generated-ouvrage-types";

type DraftSummary = {
  totalCandidates: number;
  certainCount: number;
  plausibleCount: number;
  questionCount: number;
  pendingCount: number;
  insertedCount: number;
  rejectedCount: number;
};

type GeneratedOuvrageDraftReviewProps = {
  candidates: UiGeneratedOuvrageCandidate[];
  summary: DraftSummary;
  draftStatus: string;
  existingSections: ExistingSection[];
  rejectingCandidateId: string | null;
  statusMessage: string | null;
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
  subdetailByCandidateId: Record<string, GeneratedOuvrageSubdetailUiState>;
};

const STATUS_MESSAGES: Record<string, string> = {
  partially_applied:
    "Certains ouvrages ont déjà été insérés. Les ouvrages restants peuvent encore être revus.",
  discarded:
    "Toutes les propositions ont ete rejetees ou ecartees.",
};

export function GeneratedOuvrageDraftReview({
  candidates,
  summary,
  draftStatus,
  existingSections,
  rejectingCandidateId,
  statusMessage,
  onToggleSelect,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onReject,
  onOpenSubdetail,
  onSaveSubdetail,
  subdetailByCandidateId,
}: GeneratedOuvrageDraftReviewProps) {
  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {summary.certainCount > 0 && (
          <Badge variant="success" size="sm">
            {summary.certainCount} Certain
          </Badge>
        )}
        {summary.plausibleCount > 0 && (
          <Badge variant="warning" size="sm">
            {summary.plausibleCount} Plausible
          </Badge>
        )}
        {summary.questionCount > 0 && (
          <Badge variant="error" size="sm">
            {summary.questionCount} A clarifier
          </Badge>
        )}
        {summary.pendingCount > 0 && (
          <Badge variant="neutral" size="sm">
            {summary.pendingCount} En attente
          </Badge>
        )}
        {summary.insertedCount > 0 && (
          <Badge variant="success" size="sm">
            {summary.insertedCount} Insere(s)
          </Badge>
        )}
        {summary.rejectedCount > 0 && (
          <Badge variant="error" size="sm">
            {summary.rejectedCount} Rejete(s)
          </Badge>
        )}
      </div>

      {/* Draft status message */}
      {STATUS_MESSAGES[draftStatus] && (
        <div className="text-sm text-slate-500 italic">
          {STATUS_MESSAGES[draftStatus]}
        </div>
      )}

      {/* Status announcement */}
      {statusMessage && (
        <div
          aria-live="polite"
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
        >
          {statusMessage}
        </div>
      )}
      {/* Keep sr-only fallback for screen readers when no visible message */}
      {!statusMessage && (
        <div aria-live="polite" className="sr-only" />
      )}

      {/* Candidate list */}
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {candidates.map((candidate) => (
          <GeneratedOuvrageCandidateCard
            key={candidate.candidateId}
            candidate={candidate}
            existingSections={existingSections}
            onToggleSelect={onToggleSelect}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onReject={onReject}
            onOpenSubdetail={onOpenSubdetail}
            onSaveSubdetail={onSaveSubdetail}
            subdetailState={subdetailByCandidateId[candidate.candidateId] ?? null}
            isRejecting={rejectingCandidateId === candidate.candidateId}
          />
        ))}
      </div>
    </div>
  );
}
