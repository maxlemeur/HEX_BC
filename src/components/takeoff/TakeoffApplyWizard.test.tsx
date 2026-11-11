import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/editor-read-client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  previewTakeoffConversion: vi.fn(),
}));

vi.mock("@/lib/takeoff/page-contributions-client", () => ({
  fetchTakeoffJobPageContributions: vi.fn(),
  fetchLaunchPageContributions: vi.fn(),
}));

vi.mock("@/lib/takeoff/page-replacement-client", () => ({
  fetchTakeoffPageReplacement: vi.fn(),
}));

import { TakeoffApplyWizard } from "@/components/takeoff/TakeoffApplyWizard";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/editor-read-client";
import { previewTakeoffConversion } from "@/lib/takeoff/client";
import { fetchTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-client";
import { fetchTakeoffPageReplacement } from "@/lib/takeoff/page-replacement-client";
import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

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
    vi.mocked(fetchTakeoffJobPageContributions).mockResolvedValue({ version_id: VERSION_ID, pages: [], jobs: [],
      unidentified_item_ids: [], other_takeoff_line_count: 0 });
    vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ job_id: JOB_ID, version_id: VERSION_ID, rows: [], jobs: [],
      unidentified_count: 0, merge_required: false });
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
  // TI-682 lot D, PR 2: a page of this takeoff that another takeoff already brought into the estimate is decided before
  // the last click: replace its earlier measure (preselected) or keep both with a reason. A line the new takeoff no longer
  // has and a quantity changed by hand wait for the estimator's choice; the confirmation stays disabled until then.
  // Written before the step existed (PR 1 only named the page).
  describe("pages already in the estimate", () => {
    const EARLIER_JOB = "66666666-6666-4666-8666-666666666666";
    const LINE_A = "77777777-7777-4777-8777-777777777771";
    const LINE_B = "77777777-7777-4777-8777-777777777772";
    const NEW_LINE = "88888888-8888-4888-8888-888888888882";
    const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
    const earlierLine = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, unit_key: "ml", quantity: 13,
      measured_quantity: 13, changed_by_hand: false, updated_at: "2026-11-10T09:30:00.123456+00:00", unit_price_ht_cents: 2500,
      job_id: EARLIER_JOB, dpgf_target: false, item_ids: [`${id.slice(0, -1)}9`], sources: [{ id: `${id.slice(0, -1)}9`, quantity: 12.4 }],
      length_factor: 1, ...extra });
    const proposal = (rowExtra: Record<string, unknown> = {}, lineA: Record<string, unknown> = {}): TakeoffPageReplacementResponse => ({
      job_id: JOB_ID, version_id: VERSION_ID, unidentified_count: 0, merge_required: false,
      jobs: [{ id: EARLIER_JOB, created_at: "2026-11-10T09:30:00.000Z", level: "C", source_file_name: "plan.pdf" }],
      rows: [{ key: "row-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [EARLIER_JOB],
        new_lines: [{ id: ITEM_ID, designation: "Tube PVC", unit: "ml", quantity: 15.2, unit_key: "ml", candidate_ids: [LINE_A, LINE_B] },
          { id: NEW_LINE, designation: "Lave-mains", unit: "u", quantity: 2, unit_key: "u", candidate_ids: [] }],
        earlier_lines: [earlierLine(LINE_A, "Réseau chiffré", lineA), earlierLine(LINE_B, "Vanne d’arrêt")],
        pairs: [{ takeoff_item_id: ITEM_ID, estimate_item_id: LINE_A, source_item_id: `${LINE_A.slice(0, -1)}9`, reason: "same_designation",
          locked: false }],
        ambiguous_document: false, keep_both_refused: null, ...rowExtra } as TakeoffPageReplacementResponse["rows"][number]],
    });
    const confirm = () => screen.getByRole("button", { name: "Confirmer l'application" });

    function renderWizard(onConfirm = vi.fn().mockResolvedValue(undefined), extra: Record<string, unknown> = {}) {
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} items={[{ ...RULE_ITEM, rule_results: [] }]} jobLevel="C"
          {...extra} />
      );
      return onConfirm;
    }

    it("proposes the replacement, waits for the vanished line, and sends the decisions with « Ajouter »", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const onConfirm = renderWizard();
      await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      fireEvent.click(screen.getByRole("radio", { name: /^Fusionner/ }));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(panel).toHaveTextContent("plan.pdf, page 1");
      expect(panel).toHaveTextContent("Déjà au devis par le métré du 10/11/2026 (niveau C), 2 lignes.");
      expect(within(panel).getByRole("radio", { name: "Remplacer la mesure précédente (recommandé)" })).toBeChecked();
      expect(panel).toHaveTextContent("Réseau chiffré : 13 → 16 (+3) — titre, prix et catégorie gardés");
      expect(panel).toHaveTextContent("« Ajouter » est retenu");
      expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(JOB_ID,
        { strategy: "merge", target_section_id: SECTION_ID, overrides: undefined }, expect.anything());
      // No default for a line the new takeoff no longer has: the confirmation waits for « remove » or « keep ».
      expect(confirm()).toBeDisabled();
      fireEvent.click(within(panel).getByRole("button", { name: "Retirer les 1 ligne" }));
      expect(within(panel).getByLabelText("Choix pour Vanne d’arrêt")).toHaveValue("remove");
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalled());
      expect(onConfirm.mock.calls[0][0]).toMatchObject({ strategy: "append", pageDecisions: [{
        document, source_page: 1, earlier_job_ids: [EARLIER_JOB], decision: "replace", reason_code: null, note: null,
        lines: [{ estimate_item_id: LINE_A, expected_updated_at: "2026-11-10T09:30:00.123456+00:00", action: "update", take: null,
          item_ids: [`${LINE_A.slice(0, -1)}9`] },
        { estimate_item_id: LINE_B, expected_updated_at: "2026-11-10T09:30:00.123456+00:00", action: "remove", take: null,
          item_ids: [`${LINE_B.slice(0, -1)}9`] }],
        pairs: [{ takeoff_item_id: ITEM_ID, estimate_item_id: LINE_A }] }] });
    });

    it("lets the estimator correct a pair, and waits for a choice on a quantity changed by hand", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({}, { changed_by_hand: true, quantity: 14 }));
      renderWizard(undefined, { presetStrategy: "append" });
      await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.click(within(panel).getByRole("button", { name: "Garder les 1 ligne" }));
      expect(confirm()).toBeDisabled();
      expect(within(panel).getByRole("status")).toHaveTextContent("1 quantité modifiée à la main");
      fireEvent.click(within(panel).getByRole("radio", { name: "Garder ma quantité (14)" }));
      await waitFor(() => expect(confirm()).toBeEnabled());
      // The tube now replaces the valve instead: the network line has no new line, so it waits for a choice again.
      fireEvent.change(within(panel).getByLabelText("Remplace, pour Tube PVC"), { target: { value: LINE_B } });
      expect(confirm()).toBeDisabled();
      expect(within(panel).getByLabelText("Choix pour Réseau chiffré")).toHaveValue("");
    });

    it("keeps both only with a reason, and a note for a complementary scope", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const onConfirm = renderWizard(undefined, { presetStrategy: "append" });
      await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.click(within(panel).getByRole("radio", { name: "Garder les deux" }));
      expect(confirm()).toBeDisabled();
      fireEvent.change(within(panel).getByLabelText("Motif pour plan.pdf, page 1"), { target: { value: "complementary_scope" } });
      expect(confirm()).toBeDisabled();
      fireEvent.change(within(panel).getByLabelText("Périmètre complémentaire pour plan.pdf, page 1"),
        { target: { value: "Réseau du local technique ajouté" } });
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalled());
      expect(onConfirm.mock.calls[0][0].pageDecisions).toMatchObject([{ decision: "keep_both", reason_code: "complementary_scope",
        note: "Réseau du local technique ajouté", pairs: [], lines: [{ estimate_item_id: LINE_A, action: "keep" },
          { estimate_item_id: LINE_B, action: "keep" }] }]);
    });

    it("does not offer to keep both where the page feeds a DPGF line another takeoff fed", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({ keep_both_refused: "dpgf_target" }));
      renderWizard(undefined, { presetStrategy: "append" });
      await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(within(panel).getByRole("radio", { name: "Garder les deux" })).toBeDisabled();
      expect(panel).toHaveTextContent("alimente une ligne DPGF déjà alimentée par un autre métré");
    });

    it("reads the proposal again after the application refused a page decision", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const props = { open: true, jobId: JOB_ID, versionId: VERSION_ID, includedCount: 1, excludedCount: 0, isSubmitting: false,
        onOpenChange: () => undefined, onConfirm: vi.fn().mockResolvedValue(undefined), items: [{ ...RULE_ITEM, rule_results: [] }],
        jobLevel: "C", presetStrategy: "append" as const };
      const { rerender } = render(<TakeoffApplyWizard {...props} submitError={null} />);
      await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
      fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
      await screen.findByRole("region", { name: "Pages déjà au devis" });
      const calls = vi.mocked(fetchTakeoffPageReplacement).mock.calls.length;
      rerender(<TakeoffApplyWizard {...props} submitError="Le devis a changé depuis la proposition." submitErrorGuard="page_decision" />);
      await waitFor(() => expect(vi.mocked(fetchTakeoffPageReplacement).mock.calls.length).toBe(calls + 1));
    });

    it("shows nothing and waits for nothing when the estimate holds none of its pages", async () => {
      vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction("set_price"));
      renderRuleWizard();
      await reachConfirmation();
      await waitFor(() => expect(screen.getByRole("button", { name: "Confirmer l'application" })).toBeEnabled());
      expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull();
    });
  });
});
