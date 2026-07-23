import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/estimates/EstimateExplanationTrigger", () => ({
  EstimateExplanationTrigger: ({
    triggerLabel,
  }: {
    triggerLabel: string;
  }) => <button type="button">{triggerLabel}</button>,
}));

import { EstimateDiffView } from "@/components/estimates/EstimateDiffView";

describe("EstimateDiffView", () => {
  afterEach(cleanup);

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

  it("montre le résumé quand seuls remise/coefficient changent (lignes identiques)", () => {
    render(
      <EstimateDiffView
        diff={{
          summary: {
            addedCount: 0,
            removedCount: 0,
            modifiedCount: 0,
            deltaHtCents: -1000000,
            deltaTtcCents: -1200000,
            previousTotals: { totalHtCents: 5000000, totalTtcCents: 6000000 },
            currentTotals: { totalHtCents: 4000000, totalTtcCents: 4800000 },
          },
          entries: [],
        }}
        mode="inline"
        versionId="11111111-1111-4111-8111-111111111111"
        compareVersionId="22222222-2222-4222-8222-222222222222"
        previousVersionLabel="V1"
        currentVersionLabel="V2"
      />
    );

    expect(
      screen.queryByText(/Aucun changement detecte/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText("Resume des changements")).toBeInTheDocument();
    expect(
      screen.getByText(/remise, coefficient global ou arrondi/i)
    ).toBeInTheDocument();
  });
});
