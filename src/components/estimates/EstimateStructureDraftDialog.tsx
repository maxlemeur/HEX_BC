"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchEstimateStructureDraft,
  generateEstimateStructureDraft,
  type ApplyEstimateStructureDraftPayload,
  type ApplyEstimateStructureDraftResult,
  type EstimateStructureDraft,
  type EstimateStructureDraftApplyMode,
  type EstimateStructureDraftNode,
  type EstimateStructureDraftNodeAction,
} from "@/lib/estimates/client";

export type { ApplyEstimateStructureDraftResult };

const WIZARD_STEPS = [
  { step: 1, label: "Sources" },
  { step: 2, label: "Selection" },
  { step: 3, label: "Application" },
] as const;

type TreeFilterKey = "create" | "merge" | "skip" | "low_confidence" | "duplicate";

const TREE_FILTER_CHIPS: Array<{
  key: TreeFilterKey;
  label: string;
  activeClass: string;
  inactiveClass: string;
}> = [
  {
    key: "create",
    label: "Nouveau",
    activeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "merge",
    label: "Fusion",
    activeClass: "bg-amber-100 text-amber-800 border-amber-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "skip",
    label: "Ignore",
    activeClass: "bg-slate-200 text-slate-800 border-slate-400",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "low_confidence",
    label: "Confiance faible",
    activeClass: "bg-rose-100 text-rose-800 border-rose-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
  {
    key: "duplicate",
    label: "Doublons",
    activeClass: "bg-violet-100 text-violet-800 border-violet-300",
    inactiveClass: "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
  },
];

type ExistingSectionOption = {
  id: string;
  path: string;
  hierarchyLevel: number;
  parentId: string | null;
  title: string;
};

type EstimateStructureDraftDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  hasExistingItems: boolean;
  existingSections: ExistingSectionOption[];
  onClose: (result?: ApplyEstimateStructureDraftResult) => void;
  onConfirm: (
    draftId: string,
    input: ApplyEstimateStructureDraftPayload
  ) => Promise<ApplyEstimateStructureDraftResult>;
};

type NodeOverrideState = {
  action: EstimateStructureDraftNodeAction;
  renameTo: string;
  mergeIntoItemId: string;
};

type FlatStructureDraftNode = EstimateStructureDraftNode & {
  path: string[];
};

type ExistingSectionLookup = ExistingSectionOption & {
  normalizedTitle: string;
};

type MergeParentContext =
  | {
      kind: "existing";
      parentId: string | null;
    }
  | {
      kind: "created";
    }
  | {
      kind: "ignored";
      reason: string;
    }
  | {
      kind: "blocked";
      reason: string;
    };

type NodeMergeState = {
  mergeCandidates: ExistingSectionLookup[];
  resolvedMergeTargetId: string | null;
  resolvedMergeTargetPath: string | null;
  requiresExplicitMergeTarget: boolean;
  hasInvalidMergeConfiguration: boolean;
  blockingReason: string | null;
};

function sourceKindLabel(kind: EstimateStructureDraft["sources"][number]["kind"]) {
  switch (kind) {
    case "linked_dpgf":
      return "DPGF lie";
    case "historical_versions":
      return "Historique";
    case "template_library":
      return "Templates";
    case "assembly_library":
      return "Assemblages";
    case "project_notes":
      return "Notes affaire";
    case "confirmed_brief":
      return "Brief confirme";
    default:
      return kind;
  }
}

function actionLabel(action: EstimateStructureDraftNodeAction) {
  switch (action) {
    case "create":
      return "Nouveau";
    case "merge":
      return "Fusion proposee";
    case "skip":
      return "Ignore";
    default:
      return action;
  }
}

