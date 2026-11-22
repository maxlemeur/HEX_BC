import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
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

const replace = vi.hoisted(() => vi.fn());
// The address as Next gives it: the page's search parameters follow `history.replaceState` (Next patches it so).
const address = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return { listeners, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
});
vi.mock("next/navigation", async () => {
  const { useMemo, useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/dashboard/affaires/project/takeoff",
    useRouter: () => ({ replace }),
    useSearchParams: () => {
      const search = useSyncExternalStore(address.subscribe, () => window.location.search);
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
const replaceState = window.history.replaceState.bind(window.history);
window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
  replaceState(data, unused, url);
  for (const listener of address.listeners) listener();
};

import { TakeoffItemDetailScreen } from "@/components/takeoff/item-detail/TakeoffItemDetailScreen";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { takeoffItemDetailHref } from "@/lib/takeoff/review-href";
import type { ItemTableAddress } from "@/lib/takeoff/item-table-query";
import {
  DETAIL_ITEMS, DETAIL_PLANS, DETAIL_PROJECT, DETAIL_READINGS, ITEMS, JOB_EARLIER, JOB_R1, JOB_RDC, PLAN_R1, PLAN_RDC, detailReadings,
  planViews,
} from "@/lib/takeoff/item-detail.test-fixtures";
import { fixtureItemTable } from "@/lib/takeoff/item-table.test-fixtures";
import type { ItemEntryView, ItemReadingInput } from "@/lib/takeoff/item-table";

type Scenario = { readings: ItemReadingInput[]; canReview: boolean; entries?: ItemEntryView[] };
let scenario: Scenario = { readings: DETAIL_READINGS, canReview: true };
const tableOf = (request: Partial<ItemTableAddress> = {}) => fixtureItemTable({ items: DETAIL_ITEMS, readings: scenario.readings,
  entries: scenario.entries, plans: DETAIL_PLANS, canReview: scenario.canReview, limit: 50, scope: request.scope, filter: request.filter,
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
function FreshCache({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function open(item: string, plan: string | null, job: string | null, table = TABLE) {
  const href = takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: item, planKey: plan, jobId: job, from: table });
  const url = new URL(href, "https://app.test");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  // A cache of the journal's reads of its own, kept while the screen is rendered again.
  return render(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:member" />, { wrapper: FreshCache });
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
    const tableReads = client.fetchItemTable.mock.calls.length;
    fireEvent.click(dialog().getByRole("button", { name: "Accepter 1 poste" }));
    await settle();
    const homonym = tableOf({ scope: { kind: "plan", planKey: PLAN_R1 } }).page.lines.find(({ itemId }) => itemId === ITEMS.homonym)!;
    expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1);
    expect(client.sendItemReviewCommand).toHaveBeenCalledWith(DETAIL_PROJECT, {
      command_version: 1, intent_key: "91111111-1111-4111-8111-111111111111", scope: { kind: "plan", planKey: PLAN_R1 },
      targets: [homonym.targets], gesture: "accept_measured",
    });
    expect(screen.getByTestId("poste-detail-decision").textContent).toBe("Poste accepté.");
    // The item is read again (its line and its journal) in the table's plan, without its filters; the member stays on it.
    expect(client.fetchItemTable.mock.calls.length).toBeGreaterThan(tableReads);
    expect(client.fetchItemTable).toHaveBeenLastCalledWith(DETAIL_PROJECT, expect.objectContaining({
      scope: { kind: "plan", planKey: PLAN_R1 }, filter: {}, focusItemId: ITEMS.homonym }));
    expect(client.fetchItemLine).not.toHaveBeenCalled();
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

describe("TakeoffItemDetailScreen, the item read again after a decision", () => {
  const stale = () => new TakeoffApiError("La sélection a changé.", 409,
    { stale: [{ itemId: ITEMS.basin, label: "Lavabo céramique" }] }, "TAKEOFF_ITEM_REVIEW_STALE");
  const setAside = async () => {
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
    await settle();
  };

  // Review of #483 (written before the fix): read again alone, the item came back with every plan of the affaire while
  // the commands stayed in the table's plan, so the next one named answers outside it and was refused as stale.
  it("reads the item again in the table's scope, so that the next command names only that scope's answers", async () => {
    client.sendItemReviewCommand.mockRejectedValueOnce(stale()).mockResolvedValueOnce({ outcome: "applied", applied: [], skipped: [] });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC, `postePlan=${PLAN_RDC}&posteState=measured&tab=jobs`);
    await settle();
    await setAside();
    await setAside();
    const scoped = tableOf({ scope: { kind: "plan", planKey: PLAN_RDC } }).page.lines.find(({ itemId }) => itemId === ITEMS.basin)!;
    expect(scoped.targets.answers).toHaveLength(1);
    expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(2);
    for (const [, command] of client.sendItemReviewCommand.mock.calls) {
      expect(command).toMatchObject({ scope: { kind: "plan", planKey: PLAN_RDC }, targets: [scoped.targets] });
    }
    // Read again without the table's filters: an item the filter no longer keeps stays decidable.
    expect(client.fetchItemTable).toHaveBeenLastCalledWith(DETAIL_PROJECT, expect.objectContaining({
      scope: { kind: "plan", planKey: PLAN_RDC }, filter: {}, focusItemId: ITEMS.basin }));
  });

  // Review of #483 (written before the fix): one item read again at a time, so after deciding B, A came back as first read
  // (its old decision, its old revisions) and its next command was refused as stale.
  it("keeps each item read again after its decision, the queue's order unchanged", async () => {
    const setAsideOf = (itemId: string) => (readings: ItemReadingInput[]) => readings.map((reading) => reading.itemId === itemId
      && reading.answer ? { ...reading, decisionRevision: reading.decisionRevision + 1, decision: { kind: "set_aside" as const,
        revision: reading.decisionRevision + 1, reason: "duplicate" as const, note: null, actorId: reading.answer.jobId, at: "2026-11-22T09:00:00.000Z" } }
      : reading);
    client.sendItemReviewCommand.mockImplementation(async (_project: string, command: { targets: Array<{ itemId: string }> }) => {
      scenario = { ...scenario, readings: setAsideOf(command.targets[0]!.itemId)(scenario.readings) };
      return { outcome: "applied", applied: [{ itemId: command.targets[0]!.itemId, label: "x", answers: 1 }], skipped: [] };
    });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    const options = () => within(screen.getByRole("listbox", { name: "Postes" })).getAllByRole("option");
    const order = options().map((option) => option.textContent);
    await setAside();
    expect(evidence().getByText(/^Écarté \(Doublon\)/)).toBeTruthy();
    fireEvent.click(options().find((option) => option.textContent?.startsWith("Siphon de sol"))!);
    await settle();
    await setAside();
    expect(evidence().getByText(/^Écarté \(Doublon\)/)).toBeTruthy();
    fireEvent.click(options()[0]!);
    await settle();
    expect(evidence().getByRole("heading", { name: "Lavabo céramique" })).toBeTruthy();
    expect(evidence().getByText(/^Écarté \(Doublon\)/)).toBeTruthy();
    expect(evidence().queryByText(/^Accepté/)).toBeNull();
    expect(options().map((option) => option.textContent)).toEqual(order);
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

// Review of #483, first independent review: its cases, written before the fixes. The page's address moves as Next moves it
// (`go`: history.replaceState, which the search parameters follow) where the review set the mocked parameters and
// rendered again; the assertions are the review's.
describe("TakeoffItemDetailScreen, review of #483", () => {
  const go = (href: string) => act(() => {
    const url = new URL(href, "https://app.test");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  });
  const setAside = async () => {
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
    await settle();
  };

  it("keeps the refreshed target in the table scope after a stale refusal", async () => {
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("stale", 409, { stale: [{ itemId: ITEMS.basin, label: "Lavabo" }] },
      "TAKEOFF_ITEM_REVIEW_STALE"));
    open(ITEMS.basin, PLAN_R1, JOB_R1, "postePlan=" + PLAN_R1);
    await settle();
    scenario.readings = scenario.readings.map((r) => r.itemId === ITEMS.basin && r.planKey === PLAN_R1 ? { ...r, decisionRevision: r.decisionRevision + 1 } : r);
    await setAside(); await setAside();
    expect(client.sendItemReviewCommand.mock.calls.map((args) => args[1].targets[0].answers.length)).toEqual([1, 1]);
  });

  it("withdraws a line that went missing on the stale reread", async () => {
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("stale", 409, { stale: [{ itemId: ITEMS.basin, label: "Lavabo" }] },
      "TAKEOFF_ITEM_REVIEW_STALE"));
    client.fetchItemLine.mockRejectedValue(new TakeoffApiError("introuvable", 404, null, "NOT_FOUND"));
    open(ITEMS.basin, PLAN_R1, JOB_R1);
    await settle(); await setAside();
    expect(screen.queryByRole("group", { name: "Décider du poste" }) === null).toBe(true);
  });

  it("applies the latest canReview when refreshing a line", async () => {
    client.sendItemReviewCommand.mockResolvedValue({ applied: [], skipped: [] });
    open(ITEMS.basin, PLAN_R1, JOB_R1);
    await settle(); scenario.canReview = false; await setAside();
    expect(screen.queryByRole("group", { name: "Décider du poste" }) === null).toBe(true);
  });

  it("offers no keyboard decision under a historical reading", async () => {
    open(ITEMS.basin, PLAN_RDC, JOB_EARLIER);
    await settle();
    expect(evidence().getByText(/Lecture antérieure du poste/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "e" });
    const activeDialog = screen.queryByRole("dialog");
    if (activeDialog) {
      fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
      fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
      await settle();
    }
    expect(client.sendItemReviewCommand.mock.calls.map((args) => args[1].targets[0].answers.map((a: { answerId: string }) => a.answerId))).toEqual([]);
  });

  it("keeps older journal pages with the item they belong to", async () => {
    client.fetchItemHistory.mockImplementation(async (projectId: string, itemId: string, { offset }: { offset: number }) => ({
      projectId, itemId, offset, limit: 20, hasMore: itemId === ITEMS.basin && offset === 0, names: {},
      events: offset ? [{ id: 123, event: "set_aside", at: "2026-11-21T10:00:00.000Z", actorId: "operator", planKey: null,
        after: { reason: "duplicate", note: "Basin journal only" } }] : [],
    }));
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Événements plus anciens" }));
    await settle();
    expect(evidence().getByText(/Basin journal only/)).toBeTruthy();
    go(takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: ITEMS.notFound, planKey: PLAN_RDC, jobId: JOB_RDC, from: TABLE }));
    await settle();
    expect(evidence().getByRole("heading", { name: "Siphon de sol" })).toBeTruthy();
    expect(evidence().queryByText(/Basin journal only/) === null).toBe(true);
  });

  it("closes an operator's pending dialog when the screen receives a reader identity", async () => {
    const wrapper = open(ITEMS.homonym, PLAN_R1, JOB_R1);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Accepter" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    scenario.canReview = false;
    wrapper.rerender(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:reader" />);
    await settle();
    expect(screen.queryByRole("dialog") === null).toBe(true);
  });

  it("keeps an old dossier bookmark from presenting today's decision against replacement bytes", async () => {
    go(takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: ITEMS.basin, source: { documentId: PLAN_RDC, generation: null } }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: planViews()[":" + PLAN_RDC] }), { status: 200 })));
    render(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:member" />);
    await settle();
    const offered = evidence().queryByRole("button", { name: "Écarter" }) !== null;
    expect({ saidUnread: evidence().queryByText(/aucune analyse n’a encore lu ce poste sur ce plan/) !== null, offered })
      .not.toEqual({ saidUnread: true, offered: true });
  });

  it("invalidates a pending confirmation when another item address arrives", async () => {
    open(ITEMS.basin, PLAN_R1, JOB_R1);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    go(takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: ITEMS.notFound, planKey: PLAN_RDC, jobId: JOB_RDC, from: TABLE }));
    await settle();
    expect(screen.getByText("Siphon de sol", { selector: "h2" })).toBeTruthy();
    const ok = screen.queryByRole("button", { name: "Écarter 1 poste" });
    if (ok) { fireEvent.click(ok); await settle(); }
    expect(client.sendItemReviewCommand.mock.calls.map((args) => args[1].targets[0].itemId)).toEqual([]);
  });

  it("retains the fresh decision on A after reviewing B and returning to A", async () => {
    client.sendItemReviewCommand.mockImplementation(async (_project: string, cmd: { targets: Array<{ itemId: string }> }) => {
      const id = cmd.targets[0]!.itemId;
      scenario.readings = scenario.readings.map((r) => r.itemId === id ? { ...r, decisionRevision: r.decisionRevision + 1,
        decision: { kind: "set_aside" as const, reason: "duplicate" as const, note: null, actorId: "operator", at: "2026-11-22T10:00:00Z",
          revision: r.decisionRevision + 1 } } : r);
      return { applied: [{ itemId: id }], skipped: [] };
    });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    const show = async (itemId: string) => {
      go(takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId, planKey: PLAN_RDC, jobId: JOB_RDC, from: TABLE }));
      await settle();
    };
    await settle(); await setAside();
    expect(evidence().queryByRole("button", { name: "Écarter" })).toBeNull();
    await show(ITEMS.notFound); await setAside();
    await show(ITEMS.basin);
    expect(evidence().queryByRole("button", { name: "Écarter" }) === null).toBe(true);
  });
});

