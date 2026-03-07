"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";

import {
  fetchGeneratedOuvrageSubdetailDraft,
  generateOuvragesFromText,
  fetchGeneratedOuvrageDraft,
  insertGeneratedOuvrages,
  rejectGeneratedOuvrageDraft,
  updateGeneratedOuvrageSubdetailDraft,
} from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import type { GeneratedOuvrageDraftResult } from "@/lib/estimates/generated-ouvrages";

import {
  type CandidateEdits,
  type ExistingSection,
  type GeneratedOuvrageSubdetailEditorComponent,
  type GeneratedOuvrageSubdetailUiState,
  type UiGeneratedOuvrageCandidate,
  initUiCandidates,
} from "./generated-ouvrage-types";
import { GeneratedOuvrageSourceForm } from "./GeneratedOuvrageSourceForm";
import { GeneratedOuvrageDraftReview } from "./GeneratedOuvrageDraftReview";
import { GeneratedOuvrageFooterBar } from "./GeneratedOuvrageFooterBar";

type DialogStep = "input" | "generating" | "review" | "inserting" | "error";

export type GeneratedOuvrageDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  projectId: string;
  existingSections: ExistingSection[];
  onClose: (result?: { insertedCount?: number }) => void;
};

const DEFAULT_SUMMARY = {
  totalCandidates: 0,
  certainCount: 0,
  plausibleCount: 0,
  questionCount: 0,
  pendingCount: 0,
  insertedCount: 0,
  rejectedCount: 0,
};

