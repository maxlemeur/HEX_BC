import type {
  ApplyEstimateStructureDraftPayload,
  EstimateStructureDraft,
  EstimateStructureDraftNode,
  EstimateStructureDraftNodeAction,
} from "@/lib/estimates/client";

export type TreeFilterKey =
  | "create"
  | "merge"
  | "skip"
  | "low_confidence"
  | "duplicate";

export type ExistingSectionOption = {
  id: string;
  path: string;
  hierarchyLevel: number;
  parentId: string | null;
  title: string;
};

export type NodeOverrideState = {
  action: EstimateStructureDraftNodeAction;
  renameTo: string;
  mergeIntoItemId: string;
};

export type FlatStructureDraftNode = EstimateStructureDraftNode & {
  path: string[];
};

export type ExistingSectionLookup = ExistingSectionOption & {
  normalizedTitle: string;
};

export type MergeParentContext =
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

export type NodeMergeState = {
  mergeCandidates: ExistingSectionLookup[];
  resolvedMergeTargetId: string | null;
  resolvedMergeTargetPath: string | null;
  requiresExplicitMergeTarget: boolean;
  hasInvalidMergeConfiguration: boolean;
  blockingReason: string | null;
};

export type StickySummaryCounts = {
  selectedLots: number;
  createCount: number;
  mergeCount: number;
  skipCount: number;
  lowConfidenceCount: number;
  duplicateCount: number;
};

const STRONG_SIGNAL_SOURCE_KINDS = new Set<
  EstimateStructureDraft["sources"][number]["kind"]
>([
  "linked_dpgf",
  "primary_cctp",
  "historical_versions",
  "template_library",
  "project_notes",
  "confirmed_brief",
]);

