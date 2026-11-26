import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  // As Next's patch: a state carrying its own markers (`__NA`, `_N`) is one of its navigations, not followed here.
  const marked = data !== null && typeof data === "object" && ("__NA" in data || "_N" in data);
  if (!marked) for (const listener of address.listeners) listener();
};

import { TakeoffItemDetailScreen } from "@/components/takeoff/item-detail/TakeoffItemDetailScreen";
import * as itemClient from "@/lib/takeoff/item-table-client";
import type { MeasureReview } from "@/lib/takeoff/measure-review-contracts";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { takeoffItemDetailHref } from "@/lib/takeoff/review-href";
import type { ItemTableAddress } from "@/lib/takeoff/item-table-query";
import {
  DETAIL_ITEMS, DETAIL_PLANS, DETAIL_PROJECT, DETAIL_READINGS, ITEMS, JOB_EARLIER, JOB_R1, JOB_RDC, PLAN_R1, PLAN_RDC, detailReadings,
  fixtureMeasureReview, planViews,
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
    if (url.pathname.endsWith("/items/remeasure")) return Response.json({ ok: true, data: null });
    if (url.pathname.includes("/items/measures/")) return Response.json({ ok: true,
      data: fixtureMeasureReview(url.pathname.split("/").at(-1)!, scenario.readings) });
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
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>{children}</SWRConfig>;
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
  it("keeps the plan evidence visible and withdraws quantity decisions while it is being read again", async () => {
    scenario.readings = DETAIL_READINGS.map((reading) => reading.itemId === ITEMS.basin && reading.planKey === PLAN_R1
      ? { ...reading, unit: "running", reading: "in_flight", attempt: { unit: "running", reason: null },
        verifiedMarks: { revision: 1, verified: true, counted: true, quantity: 1, unit: "u", pages: [1] } } : reading);
    open(ITEMS.basin, PLAN_R1, JOB_R1, `postePlan=${PLAN_R1}&tab=jobs`);
    await settle();
    expect(evidence().getByText(/Deux lavabos, sanitaires étage/)).toBeInTheDocument();
    expect(evidence().queryByRole("group", { name: "Quantité retenue pour ce poste sur ce plan" })).not.toBeInTheDocument();
    expect(client.sendItemReviewCommand).not.toHaveBeenCalled();
  });

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
      scope: { kind: "plan", planKey: PLAN_R1 }, filter: {}, focusItemId: ITEMS.homonym }), true);
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
    fireEvent.change(dialog().getByLabelText("Portée de la saisie"), { target: { value: PLAN_RDC } });
    fireEvent.change(dialog().getByLabelText("Ce qui fonde ces quantités"), { target: { value: "site_survey" } });
    fireEvent.click(dialog().getByRole("button", { name: "Enregistrer" }));
    await settle();
    expect(client.sendItemReviewCommand).toHaveBeenLastCalledWith(DETAIL_PROJECT, expect.objectContaining({
      gesture: "enter_quantity", scope: { kind: "plan", planKey: PLAN_RDC }, values: [{ item_id: ITEMS.notFound, quantity: 2.5, unit: "u" }],
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
      scope: { kind: "plan", planKey: PLAN_RDC }, filter: {}, focusItemId: ITEMS.basin }), true);
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

// Follow-ups of lot 5, written before the fix: a command refused for the member's right once another item was shown was
// discarded, the member keeping the detail until the next read.
describe("TakeoffItemDetailScreen, a refusal of the member's right", () => {
  it("withdraws the screen at once when this screen's command is refused, whatever item is shown", async () => {
    let refuse: (error: unknown) => void = () => undefined;
    client.sendItemReviewCommand.mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    open(ITEMS.homonym, PLAN_R1, JOB_R1);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Accepter" }));
    fireEvent.click(dialog().getByRole("button", { name: "Accepter 1 poste" }));
    await settle();
    // Another item's address arrives (the browser's history) while the command is on its way, in the same scope.
    act(() => {
      const url = new URL(takeoffItemDetailHref({ projectId: DETAIL_PROJECT, itemId: ITEMS.notFound, planKey: PLAN_RDC,
        jobId: JOB_RDC, from: TABLE }), "https://app.test");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    });
    await settle();
    expect(screen.getByText("Siphon de sol", { selector: "h2" })).toBeTruthy();
    expect(screen.queryByTestId("poste-detail-refus")).toBeNull();
    await act(async () => refuse(new TakeoffApiError("Accès refusé.", 403, null, "FORBIDDEN")));
    await settle();
    expect(screen.getByTestId("poste-detail-refus")).toBeInTheDocument();
  });
});