export function GeneratedOuvrageDialog({
  isOpen,
  targetVersionId,
  projectId,
  existingSections,
  onClose,
}: GeneratedOuvrageDialogProps) {
  const toast = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<DialogStep>("input");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<UiGeneratedOuvrageCandidate[]>(
    []
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("pending");
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [rejectingCandidateId, setRejectingCandidateId] = useState<
    string | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [subdetailByCandidateId, setSubdetailByCandidateId] = useState<
    Record<string, GeneratedOuvrageSubdetailUiState>
  >({});
  const totalInsertedRef = useRef(0);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setStep("input");
      setErrorMessage(null);
      setCandidates([]);
      setDraftId(null);
      setDraftStatus("pending");
      setSummary(DEFAULT_SUMMARY);
      setRejectingCandidateId(null);
      setStatusMessage(null);
      setSubdetailByCandidateId({});
      totalInsertedRef.current = 0;
    }
  }, [isOpen]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const el = dialogRef.current;
    if (el) el.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose(
          totalInsertedRef.current > 0
            ? { insertedCount: totalInsertedRef.current }
            : undefined
        );
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const applyDraftResult = useCallback(
    (result: GeneratedOuvrageDraftResult, existingCandidates?: UiGeneratedOuvrageCandidate[]) => {
      setDraftId(result.draftId);
      setDraftStatus(result.status);
      setSummary(result.summary);
      setCandidates((prev) => {
        const nextCandidates = initUiCandidates(result.candidates, existingCandidates ?? prev);
        return nextCandidates.map((candidate) => {
          const subdetailState = subdetailByCandidateId[candidate.candidateId];
          return {
            ...candidate,
            subdetailStatus: subdetailState?.data?.status ?? candidate.subdetailStatus,
            subdetailReviewed:
              subdetailState?.data?.status === "reviewed" ||
              subdetailState?.data?.status === "applied",
          };
        });
      });
    },
    [subdetailByCandidateId]
  );

  const handleGenerate = useCallback(
    async (input: {
      sourceKind: "free_text" | "cctp_excerpt" | "internal_note";
      sourceText: string;
      preferredLotId: string | null;
    }) => {
      setStep("generating");
      setErrorMessage(null);
      try {
        const result = await generateOuvragesFromText({
          projectId,
          versionId: targetVersionId,
          sourceKind: input.sourceKind,
          sourceText: input.sourceText,
          preferredLotId: input.preferredLotId,
        });
        startTransition(() => {
          applyDraftResult(result);
          setStep("review");
        });
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Erreur lors de la generation."
        );
        setStep("error");
      }
    },
    [projectId, targetVersionId, applyDraftResult]
  );

  const handleReject = useCallback(
    async (candidateId: string) => {
      if (!draftId) return;
      setRejectingCandidateId(candidateId);
      setStatusMessage(null);
      try {
        await rejectGeneratedOuvrageDraft({ draftId, candidateId });
        const reloaded = await fetchGeneratedOuvrageDraft({
          versionId: targetVersionId,
          draftId,
        });
        startTransition(() => {
          applyDraftResult(reloaded);
          setStatusMessage("Proposition rejetee.");
        });
      } catch (err) {
        setStatusMessage(
          err instanceof Error ? err.message : "Erreur lors du rejet."
        );
      } finally {
        setRejectingCandidateId(null);
      }
    },
    [draftId, targetVersionId, applyDraftResult]
  );

  const handleInsertSelected = useCallback(async () => {
    if (!draftId) return;
    const selected = candidates.filter(
      (c) => c.selected && c.resolutionStatus === "pending"
    );
    if (selected.length === 0) return;

    const blocked = selected.filter((candidate) => !candidate.subdetailReviewed);
    if (blocked.length > 0) {
      setStatusMessage(
        "Chaque ouvrage selectionne doit avoir un sous-detail explicitement valide avant insertion."
      );
      return;
    }

    setStep("inserting");
    setStatusMessage(null);
    try {
      const insertResult = await insertGeneratedOuvrages({
        versionId: targetVersionId,
        draftId,
        acceptedCandidates: selected.map((c) => ({
          candidateId: c.candidateId,
          designation: c.editedDesignation,
          unit: c.editedUnit,
          quantity: c.editedQuantity,
          lotId: c.editedLotId,
        })),
      });

      totalInsertedRef.current += insertResult.insertedCount;

      const reloaded = await fetchGeneratedOuvrageDraft({
        versionId: targetVersionId,
        draftId,
      });
      startTransition(() => {
        applyDraftResult(reloaded);
      });

      if (
        reloaded.status === "applied" ||
        reloaded.status === "discarded"
      ) {
        toast.success({
          title: `${totalInsertedRef.current} ouvrage(s) insere(s) dans le devis.`,
        });
        onClose({ insertedCount: totalInsertedRef.current });
        return;
      }

      setStep("review");
      setStatusMessage(
        `${insertResult.insertedCount} ouvrage(s) insere(s). Il reste des propositions a traiter.`
      );
      toast.success({ title: `${insertResult.insertedCount} ouvrage(s) insere(s).` });
    } catch (err) {
      setStep("review");
      setStatusMessage(
        err instanceof Error ? err.message : "Erreur lors de l'insertion."
      );
    }
  }, [
    draftId,
    candidates,
    targetVersionId,
    applyDraftResult,
    toast,
    onClose,
  ]);

  const handleToggleSelect = useCallback((candidateId: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.candidateId === candidateId ? { ...c, selected: !c.selected } : c
      )
    );
  }, []);

  const handleStartEdit = useCallback((candidateId: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.candidateId === candidateId ? { ...c, isEditing: true } : c
      )
    );
  }, []);

  const handleSaveEdit = useCallback(
    (candidateId: string, edits: CandidateEdits) => {
      setCandidates((prev) =>
        prev.map((c) =>
          c.candidateId === candidateId
            ? {
                ...c,
                isEditing: false,
                editedDesignation: edits.designation,
                editedUnit: edits.unit,
                editedQuantity: edits.quantity,
                editedLotId: edits.lotId,
              }
            : c
        )
      );
    },
    []
  );

  const handleCancelEdit = useCallback((candidateId: string) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.candidateId === candidateId ? { ...c, isEditing: false } : c
      )
    );
  }, []);

  const handleNewGeneration = useCallback(() => {
    setStep("input");
    setCandidates([]);
    setDraftId(null);
    setDraftStatus("pending");
    setSummary(DEFAULT_SUMMARY);
    setStatusMessage(null);
    setErrorMessage(null);
    setSubdetailByCandidateId({});
    totalInsertedRef.current = 0;
  }, []);

  const handleOpenSubdetail = useCallback(
    async (candidateId: string) => {
      if (!draftId) return;

      setSubdetailByCandidateId((prev) => ({
        ...prev,
        [candidateId]: {
          status: "loading",
          data: prev[candidateId]?.data ?? null,
          errorMessage: null,
        },
      }));

      try {
        const result = await fetchGeneratedOuvrageSubdetailDraft({
          versionId: targetVersionId,
          draftId,
          candidateId,
        });
        startTransition(() => {
          setSubdetailByCandidateId((prev) => ({
            ...prev,
            [candidateId]: {
              status: "idle",
              data: result,
              errorMessage: null,
            },
          }));
          setCandidates((prev) =>
            prev.map((candidate) =>
              candidate.candidateId === candidateId
                ? {
                    ...candidate,
                    subdetailStatus: result.status,
                    subdetailReviewed:
                      result.status === "reviewed" || result.status === "applied",
                  }
                : candidate
            )
          );
        });
      } catch (err) {
        setSubdetailByCandidateId((prev) => ({
          ...prev,
          [candidateId]: {
            status: "error",
            data: prev[candidateId]?.data ?? null,
            errorMessage:
              err instanceof Error
                ? err.message
                : "Erreur lors du chargement du sous-detail.",
          },
        }));
      }
    },
    [draftId, targetVersionId]
  );

  const handleSaveSubdetail = useCallback(
    async (
      candidateId: string,
      components: GeneratedOuvrageSubdetailEditorComponent[]
    ) => {
      if (!draftId) return;

      setSubdetailByCandidateId((prev) => ({
        ...prev,
        [candidateId]: {
          status: "saving",
          data: prev[candidateId]?.data ?? null,
          errorMessage: null,
        },
      }));

      try {
        const result = await updateGeneratedOuvrageSubdetailDraft({
          versionId: targetVersionId,
          draftId,
          candidateId,
          markReviewed: true,
          components,
        });
        startTransition(() => {
          setSubdetailByCandidateId((prev) => ({
            ...prev,
            [candidateId]: {
              status: "idle",
              data: result,
              errorMessage: null,
            },
          }));
          setCandidates((prev) =>
            prev.map((candidate) =>
              candidate.candidateId === candidateId
                ? {
                    ...candidate,
                    subdetailStatus: result.status,
                    subdetailReviewed:
                      result.status === "reviewed" || result.status === "applied",
                  }
                : candidate
            )
          );
          setStatusMessage("Sous-detail valide. L'insertion reste une action explicite.");
        });
      } catch (err) {
        setSubdetailByCandidateId((prev) => ({
          ...prev,
          [candidateId]: {
            status: "error",
            data: prev[candidateId]?.data ?? null,
            errorMessage:
              err instanceof Error
                ? err.message
                : "Erreur lors de la sauvegarde du sous-detail.",
          },
        }));
      }
    },
    [draftId, targetVersionId]
  );

  const handleClose = useCallback(() => {
    onClose(
      totalInsertedRef.current > 0
        ? { insertedCount: totalInsertedRef.current }
        : undefined
    );
  }, [onClose]);

  if (!isOpen) return null;

  const selectedCount = candidates.filter(
    (c) => c.selected && c.resolutionStatus === "pending"
  ).length;
  const selectedReviewedCount = candidates.filter(
    (c) => c.selected && c.resolutionStatus === "pending" && c.subdetailReviewed
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[5vh]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Generer des ouvrages"
        tabIndex={-1}
        className="relative w-full max-w-5xl rounded-xl bg-white shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold">Generer des ouvrages</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={handleClose}
            aria-label="Fermer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {step === "input" && (
            <GeneratedOuvrageSourceForm
              existingSections={existingSections}
              isGenerating={false}
              onGenerate={handleGenerate}
            />
          )}

          {step === "generating" && (
            <GeneratedOuvrageSourceForm
              existingSections={existingSections}
              isGenerating={true}
              onGenerate={handleGenerate}
            />
          )}

          {step === "error" && (
            <div className="space-y-4">
              <div className="alert alert-error text-sm">
                {errorMessage ?? "Une erreur est survenue."}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleNewGeneration}
              >
                Reessayer
              </button>
            </div>
          )}

          {(step === "review" || step === "inserting") && (
            <>
              <GeneratedOuvrageDraftReview
                candidates={candidates}
                summary={summary}
                draftStatus={draftStatus}
                existingSections={existingSections}
                rejectingCandidateId={rejectingCandidateId}
                statusMessage={statusMessage}
                onToggleSelect={handleToggleSelect}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                onReject={handleReject}
                onOpenSubdetail={handleOpenSubdetail}
                onSaveSubdetail={handleSaveSubdetail}
                subdetailByCandidateId={subdetailByCandidateId}
              />
              <GeneratedOuvrageFooterBar
                selectedCount={selectedCount}
                selectedReviewedCount={selectedReviewedCount}
                draftStatus={draftStatus}
                isInserting={step === "inserting"}
                onNewGeneration={handleNewGeneration}
                onClose={handleClose}
                onInsertSelected={handleInsertSelected}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
