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
import { previewTakeoffConversion, type TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
import { fetchTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-client";
import { fetchTakeoffPageReplacement } from "@/lib/takeoff/page-replacement-client";
import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_SECTION_ID = "55555555-5555-4555-8555-555555555556";
const RULE_ID = "44444444-4444-4444-8444-444444444444";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type PreviewItem = TakeoffPreviewConversionResponse["items"][number];
type Action = PreviewItem["action"];
const state = (designation: string, extra: Partial<PreviewItem["original"]> = {}): PreviewItem["original"] => ({ designation, quantity: 12,
  unit: "ml", is_excluded: false, category_id: null, unit_price_cents: null, assembly_id: null, ...extra });

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "append" as const,
  target_section_id: SECTION_ID,
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
      rule_id: RULE_ID,
      rule_name: "Rule set_price",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 420,
      },
      applied_by: "rule" as const,
      original: state("Tube PVC"),
      transformed: state("Tube PVC", { unit_price_cents: 420 }),
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

const confirm = () => screen.getByRole("button", { name: "Confirmer l'envoi" });

/** The one screen, once its impact preview is computed: no click needed. */
async function reachConfirmation() {
  await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
  await screen.findByRole("list", { name: "Lignes envoyées" });
}

function renderRuleWizard() {
  render(
    <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
      submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn().mockResolvedValue(undefined)}
      items={[RULE_ITEM]} jobLevel="C" />
  );
}

