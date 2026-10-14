"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { XIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui-legacy/Toast";
import {
  getEstimateDraftLockSessionId,
} from "@/lib/estimates/client";
import { applyGeneratedOuvrages } from "@/lib/estimates/generated-ouvrage-client";
import { normalizeGeneratedOuvrageParent } from "@/lib/estimates/generated-ouvrage-parent";

import {
  fetchGeneratedOuvrageSubdetailDraft,
  generateOuvragesFromText,
  fetchGeneratedOuvrageDraft,
  fetchResumableGeneratedOuvrageDraft,
  rejectGeneratedOuvrageDraft,
  updateGeneratedOuvrageSubdetailDraft,
} from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import type { GeneratedOuvrageDraftResult, GeneratedOuvrageSubdetailResult } from "@/lib/estimates/generated-ouvrages";

import {
  type CandidateEdits,
  type ExistingSection,
  type GeneratedOuvrageSubdetailEditorComponent,
  type GeneratedOuvrageSubdetailUiState,
  type UiGeneratedOuvrageCandidate,
  getGeneratedOuvrageParentReadiness,
  initUiCandidates,
  isGeneratedOuvrageReadyForInsert,
} from "./generated-ouvrage-types";
import { GeneratedOuvrageSourceForm } from "./GeneratedOuvrageSourceForm";
import { GeneratedOuvrageDraftReview } from "./GeneratedOuvrageDraftReview";
import { GeneratedOuvrageFooterBar } from "./GeneratedOuvrageFooterBar";
import { GeneratedOuvrageDraftPicker } from "./GeneratedOuvrageDraftPicker";

type DialogStep = "input" | "generating" | "review" | "inserting" | "error";

