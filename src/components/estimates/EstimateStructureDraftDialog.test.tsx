import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      detail: "Indisponible sur main",
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
          facts: ["Historique present sur une version precedente."],
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

  it("loads the draft preview and only applies after explicit confirmation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

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
          },
        ]}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    await screen.findByText("Provenance utilisee");
    expect(generateEstimateStructureDraft).toHaveBeenCalledWith("version-1", {
      strategy: "hybrid",
    });
    expect(fetchEstimateStructureDraft).toHaveBeenCalledWith(
      "version-1",
      "draft-1"
    );
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await screen.findByText("Lots a retenir");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await screen.findByText("Mode d'application");
    expect(
      screen.getByRole("radio", { name: /Creer a vide/i })
    ).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Appliquer la structure" })
    );

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith("draft-1", {
        mode: "merge_existing",
        selectedRootNodeIds: ["root-node"],
        overrides: [],
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the generation error and keeps the next step disabled", async () => {
    const user = userEvent.setup();

    vi.mocked(generateEstimateStructureDraft).mockRejectedValueOnce(
      new Error("Generation indisponible")
    );

    render(
      <EstimateStructureDraftDialog
        isOpen
        targetVersionId="version-1"
        hasExistingItems={false}
        existingSections={[]}
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByText("Generation indisponible");
    expect(
      screen.getByRole("button", { name: "Continuer" })
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Fermer" }));
  });
});
