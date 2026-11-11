import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("@/components/UserContext", () => ({ useUserContext: () => ({ profile: { tenant_role: "member" }, tenantId: "tenant" }) }));
vi.mock("@/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false, value: null }) }));
vi.mock("@/lib/estimates/client", () => ({ releaseEstimateDraftLock: vi.fn() }));
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffJobWithAllItems: vi.fn(),
  fetchTakeoffDpgfComparison: vi.fn(),
  patchTakeoffItems: vi.fn(),
  applyTakeoffJob: vi.fn(),
  isTakeoffApiError: () => false,
}));
vi.mock("@/lib/takeoff/page-contributions-client", () => ({
  fetchTakeoffJobPageContributions: vi.fn(),
  fetchLaunchPageContributions: vi.fn(),
}));

import { TakeoffTargetedReview } from "@/components/takeoff/review/TakeoffTargetedReview";
import { fetchTakeoffDpgfComparison, fetchTakeoffJobWithAllItems, patchTakeoffItems } from "@/lib/takeoff/client";
import { fetchTakeoffJobPageContributions } from "@/lib/takeoff/page-contributions-client";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffJobItem } from "@/lib/takeoff/types";
import { TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS } from "@/lib/takeoff/hypothesis";

// TI-664 L5c, the targeted review's decisions as the browser drives them. Ways it fails, written before the screen:
// - F6: a quantity the plan cannot show, already right, cannot be settled: confirming it never sends its attestation;
// - F5: V offered on it, though verifying never settles it;
// - F3: E typed while the quantity is being entered opens the exclusion instead of staying in the field;
// - F7: after a pair is settled from one line, its partner of the same job still shows failed (only the saved line
//   was read back);
// - review of L5c: a decision on a partner while the first one is saved acts on its pre-save guidance (the length
//   removed twice); a quantity field reached by Tab keeps an entry that swallows Enter on any later button (and
//   attests a quantity to enter); F2 with the decision panel folded starts an entry nobody sees.

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ids = { toEnter: "33333333-3333-4333-8333-333333333331", z1: "33333333-3333-4333-8333-333333333332", z2: "33333333-3333-4333-8333-333333333333" };

function item(id: string, designation: string, quantity: number, rule_results: TakeoffRuleResult[]): TakeoffJobItem {
  return { id, designation, quantity, unit: id === ids.toEnter ? "u" : "ml", confidence: 0.9, evidence: "Plan", source_file_name: "plan.pdf",
    source_page: 1, metadata: {}, is_excluded: false, exclusion_reason: null, is_verified: false, verified_at: null, verified_by: null,
    created_at: "2026-11-04T10:00:00.000Z", updated_at: "2026-11-04T10:00:00.000Z", rule_results, rules_stale: false,
    rules_evaluated_at: "2026-11-04T10:00:01.000Z" };
}
const partner = (id: string, zone: string, resolved = false) => ({ item_id: id, job_id: JOB_ID, zone, designation: `EF ${zone}`, overlap_m: 1, resolved });
const duplicate = (other: string, zone: string): TakeoffRuleResult => ({ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101,
  acceptable: true, reason: `Tronçon compté aussi sur ${zone}.`, details: { overlap_m: 1, partners: [partner(other, zone)] } });
const resolved = (other: string, zone: string): TakeoffRuleResult => ({ rule: "zone_overlap", status: "pass", code: "ZONE_OVERLAP_RESOLVED", version: 101,
  acceptable: true, reason: "Réglé.", details: { partners: [partner(other, zone, true)] } });

const ITEMS = [
  item(ids.toEnter, "Soudures des réseaux", 12, [{ rule: "non_observable", status: "fail", code: "NON_OBSERVABLE_TO_ENTER", version: 1,
    acceptable: false, reason: "Soudures : le plan ne les montre pas, quantité à saisir." }]),
  item(ids.z1, "EF Z1", 5, [duplicate(ids.z2, "Z2")]),
  item(ids.z2, "EF Z2", 3, [duplicate(ids.z1, "Z1")]),
];