describe("TakeoffItemDetailScreen, the way back", () => {
  // Follow-ups of lot 5: the line whose « Détail » opened the detail, for the browser's back (ItemDetailOpenerFocus).
  it("remembers the line it was opened from for the table's address, and « Revenir aux postes » forgets it", async () => {
    const { takeItemDetailOpener } = await import("@/components/takeoff/item-detail/ItemDetailOpenerFocus");
    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Postes" }), { key: "ArrowDown" });
    await settle();
    // The opener is the item first shown, whatever item the member moved to since.
    expect(takeItemDetailOpener(DETAIL_PROJECT, "tenant:member", TABLE)).toBe(ITEMS.notFound);
    cleanup();
    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(takeItemDetailOpener(DETAIL_PROJECT, "tenant:member", TABLE)).toBeNull();
  });

  it("comes back to the table by the router, the table's filter kept and the item in focus", async () => {
    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(replace).toHaveBeenCalledWith(
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?posteState=measured&posteState=not_found&tab=jobs&posteFocus=${ITEMS.notFound}`,
      { scroll: false });
    // Navigation reads only the plan, its marks and this member’s latest measure on that plan.
    expect(plansAsked.every((path) => path.startsWith(`/api/affaires/${DETAIL_PROJECT}/takeoff/item-detail/plan?`)
      || path.startsWith(`/api/affaires/${DETAIL_PROJECT}/takeoff/count-marks?`)
      || path.startsWith(`/api/affaires/${DETAIL_PROJECT}/takeoff/items/remeasure?`))).toBe(true);
    expect(plansAsked.some((path) => path.startsWith(`/api/affaires/${DETAIL_PROJECT}/takeoff/item-detail/plan?`))).toBe(true);
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
    // The retry names the item as read again after the refusal: its plan's answer, at its new decision revision.
    const reread = tableOf({ scope: { kind: "plan", planKey: PLAN_R1 } }).page.lines.find(({ itemId }) => itemId === ITEMS.basin)!;
    expect(client.sendItemReviewCommand.mock.calls[1]![1].targets).toEqual([reread.targets]);
    expect(client.sendItemReviewCommand.mock.calls[0]![1].targets).not.toEqual([reread.targets]);
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

// Review of #483, the check of the fixes (written before the fix): « Annuler » stayed enabled on a confirmation whose
// command was sent, as if it could cancel it. Its answer closes it; nothing else does meanwhile.
describe("TakeoffItemDetailScreen, a confirmation under way", () => {
  it("cannot be closed while its command is under way, names its item, and closes with its own answer", async () => {
    const sent = Promise.withResolvers<void>();
    client.sendItemReviewCommand.mockImplementationOnce(async () => { await sent.promise; return { outcome: "applied", applied: [], skipped: [] }; });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Écarter" }));
    expect(dialog().getByText(/« Lavabo céramique » · Portée : toute l’affaire/)).toBeTruthy();
    fireEvent.click(dialog().getByRole("radio", { name: "Doublon" }));
    fireEvent.click(dialog().getByRole("button", { name: "Écarter 1 poste" }));
    await settle();
    expect(dialog().getByRole("button", { name: "Annuler" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await settle();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => sent.resolve());
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// Review of #483, automated review of 24f59de6 (written before the fix): A's read after its command was still pending when
// a command on B ended; the new read cancelled A's, so A kept its old line. Reads of different items live until they end.
describe("TakeoffItemDetailScreen, reads of two items that overlap", () => {
  it("keeps the line of each item its command read again, when the reads overlap", async () => {
    const entry = (itemId: string, included: boolean, revision: number): ItemEntryView => ({ itemId, scope: "affaire", planKey: null,
      revision, quantity: 2, unit: "u", category: "hypothesis", note: "Hypothèse fictive à inclure.", included, actorId: "operator",
      at: "2026-11-22T09:00:00.000Z", previous: null });
    scenario = { ...scenario, entries: [entry(ITEMS.basin, false, 1), entry(ITEMS.notFound, false, 1)] };
    client.sendItemReviewCommand.mockImplementation(async (_project: string, command: { targets: Array<{ itemId: string }> }) => {
      const id = command.targets[0]!.itemId;
      scenario = { ...scenario, entries: scenario.entries!.map((value) => (value.itemId === id ? entry(id, true, 2) : value)) };
      return { outcome: "applied", applied: [{ itemId: id, label: "x", answers: 0 }], skipped: [] };
    });
    const heldA = Promise.withResolvers<void>();
    const readLine = client.fetchItemLine.getMockImplementation()!;
    client.fetchItemLine.mockImplementation(async (projectId: string, itemId: string) => {
      if (itemId === ITEMS.basin) await heldA.promise;
      return readLine(projectId, itemId);
    });
    open(ITEMS.basin, PLAN_RDC, JOB_RDC);
    await settle();
    const options = () => within(screen.getByRole("listbox", { name: "Postes" })).getAllByRole("option");
    fireEvent.click(evidence().getByRole("button", { name: "Inclure l’hypothèse" }));
    await settle();
    fireEvent.click(options().find((option) => option.textContent?.startsWith("Siphon de sol"))!);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Inclure l’hypothèse" }));
    await settle();
    expect(evidence().queryByText(/hypothèse non incluse/)).toBeNull();
    await act(async () => heldA.resolve());
    await settle();
    fireEvent.click(options().find((option) => option.textContent?.startsWith("Lavabo céramique") && option.textContent.endsWith("5 u"))!);
    await settle();
    expect(evidence().getByRole("heading", { name: "Lavabo céramique" })).toBeTruthy();
    expect(evidence().queryByText(/hypothèse non incluse/)).toBeNull();
    expect(evidence().queryByRole("button", { name: "Inclure l’hypothèse" })).toBeNull();
  });
});

// Review of #483, the check of the fixes (its cases, written before these changes and kept as written): a completion that
// ends after the member moved acts on what started it, never on what is shown now.
describe("TakeoffItemDetailScreen, check of #483", () => {
  const changeAddress = (itemId: string, planKey = PLAN_RDC, jobId = JOB_RDC, from = TABLE) =>
    act(() => window.history.replaceState(null, "", takeoffItemDetailHref({projectId: DETAIL_PROJECT, itemId, planKey, jobId, from})));
  const beginAside = () => {
    fireEvent.click(evidence().getByRole("button", {name:"Écarter"}));
    fireEvent.click(dialog().getByRole("radio", {name:"Doublon"}));
    fireEvent.click(dialog().getByRole("button",{name:"Écarter 1 poste"}));
  };
  async function slowDecision() {
    const sent = Promise.withResolvers<void>();
    client.sendItemReviewCommand.mockImplementationOnce(async () => {
      await sent.promise;
      scenario.readings = scenario.readings.map(r => r.itemId !== ITEMS.basin ? r : { ...r, decisionRevision: r.decisionRevision + 1,
        decision: { kind: "set_aside", reason: "duplicate", note: null, actorId: JOB_RDC, at: "2026-11-22T09:00:00Z", revision:r.decisionRevision+1 } });
      return {applied:[{itemId:ITEMS.basin}],skipped:[]};
    });
    open(ITEMS.basin,PLAN_RDC,JOB_RDC);
    await settle(); beginAside();
    // The slow request has already been submitted. (Adapted to the closing changes: « Annuler » no longer closes a
    // confirmation whose command is under way, it is disabled and the queue stays behind the dialog; the member reaches B
    // by its address, a link or the router, which drops the confirmation.)
    expect(dialog().getByRole("button",{name:"Annuler"})).toBeDisabled();
    changeAddress(ITEMS.notFound);
    await settle();
    expect(evidence().getByRole("heading",{name:"Siphon de sol"})).toBeTruthy();
    return sent;
  }
  it("rereads the item actually decided when A finishes under B", async () => {
    const sent = await slowDecision();
    await act(async () => sent.resolve()); await settle();
    const ids=client.fetchItemLine.mock.calls.map(([,item])=>item);
    fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]!);
    await settle();
    expect({readA:ids.includes(ITEMS.basin), readB:ids.includes(ITEMS.notFound), staleAside:!!evidence().queryByRole("button",{name:"Écarter"})})
      .toEqual({readA:true,readB:false,staleAside:false});
  });
  it("keeps B's typed quantity when A finishes", async () => {
    const sent = await slowDecision();
    fireEvent.click(evidence().getByRole("button",{name:"Saisir une quantité"}));
    fireEvent.change(dialog().getByLabelText("Quantité"),{target:{value:"2,75"}});
    expect(dialog().getByLabelText("Quantité")).toHaveValue("2,75");
    await act(async () => sent.resolve()); await settle();
    expect(screen.queryByLabelText("Quantité")).toHaveValue("2,75");
  });
  it("honours canReview false on a scoped page even when the item dropped out during the reread", async () => {
    const from="postePlan="+PLAN_RDC;
    open(ITEMS.basin,PLAN_RDC,JOB_RDC,from); await settle();
    client.sendItemReviewCommand.mockRejectedValueOnce(new TakeoffApiError("stale",409,{stale:[{itemId:ITEMS.basin,label:"x"}]},"TAKEOFF_ITEM_REVIEW_STALE"));
    // A vanished; B is on the SAME frozen page. The new page says this viewer is now a reader.
    scenario.canReview=false;
    scenario.readings=scenario.readings.filter(r=>r.itemId!==ITEMS.basin);
    const late=Promise.withResolvers<void>();
    client.fetchItemTable.mockImplementationOnce(async (_project,address)=>{await late.promise;return tableOf(address)});
    beginAside(); await settle();
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option",{name:/Siphon de sol/})); await settle();
    await act(async()=>late.resolve()); await settle();
    expect(evidence().getByRole("heading",{name:"Siphon de sol"})).toBeTruthy();
    const offered=!!evidence().queryByRole("group",{name:"Décider du poste"});
    fireEvent.keyDown(screen.getByRole("listbox"),{key:"e"});
    expect({offered,dialog:!!screen.queryByRole("dialog")}).toEqual({offered:false,dialog:false});
  });
  it.each(["reading","scope"])("cancels a dialog when its %s changes", async kind=>{
    open(ITEMS.basin,PLAN_RDC,JOB_RDC); await settle();
    fireEvent.click(evidence().getByRole("button",{name:"Écarter"}));
    changeAddress(ITEMS.basin, kind==="reading"?PLAN_R1:PLAN_RDC, kind==="reading"?JOB_R1:JOB_RDC, kind==="scope"?"postePlan="+PLAN_RDC:TABLE);
    await settle(); expect(screen.queryByRole("dialog")).toBeNull(); expect(client.sendItemReviewCommand).not.toHaveBeenCalled();
  });
  it("discards an A journal page that resolves after B is already shown", async ()=>{
    const release=Promise.withResolvers<void>();
    client.fetchItemHistory.mockImplementation(async (projectId,itemId,{offset})=>{
      if(offset) await release.promise;
      return {projectId,itemId,offset,limit:20,hasMore:!offset && itemId===ITEMS.basin,names:{},events:offset?[{id:99,event:"set_aside",at:"2026-11-22T09:00:00Z",actorId:JOB_RDC,planKey:null,after:{reason:"duplicate",note:"Only A late"}}]:[]};
    });
    open(ITEMS.basin,PLAN_RDC,JOB_RDC); await settle();
    fireEvent.click(evidence().getByRole("button",{name:"Événements plus anciens"}));
    changeAddress(ITEMS.notFound); await settle();
    await act(async()=>release.resolve()); await settle();
    expect(evidence().getByRole("heading",{name:"Siphon de sol"})).toBeTruthy();
    expect(screen.queryByText(/Only A late/)).toBeNull();
  });
  it("does not attribute a different job to this item when the server says that plan was never read by it", async ()=>{
    open(ITEMS.basin,PLAN_R1,JOB_RDC); await settle();
    expect(screen.getByText(/Ce plan est introuvable pour ce poste/)).toBeTruthy();
    expect(screen.queryByText(/Lecture antérieure du poste sur ce plan/)).toBeNull();
  });
  it("does not send even an otherwise eligible hypothesis on an earlier reading", async()=>{
    client.fetchItemTable.mockImplementation(async (_project, req) => fixtureItemTable({items:DETAIL_ITEMS, readings:DETAIL_READINGS, plans:DETAIL_PLANS,
      entries:[{itemId:ITEMS.basin,scope:"affaire",planKey:null,revision:1,quantity:2,unit:"u",category:"hypothesis",note:"a hypothesis",included:false,actorId:JOB_RDC,at:"2026-11-22T09:00:00Z",previous:null}],...req}));
    open(ITEMS.basin, PLAN_RDC,JOB_EARLIER); await settle();
    fireEvent.keyDown(screen.getByRole("listbox"),{key:"i"});
    expect(client.sendItemReviewCommand).not.toHaveBeenCalled();
    changeAddress(ITEMS.basin); await settle();
    client.sendItemReviewCommand.mockResolvedValue({applied:[],skipped:[]});
    fireEvent.keyDown(screen.getByRole("listbox"),{key:"i"}); await settle();
    expect(client.sendItemReviewCommand).toHaveBeenCalledWith(DETAIL_PROJECT,expect.objectContaining({gesture:"include_entry"}));
  });
  it("focuses an item after page one and removes a line absent from the plan",async()=>{
    const {itemTableDetailSource}=await import("@/lib/takeoff/item-detail-client");
    const {fixtureItemId}=await import("@/lib/takeoff/item-table.test-fixtures");
    const items=Array.from({length:52},(_,i)=>({...DETAIL_ITEMS[1]!,id:fixtureItemId(i),position:i}));
    let readings=items.map(i=>({...DETAIL_READINGS[2]!,itemId:i.id,decisionRevision:i.position+1}));
    let pageOffset=-1;
    client.fetchItemTable.mockImplementation(async (_project,req)=>{
      const table=fixtureItemTable({items,readings,plans:DETAIL_PLANS,...req});
      pageOffset=table.page.offset;
      return table;
    });
    const src=itemTableDetailSource(DETAIL_PROJECT,{scope:{kind:"plan",planKey:PLAN_RDC},filter:{states:["measured"]},offset:0,limit:25,focusItemId:null});
    const id=items[51]!.id;
    const r=await src.readLine(id);
    expect(pageOffset).toBe(50);
    expect(r?.line?.targets).toMatchObject({itemId:id,answers:[{decisionRevision:52}]});
    expect(r?.line?.eligibility.enter_quantity.eligible).toBe(true);
    readings=readings.filter(r=>r.itemId!==id);
    // The item absent from the plan's scope; the reply's right is kept (case 3 of the closing brief).
    expect((await src.readLine(id))?.line).toBeNull();
    expect(client.fetchItemLine).not.toHaveBeenCalled();
  });
  it("confirms with latest revisions of the same item after a reread arrives",async()=>{
    const late=Promise.withResolvers<void>();
    client.sendItemReviewCommand.mockResolvedValue({applied:[],skipped:[]});
    open(ITEMS.basin,PLAN_RDC,JOB_RDC);await settle();
    const readLine=client.fetchItemLine.getMockImplementation()!;
    client.fetchItemLine.mockImplementationOnce(async(...args)=>{await late.promise;return readLine(...args)});
    beginAside(); await settle();
    fireEvent.click(evidence().getByRole("button",{name:"Écarter"}));
    fireEvent.click(dialog().getByRole("radio",{name:"Doublon"}));
    scenario.readings=scenario.readings.map(r=>r.itemId===ITEMS.basin?{...r,decisionRevision:r.decisionRevision+4}:r);
    await act(async()=>late.resolve());await settle();
    fireEvent.click(dialog().getByRole("button",{name:"Écarter 1 poste"}));await settle();
    const revised=tableOf().page.lines.find(l=>l.itemId===ITEMS.basin)!;
    expect(client.sendItemReviewCommand.mock.calls[1]![1].targets).toEqual([revised.targets]);
    expect(client.sendItemReviewCommand.mock.calls[0]![1].targets).not.toEqual([revised.targets]);
  });
  it("discards a late denial from the previous viewer's older journal page", async()=>{
    const late=Promise.withResolvers<void>();
    client.fetchItemHistory.mockImplementation(async (projectId,itemId,{offset})=>{
      if(offset) {await late.promise; throw new TakeoffApiError("Old session expired",401,null,"UNAUTHORIZED"); }
      return {projectId,itemId,events:[],offset,limit:20,hasMore:itemId===ITEMS.basin,names:{}};
    });
    const w=open(ITEMS.basin,PLAN_RDC,JOB_RDC); await settle();
    fireEvent.click(evidence().getByRole("button",{name:"Événements plus anciens"}));
    changeAddress(ITEMS.notFound); w.rerender(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:new-member" />);
    await settle();
    expect(evidence().getByRole("heading",{name:"Siphon de sol"})).toBeTruthy();
    await act(async()=>late.resolve());await settle();
    expect(screen.queryByTestId("poste-detail-refus")).toBeNull();
  });
  it("waits for proof before calling another item's job on the shared plan this item's earlier reading", async()=>{
    const late=Promise.withResolvers<void>();
    vi.stubGlobal("fetch",vi.fn(async()=>{
      await late.promise;
      return new Response(JSON.stringify({ok:false,error:{code:"TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND"}}),{status:404});
    }));
    open(ITEMS.basin,PLAN_RDC,JOB_EARLIER); await settle();
    const labelledEarlier=!!screen.queryByText(/Lecture antérieure du poste sur ce plan/);
    await act(async()=>late.resolve());await settle();
    expect(screen.getByText("Ce lien ne désigne pas une lecture de ce poste.")).toBeTruthy();
    expect(labelledEarlier).toBe(false);
  });
  it("ignores Enter while IME composition is active in the quantity dialog", async () => {
    open(ITEMS.notFound, PLAN_RDC, JOB_RDC);
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Saisir une quantité" }));
    const quantityInput = dialog().getByLabelText("Quantité");
    fireEvent.change(quantityInput, { target: { value: "2,5" } });
    fireEvent.keyDown(quantityInput, { key: "Enter", isComposing: true });
    fireEvent.keyDown(quantityInput, { key: "Enter", keyCode: 229 });
    expect(dialog().getByRole("button", { name: "Continuer" })).toBeInTheDocument();
    fireEvent.keyDown(quantityInput, { key: "Enter" });
    expect(dialog().getByLabelText("Ce qui fonde ces quantités")).toBeInTheDocument();
  });

  it("draws the sealed PDF for an old dossier bookmark naming a measured piece",async()=>{
    const {COPY_RDC}=await import("@/lib/takeoff/item-detail.test-fixtures");
    act(()=>window.history.replaceState(null,"",takeoffItemDetailHref({projectId:DETAIL_PROJECT,itemId:ITEMS.basin,source:{documentId:PLAN_RDC,generation:"2"}})));
    render(<TakeoffItemDetailScreen projectId={DETAIL_PROJECT} viewerKey="tenant:member"/>,{wrapper:FreshCache});
    await settle();
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({url:`/api/takeoff/jobs/${JOB_RDC}/vector-plans/${COPY_RDC}`}));
  });
});

describe("the retention panel checks the current measure", () => {
  const expiry = "Les éléments sur lesquels vous aviez retenu cette mesure ont changé. Vérifiez la mesure à nouveau.";
  const basin = DETAIL_READINGS.find(row => row.itemId === ITEMS.basin && row.planKey === PLAN_RDC)!;
  const retained: MeasureReview = {
    answer_id: basin.answer!.answerId, item_id: ITEMS.basin, plan_id: PLAN_RDC, revision: "a".repeat(64), decision_revision: 1,
    quantity: 3, unit: "u", expected_unit: "u", reference: 1, gap: 2, gap_required: true,
    previously_retained: true, effective_decision: "accepted", retained: { quantity: 3, unit: "u" }, reason: "already_decided",
    confidence_threshold: 0.5, rules_required: false, proof_required: false, rows: [],
  };
  function show() { return open(ITEMS.basin, PLAN_RDC, JOB_RDC, `postePlan=${PLAN_RDC}`); }
  function expectNoAcceptance() {
    expect(evidence().queryByText(/^Retenu sur ce plan/)).toBeNull();
    expect(evidence().queryByText(/^Retenu : [0-9]/)).toBeNull();
    expect(evidence().queryByText(/^Accepté par /)).toBeNull();
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it("withdraws cached acceptance on a failed re-read and checks again on retry", async () => {
    const read = vi.spyOn(itemClient, "fetchMeasureReview").mockResolvedValue(retained);
    show();
    await screen.findByText("Retenu sur ce plan · 3 u");
    const recheck = Promise.withResolvers<MeasureReview>();
    read.mockReturnValueOnce(recheck.promise);
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(evidence().getByText("Vérification de la décision sur cette mesure…")).toBeInTheDocument();
    expectNoAcceptance();
    expect(evidence().queryByRole("button", { name: "Retenir cette mesure" })).toBeNull();
    await act(async () => recheck.reject(new Error("Lecture interrompue")));
    await screen.findByText("Impossible de vérifier la décision sur cette mesure.");
    expectNoAcceptance();
    expect(evidence().queryByRole("button", { name: "Retenir cette mesure" })).toBeNull();
    fireEvent.click(evidence().getByRole("button", { name: "Relire la mesure" }));
    await screen.findByText("Retenu sur ce plan · 3 u");
  });

  it("withdraws the accepted amount when a different verified count requires a quantity choice", async () => {
    const read = vi.spyOn(itemClient, "fetchMeasureReview").mockResolvedValue(retained);
    show();
    await screen.findByText("Retenu sur ce plan · 3 u");
    read.mockResolvedValue({ ...retained, revision: "b".repeat(64), reason: "quantity_choice", effective_decision: null, retained: null });
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("Choisissez la source de quantité dans le détail du comptage.");
    expectNoAcceptance();
    expect(evidence().getByText(expiry)).toBeInTheDocument();
  });

  it("checks the state while the first review is pending and then shows why the decision expired", async () => {
    const pending = Promise.withResolvers<MeasureReview>();
    const read = vi.spyOn(itemClient, "fetchMeasureReview").mockReturnValue(pending.promise);
    scenario.readings = [{ ...basin, decision: null }];
    show();
    await screen.findByRole("heading", { name: "Lavabo céramique" });
    expect(evidence().getByText("Vérification de la décision sur cette mesure…")).toBeInTheDocument();
    expectNoAcceptance();
    expect(evidence().queryByRole("button", { name: "Retenir cette mesure" })).toBeNull();
    await act(async () => pending.resolve({ ...retained, quantity: 4, gap: 3, effective_decision: null, retained: null, reason: null }));
    expect(evidence().getByText(expiry)).toBeInTheDocument();
    expect(evidence().getByText("Quantité observée · 4 u")).toBeInTheDocument();
    // The poste still has no decision when the next review confirms a new individual acceptance.
    read.mockResolvedValue({ ...retained, revision: "c".repeat(64), decision_revision: 2, quantity: 4,
      gap: 3, retained: { quantity: 4, unit: "u" } });
    act(() => window.dispatchEvent(new Event("focus")));
    await screen.findByText("Retenu sur ce plan · 4 u");
    expect(evidence().queryByText(expiry)).toBeNull();
  });
});
