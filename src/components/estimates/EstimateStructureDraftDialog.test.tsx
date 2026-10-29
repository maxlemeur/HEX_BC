import { cleanup,render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateStructureDraft: vi.fn(),
  generateEstimateStructureDraft: vi.fn(),
}));

import { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import {
fetchEstimateStructureDraft,
generateEstimateStructureDraft,
} from "@/lib/estimates/client";

const draftFixture = {
  draftId: "draft-1",
  versionId: "version-1",
  strategy: "hybrid" as const,
  generatedAt: "2026-03-06T18:00:00.000Z",
  sources: [
    {
      kind: "linked_dpgf" as const,
      label: "DPGF lie",
      available: true,
      used: true,
      detail: "2 lignes retenues",
    },
    {
      kind: "confirmed_brief" as const,
      label: "Brief confirme",
      available: false,
      used: false,
      detail: "Aucun brief confirme disponible.",
    },
  ],
  summary: {
    rootCount: 1,
    newCount: 1,
    mergeCount: 1,
    duplicateCount: 1,
    lowConfidenceCount: 0,
  },
  nodes: [
    {
      id: "root-node",
      parentId: null,
      orderIndex: 0,
      hierarchyLevel: 1,
      label: 'Lot "Peinture"',
      normalizedLabel: "lot peinture",
      confidence: 0.91,
      confidenceLabel: "elevee" as const,
      defaultAction: "merge" as const,
      duplicateMatchItemId: "section-existing",
      duplicateMatchPath: "Peinture",
      provenance: [
        {
          type: "dpgf" as const,
          label: "DPGF seed",
          excerpt: "Peinture murale",
        },
      ],
      facts: ["Le DPGF contient une section peinture."],
      hypotheses: ["Le lot doit rester au niveau racine."],
      inferences: ["Fusion recommande avec l'existant."],
      children: [
        {
          id: "child-node",
          parentId: "root-node",
          orderIndex: 0,
          hierarchyLevel: 2,
          label: "Preparation des supports",
          normalizedLabel: "preparation des supports",
          confidence: 0.74,
          confidenceLabel: "moyenne" as const,
          defaultAction: "create" as const,
          duplicateMatchItemId: null,
          duplicateMatchPath: null,
          provenance: [
            {
              type: "history" as const,
              label: "Version V1",
              excerpt: "Preparation des surfaces",
            },
          ],
          facts: ["Historique present sur une version précédente."],
          hypotheses: [],
          inferences: ["Sous-chapitre nouveau."],
          children: [],
        },
      ],
    },
  ],
};

describe("EstimateStructureDraftDialog", () => {
  beforeEach(() => {
    vi.mocked(generateEstimateStructureDraft).mockResolvedValue(draftFixture);
    vi.mocked(fetchEstimateStructureDraft).mockResolvedValue(draftFixture);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("allows applying when a skipped parent contains descendants still marked for merge", async () => {
    const user = userEvent.setup();
    const mergedChildDraft = {
      ...draftFixture,
      nodes: [
        {
          ...draftFixture.nodes[0],
          children: [
            {
              ...draftFixture.nodes[0].children[0],
              defaultAction: "merge" as const,
              duplicateMatchItemId: "section-compatible-child",
              duplicateMatchPath: "Peinture > Preparation des supports",
            },
          ],
        },
      ],
    };

    vi.mocked(generateEstimateStructureDraft).mockResolvedValueOnce(mergedChildDraft);
    vi.mocked(fetchEstimateStructureDraft).mockResolvedValueOnce(mergedChildDraft);

    render(
      <EstimateStructureDraftDialog
        isOpen
        targetVersionId="version-1"
        hasExistingItems
        existingSections={[
          {
            id: "section-existing",
            path: "Peinture",
            hierarchyLevel: 1,
            parentId: null,
            title: "Peinture",
          },
          {
            id: "section-compatible-child",
            path: "Peinture > Preparation des supports",
            hierarchyLevel: 2,
            parentId: "section-existing",
            title: "Preparation des supports",
          },
        ]}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByText("Provenance utilisée");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await screen.findByText("Lots à retenir");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await screen.findByText("Ajustements par nœud");

    const rootNodeCard = screen.getByTestId(
      "estimate-structure-draft-node-root-node"
    );
    const [rootActionSelect] = within(rootNodeCard).getAllByRole("combobox");

    await user.selectOptions(rootActionSelect, "skip");

    expect(
      screen.queryByText(
        /Corrigez les nœuds signalés avant d'appliquer la structure/i
      )
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Appliquer la structure" })
    ).not.toBeDisabled();
  });
});