// A floor of 19.5 m² measured, 20 m² printed, priced on the net floor basis (TI-686 D9, D17, D21).
const AREA_LINE = { ...item(ids.z1, "Revêtement de sol", 19.5, [{ rule: "area_printed", status: "fail", code: "AREA_PRINTED_MISMATCH",
  version: 3, acceptable: true, reason: "Surface écrite différente.", details: { printed_m2: 20, measured_m2: 19.5,
    expected_basis: "net_floor" } }]), unit: "m2" };
const D17_REFUSAL = "Même base que la prestation : les deux surfaces se comparent et la plus élevée est retenue. Retenez 20 m² avant d’accepter.";

/** Opens the acceptance of an area line alone (AREA_LINE by default), its reason, the net floor basis and a note filled in. */
async function justifyPrintedArea(user: ReturnType<typeof userEvent.setup>, reason: string, line: TakeoffJobItem = AREA_LINE) {
  vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
    job: { id: JOB_ID, status: "completed", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
    items: { data: [line], pagination: { total: 1, offset: 0, limit: 200 } },
  } as never);
  render(<TakeoffTargetedReview jobId={JOB_ID} versionId={VERSION_ID} projectId="44444444-4444-4444-8444-444444444444" />);
  const list = await screen.findByRole("listbox", { name: "Lignes à trancher" });
  await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
  choose(list, "Revêtement de sol");
  await user.click(screen.getByRole("button", { name: /^Accepter/ }));
  const dialog = await screen.findByRole("dialog", { name: "Justifier l’acceptation" });
  await user.selectOptions(within(dialog).getByLabelText("Motif de surface"), reason);
  await user.click(within(dialog).getByRole("radio", { name: "Sol net" }));
  await user.type(within(dialog).getByLabelText("Note"), "Tableau des surfaces du plan, indice B.");
  return dialog;
}

async function open() {
  render(<TakeoffTargetedReview jobId={JOB_ID} versionId={VERSION_ID} projectId="44444444-4444-4444-8444-444444444444" />);
  const list = await screen.findByRole("listbox", { name: "Lignes à trancher" });
  await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(3));
  return list;
}

function choose(list: HTMLElement, designation: string) {
  fireEvent.click(within(list).getByText(designation));
}

