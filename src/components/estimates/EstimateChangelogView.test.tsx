import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/estimates/EstimateExplanationTrigger", () => ({
  EstimateExplanationTrigger: ({
    triggerLabel,
  }: {
    triggerLabel: string;
  }) => <button type="button">{triggerLabel}</button>,
}));

import { EstimateChangelogView } from "@/components/estimates/EstimateChangelogView";

describe("EstimateChangelogView", () => {
  it("renders the delta explanation trigger in the changelog header", () => {
    render(
      <EstimateChangelogView
        versionId="11111111-1111-4111-8111-111111111111"
        compareVersionId="22222222-2222-4222-8222-222222222222"
        changelog={{
          summary: {
            addedCount: 1,
            removedCount: 0,
            modifiedCount: 1,
            totalChangeCount: 2,
            deltaHtCents: 8000,
            deltaTtcCents: 9600,
          },
          sections: [],
        }}
        previousVersionLabel="V1"
        currentVersionLabel="V2"
        exportPdfHref={null}
      />
    );

    expect(
      screen.getByRole("button", { name: "Expliquer le delta" })
    ).toBeInTheDocument();
  });
});
