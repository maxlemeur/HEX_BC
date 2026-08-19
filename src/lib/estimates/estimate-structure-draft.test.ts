import { describe, expect, it } from "vitest";

import type {
  EstimateStructureDraft,
  EstimateStructureDraftNode,
} from "@/lib/estimates/client";
import {
  buildDraftOverrides,
  buildFilterCounts,
  buildFilteredFlatNodeIds,
  buildNodeMergeStates,
  buildSourceCoverageSummary,
  buildStickySummaryCounts,
  flattenNodes,
  getDefaultSelectedRootIds,
  getSelectedNodes,
  isAssemblyOnlyWeakSignalMode,
  isWeakSignalNode,
  normalizeSectionTitleKey,
  type NodeOverrideState,
} from "@/lib/estimates/estimate-structure-draft";

function createNode(
  overrides: Partial<EstimateStructureDraftNode> &
    Pick<EstimateStructureDraftNode, "id" | "label">,
): EstimateStructureDraftNode {
  return {
    parentId: null,
    orderIndex: 0,
    hierarchyLevel: 1,
    normalizedLabel: normalizeSectionTitleKey(overrides.label),
    confidence: 0.82,
    confidenceLabel: "elevee",
    defaultAction: "create",
    duplicateMatchItemId: null,
    duplicateMatchPath: null,
    provenance: [
      {
        type: "dpgf",
        label: "DPGF lie",
        excerpt: "Lot electricite",
      },
    ],
    facts: ["Source DPGF"],
    hypotheses: [],
    inferences: [],
    children: [],
    ...overrides,
  };
}

const assemblyOnlySources: EstimateStructureDraft["sources"] = [
  {
    kind: "assembly_library",
    label: "Ouvrages",
    available: true,
    used: true,
    detail: "4 ouvrages",
  },
  {
    kind: "confirmed_brief",
    label: "Brief",
    available: false,
    used: false,
    detail: null,
  },
];

const mixedSources: EstimateStructureDraft["sources"] = [
  {
    kind: "linked_dpgf",
    label: "DPGF",
    available: true,
    used: true,
    detail: "1 fichier",
  },
  {
    kind: "assembly_library",
    label: "Ouvrages",
    available: true,
    used: true,
    detail: "4 ouvrages",
  },
];