beforeEach(() => {
  vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
    job: { id: JOB_ID, status: "completed", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
    items: { data: ITEMS, pagination: { total: 3, offset: 0, limit: 200 } },
  } as never);
  vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue({ summary: { total_lines: 0, to_confirm: 0, significant_gaps: 0,
    lines_without_proof: 0, forced_manual: 0, unused_takeoff_items: 0 } } as never);
  vi.mocked(fetchTakeoffJobPageContributions).mockResolvedValue({ version_id: VERSION_ID, pages: [], jobs: [],
    unidentified_item_ids: [], other_takeoff_line_count: 0 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TakeoffTargetedReview", () => {
  // TI-682 D11: an hypothesis arrives excluded. Ways the screen fails: the weld leaves the list with its exclusion and
  // is never entered; its entry is saved but the line stays excluded, out of the estimate; V or Inclure counts a
  // quantity to enter nobody entered; an estimate cannot be included from the list.
  it("keeps an hypothesis that arrived excluded in the list, and includes it with its entered quantity", async () => {
    const weld = { ...ITEMS[0], is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable };
    vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
      job: { id: JOB_ID, status: "completed", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
      items: { data: [weld, ITEMS[1], ITEMS[2]], pagination: { total: 3, offset: 0, limit: 200 } },
    } as never);
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true, item: { ...weld, is_excluded: false,
      exclusion_reason: null, quantity_entry_category: "site_survey", quantity_entry_note: null,
      rule_results: [{ rule: "non_observable", status: "pass", code: "NON_OBSERVABLE_ENTERED", version: 1, acceptable: false, reason: "Saisie." }],
      updated_at: "2026-11-04T10:01:00.000Z" } }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const list = await open();
    const option = within(list).getByRole("option", { name: /Soudures des réseaux/ });
    expect(within(option).getByText("Hypothèse")).toBeInTheDocument();
    choose(list, "Soudures des réseaux");

    expect(screen.getByText(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Accepter/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Inclure/ })).not.toBeInTheDocument();
    fireEvent.keyDown(list, { key: "i" });
    expect(patchTakeoffItems).not.toHaveBeenCalled();

    fireEvent.keyDown(list, { key: "F2" });
    const quantity = await screen.findByLabelText("Quantité à saisir");
    await waitFor(() => expect(quantity).toHaveFocus());
    fireEvent.keyDown(quantity, { key: "Enter" });
    const dialog = await screen.findByRole("dialog", { name: "Justifier la quantité saisie" });
    await user.selectOptions(within(dialog).getByLabelText("Justification"), "site_survey");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer la quantité" }));

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter, updated_at: weld.updated_at,
      fields: { quantity: 12, quantity_entry: expect.objectContaining({ category: "site_survey" }), is_excluded: false, exclusion_reason: null } }] }));
    await waitFor(() => expect(within(list).queryByText("Soudures des réseaux")).not.toBeInTheDocument());
  });

  it("asks what a weld rests on even before its rules were computed, and never offers Inclure for it", async () => {
    const weld = { ...item(ids.toEnter, "Soudures des réseaux", 12, []), unit: "u", rules_evaluated_at: null, is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable };
    vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
      job: { id: JOB_ID, status: "completed", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
      items: { data: [weld, ITEMS[1], ITEMS[2]], pagination: { total: 3, offset: 0, limit: 200 } },
    } as never);
    const list = await open();
    choose(list, "Soudures des réseaux");

    expect(screen.queryByRole("button", { name: /^Inclure/ })).not.toBeInTheDocument();
    fireEvent.keyDown(list, { key: "i" });
    fireEvent.keyDown(list, { key: "F2" });
    const quantity = await screen.findByLabelText("Quantité à saisir");
    await waitFor(() => expect(quantity).toHaveFocus());
    fireEvent.keyDown(quantity, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Justifier la quantité saisie" })).toBeInTheDocument();
    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });

  it("leaves an hypothesis of an applied job as it is: nothing includes it", async () => {
    const estimate = { ...item(ids.toEnter, "Réseau EF estimé", 40, []), unit: "ml", is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated };
    vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
      job: { id: JOB_ID, status: "applied", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
      items: { data: [estimate, ITEMS[1], ITEMS[2]], pagination: { total: 3, offset: 0, limit: 200 } },
    } as never);
    const list = await open();
    choose(list, "Réseau EF estimé");

    expect(screen.getByRole("button", { name: /^Inclure/ })).toBeDisabled();
    fireEvent.keyDown(list, { key: "i" });
    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });

  it("includes an estimate that arrived excluded with Inclure, and never accepts it with V", async () => {
    const estimate = { ...item(ids.toEnter, "Réseau EF estimé", 40, []), unit: "ml", metadata: { quantity_nature: "estimated" },
      is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated };
    vi.mocked(fetchTakeoffJobWithAllItems).mockResolvedValue({
      job: { id: JOB_ID, status: "completed", level: "B", source_file_name: "plan.pdf", plan_set_id: null, version_number: 1 },
      items: { data: [estimate, ITEMS[1], ITEMS[2]], pagination: { total: 3, offset: 0, limit: 200 } },
    } as never);
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true,
      item: { ...estimate, is_excluded: false, exclusion_reason: null, updated_at: "2026-11-04T10:01:00.000Z" } }], succeeded: 1, failed: 0 });
    const list = await open();
    choose(list, "Réseau EF estimé");

    expect(screen.getByText(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Accepter/ })).toBeDisabled();
    fireEvent.keyDown(list, { key: "v" });
    expect(patchTakeoffItems).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Inclure/ })).toBeEnabled();
    fireEvent.keyDown(list, { key: "i" });

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter, updated_at: estimate.updated_at,
      fields: { is_excluded: false, exclusion_reason: null } }] }));
    await waitFor(() => expect(within(list).queryByText("Réseau EF estimé")).not.toBeInTheDocument());
  });

  // TI-686 D12: Enter on a quantity to enter opens « Justifier la quantité saisie »; the quantity is saved with what it
  // rests on, and the line then shows it.
  it("attests a quantity to enter confirmed as it is with its category, and never offers V for it", async () => {
    const entered = { ...ITEMS[0], quantity_entered_at: "2026-11-04T10:01:00.000Z", quantity_entered_by: "55555555-5555-4555-8555-555555555555",
      quantity_entry_category: "written_confirmation", quantity_entry_note: "Fiche atelier A-07", rules_stale: true,
      updated_at: "2026-11-04T10:01:00.000Z" };
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true, item: entered }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const list = await open();
    choose(list, "Soudures des réseaux");

    expect(screen.getByRole("button", { name: /^Accepter/ })).toBeDisabled();
    expect(screen.getByText(/Une quantité à saisir ne s’accepte pas/)).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "F2" });
    const quantity = await screen.findByLabelText("Quantité à saisir");
    await waitFor(() => expect(quantity).toHaveFocus());
    fireEvent.keyDown(quantity, { key: "Enter" });

    const dialog = await screen.findByRole("dialog", { name: "Justifier la quantité saisie" });
    expect(patchTakeoffItems).not.toHaveBeenCalled();
    const save = within(dialog).getByRole("button", { name: "Enregistrer la quantité" });
    expect(save).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Justification"), "hypothesis");
    expect(save).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Justification"), "written_confirmation");
    await user.type(within(dialog).getByLabelText("Ce qui fonde la quantité"), "Fiche atelier A-07");
    await user.click(save);

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter,
      updated_at: ITEMS[0].updated_at, fields: { quantity: 12, quantity_entry: { category: "written_confirmation", note: "Fiche atelier A-07" } } }] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Saisie : Confirmation écrite — Fiche atelier A-07")).toBeInTheDocument();
  });

  it("cancels the entry's justification with Escape, without saving", async () => {
    const user = userEvent.setup();
    const list = await open();
    choose(list, "Soudures des réseaux");
    fireEvent.keyDown(list, { key: "F2" });
    const quantity = await screen.findByLabelText("Quantité à saisir");
    await waitFor(() => expect(quantity).toHaveFocus());
    fireEvent.keyDown(quantity, { key: "Enter" });
    await screen.findByRole("dialog", { name: "Justifier la quantité saisie" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });

  it("keeps a letter typed in the quantity in the field, and opens the exclusion from the list", async () => {
    const list = await open();
    choose(list, "EF Z1");
    fireEvent.keyDown(list, { key: "4" });
    const quantity = await screen.findByLabelText("Quantité");
    await waitFor(() => expect(quantity).toHaveValue("4"));
    fireEvent.keyDown(quantity, { key: "e" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(quantity, { key: "Escape" });
    await waitFor(() => expect(list).toHaveFocus());
    fireEvent.keyDown(list, { key: "e" });
    expect(await screen.findByRole("dialog", { name: "Exclure 1 item" })).toBeInTheDocument();
    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });

  it("reads the partner of a settled pair back with the saved line", async () => {
    const settledZ1 = { ...ITEMS[1], quantity: 4, rule_results: [resolved(ids.z2, "Z2")], updated_at: "2026-11-04T10:01:00.000Z" };
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.z1, success: true, item: settledZ1 }], succeeded: 1, failed: 0,
      rule_states: [
        { item_id: ids.z1, rule_results: [resolved(ids.z2, "Z2")], rules_evaluated_at: "2026-11-04T10:01:01.000Z", rules_stale: false },
        { item_id: ids.z2, rule_results: [resolved(ids.z1, "Z1")], rules_evaluated_at: "2026-11-04T10:01:01.000Z", rules_stale: false },
      ] });
    const list = await open();
    choose(list, "EF Z1");
    expect(screen.getByText(/Longueur comptée deux fois/)).toHaveTextContent("1,00 m");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Retirer 1,00 m/ }));
    });

    expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.z1, updated_at: ITEMS[1].updated_at,
      expected_rules_evaluated_at: ITEMS[1].rules_evaluated_at, fields: { quantity: 4 } }] });
    await waitFor(() => expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("Soudures des réseaux"),
    ]));
  });

  it("takes one decision at a time: the partner waits for the first one's answer", async () => {
    let answer: (value: unknown) => void = () => undefined;
    vi.mocked(patchTakeoffItems).mockReturnValue(new Promise((resolve) => { answer = resolve; }) as never);
    const list = await open();
    choose(list, "EF Z1");
    fireEvent.click(screen.getByRole("button", { name: /^Retirer 1,00 m/ }));
    choose(list, "EF Z2");
    fireEvent.keyDown(list, { key: "v" });
    fireEvent.keyDown(list, { key: "e" });

    expect(screen.getByRole("button", { name: /^Retirer 1,00 m/ })).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(patchTakeoffItems).toHaveBeenCalledTimes(1);
    await act(async () => answer({ results: [{ item_id: ids.z1, success: true, item: ITEMS[1] }], succeeded: 1, failed: 0 }));
  });

  it("lets Enter act on a button after the quantity field was only passed through", async () => {
    const list = await open();
    choose(list, "Soudures des réseaux");
    const quantity = screen.getByLabelText("Quantité à saisir");
    act(() => quantity.focus());
    const exclude = screen.getByRole("button", { name: /^Exclure/ });
    act(() => exclude.focus());
    fireEvent.keyDown(exclude, { key: "Enter" });

    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });

  it("opens the folded decision panel to show an entry started with F2", async () => {
    const list = await open();
    choose(list, "EF Z1");
    fireEvent.click(screen.getByRole("button", { name: "Replier le détail" }));
    expect(screen.queryByLabelText("Quantité")).not.toBeInTheDocument();
    act(() => list.focus());
    fireEvent.keyDown(list, { key: "F2" });

    const quantity = await screen.findByLabelText("Quantité");
    await waitFor(() => expect(quantity).toHaveFocus());
    expect(quantity).toHaveValue("5");
  });

  // TI-686 D9: « Retenir 20 m² » saves the printed surface, but the computation that follows failed: the line is stale,
  // so the acceptance stays closed. The dialog says why, where the user acts, instead of a silent disabled button.
  it("says why the acceptance stays closed when the line is stale after the printed surface is retained", async () => {
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: AREA_LINE.id, success: true, item: { ...AREA_LINE, quantity: 20,
      rules_stale: true, updated_at: "2026-11-04T10:01:00.000Z" } }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const dialog = await justifyPrintedArea(user, "printed_area_basis_identified");
    const confirm = within(dialog).getByRole("button", { name: "Confirmer l’acceptation" });
    expect(confirm).toBeDisabled();
    // The quantity below the printed surface is explained by the button that retains it, not by a second message.
    expect(within(dialog).queryByText(D17_REFUSAL)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Retenir 20 m²" }));

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: AREA_LINE.id,
      updated_at: AREA_LINE.updated_at, expected_rules_evaluated_at: AREA_LINE.rules_evaluated_at, fields: { quantity: 20 } }] }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Retenir 20 m²" })).not.toBeInTheDocument());
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText("Recalculez les règles avant d’accepter la ligne.")).toBeInTheDocument();
  });

  // TI-686 D21: « contour mesuré retenu » says the printed surface covers another outline. On the price line's basis
  // too, nothing compares: the quantity stays the line's, nothing to retain, V is offered at 19.5 m².
  const OUTLINE_SENTENCE = "Même base, autre périmètre : la quantité reste celle de la ligne ; la surface écrite reste visible "
    + "dans le contrôle.";
  it("accepts a measured outline on the price line's basis at the line's quantity", async () => {
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: AREA_LINE.id, success: true, item: { ...AREA_LINE,
      is_verified: true, updated_at: "2026-11-04T10:01:00.000Z" } }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const dialog = await justifyPrintedArea(user, "measured_outline_retained");
    expect(within(dialog).getByText(OUTLINE_SENTENCE)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Retenir/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(D17_REFUSAL)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirmer l’acceptation" }));

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: AREA_LINE.id,
      updated_at: AREA_LINE.updated_at, expected_rules_evaluated_at: AREA_LINE.rules_evaluated_at, fields: { is_verified: true,
        verification_justification: { area_printed: { reason_code: "measured_outline_retained", retained_basis: "net_floor",
          note: "Tableau des surfaces du plan, indice B." } } } }] }));
  });

  // A vector room labelled « sol net » is stored at max(polygon, printed) when the line is created (vectors/items.ts):
  // here 20 m² for 19.5 measured. The dialog must not say the quantity stays the measurement: it stays the line's,
  // 20 m², and V sends no quantity.
  it("never calls the stored maximum of a vector net-floor room its measurement", async () => {
    const stored = { ...AREA_LINE, quantity: 20 };
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: stored.id, success: true, item: { ...stored,
      is_verified: true, updated_at: "2026-11-04T10:01:00.000Z" } }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const dialog = await justifyPrintedArea(user, "measured_outline_retained", stored);
    expect(within(dialog).getByText(OUTLINE_SENTENCE)).toBeInTheDocument();
    expect(within(dialog).queryByText(/reste la mesure/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirmer l’acceptation" }));

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: stored.id,
      updated_at: stored.updated_at, expected_rules_evaluated_at: stored.rules_evaluated_at, fields: { is_verified: true,
        verification_justification: { area_printed: { reason_code: "measured_outline_retained", retained_basis: "net_floor",
          note: "Tableau des surfaces du plan, indice B." } } } }] }));
  });

  // Codex #162: the field's blur ended an unchanged entry before the click on « Enregistrer » landed.
  it("confirms an unchanged quantity to enter with a click on Enregistrer, then Enter in its justification", async () => {
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true, item: ITEMS[0] }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const list = await open();
    choose(list, "Soudures des réseaux");
    await user.click(screen.getByRole("button", { name: /^Saisir/ }));
    await waitFor(() => expect(screen.getByLabelText("Quantité à saisir")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: /^Enregistrer/ }));
    const dialog = await screen.findByRole("dialog", { name: "Justifier la quantité saisie" });
    await user.selectOptions(within(dialog).getByLabelText("Justification"), "site_survey");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter,
      updated_at: ITEMS[0].updated_at, fields: { quantity: 12, quantity_entry: { category: "site_survey" } } }] }));
  });
  // TI-682 lot D, PR 1: the page this takeoff re-reads is already in the estimate through an earlier takeoff. The
  // targeted review names it at its head with that takeoff (and opens it) before the application. Written before the banner.
  it("names a page already in the estimate through another takeoff, and opens that takeoff", async () => {
    const earlier = "66666666-6666-4666-8666-666666666666";
    const earlierVersion = "77777777-7777-4777-8777-777777777777";
    vi.mocked(fetchTakeoffJobPageContributions).mockResolvedValue({ version_id: VERSION_ID, other_takeoff_line_count: 2, unidentified_item_ids: [],
      jobs: [{ id: earlier, estimate_version_id: earlierVersion, created_at: "2026-11-10T09:30:00.000Z", source_file_name: "plan.pdf" }],
      pages: [{ file_name: "plan.pdf", page: 1, item_ids: [ids.z1, ids.z2], earlier: [{ job_id: earlier, line_count: 2, takeoff_item_ids: [] }], own_line_count: 0 }] });
    await open();
    const banner = await screen.findByRole("region", { name: "Pages déjà au devis" });
    expect(banner).toHaveTextContent("plan.pdf, page 1 : déjà au devis par le métré du 10/11/2026 (plan.pdf), 2 lignes");
    expect(within(banner).getByRole("link", { name: "Ouvrir le métré" })).toHaveAttribute("href",
      `/dashboard/affaires/44444444-4444-4444-8444-444444444444/takeoff/${earlier}/review?versionId=${earlierVersion}`);
    // Their Z1/Z2 duplicates pair two lines of this takeoff, not a line of the earlier one: the banner leaves them alone.
    expect(banner).not.toHaveTextContent("ne retirez pas la ligne");
    expect(fetchTakeoffJobPageContributions).toHaveBeenCalledWith(JOB_ID, expect.anything());
  });
});
