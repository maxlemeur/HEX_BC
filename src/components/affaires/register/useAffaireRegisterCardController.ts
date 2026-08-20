"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  continueAffaireRegisterWithHypothesisAction,
  createAffaireRegisterEntryAction,
  requestAffaireRegisterRevalidationAction,
  updateAffaireRegisterEntryStatusAction,
} from "@/app/dashboard/affaires/_actions/register";
import { useToast } from "@/components/ui-legacy/Toast";
import {
  AFFAIRE_REGISTER_KIND_LABELS,
  type AffaireRegisterRevalidationImpactedStage,
  AFFAIRE_REGISTER_REVALIDATION_QUERY_PARAM,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  buildAffaireRegisterSearchHref,
  parseAffaireRegisterRevalidationSearchParam,
  type AffaireRegisterEntry,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
} from "@/lib/affaires/register";

import type {
  AffaireRegisterCardProps,
  PendingTransition,
  RegisterEntryFormState,
  RegisterRevalidationFormState,
} from "./registerTypes";
import {
  buildDerivedSummary,
  getErrorMessage,
  resolveTransitionFeedback,
} from "./registerViewModel";

const INITIAL_FORM_STATE: RegisterEntryFormState = {
  kind: "assumption",
  severity: "warning",
  text: "",
  scopeType: "project",
  scopeId: "",
  scopeRef: "",
  scopeLabel: "",
  sourceFileName: "",
};

const INITIAL_REVALIDATION_FORM_STATE: RegisterRevalidationFormState = {
  cause: "addendum_received",
  impactedStages: ["submission_readiness"],
  triggerFileName: "",
};

const DOCUMENT_REVALIDATION_CODES = new Set([
  "missing_dpgf",
  "missing_bpu_dqe",
  "missing_cctp",
]);

function resolveDefaultRevalidationImpactedStages(
  entry: Pick<AffaireRegisterEntry, "code" | "scopeType">
): AffaireRegisterRevalidationImpactedStage[] {
  if (entry.scopeType === "exception") {
    return ["exceptions_review", "submission_readiness"];
  }

  if (entry.code === "missing_plans") {
    return ["plans_replay", "submission_readiness"];
  }

  if (entry.code && DOCUMENT_REVALIDATION_CODES.has(entry.code)) {
    return ["document_review", "submission_readiness"];
  }

  return ["submission_readiness"];
}

function buildDefaultRevalidationFormState(
  entry: Pick<AffaireRegisterEntry, "code" | "scopeType">
): RegisterRevalidationFormState {
  return {
    cause: "addendum_received",
    impactedStages: resolveDefaultRevalidationImpactedStages(entry),
    triggerFileName: "",
  };
}

