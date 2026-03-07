import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/estimates/EstimateExplanationTrigger", () => ({
  EstimateExplanationTrigger: ({
    triggerLabel,
  }: {
    triggerLabel: string;
  }) => <button type="button">{triggerLabel}</button>,
}));

import { EstimateDiffView } from "@/components/estimates/EstimateDiffView";

describe("EstimateDiffView", () => {
  it("renders the delta explanation trigger in the summary header", () => {
    render(
      <EstimateDiffView
        diff={{
          summary: {
            addedCount: 1,
            removedCount: 0,
            modifiedCount: 1,
            deltaHtCents: 12000,
            deltaTtcCents: 14400,
            previousTotals: {
              totalHtCents: 100000,
              totalTtcCents: 120000,
            },
            currentTotals: {
              totalHtCents: 112000,
              totalTtcCents: 134400,
            },
          },
          entries: [
            {
              key: "line-1",
              entityType: "line",
              changeType: "modified",
              sectionPath: ["Lot gros oeuvre"],
              title: "Mur beton",
              beforeItem: null,
              afterItem: null,
              fieldChanges: [],
              sortOrder: 1,
            },
          ],
        }}
        mode="inline"
        versionId="11111111-1111-4111-8111-111111111111"
        compareVersionId="22222222-2222-4222-8222-222222222222"
        previousVersionLabel="V1"
        currentVersionLabel="V2"
      />
    );

    expect(
      screen.getByRole("button", { name: "Expliquer le delta" })
    ).toBeInTheDocument();
  });
});
