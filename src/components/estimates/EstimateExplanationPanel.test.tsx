import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/explanations-client", () => ({
  fetchEstimateLineExplanation: vi.fn(),
  fetchEstimateDeltaExplanation: vi.fn(),
  generateEstimateLineExplanation: vi.fn(),
  refreshEstimateLineExplanationSettings: vi.fn(),
}));

import { EstimateExplanationPanel } from "@/components/estimates/EstimateExplanationPanel";
import { fetchEstimateLineExplanation, generateEstimateLineExplanation } from "@/lib/estimates/explanations-client";
import type { PriceExplanationSettings } from "@/lib/estimates/explanation-schemas";

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

const MODEL = { id: "gpt-5-mini", name: "GPT-5 mini", reasoningEfforts: ["low", "medium"], defaultReasoningEffort: "low" } as const;
const settings: PriceExplanationSettings = {
  defaultSource: "personal_api_key",
  connectionId: "99999999-9999-4999-8999-999999999999",
  canRefreshPlanModels: false,
  sources: {
    personal_api_key: {
      available: true, message: "Clé configurée.", models: [{ ...MODEL, reasoningEfforts: [...MODEL.reasoningEfforts] }],
      preferences: { model: MODEL.id, reasoningEffort: "low" },
    },
    chatgpt_plan: { available: false, message: "Forfait indisponible." },
  },
};

const cached = (explanation = summaryFixture, revision = explanation.explanation_id) =>
  ({ status: "ready" as const, explanation, revision, settings });

const panel = {
  open: true,
  onOpenChange: () => undefined,
  kind: "price" as const,
  versionId: summaryFixture.version_id,
  lineId: summaryFixture.line_id,
  lineLabel: "Mur béton",
  surfaceLabel: "Explication prix ligne devis",
};

describe("EstimateExplanationPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("reopens and refreshes a cached explanation without generating it", async () => {
    vi.mocked(fetchEstimateLineExplanation)
      .mockResolvedValueOnce(cached())
      .mockResolvedValueOnce(cached())
      .mockResolvedValueOnce(cached({ ...summaryFixture, summary_short: "Résumé actualisé." }, "updated"));
    const { rerender } = render(<EstimateExplanationPanel {...panel} />);
    expect(await screen.findByText("Resume court.")).toBeInTheDocument();

    rerender(<EstimateExplanationPanel {...panel} open={false} />);
    rerender(<EstimateExplanationPanel {...panel} />);
    expect(await screen.findByText("Resume court.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualiser" }));

    expect(await screen.findByText("Résumé actualisé.")).toBeInTheDocument();
    expect(fetchEstimateLineExplanation).toHaveBeenCalledTimes(3);
    expect(generateEstimateLineExplanation).not.toHaveBeenCalled();
  });

  it("reloads an explanation when the line cache token changes", async () => {
    vi.mocked(fetchEstimateLineExplanation)
      .mockResolvedValueOnce(cached())
      .mockResolvedValueOnce(cached({ ...summaryFixture, summary_short: "Résumé après édition." }, "edited"));

    const { rerender } = render(<EstimateExplanationPanel {...panel} cacheToken="2026-03-07T10:00:00.000Z" />);
    expect(await screen.findByText("Resume court.")).toBeInTheDocument();

    rerender(<EstimateExplanationPanel {...panel} cacheToken="2026-03-07T10:05:00.000Z" />);
    expect(await screen.findByText("Résumé après édition.")).toBeInTheDocument();
    expect(fetchEstimateLineExplanation).toHaveBeenCalledTimes(2);
    expect(generateEstimateLineExplanation).not.toHaveBeenCalled();
  });

  it.each(["missing", "stale"] as const)("requires an explicit click and shows the key ceiling for a %s explanation", async (status) => {
    vi.mocked(fetchEstimateLineExplanation).mockResolvedValue({ status, explanation: null, revision: "initial", settings });
    vi.mocked(generateEstimateLineExplanation).mockResolvedValue({
      revision: "generated",
      explanation: {
        ...summaryFixture, summary_short: "Résumé généré.", provider: "openai", model: "gpt-5-mini-2025-08-07",
        ai_request: { source: "personal_api_key", model: "gpt-5-mini-2025-08-07", reasoningEffort: "medium" },
      },
    });

    render(<EstimateExplanationPanel {...panel} />);

    expect(await screen.findByLabelText("Source d’IA")).toHaveValue("personal_api_key");
    expect(screen.getByLabelText("Modèle")).toHaveValue(MODEL.id);
    expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue("low");
    expect(screen.getByText(/0,10.*par explication/)).toBeInTheDocument();
    expect(generateEstimateLineExplanation).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Effort de raisonnement"), "medium");
    await user.click(screen.getByRole("button", { name: "Générer l’explication" }));

    expect(generateEstimateLineExplanation).toHaveBeenCalledTimes(1);
    expect(generateEstimateLineExplanation).toHaveBeenCalledWith(panel.versionId, panel.lineId, {
      revision: "initial", source: "personal_api_key", connectionId: settings.connectionId,
      model: MODEL.id, reasoningEffort: "medium",
    });
    expect(await screen.findByText("Résumé généré.")).toBeInTheDocument();
    expect(screen.getByText("gpt-5-mini-2025-08-07 · Moyen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Régénérer l’explication" })).toBeEnabled();
  });
});
