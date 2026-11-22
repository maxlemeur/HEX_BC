import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The detail of an item as the affaire's takeoff page shows it, on the table of items' reads and command (lot 5, the
// wiring). Ways it could mislead, written with the screen:
// - a decision written by a second writer, outside the table's confirmation, on another scope or on the whole table;
// - a reader offered a gesture, or a plan already sent offered one;
// - a refused read leaving the item, its plan or its journal shown;
// - a refusal of the command (the item changed meanwhile) leaving the old line shown as if it were current.
// The table's client is replaced by its fixtures (item-table.test-fixtures.ts); pdfjs by a document of nine pages.

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));
getDocument.mockImplementation(() => ({
  promise: Promise.resolve({
    numPages: 9,
    getPage: () => Promise.resolve({
      getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    }),
  }),
  destroy: () => Promise.resolve(),
}));

const client = vi.hoisted(() => ({
  fetchItemTable: vi.fn(),
  fetchItemLine: vi.fn(),
  fetchItemHistory: vi.fn(),
  sendItemReviewCommand: vi.fn(),
}));
vi.mock("@/lib/takeoff/item-table-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/item-table-client")>(), ...client,
}));

let searchParams = new URLSearchParams();
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project/takeoff",
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

import { TakeoffItemDetailScreen } from "@/components/takeoff/item-detail/TakeoffItemDetailScreen";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { takeoffItemDetailHref } from "@/lib/takeoff/review-href";
import type { ItemTableAddress } from "@/lib/takeoff/item-table-query";
import {
  DETAIL_ITEMS, DETAIL_PLANS, DETAIL_PROJECT, DETAIL_READINGS, ITEMS, JOB_R1, JOB_RDC, PLAN_R1, PLAN_RDC, detailReadings, planViews,
} from "@/lib/takeoff/item-detail.test-fixtures";
import { fixtureItemTable } from "@/lib/takeoff/item-table.test-fixtures";
import type { ItemReadingInput } from "@/lib/takeoff/item-table";

type Scenario = { readings: ItemReadingInput[]; canReview: boolean };
let scenario: Scenario = { readings: DETAIL_READINGS, canReview: true };
const tableOf = (request: Partial<ItemTableAddress> = {}) => fixtureItemTable({ items: DETAIL_ITEMS, readings: scenario.readings,
  plans: DETAIL_PLANS, canReview: scenario.canReview, limit: 50, scope: request.scope, filter: request.filter,
  offset: request.offset, focusItemId: request.focusItemId ?? null });

