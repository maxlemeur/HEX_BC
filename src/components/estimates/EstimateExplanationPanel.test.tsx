import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/explanations-client", () => ({
  fetchEstimateLineExplanation: vi.fn(),
  fetchEstimateDeltaExplanation: vi.fn(),
}));

import { EstimateExplanationPanel } from "@/components/estimates/EstimateExplanationPanel";
import {
  fetchEstimateDeltaExplanation,
  fetchEstimateLineExplanation,
} from "@/lib/estimates/explanations-client";

const summaryFixture = {
  explanation_id: "11111111-1111-4111-8111-111111111111",
  kind: "price" as const,
  version_id: "22222222-2222-4222-8222-222222222222",
  line_id: "33333333-3333-4333-8333-333333333333",
  compare_version_id: null,
  summary_short: "Resume court.",
  summary_detail: null,
  confidence_label: "high" as const,
  confidence_score: 0.88,
  used_fallback: false,
  provider: "gemini",
  model: "gemini-3-pro-preview",
  generated_at: "2026-03-07T10:00:00.000Z",
  facts: [{ label: "Fact 1", source_label: "Source A", confidence_score: 1 }],
  hypotheses: [],
  inferences: [],
  provenance: [{ source_kind: "estimate_item", label: "Ligne", source_ref: "V2" }],
  risk_signals: [],
  impact_summary: {
    current_amount_ht_cents: 12000,
    current_amount_ttc_cents: 14400,
    top_drivers: [],
  },
};

const detailFixture = {
  ...summaryFixture,
  summary_detail: "Detail narratif complet.",
};

describe("EstimateExplanationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads summary on open and detail only on explicit request", async () => {
    vi.mocked(fetchEstimateLineExplanation)
      .mockResolvedValueOnce(summaryFixture)
      .mockResolvedValueOnce(detailFixture);

    render(
      <EstimateExplanationPanel
        open
        onOpenChange={() => undefined}
        kind="price"
        versionId={summaryFixture.version_id}
        lineId={summaryFixture.line_id}
        lineLabel="Mur beton"
        surfaceLabel="Explication prix ligne devis"
      />
    );

    expect(await screen.findByText("Resume court.")).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenCalledWith(
      summaryFixture.version_id,
      summaryFixture.line_id,
      { detail: false }
    );
    expect(screen.queryByText("Detail narratif complet.")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Charger le detail" }));

    await waitFor(() => {
      expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenLastCalledWith(
        summaryFixture.version_id,
        summaryFixture.line_id,
        { detail: true }
      );
    });
    expect(await screen.findByText("Detail narratif complet.")).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateDeltaExplanation)).not.toHaveBeenCalled();
  });
});