function section(id: string, title: string, position: number) {
  return { id, parent_id: null, item_type: "section", position, title, source_provider: null };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("TakeoffApplyWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1)] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
    vi.mocked(fetchTakeoffJobPageContributions).mockResolvedValue({ version_id: VERSION_ID, pages: [], jobs: [],
      unidentified_item_ids: [], other_takeoff_line_count: 0 });
    vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ job_id: JOB_ID, version_id: VERSION_ID, pages: [], lines: [], new_lines: [],
      pairs: [], jobs: [], unidentified_count: 0, merge_required: false, dpgf_targets: [], dpgf_merge_refusals: [] });
  });

  // 2026-11-18, the owner's validated redesign: sending a reviewed takeoff to the estimate is one screen. Written before
  // the change, which walked four steps with « Suivant », asked for a strategy and computed the impact on step 3 only.
  describe("one screen « Envoyer au tableau de chiffrage »", () => {
    it("computes the impact preview without a click and confirms from the same screen, with no step and no strategy", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} targetVersionLabel="V2" includedCount={1} excludedCount={0}
          isSubmitting={false} submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} />
      );
      const dialog = screen.getByRole("dialog", { name: "Envoyer au tableau de chiffrage" });
      await reachConfirmation();
      expect(previewTakeoffConversion).toHaveBeenCalledTimes(1);
      expect(previewTakeoffConversion).toHaveBeenCalledWith(JOB_ID, { strategy: "append", target_section_id: SECTION_ID });
      expect(dialog).toHaveTextContent("Les lignes du métré arrivent dans cette section ; une page déjà mesurée met à jour ses lignes à leur place.");
      expect(within(dialog).queryByText(/Étape/)).toBeNull();
      expect(within(dialog).queryByRole("radio")).toBeNull();
      for (const name of ["Suivant", "Retour", /Recalculer/]) expect(within(dialog).queryByRole("button", { name })).toBeNull();
      expect(within(dialog).getByRole("button", { name: "Annuler" })).toBeEnabled();
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(onConfirm.mock.calls[0][0]).toEqual({ targetSectionId: SECTION_ID, targetSectionLabel: "Section A", strategy: "append",
        pageDecisions: [] });
    });

    it("merges into a version that holds DPGF lines, without offering a choice", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        { id: "66666666-6666-4666-8666-666666666666", parent_id: SECTION_ID, item_type: "line", position: 1, title: "Cloison",
          source_provider: "dpgf" }] as never);
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} />
      );
      await reachConfirmation();
      expect(previewTakeoffConversion).toHaveBeenCalledWith(JOB_ID, { strategy: "merge", target_section_id: SECTION_ID });
      expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(JOB_ID, { strategy: "merge", target_section_id: SECTION_ID },
        expect.anything());
      expect(screen.getByRole("dialog")).toHaveTextContent("Les lignes DPGF rapprochées gardent leur place ; cette section reçoit les nouvelles lignes.");
      expect(screen.queryByRole("radio")).toBeNull();
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "merge" })));
    });

    it("waits for a section: without one, says to create it and computes nothing", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([] as never);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      expect(await screen.findByText("Créez d'abord un lot ou un chapitre dans le devis pour y rattacher les lignes du métré.")).toBeInTheDocument();
      expect(screen.getByLabelText("Section cible")).toBeDisabled();
      expect(previewTakeoffConversion).not.toHaveBeenCalled();
      expect(fetchTakeoffPageReplacement).not.toHaveBeenCalled();
      expect(confirm()).toBeDisabled();
    });

    it("computes the preview again for another section, and never shows or confirms the answer of an earlier one", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        section(OTHER_SECTION_ID, "Section B", 2)] as never);
      const first = deferred<TakeoffPreviewConversionResponse>();
      const second = deferred<TakeoffPreviewConversionResponse>();
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} />
      );
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("region", { name: "Aperçu d’impact" })).toHaveTextContent("Calcul de l’aperçu d’impact…");
      fireEvent.change(screen.getByLabelText("Section cible"), { target: { value: OTHER_SECTION_ID } });
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenCalledTimes(2));
      expect(previewTakeoffConversion).toHaveBeenLastCalledWith(JOB_ID, { strategy: "append", target_section_id: OTHER_SECTION_ID });

      // Section B answers first, then the late answer computed for section A.
      second.resolve({ ...PREVIEW_RESPONSE, target_section_id: OTHER_SECTION_ID,
        items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube section B"), transformed: state("Tube section B") }] });
      await screen.findByText("Tube section B");
      first.resolve({ ...PREVIEW_RESPONSE, items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube section A"),
        transformed: state("Tube section A") }] });
      await waitFor(() => expect(confirm()).toBeEnabled());
      expect(screen.queryByText("Tube section A")).toBeNull();
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ targetSectionId: OTHER_SECTION_ID,
        targetSectionLabel: "Section B" })));
    });

    it("withholds the confirmation while the new section's preview is computed", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        section(OTHER_SECTION_ID, "Section B", 2)] as never);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());
      const pending = deferred<TakeoffPreviewConversionResponse>();
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(pending.promise);
      fireEvent.change(screen.getByLabelText("Section cible"), { target: { value: OTHER_SECTION_ID } });
      expect(confirm()).toBeDisabled();
      expect(screen.queryByRole("list", { name: "Lignes envoyées" })).toBeNull();
      pending.resolve({ ...PREVIEW_RESPONSE, target_section_id: OTHER_SECTION_ID });
      await waitFor(() => expect(confirm()).toBeEnabled());
    });

    it("shows a failed preview with « Réessayer », and confirms nothing until it is computed", async () => {
      vi.mocked(previewTakeoffConversion).mockRejectedValueOnce(new Error("Le serveur ne répond pas."));
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      expect(await screen.findByText("Le serveur ne répond pas.")).toBeInTheDocument();
      expect(confirm()).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
      await reachConfirmation();
      expect(previewTakeoffConversion).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Le serveur ne répond pas.")).toBeNull();
      await waitFor(() => expect(confirm()).toBeEnabled());
    });

    // The administrator's mapping rules apply silently: the estimator reads what each rule did, in French, with its
    // name; no action names, no identifier, no price in cents, nothing to type. Written before the change, which offered
    // a per-line « Override » select (rename, set_price, skip…), UUID inputs and a price in cents.
    it("lists the lines sent, read-only, with what each mapping rule did", async () => {
      const line = (id: string, action: Action, rule: string | null, original: PreviewItem["original"], transformed = original): PreviewItem =>
        ({ ...PREVIEW_RESPONSE.items[0], item_id: id, rule_id: rule ? RULE_ID : null, rule_name: rule, action,
          applied_by: action === "none" ? "none" : "rule", original, transformed });
      const ids = ["33333333-3333-4333-8333-333333333301", "33333333-3333-4333-8333-333333333302", "33333333-3333-4333-8333-333333333303",
        "33333333-3333-4333-8333-333333333304", "33333333-3333-4333-8333-333333333305", "33333333-3333-4333-8333-333333333306",
        "33333333-3333-4333-8333-333333333307"];
      const items = [
        line(ids[0], "rename", "Libellés plomberie", state("Tube cu 22"), state("Tube cuivre DN 22")),
        line(ids[1], "set_price", "Prix vannes", state("Vanne d’arrêt", { quantity: 3, unit: "u" }), state("Vanne d’arrêt", { quantity: 3, unit: "u", unit_price_cents: 4250 })),
        line(ids[2], "set_category", "Catégorie sanitaire", state("WC suspendu", { quantity: 2, unit: "u" }),
          state("WC suspendu", { quantity: 2, unit: "u", category_id: "77777777-7777-4777-8777-777777777777" })),
        line(ids[3], "apply_assembly", "Ouvrage lavabo", state("Lavabo", { quantity: 1, unit: "u" }),
          state("Lavabo", { quantity: 1, unit: "u", is_excluded: true, assembly_id: "88888888-8888-4888-8888-888888888888" })),
        line(ids[4], "skip", "Hors lot", state("Gaine technique", { quantity: 1, unit: "u" }), state("Gaine technique", { quantity: 1, unit: "u", is_excluded: true })),
        line(ids[5], "none", null, state("Robinet", { quantity: 4, unit: "u" })),
        line(ids[6], "none", null, state("Ligne exclue à la revue", { is_excluded: true })),
      ];
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE, items: items.map((item, at) => ({ ...item, source_order: at })),
        summary: { total_count: 7, included_count: 6, transformed_count: 5, overridden_count: 0, excluded_by_mapping_count: 2,
          assembly_insertions_count: 1 } });
      const source = (id: string, designation: string, page: number | null) => ({ ...RULE_ITEM, id, designation, rule_results: [],
        source_file_name: "plan-r1.pdf", source_page: page });
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={6} excludedCount={1} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} jobLevel="B"
          items={[source(ids[0], "Tube cu 22", 3), source(ids[1], "Vanne d’arrêt", null)]} />
      );
      await reachConfirmation();
      const list = screen.getByRole("list", { name: "Lignes envoyées" });
      const entry = (designation: string) => within(list).getByRole("listitem", { name: designation });
      expect(within(list).getAllByRole("listitem")).toHaveLength(6);
      expect(entry("Tube cu 22")).toHaveTextContent("Tube cu 22 → Tube cuivre DN 22");
      expect(entry("Tube cu 22")).toHaveTextContent("12 ml · plan-r1.pdf, page 3");
      expect(entry("Tube cu 22")).toHaveTextContent("Renommée par la règle « Libellés plomberie »");
      expect(entry("Vanne d’arrêt")).toHaveTextContent("3 u · plan-r1.pdf, page non renseignée");
      expect(entry("Vanne d’arrêt")).toHaveTextContent("Prix fixé par la règle « Prix vannes »");
      expect(entry("WC suspendu")).toHaveTextContent("Catégorie fixée par la règle « Catégorie sanitaire »");
      expect(entry("WC suspendu")).toHaveTextContent("Provenance non renseignée");
      expect(entry("Lavabo")).toHaveTextContent("Remplacée par un ouvrage (règle « Ouvrage lavabo »)");
      expect(entry("Gaine technique")).toHaveTextContent("Laissée de côté par la règle « Hors lot »");
      expect(entry("Robinet")).not.toHaveTextContent(/règle/);
      expect(within(list).queryByText("Ligne exclue à la revue")).toBeNull();
      // Nothing to edit, nothing technical.
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getAllByRole("combobox")).toEqual([screen.getByLabelText("Section cible")]);
      expect(within(dialog).queryByRole("textbox")).toBeNull();
      expect(within(dialog).queryByRole("spinbutton")).toBeNull();
      expect(dialog.textContent).not.toMatch(UUID);
      expect(dialog.textContent).not.toMatch(/4250|set_price|apply_assembly|skip|rename|Override|preview|apply\b/i);
      // The counts the preview computed, in words.
      const impact = screen.getByRole("region", { name: "Aperçu d’impact" });
      expect(impact).toHaveTextContent("Lignes retenues6");
      expect(impact).toHaveTextContent("Écartées3");
      expect(impact).toHaveTextContent("Ouvrages1");
      expect(impact).toHaveTextContent("Modifiées par une règle5");
    });
  });

  it.each(["skip", "apply_assembly"] as const)("does not block a failed line the mapping plan leaves out (%s), as the server does not", async (action) => {
    vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction(action));
    renderRuleWizard();
    await reachConfirmation();

    await waitFor(() => expect(confirm()).toBeEnabled());
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
    expect(confirm()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motif de la sélection"), { target: { value: "additional_evidence" } });
    fireEvent.change(screen.getByLabelText("Justification de la sélection"),
      { target: { value: "  Relevé chantier joint au dossier.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer à la sélection" }));
    await waitFor(() => expect(force).toBeEnabled());
    fireEvent.click(force);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ targetSectionId: SECTION_ID, targetSectionLabel: "Section A",
      strategy: "append", pageDecisions: [], override: true, forced: {
        forced_justifications: ["Relevé chantier joint au dossier."],
        forced_items: [
          { item_id: other, reason_code: "additional_evidence", justification_index: 0 },
          { item_id: ITEM_ID, reason_code: "additional_evidence", justification_index: 0 },
        ] } }));
  });

  it("shows the forcing of blocked lines to administrators only", async () => {
    render(
      <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
        submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn().mockResolvedValue(undefined)}
        items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} jobLevel="C" />
    );
    await reachConfirmation();
    await waitFor(() => expect(screen.getByText(/Lignes à trancher/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Forcer l'application/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motif de la sélection")).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled();
  });

  it("explains a quantity warning the plan keeps and permits confirmation without acknowledgement", async () => {
    vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction("set_price"));
    renderRuleWizard();
    await reachConfirmation();

    await waitFor(() => expect(screen.getByText(RULE_REASON, { exact: false })).toBeInTheDocument());
    expect(screen.getByText(/Doublon entre zones/)).toBeInTheDocument();
    expect(confirm()).toBeEnabled();
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
      dpgf_target: false, sources: [{ id: `${id.slice(0, -1)}9`, quantity: 12.4 }],
      length_factor: 1, assembly: false, outside_pages: false, ...extra });
    const proposal = (pageExtra: Record<string, unknown> = {}, lineA: Record<string, unknown> = {}): TakeoffPageReplacementResponse => ({
      job_id: JOB_ID, version_id: VERSION_ID, unidentified_count: 0, merge_required: false, dpgf_targets: [], dpgf_merge_refusals: [],
      jobs: [{ id: EARLIER_JOB, created_at: "2026-11-10T09:30:00.000Z", level: "C", source_file_name: "plan.pdf" }],
      pages: [{ key: "row-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [EARLIER_JOB],
        lines: [{ id: LINE_A, item_ids: [`${LINE_A.slice(0, -1)}9`] }, { id: LINE_B, item_ids: [`${LINE_B.slice(0, -1)}9`] }],
        new_line_ids: [ITEM_ID, NEW_LINE], dpgf_fed_again: [],
        ambiguous_document: false, keep_both_refused: null, ...pageExtra } as TakeoffPageReplacementResponse["pages"][number]],
      lines: [earlierLine(LINE_A, "Réseau chiffré", lineA), earlierLine(LINE_B, "Vanne d’arrêt")],
      new_lines: [{ id: ITEM_ID, designation: "Tube PVC", unit: "ml", quantity: 15.2, unit_key: "ml", candidates: [{ key: "row-1", line_ids: [LINE_A, LINE_B] }] },
        { id: NEW_LINE, designation: "Lave-mains", unit: "u", quantity: 2, unit_key: "u", candidates: [{ key: "row-1", line_ids: [] }] }],
      pairs: [{ takeoff_item_id: ITEM_ID, estimate_item_id: LINE_A, reason: "same_designation", locked: false }],
    });

    function renderWizard(onConfirm = vi.fn().mockResolvedValue(undefined)) {
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} excludedCount={0} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} items={[{ ...RULE_ITEM, rule_results: [] }]} jobLevel="C" />
      );
      return onConfirm;
    }

    // A DPGF version merges; a page already in the estimate that the merge does not require is sent with « append »,
    // each earlier line updated in place, and the screen says so in words (no strategy name).
    it("proposes the replacement, waits for the vanished line, and sends the decisions in place of a merge by title", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        { id: "99999999-9999-4999-8999-999999999999", parent_id: SECTION_ID, item_type: "line", position: 1, title: "EF DN 22",
          source_provider: "dpgf" }] as never);
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const onConfirm = renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(panel).toHaveTextContent("plan.pdf, page 1");
      expect(panel).toHaveTextContent("Déjà au devis par le métré du 10/11/2026 (niveau C), 2 lignes.");
      expect(within(panel).getByRole("radio", { name: "Remplacer la mesure précédente (recommandé)" })).toBeChecked();
      expect(panel).toHaveTextContent("Réseau chiffré : 13 → 16 (+3) — titre, prix et catégorie gardés");
      expect(panel).toHaveTextContent("Chaque ligne précédente de ces pages est mise à jour à sa place : aucune fusion par désignation ne s’applique à une page déjà au devis.");
      expect(panel).not.toHaveTextContent(/« Ajouter »|« Fusionner »/);
      expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(JOB_ID,
        { strategy: "merge", target_section_id: SECTION_ID }, expect.anything());
      // No default for a line the new takeoff no longer has: the confirmation waits for « remove » or « keep ».
      await screen.findByRole("list", { name: "Lignes envoyées" });
      expect(confirm()).toBeDisabled();
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "remove" } });
      expect(within(panel).getByLabelText("Choix pour Vanne d’arrêt")).toHaveValue("remove");
      expect(within(panel).getByRole("listitem", { name: "Vanne d’arrêt" })).toHaveTextContent("13 → retirée du devis");
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

    it("keeps the merge a DPGF page requires, without a notice", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        { id: "99999999-9999-4999-8999-999999999999", parent_id: SECTION_ID, item_type: "line", position: 1, title: "EF DN 22",
          source_provider: "dpgf" }] as never);
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...proposal(), merge_required: true });
      const onConfirm = renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(panel).not.toHaveTextContent("Chaque ligne précédente de ces pages est mise à jour à sa place");
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "keep" } });
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "merge" })));
    });

    it("lets the estimator correct a pair, and waits for a choice on a quantity changed by hand", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({}, { changed_by_hand: true, quantity: 14 }));
      renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(panel).not.toHaveTextContent("Chaque ligne précédente de ces pages est mise à jour à sa place");
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "keep" } });
      await screen.findByRole("list", { name: "Lignes envoyées" });
      expect(confirm()).toBeDisabled();
      expect(within(within(panel).getByRole("listitem", { name: "Réseau chiffré" })).getByRole("status")).toHaveTextContent("quantité modifiée à la main");
      fireEvent.click(within(panel).getByRole("radio", { name: "Garder ma quantité (14)" }));
      await waitFor(() => expect(confirm()).toBeEnabled());
      // The tube now replaces the valve instead: the network line has no new line, so it waits for a choice again.
      fireEvent.change(within(panel).getByLabelText("Remplace, pour Tube PVC"), { target: { value: LINE_B } });
      expect(confirm()).toBeDisabled();
      expect(within(panel).getByLabelText("Choix pour Réseau chiffré")).toHaveValue("");
    });

    it("keeps both only with a reason, and a note for a complementary scope", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const onConfirm = renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.click(within(panel).getByRole("radio", { name: "Garder les deux" }));
      await screen.findByRole("list", { name: "Lignes envoyées" });
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

    // The independent review: removing a line that also carries another page would remove that page too; a « replacement »
    // that replaces nothing is keeping both without a reason. Written before the fix.
    it("never removes a vanished line that also carries another page, and keeps it waiting for « keep »", async () => {
      const base = proposal();
      base.lines[1] = { ...base.lines[1], outside_pages: true };
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(base);
      renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      expect(within(within(panel).getByLabelText("Choix pour Vanne d’arrêt")).getByRole("option", { name: /Retirer du devis/ })).toBeDisabled();
      expect(within(panel).getByRole("listitem", { name: "Vanne d’arrêt" })).toHaveTextContent("Retirer n’est pas possible : elle porte aussi des pages que ce métré ne relit pas");
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "remove" } });
      expect(within(panel).getByLabelText("Choix pour Vanne d’arrêt")).toHaveValue("");
      await screen.findByRole("list", { name: "Lignes envoyées" });
      expect(confirm()).toBeDisabled();
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "keep" } });
      await waitFor(() => expect(confirm()).toBeEnabled());
    });

    it("asks to keep both, with a reason, when the replacement would replace nothing", async () => {
      const base = proposal();
      base.pairs = [];
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(base);
      renderWizard();
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.click(within(panel).getByRole("button", { name: "Garder les 2 lignes absentes" }));
      await screen.findByRole("list", { name: "Lignes envoyées" });
      expect(confirm()).toBeDisabled();
      expect(within(panel).getByRole("status")).toHaveTextContent("rien n’y est remplacé");
    });

    // TI-682 D4: keeping both is no longer refused where the page feeds a DPGF line another takeoff fed (it sums both);
    // the confirmation shows what each DPGF line it touches will hold, even with no page already in the estimate.
    it("shows each DPGF line the application touches, before and after, even without a page already in the estimate", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...proposal(), pages: [], lines: [], new_lines: [], pairs: [],
        dpgf_targets: [{ id: LINE_B, title: "EF cuivre DN 22 (DPGF)", unit_key: "ml", quantity: 20, reference: 20, length_factor: 1,
          earlier: [{ job_id: EARLIER_JOB, item_ids: [`${LINE_B.slice(0, -1)}9`], quantity: 12.4, protective: 0, printed_gap: 0,
            source_file_name: "plan.pdf", source_page: 1 }],
          fed: [{ item_id: ITEM_ID, quantity: 10.2, protective: 0, printed_gap: 0, source_file_name: "plan.pdf", source_page: 2 }] }] });
      renderWizard();
      const panel = await screen.findByRole("region", { name: "Lignes DPGF" });
      expect(panel).toHaveTextContent("EF cuivre DN 22 (DPGF) : 20 → 23 (+3) — alimentée par 2 métrés");
      expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull();
    });

    it("reads the proposal again after the application refused a page decision", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal());
      const props = { open: true, jobId: JOB_ID, versionId: VERSION_ID, includedCount: 1, excludedCount: 0, isSubmitting: false,
        onOpenChange: () => undefined, onConfirm: vi.fn().mockResolvedValue(undefined), items: [{ ...RULE_ITEM, rule_results: [] }],
        jobLevel: "C" };
      const { rerender } = render(<TakeoffApplyWizard {...props} submitError={null} />);
      await screen.findByRole("region", { name: "Pages déjà au devis" });
      const calls = vi.mocked(fetchTakeoffPageReplacement).mock.calls.length;
      rerender(<TakeoffApplyWizard {...props} submitError="Le devis a changé depuis la proposition." submitErrorGuard="page_decision" />);
      await waitFor(() => expect(vi.mocked(fetchTakeoffPageReplacement).mock.calls.length).toBe(calls + 1));
    });

    it("shows nothing and waits for nothing when the estimate holds none of its pages", async () => {
      vi.mocked(previewTakeoffConversion).mockResolvedValue(withAction("set_price"));
      renderRuleWizard();
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());
      expect(screen.queryByRole("region", { name: "Pages déjà au devis" })).toBeNull();
    });
  });
});
