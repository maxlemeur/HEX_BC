import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GeneratedOuvrageSubdetailEditor } from "./GeneratedOuvrageSubdetailEditor";

describe("GeneratedOuvrageSubdetailEditor", () => {
  it("marks edited components as manual before saving", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <GeneratedOuvrageSubdetailEditor
        candidateLabel="Pose de faux plafond"
        isSaving={false}
        onSave={onSave}
        subdetail={{
          draftId: "draft-1",
          candidateId: "candidate-1",
          versionId: "version-1",
          projectId: "project-1",
          status: "pending_review",
          humanValidationRequired: true,
          generatedAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T09:05:00.000Z",
          summary: {
            componentCount: 1,
            dsCents: 81_000,
            indicativeTargetPriceCents: 105_300,
            confidence: 0.72,
            pricingSource: "heuristic_review_draft",
            riskSignals: [],
            facts: [],
            hypotheses: [],
            inferences: [],
          },
          components: [
            {
              componentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              status: "suggested",
              costType: "labor",
              designation: "Main d'oeuvre - Pose de faux plafond",
              unit: "h",
              quantity: 54,
              unitCostHtCents: 1500,
              lossCoeffBp: 0,
              yieldValue: 0.45,
              yieldUnit: "h/m2",
              confidence: 0.67,
              sourceLabel: "Texte libre saisi",
              dsCents: 81_000,
              facts: [],
              hypotheses: [],
              inferences: [],
              riskSignals: [],
              sources: [],
            },
          ],
        }}
      />
    );

    const quantityInput = screen.getByDisplayValue("54");
    await user.clear(quantityInput);
    await user.type(quantityInput, "36");
    await user.click(screen.getByRole("button", { name: "Valider le sous-detail" }));

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "manual",
        quantity: 36,
        yieldValue: 0.45,
        yieldUnit: "h/m2",
      }),
    ]);
  });
});
