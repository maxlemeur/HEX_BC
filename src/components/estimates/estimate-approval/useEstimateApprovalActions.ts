import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  decideEstimateApprovalAction,
  submitEstimateForReviewAction,
  updateEstimateReviewCorrectionItemStatusAction,
} from "@/app/dashboard/_actions/estimate-approval";
import { useToast } from "@/components/ui/Toast";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";
import type {
  EstimateApprovalSummary,
  EstimateReviewCommentScope,
  EstimateReviewCorrectionStatus,
  EstimateReviewDecision,
} from "@/lib/estimates/rules-engine";

import {
  type DraftComment,
  DECISION_META,
  getTargetOptions,
  setSubmitPanelUrlState,
  SUBMIT_PANEL_QUERY_PARAM,
} from "./shared";

export function useEstimateApprovalActions({
  versionId,
  projectId,
  summary,
}: Readonly<{
  versionId: string;
  projectId: string;
  summary: EstimateApprovalSummary;
}>) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [draftScopeType, setDraftScopeType] =
    useState<EstimateReviewCommentScope>("project");
  const [draftScopeId, setDraftScopeId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<EstimateReviewDecision | null>(null);
  const [showSubmitPanel, setShowSubmitPanel] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [assignedReviewerUserId, setAssignedReviewerUserId] = useState<string | null>(
    summary.availableReviewers[0]?.userId ?? null
  );
  const submitPanelId = `estimate-approval-submit-panel-${versionId}`;

  const requestableReasons = summary.reasons.filter(
    (reason) => reason.approvalStatus === "missing" || reason.approvalStatus === "rejected"
  );
  const activeCycle = summary.activeCycle;
  const correctionChecklist = summary.correctionChecklist;
  const isResubmission = correctionChecklist !== null;
  const latestReview = summary.reviewHistory[0] ?? null;
  const olderReviews = summary.reviewHistory.slice(1);
  const scopeOptions = getTargetOptions(summary, draftScopeType);
  const selectedTarget =
    draftScopeType === "project"
      ? summary.commentTargets.project
      : scopeOptions.find((option) => option.scopeId === draftScopeId) ?? null;
  const canInteractWithChecklist =
    summary.permissions.canPrepareRequest && correctionChecklist !== null && activeCycle === null;
  const showPanel =
    summary.permissions.canPrepareRequest ||
    summary.permissions.canDecide ||
    correctionChecklist !== null ||
    summary.reviewHistory.length > 0 ||
    summary.activeCycle !== null;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      setShowSubmitPanel(url.searchParams.get(SUBMIT_PANEL_QUERY_PARAM) === "open");
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !summary.permissions.canPrepareRequest) {
      return;
    }

    const handleCockpitDialog = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== "approval-submit") {
        return;
      }

      setFormError(null);
      setShowSubmitPanel(true);
      setSubmitPanelUrlState(true);
    };

    document.addEventListener("cockpit-open-dialog", handleCockpitDialog);
    return () => document.removeEventListener("cockpit-open-dialog", handleCockpitDialog);
  }, [summary.permissions.canPrepareRequest]);

  useEffect(() => {
    if (typeof document === "undefined" || !summary.permissions.canPrepareRequest) {
      return;
    }

    const handleCockpitSurface = (event: Event) => {
      const detail = (event as CustomEvent<CockpitOpenSurfaceEventDetail>).detail;
      if (!detail || detail.surfaceId !== "approval-submit") {
        return;
      }

      setFormError(null);
      setShowSubmitPanel(true);
      setSubmitPanelUrlState(true);
    };

    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleCockpitSurface);
    return () =>
      document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleCockpitSurface);
  }, [summary.permissions.canPrepareRequest]);

  function resetDraftForm() {
    setDraftScopeType("project");
    setDraftScopeId(null);
    setDraftComment("");
    setFormError(null);
    setPendingConfirm(null);
  }

  function handleScopeTypeChange(nextScope: EstimateReviewCommentScope) {
    setDraftScopeType(nextScope);
    setDraftScopeId(null);
    setFormError(null);
  }

  function handleScopeIdChange(nextScopeId: string | null) {
    setDraftScopeId(nextScopeId);
    setFormError(null);
  }

  function handleDraftCommentChange(nextComment: string) {
    setDraftComment(nextComment);
    setFormError(null);
  }

  function handleSubmissionMessageChange(nextMessage: string) {
    setSubmissionMessage(nextMessage);
  }

  function clearDraftComments() {
    setDraftComments([]);
    resetDraftForm();
  }

  function handleAddComment() {
    const trimmedComment = draftComment.trim();
    if (trimmedComment.length === 0) {
      setFormError("Le commentaire est obligatoire.");
      return;
    }

    if (draftScopeType !== "project" && !selectedTarget?.scopeId) {
      setFormError("Choisissez une cible avant d'ajouter le commentaire.");
      return;
    }

    const scopeLabel = selectedTarget?.label ?? summary.commentTargets.project.label;
    setDraftComments((current) => [
      ...current,
      {
        id: `${draftScopeType}-${selectedTarget?.scopeId ?? "project"}-${current.length + 1}`,
        scopeType: draftScopeType,
        scopeId: draftScopeType === "project" ? null : selectedTarget?.scopeId ?? null,
        comment: trimmedComment,
        scopeLabel,
      },
    ]);
    resetDraftForm();
  }

  function removeDraftComment(commentId: string) {
    setDraftComments((current) => current.filter((entry) => entry.id !== commentId));
  }

  function toggleSubmitPanel() {
    setFormError(null);
    setShowSubmitPanel((current) => {
      const nextOpen = !current;
      setSubmitPanelUrlState(nextOpen);
      return nextOpen;
    });
  }

  function runCorrectionItemUpdate(
    itemId: string,
    status: Exclude<EstimateReviewCorrectionStatus, "pending">
  ) {
    startTransition(() => {
      void (async () => {
        try {
          await updateEstimateReviewCorrectionItemStatusAction({
            versionId,
            projectId,
            itemId,
            status,
          });

          toast.success({
            title:
              status === "corrected"
                ? "Item marque comme corrige"
                : "Item marque a discuter",
            description: "La checklist de correction a ete mise a jour.",
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Mise a jour impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de mettre a jour cet item.",
          });
        }
      })();
    });
  }

  function runSubmitAction() {
    if (!isResubmission && requestableReasons.length === 0) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const selectedReviewer =
            summary.availableReviewers.find(
              (reviewer) => reviewer.userId === assignedReviewerUserId
            ) ?? summary.availableReviewers[0] ?? null;

          await submitEstimateForReviewAction({
            versionId,
            projectId,
            ruleIds: requestableReasons.map((reason) => reason.ruleId),
            submissionMessage: submissionMessage.trim() || undefined,
            assignedReviewerUserId: selectedReviewer?.userId ?? null,
          });

          toast.success({
            title: "Version soumise a validation",
            description:
              selectedReviewer
                ? `Dossier transmis a ${selectedReviewer.fullName}.`
                : "Dossier transmis a la validation.",
          });
          setShowSubmitPanel(false);
          setSubmissionMessage("");
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Action impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de soumettre la version a validation.",
          });
        }
      })();
    });
  }

  function runDecision(decision: EstimateReviewDecision) {
    setFormError(null);

    if (DECISION_META[decision].requiresComment && draftComments.length === 0) {
      setFormError(
        decision === "approved_with_reservations"
          ? "Ajoutez au moins une réserve avant de valider."
          : "Ajoutez au moins un commentaire avant de renvoyer en correction."
      );
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          await decideEstimateApprovalAction({
            versionId,
            projectId,
            decision,
            comments: draftComments.map(({ scopeType, scopeId, comment }) => ({
              scopeType,
              scopeId,
              comment,
            })),
          });

          toast.success({
            title: DECISION_META[decision].successTitle,
            description:
              draftComments.length === 0
                ? "La décision a été historisée."
                : `${draftComments.length} commentaire${draftComments.length > 1 ? "s" : ""} historisé${draftComments.length > 1 ? "s" : ""}.`,
          });
          setDraftComments([]);
          resetDraftForm();
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Décision impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible d'enregistrer cette décision.",
          });
        }
      })();
    });
  }

  function prepareChangesRequestedDecision() {
    setFormError(null);
    if (draftComments.length === 0) {
      setFormError("Ajoutez au moins un commentaire avant de renvoyer en correction.");
      return;
    }

    setPendingConfirm("changes_requested");
  }

  function confirmChangesRequestedDecision() {
    setPendingConfirm(null);
    runDecision("changes_requested");
  }

  function cancelChangesRequestedDecision() {
    setPendingConfirm(null);
  }

  return {
    isPending,
    draftScopeType,
    draftScopeId,
    draftComment,
    draftComments,
    formError,
    pendingConfirm,
    showSubmitPanel,
    submissionMessage,
    assignedReviewerUserId,
    submitPanelId,
    requestableReasons,
    activeCycle,
    correctionChecklist,
    isResubmission,
    latestReview,
    olderReviews,
    scopeOptions,
    canInteractWithChecklist,
    showPanel,
    handleScopeTypeChange,
    handleScopeIdChange,
    handleDraftCommentChange,
    handleSubmissionMessageChange,
    setAssignedReviewerUserId,
    handleAddComment,
    clearDraftComments,
    removeDraftComment,
    toggleSubmitPanel,
    runCorrectionItemUpdate,
    runSubmitAction,
    runDecision,
    prepareChangesRequestedDecision,
    confirmChangesRequestedDecision,
    cancelChangesRequestedDecision,
  };
}
