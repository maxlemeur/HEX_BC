import { act,cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/estimates/editor-read-client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  previewTakeoffConversion: vi.fn(),
}));

vi.mock("@/lib/takeoff/page-replacement-client", () => ({
  fetchTakeoffPageReplacement: vi.fn(),
}));

import { TakeoffApplyWizard } from "@/components/takeoff/TakeoffApplyWizard";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/editor-read-client";
import { previewTakeoffConversion, type TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
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

/** The lines listed: « Lignes envoyées », or on a DPGF version the lines retained before its reconciliation. */
const LINES = /^Lignes (envoyées|retenues avant le rapprochement DPGF)$/;

/** The one screen, once its impact preview is computed: no click needed. */
async function reachConfirmation() {
  await waitFor(() => expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID));
  await screen.findByRole("list", { name: LINES });
}

function renderRuleWizard() {
  render(
    <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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

const NO_PAGE: TakeoffPageReplacementResponse = { job_id: JOB_ID, version_id: VERSION_ID, pages: [], lines: [], new_lines: [], pairs: [],
  jobs: [], unidentified_count: 0, merge_required: false, dpgf_targets: [], dpgf_merge_refusals: [] };
const DPGF_LINE = { id: "66666666-6666-4666-8666-666666666666", parent_id: SECTION_ID, item_type: "line", position: 1, title: "Cloison",
  source_provider: "dpgf" };
const OTHER_JOB_ID = "11111111-1111-4111-8111-111111111112";
const OUT_OF_SCOPE_NOTE = "Ce compte inclut les lignes que le rapprochement DPGF a classées hors périmètre : elles ne sont pas "
  + "envoyées, et cette liste ne les distingue pas.";
const select = () => screen.getByLabelText("Section cible");

describe("TakeoffApplyWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1)] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
    vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(NO_PAGE);
  });

  // 2026-11-18, the owner's validated redesign: sending a reviewed takeoff to the estimate is one screen. Written before
  // the change, which walked four steps with « Suivant », asked for a strategy and computed the impact on step 3 only.
  describe("one screen « Envoyer au tableau de chiffrage »", () => {
    it("computes the impact preview without a click and confirms from the same screen, with no step and no strategy", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} targetVersionLabel="V2" includedCount={1}
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
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1), DPGF_LINE] as never);
      // The server reads the same DPGF line (hasTakeoffDpgfTargetLines): its proposal says the merge is required.
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true });
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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

    // The independent review of eea9e030: a failed read of the sections or of the pages already in the estimate withheld
    // the confirmation with no way to ask again but closing the screen.
    it("offers « Réessayer » when the sections cannot be read, then computes for the first section", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockRejectedValueOnce(new Error("Le devis est momentanément indisponible."));
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      expect(await screen.findByText("Le devis est momentanément indisponible.")).toBeInTheDocument();
      expect(previewTakeoffConversion).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());
      expect(screen.queryByText("Le devis est momentanément indisponible.")).toBeNull();
    });

    it("offers « Réessayer » when the pages already in the estimate cannot be read, and waits for them", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockRejectedValueOnce(new Error("Lecture des pages impossible."));
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Lecture des pages impossible.");
      await reachConfirmation();
      expect(confirm()).toBeDisabled();
      fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
      await waitFor(() => expect(confirm()).toBeEnabled());
      expect(fetchTakeoffPageReplacement).toHaveBeenCalledTimes(2);
      expect(previewTakeoffConversion).toHaveBeenCalledTimes(1);
    });

    it("announces each preview computed without a click in a polite status, the section named", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        section(OTHER_SECTION_ID, "Section B", 2)] as never);
      render(
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} />
      );
      const status = () => within(screen.getByRole("region", { name: "Aperçu d’impact" })).getByRole("status");
      await waitFor(() => expect(status()).toHaveTextContent("Aperçu d’impact à jour pour « Section A » : 1 ligne retenue."));
      fireEvent.change(select(), { target: { value: OTHER_SECTION_ID } });
      await waitFor(() => expect(status()).toHaveTextContent("Aperçu d’impact à jour pour « Section B » : 1 ligne retenue."));
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={6} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={vi.fn()} jobLevel="B"
          items={[source(ids[0], "Tube cu 22", 3), source(ids[1], "Vanne d’arrêt", null)]} />
      );
      await reachConfirmation();
      // The independent review of eea9e030: a line a rule leaves aside was listed among the lines sent. Written before the
      // fix: it is listed apart, with the rule that left it aside; a line replaced by an ouvrage is sent as that ouvrage.
      const list = screen.getByRole("list", { name: "Lignes envoyées" });
      const aside = screen.getByRole("list", { name: "Laissées de côté par une règle" });
      const entry = (designation: string) => within(designation === "Gaine technique" ? aside : list).getByRole("listitem", { name: designation });
      expect(within(list).getAllByRole("listitem")).toHaveLength(5);
      expect(within(list).queryByText("Gaine technique")).toBeNull();
      expect(within(aside).getAllByRole("listitem")).toHaveLength(1);
      expect(screen.getByRole("heading", { name: "Lignes envoyées (5)" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Laissées de côté par une règle (1)" })).toBeInTheDocument();
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

  // The independent review of eea9e030. Each test was written before its fix and failed on that commit.
  describe("what is computed is what is sent", () => {
    const props = { open: true, versionId: VERSION_ID, includedCount: 1, isSubmitting: false, submitError: null,
      onOpenChange: () => undefined };

    // A v3 linked import stamps its root section `source_provider: "dpgf"` (planV3LinkedDpgfImport); the server merges only
    // into a version with a DPGF *line* (hasTakeoffDpgfTargetLines). The dialog sent « merge » for the section alone, and
    // the v3 writer then matched the ordinary line by title and unit and overwrote its quantity and provenance.
    it("appends into a version whose only DPGF item is a section, as the server decides", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([{ ...section(SECTION_ID, "Lot importé du DPGF", 1), source_provider: "dpgf" },
        { id: "66666666-6666-4666-8666-666666666667", parent_id: SECTION_ID, item_type: "line", position: 1, title: "Tube PVC",
          source_provider: null }] as never);
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await reachConfirmation();
      expect(previewTakeoffConversion).toHaveBeenCalledWith(JOB_ID, { strategy: "append", target_section_id: SECTION_ID });
      expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(JOB_ID, { strategy: "append", target_section_id: SECTION_ID },
        expect.anything());
      expect(screen.getByRole("dialog")).toHaveTextContent("Les lignes du métré arrivent dans cette section");
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "append" })));
    });

    // Both reads answered for A, then B was chosen and A again before B's reads came back: A's earlier answers matched
    // the request again and enabled the confirmation at once, although a rule changed meanwhile was not on screen.
    it("A → B → A: confirms only once both reads of the last visit to A have answered", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        section(OTHER_SECTION_ID, "Section B", 2)] as never);
      const previewB = deferred<TakeoffPreviewConversionResponse>();
      const previewA = deferred<TakeoffPreviewConversionResponse>();
      const pagesB = deferred<TakeoffPageReplacementResponse>();
      const pagesA = deferred<TakeoffPageReplacementResponse>();
      vi.mocked(previewTakeoffConversion).mockResolvedValueOnce(PREVIEW_RESPONSE).mockReturnValueOnce(previewB.promise)
        .mockReturnValueOnce(previewA.promise);
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValueOnce(NO_PAGE).mockReturnValueOnce(pagesB.promise)
        .mockReturnValueOnce(pagesA.promise);
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());

      fireEvent.change(select(), { target: { value: OTHER_SECTION_ID } });
      fireEvent.change(select(), { target: { value: SECTION_ID } });
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(fetchTakeoffPageReplacement).toHaveBeenCalledTimes(3));
      expect(confirm()).toBeDisabled();
      expect(screen.queryByRole("list", { name: "Lignes envoyées" })).toBeNull();

      // A mapping rule changed meanwhile: the fresh answer for A renames the line.
      previewA.resolve({ ...PREVIEW_RESPONSE, items: [{ ...PREVIEW_RESPONSE.items[0], transformed: state("Tube PVC Ø32") }] });
      expect(await screen.findByText(/Tube PVC Ø32/)).toBeInTheDocument();
      expect(confirm()).toBeDisabled();
      pagesA.resolve(NO_PAGE);
      await waitFor(() => expect(confirm()).toBeEnabled());
      // B's late answers change nothing.
      previewB.resolve({ ...PREVIEW_RESPONSE, target_section_id: OTHER_SECTION_ID,
        items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube section B"), transformed: state("Tube section B") }] });
      pagesB.resolve(NO_PAGE);
      await waitFor(() => expect(confirm()).toBeEnabled());
      expect(screen.queryByText("Tube section B")).toBeNull();
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ targetSectionId: SECTION_ID })));
    });

    // The re-check of 0fd09a20 (finding 2): both reads answered for job A, then job B of the same version was shown and A
    // again before any new answer: A's stored answers were current again and the confirmation enabled at once. Written
    // before the fix.
    it("never reads an answer computed for another job, nor one of an earlier visit to the same job (A → B → A)", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());
      const preview = deferred<TakeoffPreviewConversionResponse>();
      const pages = deferred<TakeoffPageReplacementResponse>();
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(preview.promise);
      vi.mocked(fetchTakeoffPageReplacement).mockReturnValueOnce(pages.promise);
      rerender(<TakeoffApplyWizard {...props} jobId={OTHER_JOB_ID} onConfirm={onConfirm} />);
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenLastCalledWith(OTHER_JOB_ID,
        { strategy: "append", target_section_id: SECTION_ID }));
      expect(confirm()).toBeDisabled();

      const previewAgain = deferred<TakeoffPreviewConversionResponse>();
      const pagesAgain = deferred<TakeoffPageReplacementResponse>();
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(previewAgain.promise);
      vi.mocked(fetchTakeoffPageReplacement).mockReturnValueOnce(pagesAgain.promise);
      rerender(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenLastCalledWith(JOB_ID,
        { strategy: "append", target_section_id: SECTION_ID }));
      expect(confirm()).toBeDisabled();
      expect(screen.queryByRole("list", { name: LINES })).toBeNull();
      // B's late answers change nothing; A's new ones confirm.
      preview.resolve({ ...PREVIEW_RESPONSE, job_id: OTHER_JOB_ID });
      pages.resolve({ ...NO_PAGE, job_id: OTHER_JOB_ID });
      previewAgain.resolve({ ...PREVIEW_RESPONSE, items: [{ ...PREVIEW_RESPONSE.items[0], transformed: state("Tube PVC Ø40") }] });
      expect(await screen.findByText(/Tube PVC Ø40/)).toBeInTheDocument();
      expect(confirm()).toBeDisabled();
      pagesAgain.resolve(NO_PAGE);
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    });

    // The sections were read without a DPGF line; one appeared before the proposal was read (the server says the merge is
    // required). The preview stayed computed for « append » and « append » was sent, which the server refuses on DPGF.
    it("reads both again for « merge » when a DPGF line appeared after the sections were read, and sends « merge »", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true });
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenLastCalledWith(JOB_ID, { strategy: "merge", target_section_id: SECTION_ID }));
      expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(JOB_ID, { strategy: "merge", target_section_id: SECTION_ID },
        expect.anything());
      expect(screen.getByRole("dialog")).toHaveTextContent("Les lignes DPGF rapprochées gardent leur place");
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "merge" })));
    });

    // « Le métré ou le devis a changé depuis l’aperçu »: the application refused the plan as stale, and the dialog kept
    // the stale preview and proposal, ready to be confirmed again unchanged.
    it("reads the sections and both computations again after a stale refusal, the section kept", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
        section(OTHER_SECTION_ID, "Section B", 2)] as never);
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm} />);
      await reachConfirmation();
      fireEvent.change(select(), { target: { value: OTHER_SECTION_ID } });
      await waitFor(() => expect(confirm()).toBeEnabled());
      const preview = deferred<TakeoffPreviewConversionResponse>();
      const pages = deferred<TakeoffPageReplacementResponse>();
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(preview.promise);
      vi.mocked(fetchTakeoffPageReplacement).mockReturnValueOnce(pages.promise);
      rerender(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={onConfirm}
        submitError="Le métré ou le devis a changé depuis l’aperçu. Rechargez la revue avant d’appliquer." submitErrorGuard="atomic_mapping_stale" />);
      expect(confirm()).toBeDisabled();
      await waitFor(() => expect(fetchEstimateItemsForVersion).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenCalledTimes(3));
      expect(previewTakeoffConversion).toHaveBeenLastCalledWith(JOB_ID, { strategy: "append", target_section_id: OTHER_SECTION_ID });
      expect(select()).toHaveValue(OTHER_SECTION_ID);
      expect(confirm()).toBeDisabled();
      preview.resolve({ ...PREVIEW_RESPONSE, target_section_id: OTHER_SECTION_ID });
      pages.resolve(NO_PAGE);
      await waitFor(() => expect(confirm()).toBeEnabled());
    });

    // Another reviewer excluded the last retained line before the preview was computed: the preview retains nothing, and
    // the confirmation read the review's earlier count.
    it("withholds both confirmations when the preview retains no line, whatever the review counted", async () => {
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE,
        summary: { ...PREVIEW_RESPONSE.summary, included_count: 0, transformed_count: 0 },
        items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube PVC", { is_excluded: true }),
          transformed: state("Tube PVC", { is_excluded: true }) }] });
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={vi.fn()} isAdmin jobLevel="C"
        items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} />);
      expect(await screen.findByText("Aucune ligne retenue à envoyer : réintégrez au moins une ligne dans la revue.")).toBeInTheDocument();
      expect(confirm()).toBeDisabled();
      // The administrator's forcing is withheld too, its justification complete.
      const force = await screen.findByRole("button", { name: "Forcer l'application (1 ligne)" });
      fireEvent.change(screen.getByLabelText("Motif de la sélection"), { target: { value: "additional_evidence" } });
      fireEvent.change(screen.getByLabelText("Justification de la sélection"), { target: { value: "Relevé chantier joint au dossier." } });
      fireEvent.click(screen.getByRole("button", { name: "Appliquer à la sélection" }));
      expect(force).toBeDisabled();
    });

    // On a DPGF version the application also leaves out the lines the reconciliation decided out of scope, which the
    // impact preview does not compute (it reads the mapping rules only): the screen says what its list does not count.
    it("says, on a DPGF version, that the lines decided out of scope are left aside too", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1), DPGF_LINE] as never);
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true });
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={vi.fn()} />);
      await reachConfirmation();
      expect(screen.getByRole("dialog")).toHaveTextContent(OUT_OF_SCOPE_NOTE);
    });

    it("says nothing of the reconciliation outside a DPGF version", async () => {
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={vi.fn()} />);
      await reachConfirmation();
      expect(screen.getByRole("dialog")).not.toHaveTextContent(OUT_OF_SCOPE_NOTE);
    });

    // While the application or the lock's release is pending, a way out of the guard panel left the review, and the
    // landing then moved the estimator from wherever that led.
    it("disables the guard panel's ways out while sending", async () => {
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={vi.fn()} isSubmitting isAdmin jobLevel="C"
        items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} onReturnToReview={vi.fn()}
        targetedReviewHref="/dashboard/affaires/p/takeoff/j/review/targeted" />);
      await screen.findByText(/Lignes à trancher/);
      expect(screen.getByRole("button", { name: "Retour à la revue" })).toBeDisabled();
      expect(screen.queryByRole("link", { name: "Trancher dans la revue ciblée" })).toBeNull();
      expect(screen.getByText("Trancher dans la revue ciblée")).toHaveAttribute("aria-disabled", "true");
    });

    it("disables the evidence review link while sending", async () => {
      render(<TakeoffApplyWizard {...props} jobId={JOB_ID} onConfirm={vi.fn()} isSubmitting jobLevel="C"
        items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} reviewHref="/dashboard/estimates/v/takeoff/j" />);
      await screen.findByText(/Lignes à trancher/);
      expect(screen.queryByRole("link", { name: "Ouvrir la revue des preuves" })).toBeNull();
      expect(screen.getByText("Ouvrir la revue des preuves")).toHaveAttribute("aria-disabled", "true");
    });
  });

  // The re-check of 0fd09a20. Each test was written before its fix and failed on that commit.
  describe("re-check of 0fd09a20", () => {
    const props = { open: true, jobId: JOB_ID, versionId: VERSION_ID, includedCount: 1, isSubmitting: false, submitError: null,
      onOpenChange: () => undefined };
    const ORDINARY = { id: "66666666-6666-4666-8666-666666666668", parent_id: SECTION_ID, item_type: "line", position: 2,
      title: "Tube PVC", unit_code: "ml", description: null, pricing_status: "priced", quantity: 17, source_provider: null };
    const tube = (quantity: number) => ({ ...PREVIEW_RESPONSE, strategy: "merge" as const,
      items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube PVC", { quantity }),
        transformed: state("Tube PVC", { quantity, unit_price_cents: 420 }) }] });
    const OVERWRITE = "La fusion écraserait des lignes du devis";

    // Finding 1 (high): an engine-3 version with a DPGF line elsewhere; under the destination section an ordinary line
    // « Tube PVC » whose quantity was typed by hand (17); the takeoff sends « Tube PVC », same unit, 10. The screen sent
    // « merge », the proposal had no earlier page to decide, and the writer overwrote 17 with 10 and its provenance.
    describe("an ordinary line « Fusionner » would overwrite", () => {
      beforeEach(() => {
        vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1),
          section(OTHER_SECTION_ID, "Section B", 2), { ...DPGF_LINE, parent_id: OTHER_SECTION_ID }, ORDINARY] as never);
        vi.mocked(previewTakeoffConversion).mockResolvedValue(tube(10));
        vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true });
      });

      it("refuses the send, names the line with its quantity and the one replacing it, and asks for another section", async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(<TakeoffApplyWizard {...props} onConfirm={onConfirm} />);
        const panel = await screen.findByRole("region", { name: OVERWRITE });
        expect(within(panel).getByRole("listitem", { name: "Tube PVC" })).toHaveTextContent("« Tube PVC » : 17 ml → 10 ml");
        expect(panel).toHaveTextContent("Choisissez une autre section de destination");
        await screen.findByRole("list", { name: LINES });
        expect(confirm()).toBeDisabled();

        fireEvent.change(select(), { target: { value: OTHER_SECTION_ID } });
        await waitFor(() => expect(confirm()).toBeEnabled());
        expect(screen.queryByRole("region", { name: OVERWRITE })).toBeNull();
        fireEvent.click(confirm());
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "merge",
          targetSectionId: OTHER_SECTION_ID })));
      });

      it("withholds the administrator's forcing too", async () => {
        render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} isAdmin jobLevel="C"
          items={[{ ...RULE_ITEM, rule_results: [], evidence: null }]} />);
        await screen.findByRole("region", { name: OVERWRITE });
        const force = await screen.findByRole("button", { name: "Forcer l'application (1 ligne)" });
        fireEvent.change(screen.getByLabelText("Motif de la sélection"), { target: { value: "additional_evidence" } });
        fireEvent.change(screen.getByLabelText("Justification de la sélection"), { target: { value: "Relevé chantier joint au dossier." } });
        fireEvent.click(screen.getByRole("button", { name: "Appliquer à la sélection" }));
        expect(force).toBeDisabled();
      });

      it("lets through a line the proposal pairs by the merge: its page decision says what it becomes", async () => {
        const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
        vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true,
          jobs: [{ id: OTHER_JOB_ID, created_at: "2026-11-10T09:30:00.000Z", level: "C", source_file_name: "plan.pdf" }],
          pages: [{ key: "row-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [OTHER_JOB_ID],
            lines: [{ id: ORDINARY.id, item_ids: ["99999999-9999-4999-8999-999999999991"] }], new_line_ids: [ITEM_ID],
            dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: "merge_match" }],
          lines: [{ id: ORDINARY.id, title: "Tube PVC", unit_key: "ml", quantity: 17, measured_quantity: 17, changed_by_hand: false,
            updated_at: "2026-11-10T09:30:00.123456+00:00", unit_price_ht_cents: 2500, dpgf_target: false, assembly: false,
            outside_pages: false, sources: [{ id: "99999999-9999-4999-8999-999999999991", quantity: 17 }], length_factor: 1 }],
          new_lines: [{ id: ITEM_ID, designation: "Tube PVC", unit: "ml", quantity: 10, unit_key: "ml",
            candidates: [{ key: "row-1", line_ids: [ORDINARY.id] }] }],
          pairs: [{ takeoff_item_id: ITEM_ID, estimate_item_id: ORDINARY.id, reason: "merge", locked: true }] });
        render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} />);
        await screen.findByRole("region", { name: "Pages déjà au devis" });
        await waitFor(() => expect(confirm()).toBeEnabled());
        expect(screen.queryByRole("region", { name: OVERWRITE })).toBeNull();
      });

      it("never refuses an append: it matches no line", async () => {
        vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1), ORDINARY] as never);
        vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...tube(10), strategy: "append" });
        vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(NO_PAGE);
        render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} />);
        await reachConfirmation();
        await waitFor(() => expect(confirm()).toBeEnabled());
        expect(screen.queryByRole("region", { name: OVERWRITE })).toBeNull();
      });
    });

    // Finding 3: « La validation DPGF a expiré ou n’est plus valable » (TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED: a DPGF
    // line appeared under the version's lock) left the « append » preview and proposal confirmable unchanged.
    it("reads everything again after a refused DPGF authorization, and confirms nothing before the new reads answer", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const { rerender } = render(<TakeoffApplyWizard {...props} onConfirm={onConfirm} />);
      await reachConfirmation();
      await waitFor(() => expect(confirm()).toBeEnabled());
      const sections = deferred<unknown>();
      const preview = deferred<TakeoffPreviewConversionResponse>();
      const pages = deferred<TakeoffPageReplacementResponse>();
      vi.mocked(fetchEstimateItemsForVersion).mockReturnValueOnce(sections.promise as never);
      vi.mocked(previewTakeoffConversion).mockReturnValueOnce(preview.promise);
      vi.mocked(fetchTakeoffPageReplacement).mockReturnValueOnce(pages.promise);
      rerender(<TakeoffApplyWizard {...props} onConfirm={onConfirm}
        submitError="La validation DPGF a expiré ou n’est plus valable. Relancez l’application pour recalculer les contrôles."
        submitErrorGuard="dpgf_authorization" />);
      expect(confirm()).toBeDisabled();
      await waitFor(() => expect(fetchEstimateItemsForVersion).toHaveBeenCalledTimes(2));
      expect(confirm()).toBeDisabled();
      sections.resolve([section(SECTION_ID, "Section A", 1), DPGF_LINE]);
      await waitFor(() => expect(previewTakeoffConversion).toHaveBeenLastCalledWith(JOB_ID, { strategy: "merge", target_section_id: SECTION_ID }));
      expect(confirm()).toBeDisabled();
      preview.resolve({ ...PREVIEW_RESPONSE, strategy: "merge" });
      pages.resolve({ ...NO_PAGE, merge_required: true });
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ strategy: "merge" })));
    });

    // Finding 4: with one in-scope and one out-of-scope line on a DPGF version, the heading read « Lignes envoyées (2) » and
    // named both; the caveat came after the list.
    it("names the list of a DPGF version as the lines retained before its reconciliation, the caveat beside the count", async () => {
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([section(SECTION_ID, "Section A", 1), DPGF_LINE] as never);
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...NO_PAGE, merge_required: true });
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE, strategy: "merge",
        summary: { ...PREVIEW_RESPONSE.summary, total_count: 2, included_count: 2 },
        items: [PREVIEW_RESPONSE.items[0], { ...PREVIEW_RESPONSE.items[0], item_id: "33333333-3333-4333-8333-333333333334", source_order: 1,
          original: state("Plinthe bois"), transformed: state("Plinthe bois") }] });
      render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} />);
      const heading = await screen.findByRole("heading", { name: "Lignes retenues avant le rapprochement DPGF (2)" });
      expect(screen.queryByRole("heading", { name: /Lignes envoyées/ })).toBeNull();
      const list = screen.getByRole("list", { name: "Lignes retenues avant le rapprochement DPGF" });
      const caveat = screen.getByText(OUT_OF_SCOPE_NOTE);
      expect(heading.compareDocumentPosition(caveat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(caveat.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(list).toHaveAccessibleDescription(OUT_OF_SCOPE_NOTE);
    });

    // Finding 4: « Écartées » added the host's count of lines excluded at the review, read before the preview (another
    // reviewer may have excluded one since), to the mapping's exclusions.
    it("counts the lines excluded at the review from the current preview", async () => {
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE,
        summary: { ...PREVIEW_RESPONSE.summary, total_count: 4, included_count: 2, excluded_by_mapping_count: 1 } });
      render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} />);
      await reachConfirmation();
      expect(screen.getByRole("region", { name: "Aperçu d’impact" })).toHaveTextContent("Écartées3");
    });

    // Finding 7: the zero-count case above also has a blocking guard, so it held even if the normal confirmation lost its
    // count check.
    it("withholds the confirmation when the preview retains no line, with no guard to block it", async () => {
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE,
        summary: { ...PREVIEW_RESPONSE.summary, included_count: 0, transformed_count: 0 },
        items: [{ ...PREVIEW_RESPONSE.items[0], original: state("Tube PVC", { is_excluded: true }),
          transformed: state("Tube PVC", { is_excluded: true }) }] });
      render(<TakeoffApplyWizard {...props} onConfirm={vi.fn()} />);
      await screen.findByText("Aucune ligne retenue à envoyer : réintégrez au moins une ligne dans la revue.");
      await screen.findByRole("list", { name: LINES });
      await waitFor(() => expect(fetchTakeoffPageReplacement).toHaveBeenCalledTimes(1));
      await act(async () => { await Promise.resolve(); });
      expect(screen.queryByRole("region", { name: /Lignes à trancher/ })).toBeNull();
      expect(confirm()).toBeDisabled();
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
      <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={2} isSubmitting={false}
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
      <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
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
        <TakeoffApplyWizard open jobId={JOB_ID} versionId={VERSION_ID} includedCount={1} isSubmitting={false}
          submitError={null} onOpenChange={() => undefined} onConfirm={onConfirm} items={[{ ...RULE_ITEM, rule_results: [] }]} jobLevel="C" />
      );
      return onConfirm;
    }

    // The DPGF line the sections showed is gone when the proposal is read (the server no longer requires the merge): the
    // page's earlier lines are updated in place. Until the independent review of eea9e030 the preview and the proposal
    // stayed computed for « merge » while « append » was sent; both are now read again for « append », and that is sent.
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
      expect(panel).not.toHaveTextContent(/« Ajouter »|« Fusionner »/);
      expect(screen.getByRole("dialog")).toHaveTextContent("une page déjà mesurée met à jour ses lignes à leur place");
      await waitFor(() => expect(vi.mocked(previewTakeoffConversion).mock.calls.map(([, request]) => request.strategy))
        .toEqual(["merge", "append"]));
      expect(vi.mocked(fetchTakeoffPageReplacement).mock.calls.map(([, request]) => request.strategy)).toEqual(["merge", "append"]);
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

    // The independent review of eea9e030: « Prendre la nouvelle mesure » was chosen for a quantity changed by hand; the
    // line was edited again and the application refused as stale; the proposal read again kept the choice under the new
    // revision, and a second click overwrote the second edit without a fresh choice. Written before the fix.
    it("asks again for a quantity changed by hand that was edited again before the application", async () => {
      const edited = "2026-11-18T08:00:00.000000+00:00";
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({}, { changed_by_hand: true, quantity: 14 }));
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const props = { open: true, jobId: JOB_ID, versionId: VERSION_ID, includedCount: 1, isSubmitting: false,
        onOpenChange: () => undefined, onConfirm, items: [{ ...RULE_ITEM, rule_results: [] }], jobLevel: "C" };
      const { rerender } = render(<TakeoffApplyWizard {...props} submitError={null} />);
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "keep" } });
      fireEvent.click(within(panel).getByRole("radio", { name: "Prendre la nouvelle mesure" }));
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
      expect(onConfirm.mock.calls[0][0].pageDecisions[0].lines[0]).toMatchObject({ estimate_item_id: LINE_A,
        expected_updated_at: "2026-11-10T09:30:00.123456+00:00", take: "new" });

      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({}, { changed_by_hand: true, quantity: 15, updated_at: edited }));
      rerender(<TakeoffApplyWizard {...props} submitError="Le devis a changé depuis la proposition des pages déjà au devis. Relisez-la et confirmez à nouveau."
        submitErrorGuard="page_decision" />);
      const again = await screen.findByRole("region", { name: "Pages déjà au devis" });
      await within(again).findByRole("radio", { name: "Garder ma quantité (15)" });
      await screen.findByRole("list", { name: "Lignes envoyées" });
      expect(confirm()).toBeDisabled();
      expect(within(again).getByRole("radio", { name: "Prendre la nouvelle mesure" })).not.toBeChecked();
      // The valve, not edited since, keeps its choice.
      expect(within(again).getByLabelText("Choix pour Vanne d’arrêt")).toHaveValue("keep");
      fireEvent.click(within(again).getByRole("radio", { name: "Prendre la nouvelle mesure" }));
      await waitFor(() => expect(confirm()).toBeEnabled());
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
      expect(onConfirm.mock.calls[1][0].pageDecisions[0].lines[0]).toMatchObject({ estimate_item_id: LINE_A, expected_updated_at: edited,
        take: "new" });
    });

    // The re-check of 0fd09a20 (finding 2): « Prendre la nouvelle mesure » chosen for job A was carried to job B of the same
    // version, which proposed the same earlier line at the same revision. Written before the fix.
    it("never carries a choice made for another job", async () => {
      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue(proposal({}, { changed_by_hand: true, quantity: 14 }));
      const props = { open: true, versionId: VERSION_ID, includedCount: 1, isSubmitting: false, submitError: null,
        onOpenChange: () => undefined, onConfirm: vi.fn().mockResolvedValue(undefined), items: [{ ...RULE_ITEM, rule_results: [] }],
        jobLevel: "C" };
      const { rerender } = render(<TakeoffApplyWizard {...props} jobId={JOB_ID} />);
      const panel = await screen.findByRole("region", { name: "Pages déjà au devis" });
      fireEvent.change(within(panel).getByLabelText("Choix pour Vanne d’arrêt"), { target: { value: "keep" } });
      fireEvent.click(within(panel).getByRole("radio", { name: "Prendre la nouvelle mesure" }));
      await waitFor(() => expect(confirm()).toBeEnabled());

      vi.mocked(fetchTakeoffPageReplacement).mockResolvedValue({ ...proposal({}, { changed_by_hand: true, quantity: 14 }), job_id: OTHER_JOB_ID });
      vi.mocked(previewTakeoffConversion).mockResolvedValue({ ...PREVIEW_RESPONSE, job_id: OTHER_JOB_ID });
      rerender(<TakeoffApplyWizard {...props} jobId={OTHER_JOB_ID} />);
      await waitFor(() => expect(fetchTakeoffPageReplacement).toHaveBeenLastCalledWith(OTHER_JOB_ID, expect.anything(), expect.anything()));
      const again = await screen.findByRole("region", { name: "Pages déjà au devis" });
      const take = await within(again).findByRole("radio", { name: "Prendre la nouvelle mesure" });
      await screen.findByRole("list", { name: LINES });
      expect(take).not.toBeChecked();
      expect(within(again).getByLabelText("Choix pour Vanne d’arrêt")).toHaveValue("");
      expect(confirm()).toBeDisabled();
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
      const props = { open: true, jobId: JOB_ID, versionId: VERSION_ID, includedCount: 1, isSubmitting: false,
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
