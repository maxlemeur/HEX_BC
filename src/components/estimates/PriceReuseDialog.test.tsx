import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/price-reuse-client", () => ({ arbitrateEstimatePriceReuse: vi.fn(), previewEstimatePriceReuse: vi.fn() }));
vi.mock("@/lib/estimates/section-copy-client", () => ({ fetchEstimateImportSources: vi.fn() }));

import { PriceReuseDialog } from "@/components/estimates/PriceReuseDialog";
import { arbitrateEstimatePriceReuse, previewEstimatePriceReuse } from "@/lib/estimates/price-reuse-client";
import type { PriceReusePreview } from "@/lib/estimates/price-reuse-contracts";
import { fetchEstimateImportSources } from "@/lib/estimates/section-copy-client";

const UPDATED_AT = "2026-11-26T10:00:00Z";
const ID = "10000000-0000-4000-8000-000000000001";
const PLAN_MODELS = [{ id: "plan-a", name: "Atelier", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }] as const;
const REFERENCE = { version_id: "source", updated_at: UPDATED_AT, project_name: "Atelier des Tilleuls", version_number: 2, title: "Plomberie" };
const LINES: PriceReusePreview["lines"] = Array.from({ length: 101 }, (_, index) => ({
  line_id: `vanne-${index}`, title: `Vanne DN80 ${index}`, unit_code: "u", section_path: [], status: "to_review",
  proposed_reference_line_id: null, preselected: false, current_unit_price_ht_cents: null,
  current_h_mo_per_unit: null, notes: [], candidates: [{ reference_line_id: ID, score: 0.9, exact: false, differences: [] }],
}));

function preview(defaultSource: PriceReusePreview["default_billing_source"]): PriceReusePreview {
  return {
    target: { version_id: "cible", updated_at: UPDATED_AT }, reference: REFERENCE,
    lines: LINES, summary: { identical: 0, to_review: LINES.length, new: 0 },
    references: [{ reference_line_id: ID, title: "Vanne d’arrêt DN80", unit_code: "u", section_path: [], unit_price_ht_cents: 1250,
      h_mo_per_unit: null, pu_ht_cents: null, labor_role_name: null, supply_type_name: null }],
    default_billing_source: defaultSource,
    arbiters: {
      chatgpt: { available: true, message: "Forfait connecté.", models: [{ ...PLAN_MODELS[0], reasoningEfforts: [...PLAN_MODELS[0].reasoningEfforts] }],
        preferences: { model: "plan-a", reasoningEffort: "low" } },
      personal_api_key: { available: true, message: "Clé enregistrée.", models: [
        { id: "gpt-6.1-terra", name: "Terra", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
        { id: "gpt-6.2-sol", name: "Sol", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
      ], preferences: { model: "gpt-6.1-terra", reasoningEffort: "low" } },
      decisions: { available: true, message: "Modèle fixe : gpt-6-luna." },
    },
  };
}

async function compare(result: PriceReusePreview) {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  vi.mocked(previewEstimatePriceReuse).mockResolvedValue(result);
  render(<PriceReuseDialog isOpen targetVersionId="cible" onClose={vi.fn()} prepareComparison={async () => true} onConfirm={onConfirm} />);
  await user.click(await screen.findByRole("button", { name: "Comparer" }));
  return { user, onConfirm, source: await screen.findByLabelText("Source d’IA") };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchEstimateImportSources).mockResolvedValue([{ id: REFERENCE.version_id, projectName: REFERENCE.project_name,
    title: REFERENCE.title, versionNumber: REFERENCE.version_number } as Awaited<ReturnType<typeof fetchEstimateImportSources>>[number]]);
});

describe("PriceReuseDialog AI settings", () => {
  it("prefills the profile key, shows its ceiling and sends changed settings in one command for more than 100 lines", async () => {
    vi.mocked(arbitrateEstimatePriceReuse).mockResolvedValue({
      provider: "personal_api_key", model: "gpt-6.2-sol", status: "partial", message: "Le budget ne permet pas d’envoyer les lignes restantes.",
      answers: [
        { line_id: LINES[0].line_id, reference_line_id: ID, confidence: 0.8 },
        { line_id: LINES[1].line_id, reference_line_id: null, confidence: null, no_match: true },
      ],
    });
    const { user, onConfirm, source } = await compare(preview("personal_api_key"));
    const model = screen.getByLabelText("Modèle");
    const effort = screen.getByLabelText("Effort de raisonnement");
    expect(source).toHaveValue("personal_api_key");
    expect(source).toHaveAccessibleDescription(/0,10 \$ US au plus par demande/);
    expect(model).toHaveValue("gpt-6.1-terra");
    expect(effort).toHaveValue("low");
    expect(arbitrateEstimatePriceReuse).not.toHaveBeenCalled();

    await user.selectOptions(model, "gpt-6.2-sol");
    await user.selectOptions(effort, "high");
    await user.click(screen.getByRole("button", { name: "Départager" }));

    expect(arbitrateEstimatePriceReuse).toHaveBeenCalledExactlyOnceWith("cible", {
      provider: "personal_api_key", model: "gpt-6.2-sol", reasoning_effort: "high", reference_version_id: REFERENCE.version_id,
      reference_updated_at: UPDATED_AT, line_ids: LINES.map((line) => line.line_id),
    });
    expect(await screen.findByTestId("price-reuse-ai-status")).toHaveTextContent(/budget.*lignes restantes/);
    expect(screen.getByText("Clé API OpenAI : aucun article")).toBeVisible();
    expect(screen.getByRole("button", { name: "Appliquer 0 reprise" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retenir les propositions de l’IA (1)" }));
    expect(screen.getByRole("button", { name: "Appliquer 1 reprise" })).toBeEnabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("prefills the plan and offers the fixed Decisions model only after manual selection", async () => {
    const { user, source } = await compare(preview("chatgpt_plan"));
    expect(source).toHaveValue("chatgpt_plan");
    expect(screen.getByLabelText("Modèle")).toHaveValue("plan-a");
    expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue("low");

    await user.selectOptions(source, "decisions");

    expect(source).toHaveAccessibleDescription(/Modèle fixe.*gpt-6-luna/);
    expect(screen.queryByLabelText("Modèle")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Effort de raisonnement")).not.toBeInTheDocument();
    expect(arbitrateEstimatePriceReuse).not.toHaveBeenCalled();
  });

  it("requires a manual source when the profile's default is unavailable", async () => {
    const result = preview("personal_api_key");
    result.arbiters.personal_api_key = { available: false, message: "Clé indisponible.", models: [], preferences: null };
    const { source } = await compare(result);
    expect(source).toHaveValue("");
    expect(source).toHaveAccessibleDescription(/Clé indisponible/);
    expect(screen.getByRole("button", { name: "Départager" })).toBeDisabled();
    expect(arbitrateEstimatePriceReuse).not.toHaveBeenCalled();
  });
});