export function sourceKindLabel(
  kind: EstimateStructureDraft["sources"][number]["kind"],
) {
  switch (kind) {
    case "linked_dpgf":
      return "DPGF lie";
    case "primary_cctp":
      return "CCTP principal";
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

export function actionLabel(action: EstimateStructureDraftNodeAction) {
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

export function actionBadgeClass(action: EstimateStructureDraftNodeAction) {
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

export function confidenceText(node: EstimateStructureDraftNode) {
  const score = Math.round(node.confidence * 100);
  if (node.confidenceLabel === "elevee") {
    return `Confiance elevee (${score}%)`;
  }
  if (node.confidenceLabel === "moyenne") {
    return `Confiance moyenne (${score}%)`;
  }
  return `Confiance faible (${score}%)`;
}

export function flattenNodes(nodes: EstimateStructureDraftNode[]) {
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

export function normalizeSectionTitleKey(value: string | null | undefined) {
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

export function isAssemblyOnlyWeakSignalMode(
  sources: EstimateStructureDraft["sources"],
) {
  const usedKinds = sources.filter((source) => source.used).map((source) => source.kind);

  if (usedKinds.length === 0) {
    return false;
  }

  const hasStrongUsedSource = usedKinds.some((kind) =>
    STRONG_SIGNAL_SOURCE_KINDS.has(kind),
  );

  return !hasStrongUsedSource && usedKinds.every((kind) => kind === "assembly_library");
}

export function getDefaultSelectedRootIds(draft: EstimateStructureDraft) {
  const suggestedRootIds = draft.nodes
    .filter((node) => node.defaultAction !== "skip")
    .map((node) => node.id);

  if (suggestedRootIds.length > 0) {
    return suggestedRootIds;
  }

  return isAssemblyOnlyWeakSignalMode(draft.sources) ? [] : draft.nodes.map((node) => node.id);
}

export function isWeakSignalNode(node: EstimateStructureDraftNode) {
  return (
    node.defaultAction === "skip" &&
    node.confidenceLabel === "faible" &&
    node.provenance.length > 0 &&
    node.provenance.every((entry) => entry.type === "assembly")
  );
}

export function evidenceTypeLabel(
  type: EstimateStructureDraftNode["provenance"][number]["type"],
) {
  switch (type) {
    case "dpgf":
      return "DPGF";
    case "cctp":
      return "CCTP";
    case "history":
      return "Historique";
    case "template":
      return "Template";
    case "assembly":
      return "Assemblage";
    case "brief":
      return "Brief";
    default:
      return type;
  }
}

export function summarizeNodeProvenance(node: EstimateStructureDraftNode) {
  return node.provenance
    .map((entry) => `${evidenceTypeLabel(entry.type)}: ${entry.label}`)
    .join(" · ");
}

export function buildSourceCoverageSummary(
  sources: EstimateStructureDraft["sources"],
) {
  const usedSources = sources.filter((source) => source.used);
  const availableNotUsedSources = sources.filter(
    (source) => source.available && !source.used,
  );
  const confirmedBrief = sources.find((source) => source.kind === "confirmed_brief");
  const statements = [
    `Fait: ${usedSources.length} source(s) alimente(nt) cette preview.`,
  ];
  const assemblyOnlyWeakSignalMode = isAssemblyOnlyWeakSignalMode(sources);

  if (confirmedBrief?.available) {
    statements.push("Fait: un brief confirme est disponible pour cette affaire.");
  } else {
    statements.push("Fait: aucun brief confirme n'est disponible pour cette affaire.");
  }

  if (availableNotUsedSources.length > 0) {
    statements.push(
      `Fait: ${availableNotUsedSources.length} source(s) supplementaire(s) reste(nt) disponible(s) sans etre retenue(s).`,
    );
  }

  if (assemblyOnlyWeakSignalMode) {
    statements.push(
      "Fait: la preview repose uniquement sur la bibliotheque d'assemblages disponible.",
    );
    statements.push(
      "Inference: les suggestions faibles sont de-priorisees et non preselectionnees jusqu'a validation humaine.",
    );
  }

  return statements.join(" ");
}

export function buildNodeMergeStates(input: {
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
    candidates: ExistingSectionLookup[],
  ) => {
    const overrideTargetId = input.overrides[node.id]?.mergeIntoItemId?.trim() ?? "";
    if (overrideTargetId.length > 0) {
      return candidates.find((candidate) => candidate.id === overrideTargetId) ?? null;
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
        (candidate) => candidate.normalizedTitle === node.normalizedLabel,
      ) ?? null
    );
  };

  const visit = (node: EstimateStructureDraftNode, parentContext: MergeParentContext) => {
    const requestedAction = input.overrides[node.id]?.action ?? node.defaultAction;
    const mergeCandidates =
      parentContext.kind === "existing"
        ? (sectionsByParent.get(parentContext.parentId ?? "__root__") ?? []).filter(
            (section) => section.hierarchyLevel === node.hierarchyLevel,
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
    }),
  );

  return states;
}

export function getSelectedNodes(input: {
  draftNodes: EstimateStructureDraftNode[];
  flatNodes: FlatStructureDraftNode[];
  selectedRootIds: string[];
}) {
  const rootIdSet = new Set(input.selectedRootIds);
  const selected = new Set<string>();

  const visit = (node: EstimateStructureDraftNode, rootSelected: boolean) => {
    const isRootSelected = rootSelected || rootIdSet.has(node.id);
    if (isRootSelected) {
      selected.add(node.id);
    }
    node.children.forEach((child) => visit(child, isRootSelected));
  };

  input.draftNodes.forEach((node) => visit(node, false));
  return input.flatNodes.filter((node) => selected.has(node.id));
}

export function buildStickySummaryCounts(input: {
  selectedNodes: FlatStructureDraftNode[];
  selectedRootIds: string[];
  overrides: Record<string, NodeOverrideState>;
}): StickySummaryCounts {
  const counts: StickySummaryCounts = {
    selectedLots: new Set(input.selectedRootIds).size,
    createCount: 0,
    mergeCount: 0,
    skipCount: 0,
    lowConfidenceCount: 0,
    duplicateCount: 0,
  };

  for (const node of input.selectedNodes) {
    const action = input.overrides[node.id]?.action ?? node.defaultAction;
    if (action === "create") counts.createCount++;
    if (action === "merge") counts.mergeCount++;
    if (action === "skip") counts.skipCount++;
    if (node.confidenceLabel === "faible") counts.lowConfidenceCount++;
    if (node.duplicateMatchItemId) counts.duplicateCount++;
  }

  return counts;
}

export function buildFilterCounts(input: {
  flatNodes: FlatStructureDraftNode[];
  overrides: Record<string, NodeOverrideState>;
}) {
  const counts: Record<TreeFilterKey, number> = {
    create: 0,
    merge: 0,
    skip: 0,
    low_confidence: 0,
    duplicate: 0,
  };

  for (const node of input.flatNodes) {
    const action = input.overrides[node.id]?.action ?? node.defaultAction;
    if (action === "create") counts.create++;
    if (action === "merge") counts.merge++;
    if (action === "skip") counts.skip++;
    if (node.confidenceLabel === "faible") counts.low_confidence++;
    if (node.duplicateMatchItemId) counts.duplicate++;
  }

  return counts;
}

export function buildFilteredFlatNodeIds(input: {
  activeFilters: Set<TreeFilterKey>;
  flatNodes: FlatStructureDraftNode[];
  overrides: Record<string, NodeOverrideState>;
}) {
  if (input.activeFilters.size === 0) {
    return null;
  }

  const matching = new Set<string>();
  const parentMap = new Map(input.flatNodes.map((node) => [node.id, node.parentId]));

  for (const node of input.flatNodes) {
    const action = input.overrides[node.id]?.action ?? node.defaultAction;
    let matches = false;

    if (input.activeFilters.has("create") && action === "create") matches = true;
    if (input.activeFilters.has("merge") && action === "merge") matches = true;
    if (input.activeFilters.has("skip") && action === "skip") matches = true;
    if (
      input.activeFilters.has("low_confidence") &&
      node.confidenceLabel === "faible"
    ) {
      matches = true;
    }
    if (input.activeFilters.has("duplicate") && node.duplicateMatchItemId) matches = true;

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
}

export function buildDraftOverrides(input: {
  selectedNodes: FlatStructureDraftNode[];
  overrides: Record<string, NodeOverrideState>;
  nodeMergeStates: Map<string, NodeMergeState>;
}): NonNullable<ApplyEstimateStructureDraftPayload["overrides"]> {
  return input.selectedNodes
    .map((node) => {
      const override = input.overrides[node.id];
      if (!override) {
        return null;
      }

      const hasActionOverride = override.action !== node.defaultAction;
      const renameTo = override.renameTo.trim();
      const mergeIntoItemId = override.mergeIntoItemId.trim();
      const nodeMergeState = input.nodeMergeStates.get(node.id);
      const isValidMergeTarget =
        mergeIntoItemId.length === 0 ||
        Boolean(
          nodeMergeState?.mergeCandidates.some(
            (candidate) => candidate.id === mergeIntoItemId,
          ),
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
          sanitizedMergeIntoItemId.length > 0 ? sanitizedMergeIntoItemId : null,
      };
    })
    .filter((value) => value !== null);
}
