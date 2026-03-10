import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const deltaSummaryFixture = {
  explanation_id: "44444444-4444-4444-8444-444444444444",
  kind: "delta" as const,
  version_id: "55555555-5555-4555-8555-555555555555",
  line_id: null,
  compare_version_id: "66666666-6666-4666-8666-666666666666",
  summary_short: "V2 vs V1: baisse du devis et erosion de marge.",
  summary_detail: null,
  confidence_label: "medium" as const,
  confidence_score: 0.64,
  used_fallback: false,
  provider: "gemini",
  model: "gemini-3-pro-preview",
  generated_at: "2026-03-10T09:00:00.000Z",
  facts: [],
  hypotheses: [],
  inferences: [],
  provenance: [],
  risk_signals: [],
  impact_summary: {
    delta_ht_cents: -68500,
    delta_ttc_cents: -82200,
    current_margin_bp: 1650,
    compare_margin_bp: 1800,
    margin_bp_delta: -150,
    top_drivers: ["Mur beton: -685,00 EUR HT"],
  },
};

describe("EstimateExplanationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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

  it("bypasses the in-memory cache when refreshing explicitly", async () => {
    vi.mocked(fetchEstimateLineExplanation)
      .mockResolvedValueOnce(summaryFixture)
      .mockResolvedValueOnce({
        ...summaryFixture,
        explanation_id: "99999999-9999-4999-8999-999999999999",
        summary_short: "Resume actualise.",
      });

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

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actualiser" }));

    expect(await screen.findByText("Resume actualise.")).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenLastCalledWith(
      summaryFixture.version_id,
      summaryFixture.line_id,
      { detail: false }
    );
  });

  it("invalidates cached explanations when the cache token changes", async () => {
    vi.mocked(fetchEstimateLineExplanation)
      .mockResolvedValueOnce(summaryFixture)
      .mockResolvedValueOnce({
        ...summaryFixture,
        explanation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        summary_short: "Resume apres edition.",
      });

    const { rerender } = render(
      <EstimateExplanationPanel
        open
        onOpenChange={() => undefined}
        kind="price"
        versionId={summaryFixture.version_id}
        lineId={summaryFixture.line_id}
        lineLabel="Mur beton"
        surfaceLabel="Explication prix ligne devis"
        cacheToken="2026-03-07T10:00:00.000Z"
      />
    );

    expect(await screen.findByText("Resume court.")).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenCalledTimes(1);

    rerender(
      <EstimateExplanationPanel
        open
        onOpenChange={() => undefined}
        kind="price"
        versionId={summaryFixture.version_id}
        lineId={summaryFixture.line_id}
        lineLabel="Mur beton"
        surfaceLabel="Explication prix ligne devis"
        cacheToken="2026-03-07T10:05:00.000Z"
      />
    );

    expect(await screen.findByText("Resume apres edition.")).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateLineExplanation)).toHaveBeenCalledTimes(2);
  });

  it("renders amount and margin impact explicitly for delta explanations", async () => {
    vi.mocked(fetchEstimateDeltaExplanation).mockResolvedValue(deltaSummaryFixture);

    render(
      <EstimateExplanationPanel
        open
        onOpenChange={() => undefined}
        kind="delta"
        versionId={deltaSummaryFixture.version_id}
        compareVersionId={deltaSummaryFixture.compare_version_id}
        currentVersionLabel="V2"
        compareVersionLabel="V1"
        surfaceLabel="Explication delta entre versions"
      />
    );

    expect(
      await screen.findByText("V2 vs V1: baisse du devis et erosion de marge.")
    ).toBeInTheDocument();
    expect(screen.getByText("Impact montant")).toBeInTheDocument();
    expect(screen.getByText("HT -685,00 € · TTC -822,00 €")).toBeInTheDocument();
    expect(screen.getByText("Impact marge")).toBeInTheDocument();
    expect(
      screen.getByText("-1,50 pts · actuelle 16,50% · comparee 18,00%")
    ).toBeInTheDocument();
    expect(vi.mocked(fetchEstimateDeltaExplanation)).toHaveBeenCalledWith(
      deltaSummaryFixture.version_id,
      deltaSummaryFixture.compare_version_id,
      { detail: false }
    );
  });
});