export function useAffaireRegisterCardController({
  projectId,
  versionId,
  registerPage,
  scopeOptions,
  summary = null,
  isReadOnly = false,
  errorMessage,
}: Readonly<AffaireRegisterCardProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isMutationPending, startMutationTransition] = useTransition();
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(
    null
  );
  const [transitionComment, setTransitionComment] = useState("");
  const [revalidationForm, setRevalidationForm] = useState<RegisterRevalidationFormState>(
    INITIAL_REVALIDATION_FORM_STATE
  );
  const [inlineFeedback, setInlineFeedback] = useState<{
    tone: "success" | "info";
    message: string;
  } | null>(null);
  const [form, setForm] = useState<RegisterEntryFormState>(INITIAL_FORM_STATE);
  const [isFormExpanded, setIsFormExpanded] = useState(false);

  const items = registerPage?.items ?? [];
  const isLoading = !errorMessage && registerPage === null;
  const activeScopeOptions =
    form.scopeType === "lot"
      ? scopeOptions.lots
      : form.scopeType === "line"
        ? scopeOptions.lines
        : [];
  const filterStatus = registerPage?.filters.status ?? "";
  const filterSeverity = registerPage?.filters.severity ?? "";
  const filterKind = registerPage?.filters.kind ?? "";
  const filterRevalidationRequired =
    registerPage?.filters.revalidationRequired ??
    parseAffaireRegisterRevalidationSearchParam(
      searchParams.get(AFFAIRE_REGISTER_REVALIDATION_QUERY_PARAM) ?? undefined
    );
  const hasActiveFilters = Boolean(
    filterStatus || filterSeverity || filterKind || filterRevalidationRequired
  );
  const effectiveSummary = summary ?? buildDerivedSummary(items);
  const activeFiltersLabel = [
    filterStatus ? AFFAIRE_REGISTER_STATUS_LABELS[filterStatus] : null,
    filterSeverity ? AFFAIRE_REGISTER_SEVERITY_LABELS[filterSeverity] : null,
    filterKind ? AFFAIRE_REGISTER_KIND_LABELS[filterKind] : null,
    filterRevalidationRequired ? "Revalidation requise" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function applyFilters(next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    revalidationRequired?: boolean;
    cursor?: string | null;
  }) {
    const nextStatus =
      "status" in next ? next.status ?? null : registerPage?.filters.status ?? null;
    const nextSeverity =
      "severity" in next
        ? next.severity ?? null
        : registerPage?.filters.severity ?? null;
    const nextKind =
      "kind" in next ? next.kind ?? null : registerPage?.filters.kind ?? null;
    const nextRevalidationRequired =
      "revalidationRequired" in next
        ? next.revalidationRequired ?? false
        : filterRevalidationRequired;
    const nextCursor =
      "cursor" in next ? next.cursor ?? null : registerPage?.filters.cursor ?? null;
    const href = buildAffaireRegisterSearchHref({
      pathname,
      searchParams: new URLSearchParams(searchParams.toString()),
      status: nextStatus,
      severity: nextSeverity,
      kind: nextKind,
      revalidationRequired: nextRevalidationRequired,
      cursor: nextCursor,
    });

    startFilterTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function resetFilters() {
    applyFilters({
      status: null,
      severity: null,
      kind: null,
      revalidationRequired: false,
      cursor: null,
    });
  }

  const scopeHelpMessage =
    form.scopeType === "exception" && !versionId
      ? "Une version courante est requise pour lier une exception."
      : (form.scopeType === "lot" || form.scopeType === "line") &&
          activeScopeOptions.length === 0
        ? form.scopeType === "lot"
          ? "Aucun lot disponible sur la version courante."
          : "Aucune ligne disponible sur la version courante."
        : null;
  const canCreateEntry =
    !isReadOnly &&
    form.text.trim().length > 0 &&
    !scopeHelpMessage &&
    (form.scopeType === "project" ||
      (form.scopeType === "exception" &&
        form.scopeRef.trim().length > 0 &&
        form.scopeLabel.trim().length > 0) ||
      ((form.scopeType === "lot" || form.scopeType === "line") &&
        form.scopeId.trim().length > 0));
  const formHint =
    form.scopeType === "project"
      ? "Le point concernera toute l'affaire."
      : form.scopeType === "lot"
        ? "Sélectionnez le lot précis concerné pour éviter une ambiguïté de traitement."
        : form.scopeType === "line"
          ? "Sélectionnez la ligne exacte impactée sur la version courante."
          : "Renseignez une référence et un libellé lisibles pour tracer l'exception.";
  const formReadinessMessage =
    form.text.trim().length === 0
      ? "Ajoutez une formulation courte, factuelle et actionnable."
      : scopeHelpMessage
        ? scopeHelpMessage
        : form.scopeType === "exception" &&
            (form.scopeRef.trim().length === 0 || form.scopeLabel.trim().length === 0)
          ? "La référence et le libellé de l'exception sont requis."
          : (form.scopeType === "lot" || form.scopeType === "line") &&
              form.scopeId.trim().length === 0
            ? "Sélectionnez un scope cible pour activer l'ajout."
            : "Prêt à ajouter. Le point sera créé en statut ouvert et historisé.";

  async function handleCreateEntry() {
    startMutationTransition(() => {
      void (async () => {
        try {
          const result = await createAffaireRegisterEntryAction({
            projectId,
            versionId,
            kind: form.kind,
            text: form.text,
            severity: form.severity,
            scopeType: form.scopeType,
            scopeId:
              form.scopeType === "lot" || form.scopeType === "line"
                ? form.scopeId || null
                : null,
            scopeRef: form.scopeType === "exception" ? form.scopeRef || null : null,
            scopeLabel:
              form.scopeType === "exception" ? form.scopeLabel || null : null,
            sourceFileName: form.sourceFileName || null,
          });

          setForm((current) => ({
            ...current,
            text: "",
            scopeId: "",
            scopeRef: "",
            scopeLabel: "",
            sourceFileName: "",
          }));
          setIsFormExpanded(false);
          setInlineFeedback({
            tone: "success",
            message:
              "Entrée ajoutée. Elle apparaîtra aussi dans l'historique récent du registre.",
          });
          toast.success({
            title: "Entrée ajoutée",
            description: `${AFFAIRE_REGISTER_KIND_LABELS[result.entry.kind]} enregistrée dans le registre.`,
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Création impossible",
            description: getErrorMessage(error),
          });
        }
      })();
    });
  }

  async function handleConfirmTransitionRequest(
    transition: PendingTransition,
    comment: string
  ) {
    setPendingEntryId(transition.entry.id);
    startMutationTransition(() => {
      void (async () => {
        try {
          if (transition.kind === "continue_with_hypothesis") {
            await continueAffaireRegisterWithHypothesisAction({
              projectId,
              versionId,
              entryId: transition.entry.id,
              comment: comment.trim().length > 0 ? comment : null,
            });
          } else if (transition.kind === "request_revalidation") {
            await requestAffaireRegisterRevalidationAction({
              projectId,
              versionId,
              entryId: transition.entry.id,
              cause: revalidationForm.cause,
              impactedStages: revalidationForm.impactedStages,
              triggerDocumentId: null,
              triggerFileName:
                revalidationForm.triggerFileName.trim().length > 0
                  ? revalidationForm.triggerFileName
                  : null,
              comment: comment.trim().length > 0 ? comment : null,
            });
          } else {
            await updateAffaireRegisterEntryStatusAction({
              projectId,
              versionId,
              entryId: transition.entry.id,
              status: transition.nextStatus,
              comment: comment.trim().length > 0 ? comment : null,
            });
          }
          const feedback = resolveTransitionFeedback(transition);
          setInlineFeedback({
            tone: "info",
            message: feedback.inlineMessage,
          });
          toast.success({
            title: feedback.toastTitle,
            description: feedback.toastDescription,
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Mise à jour impossible",
            description: getErrorMessage(error),
          });
        } finally {
          setPendingEntryId(null);
        }
      })();
    });
  }

  function openTransitionDialog(transition: PendingTransition) {
    setInlineFeedback(null);
    setTransitionComment("");
    setRevalidationForm(
      transition.kind === "request_revalidation"
        ? buildDefaultRevalidationFormState(transition.entry)
        : INITIAL_REVALIDATION_FORM_STATE
    );
    setPendingTransition(transition);
  }

  function closeTransitionDialog() {
    if (isMutationPending) {
      return;
    }

    setPendingTransition(null);
    setTransitionComment("");
    setRevalidationForm(INITIAL_REVALIDATION_FORM_STATE);
  }

  async function handleConfirmTransition() {
    if (!pendingTransition) {
      return;
    }

    await handleConfirmTransitionRequest(pendingTransition, transitionComment);
    setPendingTransition(null);
    setTransitionComment("");
    setRevalidationForm(INITIAL_REVALIDATION_FORM_STATE);
  }

  function updateForm<K extends keyof RegisterEntryFormState>(
    key: K,
    value: RegisterEntryFormState[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleScopeTypeChange(value: RegisterEntryFormState["scopeType"]) {
    setForm((current) => ({
      ...current,
      scopeType: value,
      scopeId: "",
      scopeRef: "",
      scopeLabel: "",
    }));
  }

  function setRevalidationCause(value: RegisterRevalidationFormState["cause"]) {
    setRevalidationForm((current) => ({
      ...current,
      cause: value,
    }));
  }

  function toggleRevalidationStage(value: AffaireRegisterRevalidationImpactedStage) {
    setRevalidationForm((current) => ({
      ...current,
      impactedStages: current.impactedStages.includes(value)
        ? current.impactedStages.filter((stage) => stage !== value)
        : [...current.impactedStages, value],
    }));
  }

  function setRevalidationTriggerFileName(value: string) {
    setRevalidationForm((current) => ({
      ...current,
      triggerFileName: value,
    }));
  }

  const isTransitionConfirmDisabled =
    pendingTransition?.kind === "request_revalidation" &&
    revalidationForm.impactedStages.length === 0;

  return {
    items,
    isLoading,
    isReadOnly,
    registerPage,
    activeScopeOptions,
    filterStatus,
    filterSeverity,
    filterKind,
    filterRevalidationRequired,
    hasActiveFilters,
    effectiveSummary,
    activeFiltersLabel,
    isFilterPending,
    isMutationPending,
    pendingEntryId,
    pendingTransition,
    transitionComment,
    revalidationForm,
    inlineFeedback,
    form,
    isFormExpanded,
    scopeHelpMessage,
    canCreateEntry,
    formHint,
    formReadinessMessage,
    applyFilters,
    resetFilters,
    handleCreateEntry,
    openTransitionDialog,
    closeTransitionDialog,
    handleConfirmTransition,
    setTransitionComment,
    setRevalidationCause,
    toggleRevalidationStage,
    setRevalidationTriggerFileName,
    isTransitionConfirmDisabled,
    setIsFormExpanded,
    updateForm,
    handleScopeTypeChange,
  };
}
