"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createAffaireRegisterEntryAction,
  updateAffaireRegisterEntryStatusAction,
} from "@/app/dashboard/affaires/_actions/register";
import { useToast } from "@/components/ui/Toast";
import {
  AFFAIRE_REGISTER_KIND_LABELS,
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
} from "./registerTypes";
import {
  buildDerivedSummary,
  getErrorMessage,
  resolveStatusChangeFeedback,
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

  async function handleStatusChange(
    entryId: string,
    status: AffaireRegisterEntryStatus,
    comment: string
  ) {
    setPendingEntryId(entryId);
    startMutationTransition(() => {
      void (async () => {
        try {
          const result = await updateAffaireRegisterEntryStatusAction({
            projectId,
            versionId,
            entryId,
            status,
            comment: comment.trim().length > 0 ? comment : null,
          });
          const feedback = resolveStatusChangeFeedback(result.entry.status);
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

  function openTransitionDialog(
    entry: AffaireRegisterEntry,
    status: AffaireRegisterEntryStatus
  ) {
    setInlineFeedback(null);
    setTransitionComment("");
    setPendingTransition({
      entry,
      nextStatus: status,
    });
  }

  function closeTransitionDialog() {
    if (isMutationPending) {
      return;
    }

    setPendingTransition(null);
    setTransitionComment("");
  }

  async function handleConfirmTransition() {
    if (!pendingTransition) {
      return;
    }

    await handleStatusChange(
      pendingTransition.entry.id,
      pendingTransition.nextStatus,
      transitionComment
    );
    setPendingTransition(null);
    setTransitionComment("");
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
    setIsFormExpanded,
    updateForm,
    handleScopeTypeChange,
  };
}
