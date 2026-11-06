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

import { TakeoffTargetedReview } from "@/components/takeoff/review/TakeoffTargetedReview";
import { fetchTakeoffDpgfComparison, fetchTakeoffJobWithAllItems, patchTakeoffItems } from "@/lib/takeoff/client";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

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
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TakeoffTargetedReview", () => {
  it("attests a quantity to enter confirmed as it is, and never offers V for it", async () => {
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true, item: ITEMS[0] }], succeeded: 1, failed: 0 });
    const list = await open();
    choose(list, "Soudures des réseaux");

    expect(screen.getByRole("button", { name: /^Accepter/ })).toBeDisabled();
    expect(screen.getByText(/Une quantité à saisir ne s’accepte pas/)).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "F2" });
    const quantity = await screen.findByLabelText("Quantité à saisir");
    await waitFor(() => expect(quantity).toHaveFocus());
    fireEvent.keyDown(quantity, { key: "Enter" });

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter,
      updated_at: ITEMS[0].updated_at, fields: { quantity: 12, quantity_entered: true } }] }));
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

    expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.z1, updated_at: ITEMS[1].updated_at, fields: { quantity: 4 } }] });
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

  // Codex #162: the field's blur ended an unchanged entry before the click on « Enregistrer » landed.
  it("confirms an unchanged quantity to enter with a click on Enregistrer", async () => {
    vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [{ item_id: ids.toEnter, success: true, item: ITEMS[0] }], succeeded: 1, failed: 0 });
    const user = userEvent.setup();
    const list = await open();
    choose(list, "Soudures des réseaux");
    await user.click(screen.getByRole("button", { name: /^Saisir/ }));
    await waitFor(() => expect(screen.getByLabelText("Quantité à saisir")).toHaveFocus());
    await user.click(screen.getByRole("button", { name: /^Enregistrer/ }));

    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledWith(JOB_ID, { items: [{ item_id: ids.toEnter,
      updated_at: ITEMS[0].updated_at, fields: { quantity: 12, quantity_entered: true } }] }));
  });
});