export type GeneratedOuvrageDialogProps = {
  scopeKey: string;
  isOpen: boolean;
  targetVersionId: string;
  projectId: string;
  existingSections: ExistingSection[];
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  ensureMutationCanProceed: (actionLabel: string) => Promise<boolean>;
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

function didReviewInputsChange(
  candidate: UiGeneratedOuvrageCandidate,
  edits: CandidateEdits
) {
  return (
    candidate.editedDesignation !== edits.designation ||
    (candidate.editedUnit ?? null) !== (edits.unit ?? null) ||
    candidate.editedQuantity !== edits.quantity
  );
}

function restoreReviewedParent(
  candidate: UiGeneratedOuvrageCandidate,
  subdetail: GeneratedOuvrageSubdetailResult
): UiGeneratedOuvrageCandidate {
  const savedParent = subdetail.reviewedCandidate;
  const canRestore = savedParent && candidate.resolutionStatus === "pending" &&
    !candidate.hasLocalParentEdits && !candidate.isEditing;
  const next = canRestore ? {
    ...candidate,
    editedDesignation: savedParent.designation,
    editedUnit: savedParent.unit,
    editedQuantity: savedParent.quantity,
  } : candidate;
  let parentMatches = !savedParent;
  if (savedParent) {
    try {
      const current = normalizeGeneratedOuvrageParent({
        designation: next.editedDesignation, unit: next.editedUnit, quantity: next.editedQuantity,
      });
      parentMatches = current.designation === savedParent.designation &&
        current.unit === savedParent.unit && current.quantity === savedParent.quantity;
    } catch {
      parentMatches = false;
    }
  }
  const reviewed = subdetail.status === "reviewed" || subdetail.status === "applied";
  return {
    ...next,
    subdetailStatus: reviewed && !parentMatches ? "pending_review" : subdetail.status,
    subdetailReviewed: reviewed && parentMatches,
  };
}

function isResumedDraft(
  value: unknown,
  expected: { draftId: string; versionId: string; projectId: string }
): value is GeneratedOuvrageDraftResult {
  if (!value || typeof value !== "object") return false;
  const draft = value as GeneratedOuvrageDraftResult;
  if (
    draft.draftId !== expected.draftId || draft.versionId !== expected.versionId ||
    draft.projectId !== expected.projectId ||
    (draft.status !== "pending" && draft.status !== "partially_applied") ||
    !Array.isArray(draft.candidates) || draft.candidates.length > 12 ||
    !draft.summary || typeof draft.summary !== "object"
  ) return false;
  const ids = new Set<string>();
  const nullableText = (input: unknown) => input === null || typeof input === "string";
  const candidatesValid = draft.candidates.every((candidate) => {
    if (
      !candidate || typeof candidate !== "object" ||
      typeof candidate.candidateId !== "string" || !candidate.candidateId ||
      ids.has(candidate.candidateId) || typeof candidate.designation !== "string" ||
      !nullableText(candidate.unit) || !nullableText(candidate.suggestedLotId) ||
      !nullableText(candidate.lotLabel) || !nullableText(candidate.reasoning) ||
      !(candidate.quantity === null || (Number.isFinite(candidate.quantity) && candidate.quantity >= 0)) ||
      !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1 ||
      !["certain", "plausible", "question"].includes(candidate.status) ||
      !["pending", "inserted", "rejected"].includes(candidate.resolutionStatus) ||
      !Array.isArray(candidate.sources)
    ) return false;
    const applied = candidate.appliedValues;
    if (applied != null && (
      typeof applied !== "object" ||
      typeof applied.designation !== "string" || !applied.designation.trim() ||
      !nullableText(applied.unit) || !nullableText(applied.lotId) ||
      !(applied.quantity === null || (Number.isFinite(applied.quantity) && applied.quantity >= 0))
    )) return false;
    ids.add(candidate.candidateId);
    return candidate.sources.every((source) =>
      source && typeof source === "object" && typeof source.sourceFragmentId === "string" &&
      typeof source.label === "string" && ["text", "cctp", "history", "library"].includes(source.type) &&
      nullableText(source.sourceDocumentId) && nullableText(source.excerpt) &&
      nullableText(source.sourceFileName) && nullableText(source.selectionLabel) &&
      (source.sourcePageFrom === null || (Number.isSafeInteger(source.sourcePageFrom) && source.sourcePageFrom > 0)) &&
      (source.sourcePageTo === null || (Number.isSafeInteger(source.sourcePageTo) && source.sourcePageTo > 0))
    );
  });
  if (!candidatesValid) return false;
  const expectedSummary = { ...DEFAULT_SUMMARY, totalCandidates: draft.candidates.length };
  for (const candidate of draft.candidates) {
    if (candidate.status === "certain") expectedSummary.certainCount += 1;
    if (candidate.status === "plausible") expectedSummary.plausibleCount += 1;
    if (candidate.status === "question") expectedSummary.questionCount += 1;
    if (candidate.resolutionStatus === "pending") expectedSummary.pendingCount += 1;
    if (candidate.resolutionStatus === "inserted") expectedSummary.insertedCount += 1;
    if (candidate.resolutionStatus === "rejected") expectedSummary.rejectedCount += 1;
  }
  return expectedSummary.pendingCount > 0 &&
    (Object.keys(expectedSummary) as Array<keyof typeof DEFAULT_SUMMARY>)
    .every((key) => draft.summary[key] === expectedSummary[key]);
}

export function GeneratedOuvrageDialog(props: GeneratedOuvrageDialogProps) {
  return <GeneratedOuvrageDialogSession key={`${props.scopeKey}:${props.projectId}:${props.targetVersionId}`} {...props} />;
}

function GeneratedOuvrageDialogSession({
  isOpen,
  targetVersionId,
  projectId,
  existingSections,
  isMutationBlocked,
  mutationBlockedMessage,
  ensureMutationCanProceed,
  onClose,
}: GeneratedOuvrageDialogProps) {
  const toast = useToast();
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
  const [resumingDraftId, setResumingDraftId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<{ draftId: string; message: string } | null>(null);
  const [pickerRevision, setPickerRevision] = useState(0);
  const [subdetailByCandidateId, setSubdetailByCandidateId] = useState<
    Record<string, GeneratedOuvrageSubdetailUiState>
  >({});
  const totalInsertedRef = useRef(0);
  const insertionPendingRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const generateRequestRef = useRef(0);
  const resumePendingRef = useRef(false);
  const mutationBlockRef = useRef({
    isBlocked: isMutationBlocked,
    message: mutationBlockedMessage,
  });

  useLayoutEffect(() => {
    mutationBlockRef.current = {
      isBlocked: isMutationBlocked,
      message: mutationBlockedMessage,
    };
  }, [isMutationBlocked, mutationBlockedMessage]);

  useLayoutEffect(() => {
    isOpenRef.current = isOpen;
    return () => {
      isOpenRef.current = false;
      generateRequestRef.current += 1;
    };
  }, [isOpen]);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      generateRequestRef.current += 1;
      insertionPendingRef.current = false;
      setStep("input");
      setErrorMessage(null);
      setCandidates([]);
      setDraftId(null);
      setDraftStatus("pending");
      setSummary(DEFAULT_SUMMARY);
      setRejectingCandidateId(null);
      setStatusMessage(null);
      setResumingDraftId(null);
      setResumeError(null);
      resumePendingRef.current = false;
      setSubdetailByCandidateId({});
      totalInsertedRef.current = 0;
    }
  }, [isOpen]);

  const applyDraftResult = useCallback(
    (result: GeneratedOuvrageDraftResult, existingCandidates?: UiGeneratedOuvrageCandidate[]) => {
      setDraftId(result.draftId);
      setDraftStatus(result.status);
      setSummary(result.summary);
      setCandidates((prev) => {
        return initUiCandidates(result.candidates, existingCandidates ?? prev);
      });
    },
    []
  );

  const handleResume = useCallback(async (requestedDraftId: string) => {
    if (!isOpenRef.current || resumePendingRef.current || insertionPendingRef.current) return;
    if (mutationBlockRef.current.isBlocked) {
      setResumeError({ draftId: requestedDraftId, message: mutationBlockRef.current.message });
      return;
    }
    const requestId = ++generateRequestRef.current;
    resumePendingRef.current = true;
    setResumingDraftId(requestedDraftId);
    setResumeError(null);
    let failureCode: string | null = null;
    try {
      const result = await fetchResumableGeneratedOuvrageDraft({
        versionId: targetVersionId,
        draftId: requestedDraftId,
      });
      if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
      if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
        throw new Error("Le brouillon reçu est invalide. Réessayez.");
      }
      if (!result.ok) {
        failureCode = result.error?.code ?? null;
        throw new Error(result.error?.message || "Le brouillon ne peut pas être repris.");
      }
      if (!isResumedDraft(result.data, { draftId: requestedDraftId, versionId: targetVersionId, projectId })) {
        throw new Error("Le brouillon reçu est invalide. Réessayez.");
      }
      if (mutationBlockRef.current.isBlocked) {
        throw new Error(mutationBlockRef.current.message);
      }
      const draft = result.data;
      setDraftId(draft.draftId);
      setDraftStatus(draft.status);
      setSummary(draft.summary);
      setCandidates(initUiCandidates(draft.candidates));
      setSubdetailByCandidateId({});
      setErrorMessage(null);
      setStatusMessage(null);
      setRejectingCandidateId(null);
      totalInsertedRef.current = 0;
      setStep("review");
    } catch (error) {
      if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
      setResumeError({
        draftId: requestedDraftId,
        message: error instanceof Error ? error.message : "Réessayez ou actualisez la liste.",
      });
      if (failureCode && [
        "GENERATED_OUVRAGE_NOT_RESUMABLE", "CONFLICT", "READ_ONLY",
        "NOT_FOUND", "FORBIDDEN", "ESTIMATE_WRITE_ROLE_REQUIRED",
      ].includes(failureCode)) {
        setPickerRevision((revision) => revision + 1);
      }
    } finally {
      if (isOpenRef.current && generateRequestRef.current === requestId) {
        resumePendingRef.current = false;
        setResumingDraftId(null);
      }
    }
  }, [projectId, targetVersionId]);

  const handleGenerate = useCallback(
    async (input: {
      sourceKind: "free_text" | "cctp_excerpt" | "internal_note";
      sourceText: string;
      preferredLotId: string | null;
    }) => {
      if (resumePendingRef.current) return;
      if (mutationBlockRef.current.isBlocked) {
        setErrorMessage(mutationBlockRef.current.message);
        return;
      }
      const requestId = generateRequestRef.current + 1;
      generateRequestRef.current = requestId;
      setResumeError(null);
      setStep("generating");
      setErrorMessage(null);
      try {
        const result = await generateOuvragesFromText({
          projectId,
          versionId: targetVersionId,
          draftLockSessionId: getEstimateDraftLockSessionId(targetVersionId),
          sourceKind: input.sourceKind,
          sourceText: input.sourceText,
          preferredLotId: input.preferredLotId,
        });
        if (!isOpenRef.current || generateRequestRef.current !== requestId) {
          return;
        }
        if ("ok" in result) throw new Error(result.error.message);
        startTransition(() => {
          applyDraftResult(result);
          setStep("review");
        });
      } catch (err) {
        if (!isOpenRef.current || generateRequestRef.current !== requestId) {
          return;
        }
        setErrorMessage(
          err instanceof Error ? err.message : "Erreur lors de la génération."
        );
        setStep("error");
      }
    },
    [projectId, targetVersionId, applyDraftResult]
  );

  const handleReject = useCallback(
    async (candidateId: string) => {
      if (!draftId) return;
      const requestId = generateRequestRef.current;
      setRejectingCandidateId(candidateId);
      setStatusMessage(null);
      try {
        const rejection = await rejectGeneratedOuvrageDraft({ versionId: targetVersionId, draftId, candidateId,
          draftLockSessionId: getEstimateDraftLockSessionId(targetVersionId) });
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        if (!rejection.ok) throw new Error(rejection.error.message);
        const reloaded = await fetchGeneratedOuvrageDraft({
          versionId: targetVersionId,
          draftId,
        });
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        startTransition(() => {
          applyDraftResult(reloaded);
          setStatusMessage("Proposition rejetée.");
        });
      } catch (err) {
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        setStatusMessage(
          err instanceof Error ? err.message : "Erreur lors du rejet."
        );
      } finally {
        if (isOpenRef.current && generateRequestRef.current === requestId) setRejectingCandidateId(null);
      }
    },
    [draftId, targetVersionId, applyDraftResult]
  );

  const handleInsertSelected = useCallback(async () => {
    if (!draftId || insertionPendingRef.current) return;
    if (isMutationBlocked) {
      setStatusMessage(mutationBlockedMessage);
      return;
    }
    const selected = candidates.filter(
      (c) => c.selected && c.resolutionStatus === "pending"
    );
    if (selected.length === 0) return;

    const blocked = selected.filter((candidate) => !candidate.subdetailReviewed ||
      !subdetailByCandidateId[candidate.candidateId]?.data?.reviewToken);
    if (blocked.length > 0) {
      setStatusMessage(
        "Chaque ouvrage sélectionné doit avoir un sous-détail explicitement validé avant insertion."
      );
      return;
    }

    const incompleteParents = selected.filter(
      (candidate) => !getGeneratedOuvrageParentReadiness(candidate).isReady
    );
    if (incompleteParents.length > 0) {
      setStatusMessage(
        "Chaque ouvrage sélectionné doit avoir une désignation, une unité et une quantité avant insertion."
      );
      return;
    }

    insertionPendingRef.current = true;
    let confirmedInsertedCount = 0;
    setStep("inserting");
    setStatusMessage(null);
    try {
      const canProceed = await ensureMutationCanProceed(
        "insérer les ouvrages générés"
      );
      if (!canProceed) {
        setStep("review");
        return;
      }

      if (!isOpenRef.current) return;
      if (mutationBlockRef.current.isBlocked) {
        setStep("review");
        setStatusMessage(mutationBlockRef.current.message);
        return;
      }

      const insertResult = await applyGeneratedOuvrages({
        versionId: targetVersionId,
        draftId,
        acceptedCandidates: selected.map((c) => ({
          candidateId: c.candidateId,
          designation: c.editedDesignation,
          unit: c.editedUnit,
          quantity: c.editedQuantity,
          lotId: c.editedLotId,
          reviewToken: subdetailByCandidateId[c.candidateId]?.data?.reviewToken,
        })),
      });

      if (!isOpenRef.current) return;
      if ("outcome" in insertResult || insertResult.replayed) {
        toast.info({ title: "La demande a déjà un résultat. Vérifiez-le pour recharger le devis actuel." });
        onClose();
        return;
      }
      totalInsertedRef.current += insertResult.insertedCount;
      confirmedInsertedCount = insertResult.insertedCount;

      const reloaded = await fetchGeneratedOuvrageDraft({
        versionId: targetVersionId,
        draftId,
      });
      if (!isOpenRef.current) return;
      startTransition(() => {
        applyDraftResult(reloaded);
      });

      if (
        reloaded.status === "applied" ||
        reloaded.status === "discarded"
      ) {
        toast.success({
          title: `${totalInsertedRef.current} ouvrage(s) inséré(s) dans le devis.`,
        });
        onClose({ insertedCount: totalInsertedRef.current });
        return;
      }

      setStep("review");
      setStatusMessage(
        `${insertResult.insertedCount} ouvrage(s) inséré(s). Il reste des propositions à traiter.`
      );
      toast.success({ title: `${insertResult.insertedCount} ouvrage(s) inséré(s).` });
    } catch (err) {
      if (!isOpenRef.current) return;
      if (confirmedInsertedCount > 0) {
        toast.warning({ title: `${confirmedInsertedCount} ouvrage(s) enregistré(s). Le devis doit être rechargé pour afficher le résultat.` });
        onClose({ insertedCount: totalInsertedRef.current });
        return;
      }
      if (err && typeof err === "object" && "code" in err &&
        ["GENERATED_OUVRAGE_OUTCOME_UNKNOWN", "ESTIMATE_BATCH_PENDING"].includes(String(err.code))) {
        toast.warning({ title: "L'application des ouvrages reste à vérifier dans le devis." });
        onClose();
        return;
      }
      setStep("review");
      setStatusMessage(
        err instanceof Error ? err.message : "Erreur lors de l'insertion."
      );
    } finally {
      insertionPendingRef.current = false;
    }
  }, [
    draftId,
    candidates,
    subdetailByCandidateId,
    targetVersionId,
    applyDraftResult,
    ensureMutationCanProceed,
    isMutationBlocked,
    mutationBlockedMessage,
    toast,
    onClose,
  ]);

  const handleToggleSelect = useCallback((candidateId: string) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.candidateId !== candidateId) {
          return c;
        }

        if (!getGeneratedOuvrageParentReadiness(c).isReady) {
          return c;
        }

        return { ...c, selected: !c.selected };
      })
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
      let reviewInvalidated = false;

      setCandidates((prev) =>
        prev.map((c) => {
          if (c.candidateId !== candidateId) {
            return c;
          }

          const shouldInvalidateReview =
            didReviewInputsChange(c, edits) &&
            (c.subdetailReviewed || c.subdetailStatus === "reviewed");
          reviewInvalidated ||= shouldInvalidateReview;

          const nextCandidate = {
            ...c,
            isEditing: false,
            editedDesignation: edits.designation,
            editedUnit: edits.unit,
            editedQuantity: edits.quantity,
            editedLotId: edits.lotId,
            hasLocalParentEdits: true,
            subdetailStatus: shouldInvalidateReview ? "pending_review" : c.subdetailStatus,
            subdetailReviewed: shouldInvalidateReview ? false : c.subdetailReviewed,
          };
          const parentReady = getGeneratedOuvrageParentReadiness(nextCandidate).isReady;

          return {
            ...nextCandidate,
            selected: parentReady ? c.selected : false,
          };
        })
      );

      const parentIncomplete = !getGeneratedOuvrageParentReadiness({
        editedDesignation: edits.designation,
        editedUnit: edits.unit,
        editedQuantity: edits.quantity,
      }).isReady;

      if (reviewInvalidated) {
        setSubdetailByCandidateId((prev) => {
          const current = prev[candidateId];
          if (!current?.data) {
            return prev;
          }

          return {
            ...prev,
            [candidateId]: {
              ...current,
              data: {
                ...current.data,
                status: "pending_review",
              },
              errorMessage: null,
            },
          };
        });
        setStatusMessage(
          "Les modifications du parent imposent une nouvelle validation du sous-détail."
        );
      } else if (parentIncomplete) {
        setStatusMessage(
          "Le parent doit conserver désignation, unité et quantité avant de pouvoir être sélectionné."
        );
      }
    },
    []
  );

  const handleCancelEdit = useCallback((candidateId: string) => {
    setCandidates((prev) =>
      prev.map((candidate) => {
        if (candidate.candidateId !== candidateId) return candidate;
        const next = { ...candidate, isEditing: false };
        const subdetail = subdetailByCandidateId[candidateId]?.data;
        return subdetail ? restoreReviewedParent(next, subdetail) : next;
      })
    );
  }, [subdetailByCandidateId]);

  const handleNewGeneration = useCallback(() => {
    generateRequestRef.current += 1;
    setResumeError(null);
    setResumingDraftId(null);
    resumePendingRef.current = false;
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
      const requestId = generateRequestRef.current;

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
          draftLockSessionId: getEstimateDraftLockSessionId(targetVersionId),
        });
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        if ("ok" in result) throw new Error(result.error.message);
        if (result.candidateId !== candidateId || result.draftId !== draftId ||
          result.versionId !== targetVersionId || result.projectId !== projectId ||
          !/^[a-f0-9]{64}$/i.test(result.reviewToken)) throw new Error("Le sous-détail reçu est invalide. Rechargez-le avant de le valider.");
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
            prev.map((candidate) => {
              if (candidate.candidateId !== candidateId) return candidate;
              return restoreReviewedParent(candidate, result);
            })
          );
        });
      } catch (err) {
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        setSubdetailByCandidateId((prev) => ({
          ...prev,
          [candidateId]: {
            status: "error",
            data: prev[candidateId]?.data ?? null,
            errorMessage:
              err instanceof Error
                ? err.message
                : "Erreur lors du chargement du sous-détail.",
          },
        }));
      }
    },
    [draftId, targetVersionId, projectId]
  );

  const handleSubdetailChanged = useCallback((candidateId: string) => {
    setCandidates((previous) => previous.map((candidate) => candidate.candidateId === candidateId
      ? { ...candidate, subdetailReviewed: false, subdetailStatus: "pending_review" }
      : candidate));
  }, []);

  const handleSaveSubdetail = useCallback(
    async (
      candidateId: string,
      components: GeneratedOuvrageSubdetailEditorComponent[]
    ) => {
      if (!draftId) return;
      const requestId = generateRequestRef.current;
      const candidate = candidates.find((entry) => entry.candidateId === candidateId);
      if (!candidate) return;
      const expectedReviewToken = subdetailByCandidateId[candidateId]?.data?.reviewToken;
      if (!expectedReviewToken || mutationBlockRef.current.isBlocked) {
        setStatusMessage(mutationBlockRef.current.isBlocked ? mutationBlockRef.current.message : "Rechargez le sous-détail avant de le valider.");
        return;
      }
      handleSubdetailChanged(candidateId);

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
          expectedReviewToken,
          draftLockSessionId: getEstimateDraftLockSessionId(targetVersionId),
          markReviewed: components.some((component) => component.status !== "rejected"),
          reviewedCandidate: {
            designation: candidate.editedDesignation,
            unit: candidate.editedUnit,
            quantity: candidate.editedQuantity,
          },
          components,
        });
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        if ("ok" in result) throw new Error(result.error.message);
        if (result.candidateId !== candidateId || result.draftId !== draftId ||
          result.versionId !== targetVersionId || result.projectId !== projectId ||
          !/^[a-f0-9]{64}$/i.test(result.reviewToken)) throw new Error("La revue reçue est invalide. Rechargez le sous-détail.");
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
                ? restoreReviewedParent(candidate, result)
                : candidate
            )
          );
          setStatusMessage(result.status === "reviewed"
            ? "Revue enregistrée. L'insertion exige un parent conforme aux valeurs validées."
            : "Décisions enregistrées. Rétablissez ou ajoutez un composant pour valider le sous-détail.");
        });
      } catch (err) {
        if (!isOpenRef.current || generateRequestRef.current !== requestId) return;
        setSubdetailByCandidateId((prev) => ({
          ...prev,
          [candidateId]: {
            status: "error",
            data: prev[candidateId]?.data ?? null,
            errorMessage:
              err instanceof Error
                ? err.message
                : "Erreur lors de la sauvegarde du sous-détail.",
          },
        }));
      }
    },
    [draftId, targetVersionId, projectId, candidates, subdetailByCandidateId, handleSubdetailChanged]
  );

  const handleClose = useCallback(() => {
    if (insertionPendingRef.current) return;
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
  const selectedParentReadyCount = candidates.filter(
    (c) =>
      c.selected &&
      c.resolutionStatus === "pending" &&
      getGeneratedOuvrageParentReadiness(c).isReady
  ).length;
  const selectedInsertReadyCount = candidates.filter(
    (c) =>
      c.selected &&
      c.resolutionStatus === "pending" &&
      isGeneratedOuvrageReadyForInsert(c)
  ).length;
  const selectedMissingParentCount = selectedCount - selectedParentReadyCount;
  const selectedMissingReviewCount =
    selectedParentReadyCount - selectedInsertReadyCount;
  const isSubdetailPending = Object.values(subdetailByCandidateId)
    .some((state) => state.status === "saving" || state.status === "loading");
  const canInsertSelected =
    !isSubdetailPending && selectedCount > 0 && selectedInsertReadyCount === selectedCount;

  const isInserting = step === "inserting";

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        size="xl"
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-5xl sm:p-0"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-14 sm:px-6 sm:pr-16">
          <DialogTitle>Générer des ouvrages</DialogTitle>
          <DialogDescription>
            Reprenez vos propositions sauvegardées ou collez un texte (CCTP, note interne…)
            pour générer des ouvrages à compléter et valider avant insertion.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="relative min-h-0 flex-1 gap-0 overflow-y-auto px-5 py-4 sm:px-6">
          {step === "input" && (
            <>
              <GeneratedOuvrageDraftPicker
                key={pickerRevision}
                versionId={targetVersionId}
                disabled={isMutationBlocked}
                resumingDraftId={resumingDraftId}
                resumeError={resumeError}
                onResume={(requestedDraftId) => {
                  startTransition(() => { void handleResume(requestedDraftId); });
                }}
              />
              <fieldset disabled={resumingDraftId !== null || isMutationBlocked} className="min-w-0">
                <GeneratedOuvrageSourceForm
                  existingSections={existingSections}
                  isGenerating={false}
                  onGenerate={handleGenerate}
                />
              </fieldset>
            </>
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
              <Alert variant="danger">
                {errorMessage ?? "Une erreur est survenue."}
              </Alert>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={handleNewGeneration}
              >
                Réessayer
              </Button>
            </div>
          )}

          {(step === "review" || isInserting) && (
            <>
              <fieldset disabled={isInserting || isSubdetailPending || isMutationBlocked} className="min-w-0">
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
                onSubdetailChanged={handleSubdetailChanged}
                subdetailByCandidateId={subdetailByCandidateId}
              />
              </fieldset>
              <GeneratedOuvrageFooterBar
                selectedCount={selectedCount}
                selectedReviewedCount={selectedReviewedCount}
                selectedMissingParentCount={selectedMissingParentCount}
                selectedMissingReviewCount={selectedMissingReviewCount}
                canInsertSelected={canInsertSelected}
                draftStatus={draftStatus}
                isInserting={isInserting}
                isMutationBlocked={isMutationBlocked}
                mutationBlockedMessage={mutationBlockedMessage}
                onNewGeneration={handleNewGeneration}
                onClose={handleClose}
                onInsertSelected={handleInsertSelected}
              />
            </>
          )}
        </DialogBody>

        {/* Rendered last so the initial focus lands on the first form field, not on the close icon. */}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 sm:top-4 sm:right-4"
          onClick={handleClose}
          aria-label="Fermer"
          disabled={isInserting}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