// Review of #483, automated review of 3b1ac6e6 (written before the fix): « Inclure l’hypothèse » sends at once; the member
// moved to another item before the answer, and the read that follows a command read the item shown, not the command's.
// Back on the first item, its line was the old one (the hypothesis still to include, its old revisions).
describe("TakeoffItemDetailScreen, a command that ends after the member moved", () => {
  it("reads again the command's item, and keeps its line, whichever item is shown when the command ends", async () => {
    const entry = (included: boolean, revision: number): ItemEntryView => ({ itemId: ITEMS.basin, scope: "affaire", planKey: null, revision,
      quantity: 5, unit: "u", category: "hypothesis", note: "Cinq lavabos supposés au sous-sol (fictif).", included,
      actorId: "operator", at: "2026-11-22T09:00:00.000Z", previous: null });
    scenario = { ...scenario, entries: [entry(false, 1)] };
    let release: () => void = () => undefined;
    client.sendItemReviewCommand.mockImplementation(() => new Promise((resolve) => {
      release = () => {
        scenario = { ...scenario, entries: [entry(true, 2)] };
        resolve({ outcome: "applied", applied: [{ itemId: ITEMS.basin, label: "Lavabo céramique", answers: 0 }], skipped: [] });
      };
    }));
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    const options = () => within(screen.getByRole("listbox", { name: "Postes" })).getAllByRole("option");
    expect(evidence().getByText(/hypothèse non incluse/)).toBeTruthy();
    fireEvent.click(evidence().getByRole("button", { name: "Inclure l’hypothèse" }));
    expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(options().find((option) => option.textContent?.startsWith("Siphon de sol"))!);
    await settle();
    expect(evidence().getByRole("heading", { name: "Siphon de sol" })).toBeTruthy();
    await act(async () => { release(); });
    await settle();
    expect(client.fetchItemLine.mock.calls.map(([, itemId]) => itemId)).toContain(ITEMS.basin);
    // The basin (5 u in all), not its homonym of the caretaker's flat (1 u).
    fireEvent.click(options().find((option) => option.textContent?.startsWith("Lavabo céramique") && option.textContent.endsWith("5 u"))!);
    await settle();
    expect(evidence().getByRole("heading", { name: "Lavabo céramique" })).toBeTruthy();
    expect(evidence().queryByText(/hypothèse non incluse/)).toBeNull();
    expect(evidence().queryByRole("button", { name: "Inclure l’hypothèse" })).toBeNull();
  });
});
