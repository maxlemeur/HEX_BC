import { cleanup,render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/structure-drafts-client", () => ({
  generateEstimateStructureDraft: vi.fn(),
}));

vi.mock("@/app/dashboard/estimates/_actions/draft-ai-settings", () => ({
  loadEstimateDraftAiOptions: vi.fn(),
}));

import { loadEstimateDraftAiOptions } from "@/app/dashboard/estimates/_actions/draft-ai-settings";
import { offeredOpenAiModels } from "@/lib/ai/access/openai-pricing";
import { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts-client";

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
    vi.mocked(loadEstimateDraftAiOptions).mockResolvedValue({
      defaultSource: "personal_api_key",
      keyConnectionId: "key-connection-1",
      sources: {
        personal_api_key: {
          available: true,
          message: "Clé disponible",
          models: offeredOpenAiModels(new Set(["gpt-6.1-terra"])),
          preferences: { model: "gpt-6.1-terra", reasoningEffort: "high" },
        },
        chatgpt_plan: { available: false, message: "Forfait indisponible", models: [], preferences: null },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("prefills the payer and starts on click, then allows applying descendants of a skipped parent", async () => {
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

    expect(await screen.findByRole("combobox", { name: "Source d’IA" })).toHaveValue("personal_api_key");
    expect(screen.getByRole("combobox", { name: "Modèle" })).toHaveValue("gpt-6.1-terra");
    expect(screen.getByRole("combobox", { name: /raisonnement/i })).toHaveValue("high");
    expect(screen.getByText(/1,00.*US au plus par demande/)).toBeVisible();
    expect(generateEstimateStructureDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Générer l’aperçu" }));
    expect(generateEstimateStructureDraft).toHaveBeenCalledWith("version-1", {
      strategy: "hybrid",
      ai: { source: "personal_api_key", model: "gpt-6.1-terra", effort: "high", expectedConnectionId: "key-connection-1" },
    });
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
