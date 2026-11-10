import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/editor-read-client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  previewTakeoffConversion: vi.fn(),
}));

import { TakeoffApplyWizard } from "@/components/takeoff/TakeoffApplyWizard";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/editor-read-client";
import { previewTakeoffConversion } from "@/lib/takeoff/client";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "append" as const,
  target_section_id: null,
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 0,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: ITEM_ID,
      source_order: 0,
      rule_id: "44444444-4444-4444-8444-444444444444",
      rule_name: "Rule set_price",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 420,
      },
      applied_by: "rule" as const,
      original: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 420,
        assembly_id: null,
      },
    },
  ],
};

// TI-664 L5c: the wizard's guard counts the lines the server's guard counts. Ways it fails, written before the fix:
// - a line the mapping plan skips (or folds into an assembly) still blocks in the wizard, never on the server;
// - the guard panel names a failed rule only « Règle en échec », without its reason (the Z1/Z2 length, the other zone).
const RULE_REASON = "Tronçon compté aussi sur une autre page du niveau R+1 que Z1 : 1,00 m avec « EF Inox 316L DN 22 » (Z2).";
const RULE_ITEM = {
  id: ITEM_ID, designation: "Tube PVC", quantity: 12, unit: "ml", confidence: 0.9, evidence: "Plan R+1 Z1",
  source_file_name: "plan.pdf", source_page: 1, metadata: {}, is_excluded: false, exclusion_reason: null,
  is_verified: false, verified_at: null, verified_by: null, created_at: "2026-11-04T10:00:00.000Z", updated_at: "2026-11-04T10:00:00.000Z",
  rules_stale: false,
  rule_results: [{ rule: "zone_overlap" as const, status: "fail" as const, code: "ZONE_OVERLAP_DUPLICATE" as const, version: 101,
    acceptable: true, reason: RULE_REASON }],
};

function withAction(action: "skip" | "apply_assembly" | "set_price") {
  return { ...PREVIEW_RESPONSE, items: [{ ...PREVIEW_RESPONSE.items[0], action,
    transformed: { ...PREVIEW_RESPONSE.items[0].transformed, is_excluded: action === "skip" } }] };
}

async function reachConfirmation() {
  await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
}

function renderRuleWizard() {
  render(
    <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
      submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn().mockResolvedValue(undefined)}
      items={[RULE_ITEM]} jobLevel="C" />
  );
}

describe("TakeoffApplyWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
      {
        id: SECTION_ID,
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Section A",
      },
    ] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
  });

  it("requires a fresh preview after an override changes", async () => {
    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });

    fireEvent.change(screen.getByDisplayValue("Règle auto"), {
      target: { value: "set_price" },
    });

    expect(screen.getByText(/Les ajustements ont changé/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Recalculer la preview" }));

    await waitFor(() => {
      expect(screen.queryByText(/Les ajustements ont changé/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });
  });

  it.each(["skip", "apply_assembly"] as const)("does not block a failed line the mapping plan leaves out (%s), as the server does not", async (action) => {
    vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction(action));
    renderRuleWizard();
    await reachConfirmation();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmer l'application" })).toBeEnabled());
    expect(screen.queryByText(RULE_REASON, { exact: false })).not.toBeInTheDocument();
  });

  // TI-686 D10: an administrator forces each blocked line with a coded reason and a justification; « Appliquer à la
  // sélection » copies one reason and one text to the selected lines, and the request stores the text once. Written
  // before the per-line panel (a single job-level justification was sent).
  it("forces each blocked line with its coded reason, the selection's text sent once", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const other = "33333333-3333-4333-8333-333333333332";
    const noProof = { ...RULE_ITEM, rule_results: [], evidence: null };
    render(
      <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={2} excludedCount={0} isSubmitting={false}
        submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} isAdmin
        items={[noProof, { ...noProof, id: other, designation: "Raccord PVC" }]} jobLevel="C" />
    );
    await reachConfirmation();
    const force = await screen.findByRole("button", { name: "Forcer l'application (2 lignes)" });
    expect(force).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motif de la sélection"), { target: { value: "additional_evidence" } });
    fireEvent.change(screen.getByLabelText("Justification de la sélection"),
      { target: { value: "  Relevé chantier joint au dossier.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer à la sélection" }));
    await waitFor(() => expect(force).toBeEnabled());
    fireEvent.click(force);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ override: true, forced: {
      forced_justifications: ["Relevé chantier joint au dossier."],
      forced_items: [
        { item_id: other, reason_code: "additional_evidence", justification_index: 0 },
        { item_id: ITEM_ID, reason_code: "additional_evidence", justification_index: 0 },
      ] } })));
  });

  it("shows the per-line override to administrators only", async () => {
    render(
      <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
        submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn().mockResolvedValue(undefined)}
        items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} jobLevel="C" />
    );
    await reachConfirmation();
    await waitFor(() => expect(screen.getByText(/Lignes à trancher/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Forcer l'application/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motif de la sélection")).not.toBeInTheDocument();
  });

  it("explains a quantity warning the plan keeps and permits confirmation without acknowledgement", async () => {
    vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction("set_price"));
    renderRuleWizard();
    await reachConfirmation();

    await waitFor(() => expect(screen.getByText(RULE_REASON, { exact: false })).toBeInTheDocument());
    expect(screen.getByText(/Doublon entre zones/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer l'application" })).toBeEnabled();
  });
});