const plansAsked: string[] = [];
beforeEach(() => {
  scenario = { readings: DETAIL_READINGS, canReview: true };
  plansAsked.length = 0;
  client.fetchItemTable.mockImplementation(async (_project: string, address: ItemTableAddress) => tableOf(address));
  client.fetchItemLine.mockImplementation(async (projectId: string, itemId: string) => {
    const read = tableOf();
    const line = read.page.lines.find((entry) => entry.itemId === itemId);
    if (!line) throw new TakeoffApiError("Ce poste n’est pas dans la liste de l’affaire.", 404, null, "NOT_FOUND");
    return { projectId, canReview: read.canReview, line, plans: read.plans, names: read.names };
  });
  client.fetchItemHistory.mockImplementation(async (projectId: string, itemId: string) => ({ projectId, itemId, events: [], offset: 0,
    limit: 20, hasMore: false, names: {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "https://app.test");
    plansAsked.push(`${url.pathname}${url.search}`);
    const view = planViews()[`${url.searchParams.get("lecture") ?? ""}:${url.searchParams.get("plan") ?? ""}`];
    return view ? new Response(JSON.stringify({ ok: true, data: view }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, error: { code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND", message: "x" } }), { status: 404 });
  }));
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "91111111-1111-4111-8111-111111111111" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const TABLE = "posteState=measured&posteState=not_found&tab=jobs";
function open(item: string, plan: string | null, job: string | null, table = TABLE) {
  const href = takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: item, planKey: plan, jobId: job, from: table });
  const url = new URL(href, "https://app.test");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  searchParams = new URLSearchParams(url.search);
  return render(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:member" />);
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await act(async () => { await Promise.resolve(); });
}

const evidence = () => within(screen.getByRole("complementary", { name: "Preuve et décisions du poste" }));
const dialog = () => within(screen.getByRole("dialog"));

describe("TakeoffItemDetailScreen, the decisions", () => {
  it("accepts the item shown through the table's confirmation and its one command, in the table's scope, then reads it again", async () => {
    const result = { outcome: "applied", applied: [{ itemId: ITEMS.homonym, label: "Lavabo céramique", answers: 1 }], skipped: [] };
    client.sendItemReviewCommand.mockResolvedValue(result);
    open(ITEMS.homonym, PLAN_R1, JOB_R1, `postePlan=${PLAN_R1}&tab=jobs`);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Accepter" }));
    expect(client.sendItemReviewCommand).not.toHaveBeenCalled();
    expect(dialog().getByText(/Portée : plan « Plan R\+1 »/)).toBeTruthy();
    const linesBefore = client.fetchItemLine.mock.calls.length;
    fireEvent.click(dialog().getByRole("button", { name: "Accepter 1 poste" }));
    await settle();
    const homonym = tableOf({ scope: { kind: "plan", planKey: PLAN_R1 } }).page.lines.find(({ itemId }) => itemId === ITEMS.homonym)!;
    expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1);
    expect(client.sendItemReviewCommand).toHaveBeenCalledWith(DETAIL_PROJECT, {
      command_version: 1, intent_key: "91111111-1111-4111-8111-111111111111", scope: { kind: "plan", planKey: PLAN_R1 },
      targets: [homonym.targets], gesture: "accept_measured",
    });
    expect(screen.getByTestId("poste-detail-decision").textContent).toBe("Poste accepté.");
    // The item is read again (its line and its journal), the member stays on it.
    expect(client.fetchItemLine.mock.calls.length).toBeGreaterThan(linesBefore);
    expect(replace).not.toHaveBeenCalled();
  });

  it("sets aside with the reason chosen in the table's dialog, and enters a quantity through its confirmation", async () => {
    client.sendItemReviewCommand.mockResolvedValue({ outcome: "applied", applied: [], skipped: [] });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
    await settle();
    expect(client.sendItemReviewCommand).toHaveBeenLastCalledWith(DETAIL_PROJECT, expect.objectContaining({
      gesture: "set_aside", reason: "duplicate", scope: { kind: "affaire" } }));
    cleanup();

    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Saisir une quantité" }));
    fireEvent.change(dialog().getByLabelText("Quantité"), { target: { value: "2,5" } });
    fireEvent.click(dialog().getByRole("button", { name: "Continuer" }));
    fireEvent.change(dialog().getByLabelText("Ce qui fonde ces quantités"), { target: { value: "site_survey" } });
    fireEvent.click(dialog().getByRole("button", { name: "Enregistrer" }));
    await settle();
    expect(client.sendItemReviewCommand).toHaveBeenLastCalledWith(DETAIL_PROJECT, expect.objectContaining({
      gesture: "enter_quantity", values: [{ item_id: ITEMS.notFound, quantity: 2.5, unit: "u" }],
      entry: { category: "site_survey" } }));
  });

  it("says nothing was applied when the item changed meanwhile, and reads it again", async () => {
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("La sélection a changé.", 409,
      { stale: [{ itemId: ITEMS.homonym, label: "Lavabo céramique" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    open(ITEMS.homonym, PLAN_R1, JOB_R1);
    await settle();
    const linesBefore = client.fetchItemLine.mock.calls.length;
    fireEvent.click(evidence().getByRole("button", { name: "Accepter" }));
    fireEvent.click(dialog().getByRole("button", { name: "Accepter 1 poste" }));
    await settle();
    expect(screen.getByTestId("poste-detail-decision").textContent).toMatch(/^Rien n’a été appliqué : le poste a changé/);
    expect(client.fetchItemLine.mock.calls.length).toBeGreaterThan(linesBefore);
  });
});

describe("TakeoffItemDetailScreen, the member's rights", () => {
  it("offers a reader no gesture, by button or by key", async () => {
    scenario = { readings: DETAIL_READINGS, canReview: false };
    open(ITEMS.homonym, PLAN_R1, JOB_R1);
    await settle();
    expect(evidence().getByTestId("poste-detail-read-only").textContent).toContain("un opérateur du métré de l’affaire décide");
    expect(evidence().queryByRole("group", { name: "Décider du poste" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Postes" }), { key: "v" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.sendItemReviewCommand).not.toHaveBeenCalled();
  });

  it("offers no gesture on a plan already sent to the estimate", async () => {
    scenario = { readings: detailReadings({ sent: true }), canReview: true };
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    expect(evidence().getByTestId("poste-detail-sent")).toBeTruthy();
    expect(evidence().queryByRole("group", { name: "Décider du poste" })).toBeNull();
    expect(evidence().getByText(/Aucune décision ne s’applique à ce poste : plan déjà envoyé au devis/)).toBeTruthy();
  });

  it("withdraws the item, its plan and its journal when a read of the affaire is refused", async () => {
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    expect(screen.getByTestId("poste-detail")).toBeTruthy();
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("Accès refusé à cette affaire.", 403, null, "FORBIDDEN"));
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
    await settle();
    expect(screen.queryByTestId("poste-detail")).toBeNull();
    expect(screen.getByTestId("poste-detail-refus").textContent).toContain("Accès refusé à cette affaire.");
    cleanup();

    client.fetchItemTable.mockRejectedValue(new TakeoffApiError("Affaire introuvable.", 404, null, "NOT_FOUND"));
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    expect(screen.queryByTestId("poste-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(replace).toHaveBeenLastCalledWith(
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?posteState=measured&posteState=not_found&tab=jobs&posteFocus=${ITEMS.basin}`,
      { scroll: false });
  });
});

describe("TakeoffItemDetailScreen, the way back", () => {
  it("comes back to the table by the router, the table's filter kept and the item in focus", async () => {
    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(replace).toHaveBeenCalledWith(
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?posteState=measured&posteState=not_found&tab=jobs&posteFocus=${ITEMS.notFound}`,
      { scroll: false });
    expect(plansAsked.every((path) => path.startsWith(`/api/affaires/${DETAIL_PROJECT}/takeoff/item-detail/plan?`))).toBe(true);
  });
});