describe("flattenNodes and default selection", () => {
  it("flattens the tree with ancestor paths and normalizes titles", () => {
    const child = createNode({
      id: "cfo",
      parentId: "elec",
      label: "CFO",
      hierarchyLevel: 2,
    });
    const root = createNode({
      id: "elec",
      label: "Électricité",
      children: [child],
    });

    expect(normalizeSectionTitleKey("  Électricité  ")).toBe("electricite");
    expect(flattenNodes([root]).map((node) => node.path)).toEqual([
      ["Électricité"],
      ["Électricité", "CFO"],
    ]);
  });

  it("preselects defensible roots and leaves assembly-only weak drafts empty", () => {
    const createRoot = createNode({ id: "lot-a", label: "Plomberie" });
    const weakRoot = createNode({
      id: "lot-b",
      label: "Electricite",
      defaultAction: "skip",
      confidenceLabel: "faible",
      provenance: [{ type: "assembly", label: "Ouvrage", excerpt: null }],
    });

    expect(isAssemblyOnlyWeakSignalMode(assemblyOnlySources)).toBe(true);
    expect(isAssemblyOnlyWeakSignalMode(mixedSources)).toBe(false);
    expect(isWeakSignalNode(weakRoot)).toBe(true);
    expect(
      getDefaultSelectedRootIds({
        draftId: "draft-1",
        versionId: "version-1",
        strategy: "hybrid",
        sources: mixedSources,
        summary: {
          rootCount: 2,
          newCount: 1,
          mergeCount: 0,
          duplicateCount: 0,
          lowConfidenceCount: 1,
        },
        nodes: [createRoot, weakRoot],
        generatedAt: "2026-08-19T10:00:00.000Z",
      }),
    ).toEqual(["lot-a"]);
    expect(
      getDefaultSelectedRootIds({
        draftId: "draft-2",
        versionId: "version-1",
        strategy: "hybrid",
        sources: assemblyOnlySources,
        summary: {
          rootCount: 1,
          newCount: 0,
          mergeCount: 0,
          duplicateCount: 0,
          lowConfidenceCount: 1,
        },
        nodes: [weakRoot],
        generatedAt: "2026-08-19T10:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("merge validation and apply overrides", () => {
  const existingSections = [
    {
      id: "sec-elec",
      path: "Electricite",
      hierarchyLevel: 1,
      parentId: null,
      title: "Électricité",
    },
    {
      id: "sec-cfo",
      path: "Electricite / CFO",
      hierarchyLevel: 2,
      parentId: "sec-elec",
      title: "CFO",
    },
  ];

  const mergeChild = createNode({
    id: "draft-cfo",
    parentId: "draft-elec",
    label: "CFO",
    hierarchyLevel: 2,
    defaultAction: "merge",
    duplicateMatchItemId: "sec-cfo",
    duplicateMatchPath: "Electricite / CFO",
  });
  const createChild = createNode({
    id: "draft-cfa",
    parentId: "draft-elec",
    label: "CFA",
    hierarchyLevel: 2,
    defaultAction: "create",
    confidenceLabel: "faible",
  });
  const mergeRoot = createNode({
    id: "draft-elec",
    label: "Electricite",
    defaultAction: "merge",
    children: [mergeChild, createChild],
  });
  const unmatchedMerge = createNode({
    id: "draft-unknown",
    label: "Inconnu",
    defaultAction: "merge",
  });

  it("resolves compatible merge targets and flags invalid merge configuration", () => {
    const states = buildNodeMergeStates({
      draftNodes: [mergeRoot, unmatchedMerge],
      existingSections,
      overrides: {},
    });

    expect(states.get("draft-elec")).toMatchObject({
      resolvedMergeTargetId: "sec-elec",
      requiresExplicitMergeTarget: false,
      hasInvalidMergeConfiguration: false,
    });
    expect(states.get("draft-cfo")).toMatchObject({
      resolvedMergeTargetId: "sec-cfo",
      hasInvalidMergeConfiguration: false,
    });
    expect(states.get("draft-cfa")?.blockingReason).toBeNull();
    expect(states.get("draft-unknown")).toMatchObject({
      requiresExplicitMergeTarget: true,
      hasInvalidMergeConfiguration: true,
    });
  });

  it("selects a subtree, counts filters, and sanitizes apply overrides", () => {
    const flatNodes = flattenNodes([mergeRoot]);
    const selectedNodes = getSelectedNodes({
      draftNodes: [mergeRoot],
      flatNodes,
      selectedRootIds: ["draft-elec"],
    });
    const overrides: Record<string, NodeOverrideState> = {
      "draft-elec": {
        action: "merge",
        renameTo: "  Courants faibles  ",
        mergeIntoItemId: "sec-elec",
      },
      "draft-cfa": {
        action: "skip",
        renameTo: "",
        mergeIntoItemId: "not-a-candidate",
      },
    };
    const nodeMergeStates = buildNodeMergeStates({
      draftNodes: [mergeRoot],
      existingSections,
      overrides,
    });

    expect(selectedNodes.map((node) => node.id)).toEqual([
      "draft-elec",
      "draft-cfo",
      "draft-cfa",
    ]);
    expect(
      buildStickySummaryCounts({
        selectedNodes,
        selectedRootIds: ["draft-elec"],
        overrides,
      }),
    ).toEqual({
      selectedLots: 1,
      createCount: 0,
      mergeCount: 2,
      skipCount: 1,
      lowConfidenceCount: 1,
      duplicateCount: 1,
    });
    expect(
      buildFilterCounts({
        flatNodes,
        overrides,
      }),
    ).toMatchObject({
      merge: 2,
      skip: 1,
      low_confidence: 1,
      duplicate: 1,
    });
    expect(
      buildFilteredFlatNodeIds({
        activeFilters: new Set(["low_confidence"]),
        flatNodes,
        overrides,
      }),
    ).toEqual(new Set(["draft-cfa", "draft-elec"]));
    expect(
      buildDraftOverrides({
        selectedNodes,
        overrides,
        nodeMergeStates,
      }),
    ).toEqual([
      {
        nodeId: "draft-elec",
        action: "merge",
        renameTo: "Courants faibles",
        mergeIntoItemId: "sec-elec",
      },
      {
        nodeId: "draft-cfa",
        action: "skip",
        renameTo: null,
        mergeIntoItemId: null,
      },
    ]);
  });

  it("summarizes source coverage for assembly-only previews", () => {
    const summary = buildSourceCoverageSummary(assemblyOnlySources);
    expect(summary).toContain("1 source(s) alimente(nt) cette preview");
    expect(summary).toContain("aucun brief confirme");
    expect(summary).toContain("bibliotheque d'ouvrages");
    expect(summary).toContain("non preselectionnees");
  });
});