function actionBadgeClass(action: EstimateStructureDraftNodeAction) {
  switch (action) {
    case "create":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "merge":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "skip":
      return "bg-slate-100 text-slate-600 border-slate-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function confidenceText(node: EstimateStructureDraftNode) {
  const score = Math.round(node.confidence * 100);
  if (node.confidenceLabel === "elevee") {
    return `Confiance elevee (${score}%)`;
  }
  if (node.confidenceLabel === "moyenne") {
    return `Confiance moyenne (${score}%)`;
  }
  return `Confiance faible (${score}%)`;
}

function flattenNodes(nodes: EstimateStructureDraftNode[]) {
  const flattened: FlatStructureDraftNode[] = [];

  const visit = (node: EstimateStructureDraftNode, path: string[]) => {
    const nextPath = [...path, node.label];
    flattened.push({
      ...node,
      path: nextPath,
    });
    node.children.forEach((child) => visit(child, nextPath));
  };

  nodes.forEach((node) => visit(node, []));
  return flattened;
}

function normalizeSectionTitleKey(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return "section";
  }

  return normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildSourceCoverageSummary(
  sources: EstimateStructureDraft["sources"]
) {
  const usedSources = sources.filter((source) => source.used);
  const availableNotUsedSources = sources.filter(
    (source) => source.available && !source.used
  );
  const confirmedBrief = sources.find((source) => source.kind === "confirmed_brief");
  const statements = [
    `Fait: ${usedSources.length} source(s) alimente(nt) cette preview.`,
  ];

  if (confirmedBrief?.available) {
    statements.push("Fait: un brief confirme est disponible pour cette affaire.");
  } else {
    statements.push("Fait: aucun brief confirme n'est disponible pour cette affaire.");
  }

  if (availableNotUsedSources.length > 0) {
    statements.push(
      `Fait: ${availableNotUsedSources.length} source(s) supplementaire(s) reste(nt) disponible(s) sans etre retenue(s).`
    );
  }

  return statements.join(" ");
}

function buildNodeMergeStates(input: {
  draftNodes: EstimateStructureDraftNode[];
  existingSections: ExistingSectionOption[];
  overrides: Record<string, NodeOverrideState>;
}) {
  const existingSectionLookup = input.existingSections.map((section) => ({
    ...section,
    normalizedTitle: normalizeSectionTitleKey(section.title),
  }));
  const sectionsByParent = new Map<string, ExistingSectionLookup[]>();

  existingSectionLookup.forEach((section) => {
    const key = section.parentId ?? "__root__";
    const siblings = sectionsByParent.get(key);
    if (siblings) {
      siblings.push(section);
      return;
    }

    sectionsByParent.set(key, [section]);
  });

  const states = new Map<string, NodeMergeState>();

  const resolveMergeTarget = (
    node: EstimateStructureDraftNode,
    candidates: ExistingSectionLookup[]
  ) => {
    const overrideTargetId = input.overrides[node.id]?.mergeIntoItemId?.trim() ?? "";
    if (overrideTargetId.length > 0) {
      const explicitTarget =
        candidates.find((candidate) => candidate.id === overrideTargetId) ?? null;

      return explicitTarget;
    }

    if (node.duplicateMatchItemId) {
      const duplicateTarget =
        candidates.find((candidate) => candidate.id === node.duplicateMatchItemId) ??
        null;
      if (duplicateTarget) {
        return duplicateTarget;
      }
    }

    return (
      candidates.find(
        (candidate) => candidate.normalizedTitle === node.normalizedLabel
      ) ?? null
    );
  };

  const visit = (
    node: EstimateStructureDraftNode,
    parentContext: MergeParentContext
  ) => {
    const requestedAction =
      input.overrides[node.id]?.action ?? node.defaultAction;
    const mergeCandidates =
      parentContext.kind === "existing"
        ? (
            sectionsByParent.get(parentContext.parentId ?? "__root__") ?? []
          ).filter(
            (section) => section.hierarchyLevel === node.hierarchyLevel
          )
        : [];
    const resolvedMergeTarget = resolveMergeTarget(node, mergeCandidates);
    const requiresExplicitMergeTarget =
      requestedAction === "merge" &&
      parentContext.kind === "existing" &&
      mergeCandidates.length > 0 &&
      resolvedMergeTarget === null;
    const isIgnoredSubtree = parentContext.kind === "ignored";
    const blockingReason =
      parentContext.kind === "blocked" || parentContext.kind === "ignored"
        ? parentContext.reason
        : null;
    const hasInvalidMergeConfiguration =
      requestedAction === "merge" &&
      (!isIgnoredSubtree &&
        (blockingReason !== null ||
        mergeCandidates.length === 0 ||
        requiresExplicitMergeTarget));

    states.set(node.id, {
      mergeCandidates,
      resolvedMergeTargetId: resolvedMergeTarget?.id ?? null,
      resolvedMergeTargetPath: resolvedMergeTarget?.path ?? null,
      requiresExplicitMergeTarget,
      hasInvalidMergeConfiguration,
      blockingReason,
    });

    let nextParentContext: MergeParentContext;
    if (requestedAction === "skip") {
      nextParentContext = {
        kind: "ignored",
        reason: "Le parent est ignore, son sous-arbre ne sera pas applique.",
      };
    } else if (requestedAction === "create") {
      nextParentContext = {
        kind: "created",
      };
    } else if (resolvedMergeTarget) {
      nextParentContext = {
        kind: "existing",
        parentId: resolvedMergeTarget.id,
      };
    } else {
      nextParentContext = {
        kind: "blocked",
        reason:
          "Choisissez d'abord une cible de fusion compatible pour ce parent.",
      };
    }

    node.children.forEach((child) => visit(child, nextParentContext));
  };

  input.draftNodes.forEach((node) =>
    visit(node, {
      kind: "existing",
      parentId: null,
    })
  );

  return states;
}

export function EstimateStructureDraftDialog({
  isOpen,
  targetVersionId,
  hasExistingItems,
  existingSections,
  onClose,
  onConfirm,
}: EstimateStructureDraftDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [draft, setDraft] = useState<EstimateStructureDraft | null>(null);
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selectedRootIds, setSelectedRootIds] = useState<string[]>([]);
  const [mode, setMode] = useState<EstimateStructureDraftApplyMode>(
    hasExistingItems ? "merge_existing" : "create_empty"
  );
  const [overrides, setOverrides] = useState<Record<string, NodeOverrideState>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<TreeFilterKey>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyEstimateStructureDraftResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isActive = true;
    setStep(1);
    setMode(hasExistingItems ? "merge_existing" : "create_empty");
    setOverrides({});
    setSubmitError(null);
    setDraftError(null);
    setDraft(null);
    setSelectedRootIds([]);
    setIsLoadingDraft(true);
    setActiveFilters(new Set());
    setApplyResult(null);

    async function loadDraft() {
      try {
        const generated = await generateEstimateStructureDraft(targetVersionId, {
          strategy: "hybrid",
        });
        const persisted = await fetchEstimateStructureDraft(
          targetVersionId,
          generated.draftId
        );
        if (!isActive) return;
        setDraft(persisted);
        setSelectedRootIds(persisted.nodes.map((node) => node.id));
      } catch (error) {
        if (!isActive) return;
        setDraftError(
          error instanceof Error
            ? error.message
            : "Impossible de generer la preview de structure."
        );
      } finally {
        if (!isActive) return;
        setIsLoadingDraft(false);
      }
    }

    void loadDraft();

    return () => {
      isActive = false;
    };
  }, [hasExistingItems, isOpen, targetVersionId]);

  const flatNodes = useMemo(() => flattenNodes(draft?.nodes ?? []), [draft?.nodes]);
  const rootIdSet = useMemo(() => new Set(selectedRootIds), [selectedRootIds]);

  const selectedNodes = useMemo(() => {
    if (!draft) return [] as FlatStructureDraftNode[];

    const selected = new Set<string>();
    const visit = (node: EstimateStructureDraftNode, rootSelected: boolean) => {
      const isRootSelected = rootSelected || rootIdSet.has(node.id);
      if (isRootSelected) {
        selected.add(node.id);
      }
      node.children.forEach((child) => visit(child, isRootSelected));
    };

    draft.nodes.forEach((node) => visit(node, false));
    return flatNodes.filter((node) => selected.has(node.id));
  }, [draft, flatNodes, rootIdSet]);
  const sourceCoverageSummary = useMemo(
    () => (draft ? buildSourceCoverageSummary(draft.sources) : null),
    [draft]
  );
  const nodeMergeStates = useMemo(
    () =>
      buildNodeMergeStates({
        draftNodes: draft?.nodes ?? [],
        existingSections,
        overrides,
      }),
    [draft?.nodes, existingSections, overrides]
  );
  const hasInvalidMergeConfiguration = useMemo(
    () =>
      selectedNodes.some(
        (node) => nodeMergeStates.get(node.id)?.hasInvalidMergeConfiguration
      ),
    [nodeMergeStates, selectedNodes]
  );

  const stickySummaryCounts = useMemo(() => {
    const counts = { selectedLots: 0, createCount: 0, mergeCount: 0, skipCount: 0, lowConfidenceCount: 0, duplicateCount: 0 };
    const rootSet = new Set(selectedRootIds);
    counts.selectedLots = rootSet.size;
    for (const node of selectedNodes) {
      const action = overrides[node.id]?.action ?? node.defaultAction;
      if (action === "create") counts.createCount++;
      if (action === "merge") counts.mergeCount++;
      if (action === "skip") counts.skipCount++;
      if (node.confidenceLabel === "faible") counts.lowConfidenceCount++;
      if (node.duplicateMatchItemId) counts.duplicateCount++;
    }
    return counts;
  }, [selectedNodes, overrides, selectedRootIds]);

  const filterCounts = useMemo(() => {
    const counts: Record<TreeFilterKey, number> = { create: 0, merge: 0, skip: 0, low_confidence: 0, duplicate: 0 };
    for (const node of flatNodes) {
      const action = overrides[node.id]?.action ?? node.defaultAction;
      if (action === "create") counts.create++;
      if (action === "merge") counts.merge++;
      if (action === "skip") counts.skip++;
      if (node.confidenceLabel === "faible") counts.low_confidence++;
      if (node.duplicateMatchItemId) counts.duplicate++;
    }
    return counts;
  }, [flatNodes, overrides]);

  const filteredFlatNodeIds = useMemo<Set<string> | null>(() => {
    if (activeFilters.size === 0) return null;
    const matching = new Set<string>();
    const parentMap = new Map(flatNodes.map((n) => [n.id, n.parentId]));
    for (const node of flatNodes) {
      const action = overrides[node.id]?.action ?? node.defaultAction;
      let matches = false;
      if (activeFilters.has("create") && action === "create") matches = true;
      if (activeFilters.has("merge") && action === "merge") matches = true;
      if (activeFilters.has("skip") && action === "skip") matches = true;
      if (activeFilters.has("low_confidence") && node.confidenceLabel === "faible") matches = true;
      if (activeFilters.has("duplicate") && node.duplicateMatchItemId) matches = true;
      if (matches) {
        matching.add(node.id);
        let parentId = parentMap.get(node.id);
        while (parentId) {
          matching.add(parentId);
          parentId = parentMap.get(parentId);
        }
      }
    }
    return matching;
  }, [activeFilters, flatNodes, overrides]);
  const hasFilteredPreviewResults =
    filteredFlatNodeIds === null || filteredFlatNodeIds.size > 0;

  const canContinueFromStep1 =
    !isLoadingDraft && !draftError && Boolean(draft?.nodes.length);
  const canContinueFromStep2 = selectedRootIds.length > 0;

  const toggleRootSelection = (nodeId: string) => {
    setSelectedRootIds((current) =>
      current.includes(nodeId)
        ? current.filter((value) => value !== nodeId)
        : [...current, nodeId]
    );
  };

  const updateOverride = (nodeId: string, patch: Partial<NodeOverrideState>) => {
    setOverrides((current) => {
      const existing = current[nodeId] ?? {
        action:
          flatNodes.find((node) => node.id === nodeId)?.defaultAction ?? "create",
        renameTo: "",
        mergeIntoItemId: "",
      };

      return {
        ...current,
        [nodeId]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const handleSubmit = async () => {
    if (!draft || selectedRootIds.length === 0 || hasInvalidMergeConfiguration) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const draftOverrides: NonNullable<
        ApplyEstimateStructureDraftPayload["overrides"]
      > = selectedNodes
        .map((node) => {
          const override = overrides[node.id];
          if (!override) {
            return null;
          }

          const hasActionOverride = override.action !== node.defaultAction;
          const renameTo = override.renameTo.trim();
          const mergeIntoItemId = override.mergeIntoItemId.trim();
          const nodeMergeState = nodeMergeStates.get(node.id);
          const isValidMergeTarget =
            mergeIntoItemId.length === 0 ||
            Boolean(
              nodeMergeState?.mergeCandidates.some(
                (candidate) => candidate.id === mergeIntoItemId
              )
            );
          const sanitizedMergeIntoItemId = isValidMergeTarget ? mergeIntoItemId : "";

          if (!hasActionOverride && !renameTo && !sanitizedMergeIntoItemId) {
            return null;
          }

          return {
            nodeId: node.id,
            action: override.action,
            renameTo: renameTo.length > 0 ? renameTo : null,
            mergeIntoItemId:
              sanitizedMergeIntoItemId.length > 0
                ? sanitizedMergeIntoItemId
                : null,
          };
        })
        .filter((value) => value !== null);

      const payload: ApplyEstimateStructureDraftPayload = {
        mode,
        selectedRootNodeIds: selectedRootIds,
        overrides: draftOverrides,
      };

      const result = await onConfirm(draft.draftId, payload);
      setApplyResult(result);
      setStep(4);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible d'appliquer la preview de structure."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.5)] p-4">
      <div
        className="dashboard-card max-h-[92vh] w-full max-w-6xl overflow-hidden p-0"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-structure-draft-dialog-title"
      >
        <div className="border-b border-[var(--slate-200)] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="estimate-structure-draft-dialog-title"
                className="text-lg font-semibold text-[var(--slate-900)]"
              >
                Structure IA
              </h2>
              <nav aria-label="Etapes du wizard" className="mt-3">
                <ol className="flex items-center gap-0">
                  {WIZARD_STEPS.map((ws, index) => {
                    const isDone = step > ws.step || step === 4;
                    const isActive = step === ws.step;
                    return (
                      <li key={ws.step} className="flex items-center">
                        {index > 0 && (
                          <div
                            className={`mx-2 h-0.5 w-8 rounded ${
                              isDone ? "bg-emerald-400" : isActive ? "bg-blue-300" : "bg-slate-200"
                            }`}
                          />
                        )}
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                              isDone
                                ? "bg-emerald-100 text-emerald-700"
                                : isActive
                                  ? "bg-blue-600 text-white"
                                  : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {isDone ? "\u2713" : ws.step}
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              isDone
                                ? "text-emerald-700"
                                : isActive
                                  ? "text-blue-700"
                                  : "text-slate-400"
                            }`}
                          >
                            {ws.label}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onClose()}
              disabled={isSubmitting}
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {(step === 2 || step === 3) && draft ? (
            <div className="sticky top-0 z-10 -mx-6 -mt-5 mb-4 border-b border-[var(--slate-200)] bg-white/95 px-6 py-3 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <span className="font-medium text-[var(--slate-700)]">
                  {stickySummaryCounts.selectedLots} lot(s)
                </span>
                <span className="text-emerald-700">
                  {stickySummaryCounts.createCount} creation(s)
                </span>
                <span className="text-amber-700">
                  {stickySummaryCounts.mergeCount} fusion(s)
                </span>
                <span className="text-slate-500">
                  {stickySummaryCounts.skipCount} ignore(s)
                </span>
                {stickySummaryCounts.lowConfidenceCount > 0 && (
                  <span className="text-rose-600">
                    {stickySummaryCounts.lowConfidenceCount} confiance faible
                  </span>
                )}
                {stickySummaryCounts.duplicateCount > 0 && (
                  <span className="text-violet-600">
                    {stickySummaryCounts.duplicateCount} doublon(s)
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              {isLoadingDraft ? (
                <div className="alert alert-info">
                  Generation de la preview de structure et consolidation des preuves...
                </div>
              ) : null}
              {draftError ? <div className="alert alert-error">{draftError}</div> : null}
              {draft ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
                        Lots proposes
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                        {draft.summary.rootCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
                        Nouveaux
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                        {draft.summary.newCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
                        Fusions
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                        {draft.summary.mergeCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
                        Doublons
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                        {draft.summary.duplicateCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
                        Confiance faible
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-[var(--slate-900)]">
                        {draft.summary.lowConfidenceCount}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--slate-200)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                          Provenance utilisee
                        </h3>
                        {sourceCoverageSummary ? (
                          <p className="mt-1 text-sm text-[var(--slate-500)]">
                            {sourceCoverageSummary}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {draft.sources.map((source) => (
                        <div
                          key={source.kind}
                          className="rounded-xl border border-[var(--slate-200)] bg-white p-4"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--slate-900)]">
                              {sourceKindLabel(source.kind)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                                source.used
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : source.available
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-slate-200 bg-slate-100 text-slate-600"
                              }`}
                            >
                              {source.used
                                ? "utilisee"
                                : source.available
                                  ? "disponible"
                                  : "absente"}
                            </span>
                          </div>
                          {source.detail ? (
                            <p className="mt-2 text-sm text-[var(--slate-600)]">
                              {source.detail}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 2 && draft ? (
            <div className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-[280px,minmax(0,1fr)]">
                <div className="rounded-2xl border border-[var(--slate-200)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                    Lots a retenir
                  </h3>
                  <p className="mt-1 text-sm text-[var(--slate-500)]">
                    Chaque lot coche sera inclus avec son sous-arbre.
                  </p>
                  <div className="mt-4 space-y-2">
                    {draft.nodes.map((node) => (
                      <label
                        key={node.id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--slate-200)] p-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedRootIds.includes(node.id)}
                          onChange={() => toggleRootSelection(node.id)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--slate-900)]">
                            {node.label}
                          </p>
                          <p className="mt-1 text-xs text-[var(--slate-500)]">
                            {confidenceText(node)}
                          </p>
                          {node.duplicateMatchPath ? (
                            <p className="mt-1 text-xs text-[var(--amber-700)]">
                              Doublon potentiel: {node.duplicateMatchPath}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--slate-200)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                    Preview arborescente
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filtrer les noeuds">
                    {TREE_FILTER_CHIPS.map((chip) => {
                      const isActive = activeFilters.has(chip.key);
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          aria-pressed={isActive}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            isActive ? chip.activeClass : chip.inactiveClass
                          }`}
                          onClick={() => {
                            setActiveFilters((prev) => {
                              const next = new Set(prev);
                              if (next.has(chip.key)) {
                                next.delete(chip.key);
                              } else {
                                next.add(chip.key);
                              }
                              return next;
                            });
                          }}
                        >
                          {chip.label}
                          <span className="text-[10px] opacity-70">{filterCounts[chip.key]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 space-y-3">
                    {!hasFilteredPreviewResults ? (
                      <div className="rounded-xl border border-dashed border-[var(--slate-300)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-600)]">
                        Aucun nœud ne correspond aux filtres actifs.
                        Desactivez un filtre pour réafficher la preview.
                      </div>
                    ) : null}
                    {flatNodes.map((node) => {
                      if (filteredFlatNodeIds && !filteredFlatNodeIds.has(node.id)) {
                        return null;
                      }
                      const isDisabled =
                        node.hierarchyLevel === 1 && !selectedRootIds.includes(node.id);
                      const resolvedAction =
                        overrides[node.id]?.action ?? node.defaultAction;

                      return (
                        <details
                          key={node.id}
                          className={`rounded-xl border border-[var(--slate-200)] bg-white p-4 ${
                            isDisabled ? "opacity-45" : ""
                          }`}
                        >
                          <summary
                            className="flex cursor-pointer list-none items-start gap-3"
                            style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-[var(--slate-900)]">
                                  {node.label}
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${actionBadgeClass(
                                    resolvedAction
                                  )}`}
                                >
                                  {actionLabel(resolvedAction)}
                                </span>
                                {node.duplicateMatchPath ? (
                                  <span className="text-xs text-[var(--amber-700)]">
                                    {node.duplicateMatchPath}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-[var(--slate-500)]">
                                {confidenceText(node)}
                              </p>
                            </div>
                          </summary>
                          <div className="mt-3 grid gap-3 border-t border-[var(--slate-100)] pt-3 md:grid-cols-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                                Faits
                              </p>
                              <ul className="mt-2 space-y-1 text-sm text-[var(--slate-700)]">
                                {node.facts.map((fact) => (
                                  <li key={fact}>{fact}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                                Hypotheses
                              </p>
                              <ul className="mt-2 space-y-1 text-sm text-[var(--slate-700)]">
                                {node.hypotheses.length > 0 ? (
                                  node.hypotheses.map((entry) => (
                                    <li key={entry}>{entry}</li>
                                  ))
                                ) : (
                                  <li>Aucune hypothese supplementaire.</li>
                                )}
                              </ul>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                                Inferences
                              </p>
                              <ul className="mt-2 space-y-1 text-sm text-[var(--slate-700)]">
                                {node.inferences.map((entry) => (
                                  <li key={entry}>{entry}</li>
                                ))}
                              </ul>
                              {node.provenance.length > 0 ? (
                                <p className="mt-3 text-xs text-[var(--slate-500)]">
                                  Provenance:{" "}
                                  {node.provenance.map((entry) => entry.label).join(", ")}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 && draft ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-[var(--slate-200)] p-4">
                <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                  Mode d&apos;application
                </h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="rounded-xl border border-[var(--slate-200)] p-4">
                    <input
                      type="radio"
                      name="estimate-structure-apply-mode"
                      checked={mode === "merge_existing"}
                      onChange={() => setMode("merge_existing")}
                    />
                    <span className="ml-3 font-medium text-[var(--slate-900)]">
                      Fusionner avec l&apos;existant
                    </span>
                    <p className="mt-2 text-sm text-[var(--slate-500)]">
                      Utilise les doublons detectes et cree le reste.
                    </p>
                  </label>
                  <label
                    className={`rounded-xl border border-[var(--slate-200)] p-4 ${
                      hasExistingItems ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="estimate-structure-apply-mode"
                      checked={mode === "create_empty"}
                      onChange={() => setMode("create_empty")}
                      disabled={hasExistingItems}
                    />
                    <span className="ml-3 font-medium text-[var(--slate-900)]">
                      Creer a vide
                    </span>
                    <p className="mt-2 text-sm text-[var(--slate-500)]">
                      Reserve aux versions sans structure existante.
                    </p>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--slate-200)] p-4">
                <h3 className="text-sm font-semibold text-[var(--slate-900)]">
                  Overrides par noeud
                </h3>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Fait: seules les cibles de fusion compatibles avec le parent final sont proposees.
                </p>
                <div className="mt-4 space-y-3">
                  {selectedNodes.map((node) => {
                    const override = overrides[node.id];
                    const action = override?.action ?? node.defaultAction;
                    const nodeMergeState = nodeMergeStates.get(node.id);
                    const mergeCandidates = nodeMergeState?.mergeCandidates ?? [];
                    const canMerge =
                      !nodeMergeState?.blockingReason && mergeCandidates.length > 0;
                    const mergeTargetValue =
                      action === "merge" &&
                      override?.mergeIntoItemId &&
                      mergeCandidates.some(
                        (section) => section.id === override.mergeIntoItemId
                      )
                        ? override.mergeIntoItemId
                        : "";
                    let mergeGuidanceText: string | null = null;

                    if (action === "merge") {
                      if (nodeMergeState?.blockingReason) {
                        mergeGuidanceText = nodeMergeState.blockingReason;
                      } else if (mergeCandidates.length === 0) {
                        mergeGuidanceText =
                          "Aucune cible de fusion compatible n'existe sous le parent final.";
                      } else if (nodeMergeState?.requiresExplicitMergeTarget) {
                        mergeGuidanceText =
                          "Selectionnez une cible de fusion compatible avant application.";
                      } else if (nodeMergeState?.resolvedMergeTargetPath) {
                        mergeGuidanceText = `Cible retenue: ${nodeMergeState.resolvedMergeTargetPath}`;
                      }
                    }

                    return (
                      <div
                        key={node.id}
                        data-testid={`estimate-structure-draft-node-${node.id}`}
                        className="rounded-xl border border-[var(--slate-200)] bg-white p-4"
                      >
                        <div
                          className="flex flex-wrap items-center gap-3"
                          style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[var(--slate-900)]">
                              {node.path.join(" > ")}
                            </p>
                            <p className="mt-1 text-xs text-[var(--slate-500)]">
                              {confidenceText(node)}
                            </p>
                          </div>
                          <select
                            className="input h-9 min-w-[170px]"
                            value={action}
                            onChange={(event) =>
                              updateOverride(node.id, {
                                action: event.target.value as EstimateStructureDraftNodeAction,
                              })
                            }
                          >
                            <option value="create">Creer</option>
                            <option value="merge" disabled={!canMerge}>
                              Fusionner
                            </option>
                            <option value="skip">Ignorer</option>
                          </select>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1fr),minmax(0,1fr)]">
                          <label className="form-label block">
                            Renommer avant application
                            <input
                              className="input mt-2 w-full"
                              value={override?.renameTo ?? ""}
                              onChange={(event) =>
                                updateOverride(node.id, {
                                  renameTo: event.target.value,
                                })
                              }
                              placeholder={node.label}
                              disabled={action === "skip"}
                            />
                          </label>

                          <label className="form-label block">
                            Cible de fusion
                            <select
                              className="input mt-2 w-full"
                              value={mergeTargetValue}
                              onChange={(event) =>
                                updateOverride(node.id, {
                                  mergeIntoItemId: event.target.value,
                                })
                              }
                              disabled={action !== "merge" || !canMerge}
                            >
                              <option value="">
                                {nodeMergeState?.requiresExplicitMergeTarget
                                  ? "Choisir une cible"
                                  : "Auto"}
                              </option>
                              {mergeCandidates.map((section) => (
                                <option key={section.id} value={section.id}>
                                  {section.path}
                                </option>
                              ))}
                            </select>
                            {mergeGuidanceText ? (
                              <p className="mt-2 text-xs text-[var(--amber-700)]">
                                {mergeGuidanceText}
                              </p>
                            ) : null}
                          </label>

                          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
                              Preuve
                            </p>
                            <p className="mt-2 text-sm text-[var(--slate-700)]">
                              {node.provenance.length > 0
                                ? node.provenance
                                    .map((entry) =>
                                      entry.excerpt
                                        ? `${entry.label}: ${entry.excerpt}`
                                        : entry.label
                                    )
                                    .join(" · ")
                                : "Aucune provenance detaillee."}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {hasInvalidMergeConfiguration ? (
                <div className="alert alert-warning">
                  Corrigez les noeuds signales avant d&apos;appliquer la structure: certaines fusions n&apos;ont pas de cible compatible.
                </div>
              ) : null}
              {submitError ? <div className="alert alert-error">{submitError}</div> : null}
            </div>
          ) : null}

          {step === 4 && applyResult ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700">
                  {"\u2713"}
                </span>
                <h3 className="text-lg font-semibold text-[var(--slate-900)]">
                  Structure appliquee
                </h3>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <p className="text-2xl font-semibold text-emerald-700">{applyResult.createdCount}</p>
                  <p className="mt-1 text-sm text-emerald-600">creation(s)</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-2xl font-semibold text-amber-700">{applyResult.mergedCount}</p>
                  <p className="mt-1 text-sm text-amber-600">fusion(s)</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="text-2xl font-semibold text-slate-600">{applyResult.skippedCount}</p>
                  <p className="mt-1 text-sm text-slate-500">ignoree(s)</p>
                </div>
              </div>

              {selectedNodes.filter((n) => (overrides[n.id]?.action ?? n.defaultAction) === "create").length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-[var(--slate-700)]">Sections creees</h4>
                  <ul className="mt-2 space-y-1">
                    {selectedNodes
                      .filter((n) => (overrides[n.id]?.action ?? n.defaultAction) === "create")
                      .map((n) => (
                        <li
                          key={n.id}
                          className="rounded-lg border-l-4 border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-[var(--slate-800)]"
                        >
                          {n.path.join(" > ")}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {selectedNodes.filter((n) => (overrides[n.id]?.action ?? n.defaultAction) === "merge").length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-[var(--slate-700)]">Sections fusionnees</h4>
                  <ul className="mt-2 space-y-1">
                    {selectedNodes
                      .filter((n) => (overrides[n.id]?.action ?? n.defaultAction) === "merge")
                      .map((n) => (
                        <li
                          key={n.id}
                          className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-[var(--slate-800)]"
                        >
                          {n.path.join(" > ")}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--slate-200)] px-6 py-4">
          {step === 4 ? (
            <div />
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3 | 4) : current))}
              disabled={step === 1 || isSubmitting}
            >
              Retour
            </button>
          )}
          <div className="flex items-center gap-2">
            {step === 4 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onClose(applyResult ?? undefined)}
              >
                Fermer
              </button>
            ) : step < 3 ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setStep((current) => ((current + 1) as 1 | 2 | 3))}
                disabled={
                  isSubmitting ||
                  (step === 1 ? !canContinueFromStep1 : !canContinueFromStep2)
                }
              >
                Continuer
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleSubmit()}
                disabled={
                  isSubmitting ||
                  selectedRootIds.length === 0 ||
                  hasInvalidMergeConfiguration
                }
              >
                {isSubmitting ? "Application..." : "Appliquer la structure"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
