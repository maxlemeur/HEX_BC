"use client";

import { Badge } from "@/components/ui/badge";

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
  onSubdetailChanged: (candidateId: string) => void;
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
    "Toutes les propositions ont été rejetées ou écartées.",
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
  onSubdetailChanged,
  onSaveSubdetail,
  subdetailByCandidateId,
}: GeneratedOuvrageDraftReviewProps) {
  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2">
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
          <Badge variant="danger" size="sm">
            {summary.questionCount} À clarifier
          </Badge>
        )}
        {summary.pendingCount > 0 && (
          <Badge variant="neutral" size="sm">
            {summary.pendingCount} En attente
          </Badge>
        )}
        {summary.insertedCount > 0 && (
          <Badge variant="success" size="sm">
            {summary.insertedCount} Inséré(s)
          </Badge>
        )}
        {summary.rejectedCount > 0 && (
          <Badge variant="danger" size="sm">
            {summary.rejectedCount} Rejeté(s)
          </Badge>
        )}
      </div>

      {/* Draft status message */}
      {STATUS_MESSAGES[draftStatus] && (
        <p className="text-sm text-muted-foreground italic">
          {STATUS_MESSAGES[draftStatus]}
        </p>
      )}

      {/* Status announcement: the live region stays mounted so updates are announced. */}
      <div aria-live="polite" aria-atomic="true" className="empty:mb-0">
        {statusMessage ? (
          <p className="rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-sm text-info">
            {statusMessage}
          </p>
        ) : null}
      </div>

      {/* Candidate list */}
      <div
        role="region"
        aria-label="Propositions d'ouvrages"
        className="relative max-h-[60vh] space-y-3 overflow-y-auto pr-1"
      >
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
            onSubdetailChanged={onSubdetailChanged}
            subdetailState={subdetailByCandidateId[candidate.candidateId] ?? null}
            isRejecting={rejectingCandidateId === candidate.candidateId}
          />
        ))}
      </div>
    </div>
  );
}
