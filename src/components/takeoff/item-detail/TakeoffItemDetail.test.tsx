import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The second depth of the review (lot 5): the detail of an item on its plan, on lines built as the table of items builds
// them (its fixtures and its model). Ways it could mislead, written with the screen:
// - an answer without a quantity drawn with a point, or without the pages searched;
// - an item never measured shown without its plan, or a scanned plan (no vector page) not drawn;
// - a move between items adding a history entry, losing its place across a page of the table, or a poll moving it;
// - the way back losing the table's filter, page or the item in focus;
// - a key acting in a field, with a modifier, or a gesture applied where the server would not, or a key that spends;
// - an old bookmark of an earlier reading showing the current reading's evidence over the earlier plan;
// - an item outside the filter (a radar link) refused, or an item foreign to the list shown.
// Before the detail is opened to members (review of #465), written before the fixes:
// - « lu le » said of a job that failed; « Page suivante » past a page count nobody knows;
// - another item's job on a shared plan shown as this item's earlier reading; on an earlier reading, an entry or a
//   journal of the current one; an observation of page 7 drawn on page 3;
// - a pending arrow overwriting an address the page gave meanwhile;
// - a plan opened by its dossier piece resolved and loaded again when chosen in « Plans du poste ».
// pdfjs is replaced by documents of nine pages; the reader by fixtures (item-detail.test-fixtures.ts).

const { getDocument, loads, destroyed } = vi.hoisted(() => ({ getDocument: vi.fn(), loads: [] as string[], destroyed: [] as string[] }));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));

import { TakeoffItemDetail, type ItemDetailGestureRequest } from "@/components/takeoff/item-detail/TakeoffItemDetail";
import { readItemDetailAddress, type ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import type { ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import { ItemDetailPlanError } from "@/lib/takeoff/item-detail-client";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import {
  COPY_RDC, DETAIL_ITEMS, DETAIL_PROJECT, DETAIL_READINGS, ITEMS, JOB_EARLIER, JOB_R1, JOB_RDC, JOB_SCAN, MEMBER, MEMBER_NAME, PLAN_R1,
  PLAN_RDC, PLAN_SCAN, OUTSIDE_ITEM, basinLine, fixtureItemDetailReader, notFoundLine, planViews,
} from "@/lib/takeoff/item-detail.test-fixtures";
import { fixturePoste } from "@/lib/takeoff/item-table.test-fixtures";

const rendered: Array<{ url: string; page: number }> = [];
const failing = new Set<string>();
/** Bytes whose load never answers during the test (a slow route). */
const held = new Set<string>();
/** Bytes whose pages never finish drawing during the test (a slow render: the page's size is known, its sheet is not). */
const heldRenders = new Set<string>();
getDocument.mockImplementation(({ url }: { url: string }) => {
  loads.push(url);
  return {
    promise: held.has(url) ? new Promise(() => undefined) : failing.has(url) ? Promise.reject(new Error("Unexpected server response (404).")) : Promise.resolve({
      numPages: 9,
      getPage: (number: number) => (number > 9 ? Promise.reject(new Error("Invalid page request.")) : Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
        render: () => {
          rendered.push({ url, page: number });
          return { promise: heldRenders.has(url) ? new Promise<void>(() => undefined) : Promise.resolve(), cancel: () => undefined };
        },
      })),
    }),
    destroy: () => {
      destroyed.push(url);
      return Promise.resolve();
    },
  };
});

const TABLE = "postePlan=&posteState=measured&posteLimit=25&tab=jobs";
const TAKEOFF = `/dashboard/affaires/${DETAIL_PROJECT}/takeoff`;
const attested = (job: string, copy: string) => `/api/takeoff/jobs/${job}/vector-plans/${copy}`;
/** The journal the table serves for an item (its history route): the basin's acceptance, nothing for the others. */
const fetches: string[] = [];

function address(overrides: Partial<ItemDetailAddress>): ItemDetailAddress {
  return { itemId: ITEMS.basin, planKey: null, jobId: null, page: null, source: null, answerId: null, observationId: null,
    versionId: null, ...overrides };
}

/** The page around the detail: it follows the address the detail replaces in place, as the router's search parameters do. */
function Page({ initial, reader, onBack, onGesture, onRefused, setter }: {
  initial: ItemDetailAddress; reader: ItemDetailReader; onBack: (href: string) => void;
  onGesture?: (request: ItemDetailGestureRequest) => void; onRefused?: (caught: unknown) => boolean;
  /** Receives the way the page itself gives another address (the router, a link). */
  setter?: (set: (address: ItemDetailAddress) => void) => void;
}) {
  const [shown, setShown] = useState(initial);
  setter?.(setShown);
  return (
    <TakeoffItemDetail projectId={DETAIL_PROJECT} address={shown} reader={reader} tableQuery={TABLE} onBack={onBack} onGesture={onGesture}
      onRefused={onRefused}
      onAddressChange={(href) => {
        const read = readItemDetailAddress(new URL(href, "https://app.test").searchParams);
        if (read.kind === "detail") setShown(read.address);
      }} />
  );
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function open(initial: ItemDetailAddress, options: Parameters<typeof fixtureItemDetailReader>[0] = {}) {
  const { reader, calls } = fixtureItemDetailReader(options);
  const onBack = vi.fn();
  const onGesture = vi.fn();
  const onRefused = vi.fn(() => true);
  let set: (address: ItemDetailAddress) => void = () => undefined;
  // A cache of the journal's reads of its own: each test reads the journal its stub serves.
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Page initial={initial} reader={reader} onBack={onBack} onGesture={onGesture} onRefused={onRefused}
        setter={(value) => { set = value; }} />
    </SWRConfig>);
  return { ...view, reader, calls, onBack, onGesture, onRefused, setAddress: (next: ItemDetailAddress) => act(() => set(next)) };
}

const evidence = () => within(screen.getByRole("complementary", { name: "Preuve et décisions du poste" }));
const list = () => screen.getByRole("listbox", { name: "Postes" });
const selected = () => within(list()).getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")?.textContent ?? null;
const here = () => `${window.location.pathname}${window.location.search}`;
const MISMATCH = "Ce lien ne désigne pas une lecture de ce poste.";
/** The view a reload of the current address opens: the address read again, on a new detail. */
function reload(options: Parameters<typeof fixtureItemDetailReader>[0] = {}) {
  const read = readItemDetailAddress(new URLSearchParams(window.location.search));
  expect(read.kind).toBe("detail");
  cleanup();
  rendered.length = 0;
  return open((read as { address: ItemDetailAddress }).address, options);
}

beforeEach(() => {
  window.history.replaceState(null, "", `${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}`);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    fetches.push(String(input));
    const item = /\/items\/([^/]+)\/history/.exec(String(input))?.[1] ?? null;
    const events = item === ITEMS.basin ? [{ id: 1, event: "accepted", planKey: PLAN_RDC, takeoffItemId: null, before: null,
      after: { kind: "accepted" }, actorId: MEMBER, at: "2026-11-21T10:00:00.000Z" }] : [];
    return new Response(JSON.stringify({ ok: true, data: { projectId: DETAIL_PROJECT, itemId: item, events, offset: 0, limit: 20,
      hasMore: false, names: { [MEMBER]: MEMBER_NAME } } }), { status: 200 });
  }));
});

afterEach(() => {
  cleanup();
  rendered.length = 0;
  loads.length = 0;
  destroyed.length = 0;
  fetches.length = 0;
  failing.clear();
  held.clear();
  heldRenders.clear();
  vi.unstubAllGlobals();
});

describe("TakeoffItemDetail, the states of an item", () => {
  it("opens a measured item on its first observation's page, with its evidence, its journal and its other plan", async () => {
    const { calls } = open(address({}));
    await settle();
    expect(calls.plans).toEqual([{ itemId: ITEMS.basin, planKey: PLAN_RDC, jobId: JOB_RDC, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: attested(JOB_RDC, COPY_RDC), page: 2 });
    expect(screen.getByText("Poste 1 sur 5")).toBeTruthy();
    const rows = within(evidence().getByRole("table", { name: "Observations" })).getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows).toEqual(["2 u2ComptéeSymbole lavabo, sanitaires hommes92 %", "1 u7ComptéeSymbole lavabo, local ménage88 %"]);
    expect(evidence().getByText(new RegExp(`^Accepté par ${MEMBER_NAME}, le `))).toBeTruthy();
    expect(within(evidence().getByTestId(`poste-historique-${ITEMS.basin}`)).getByText(new RegExp(`^Accepté · Plan RDC · ${MEMBER_NAME}`)))
      .toBeTruthy();
    const plans = within(evidence().getByRole("list", { name: "Plans du poste" })).getAllByRole("button");
    expect(plans.map((plan) => plan.textContent)).toEqual(["Plan RDC · A · RDCMesuré", "Plan R+1 · A · R+1Mesuré"]);
    expect(plans[0]!.getAttribute("aria-current")).toBe("true");
    expect(fetches.filter((url) => url.includes("/vector-pages"))).toEqual([]);
  });

  it("opens an answer without a quantity with the pages searched and no point, on the first page searched", async () => {
    open(address({ itemId: ITEMS.notFound }));
    await settle();
    expect(evidence().getByTestId("poste-detail-not-found").textContent)
      .toBe("Non trouvé sur les pages cherchées : 1, 3, 4. Aucun repère n’est proposé.");
    expect(evidence().queryByRole("table", { name: "Observations" })).toBeNull();
    expect(rendered.at(-1)?.page).toBe(1);
    expect(screen.getByLabelText("Page affichée")).toHaveValue("1");
  });

  it("opens an item never measured on the plan the dossier retains, by its signed address", async () => {
    const { calls } = open(address({ itemId: ITEMS.toMeasure }));
    await settle();
    expect(calls.plans).toEqual([{ itemId: ITEMS.toMeasure, planKey: PLAN_RDC, jobId: null, source: null }]);
    expect(loads).toEqual([`https://files.test/dossier/${COPY_RDC}.pdf`]);
    expect(evidence().getByText(/À mesurer : aucune analyse n’a encore lu ce poste sur ce plan/)).toBeTruthy();
    expect(within(evidence().getByRole("list", { name: "Plans du poste" })).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Plan RDCÀ mesurer", "Plan R+1À mesurer", "Plan scanné R+2À mesurer"]);
  });

  it("draws a scanned plan read without any vector page", async () => {
    const { calls } = open(address({ itemId: ITEMS.scan }));
    await settle();
    expect(calls.plans).toEqual([{ itemId: ITEMS.scan, planKey: PLAN_SCAN, jobId: JOB_SCAN, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: attested(JOB_SCAN, "53333333-3333-4333-8333-333333333333"), page: 2 });
    expect(evidence().getByText("Valeur candidate (non mesurée) : 4 u")).toBeTruthy();
    expect(fetches.filter((url) => url.includes("/vector-pages"))).toEqual([]);
  });

  it("names the plan without drawing it when the original is unavailable, and when it is not available to the member", async () => {
    const views = planViews();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, document: { kind: "unavailable", reason: "original_unavailable" } };
    open(address({}), { views });
    await settle();
    expect(screen.getByText("Plan d’origine indisponible : la copie lue par cette analyse n’est plus servie.")).toBeTruthy();
    expect(screen.getByText(/Plan RDC · génération 1 · lu le/)).toBeTruthy();
    expect(loads).toEqual([]);
    cleanup();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, document: { kind: "unavailable", reason: "not_available_to_you" } };
    open(address({}), { views });
    await settle();
    expect(screen.getByText("Ce plan n’est pas accessible avec vos droits.")).toBeTruthy();
  });

  // Before the detail is opened to members (review of #465): a failed job records when it ended, never when it read.
  it("says « lu le » only of a reading that ran to its end", async () => {
    const views = planViews();
    const base = views[`${JOB_RDC}:${PLAN_RDC}`]!;
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...base, reading: { jobId: JOB_RDC, status: "failed", finishedAt: "2026-11-21T09:30:00.000Z" },
      document: { kind: "unavailable", reason: "original_unavailable" } };
    open(address({}), { views });
    await settle();
    const centre = within(screen.getByRole("region", { name: "Plan du poste" }));
    expect(centre.getByText(/^Plan RDC · génération 1$/)).toBeTruthy();
    expect(screen.queryByText(/lu le/)).toBeNull();
  });

  // Before the detail is opened to members (review of #465): « Page suivante » wrote page=10000 past a count nobody knows.
  it("never turns past a page count nobody knows", async () => {
    const views = planViews();
    const base = views[`${JOB_RDC}:${PLAN_RDC}`]!;
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...base, plan: { ...base.plan, pageCount: null },
      document: { kind: "unavailable", reason: "original_unavailable" } };
    open(address({}), { views });
    await settle();
    expect(screen.getByRole("button", { name: "Page suivante" })).toBeDisabled();
  });

  it("says « verified » only once the attested bytes were served, and never for a reading that did not run", async () => {
    open(address({}));
    await settle();
    expect(evidence().getByText(/Octets lus par cette analyse, servis et vérifiés/)).toBeTruthy();
    cleanup();
    held.add(attested(JOB_RDC, COPY_RDC));
    open(address({}));
    await settle();
    expect(evidence().queryByText(/vérifiés/)).toBeNull();
    expect(evidence().getByText(/Octets lus par cette analyse : ouverture en cours/)).toBeTruthy();
    cleanup();
    held.clear();
    failing.add(attested(JOB_RDC, COPY_RDC));
    open(address({}));
    await settle();
    expect(evidence().queryByText(/vérifiés/)).toBeNull();
    expect(evidence().getByText(/La copie scellée n’a pas pu être servie/)).toBeTruthy();
    cleanup();
    failing.clear();
    const views = planViews();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, reading: { jobId: JOB_RDC, status: "pending", finishedAt: null } };
    open(address({}), { views });
    await settle();
    expect(evidence().queryByText(/lus par cette analyse/)).toBeNull();
    expect(evidence().getByText(/lecture en attente/)).toBeTruthy();
  });

  it("opens an earlier reading of an old bookmark on that reading's plan, never with the current reading's evidence", async () => {
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    expect(calls.plans).toEqual([{ itemId: ITEMS.basin, planKey: PLAN_RDC, jobId: JOB_EARLIER, source: null }]);
    expect(evidence().getByText(/Lecture antérieure du poste sur ce plan/)).toBeTruthy();
    expect(evidence().queryByRole("table", { name: "Observations" })).toBeNull();
    expect(evidence().queryByText(/Accepté par/)).toBeNull();
    expect(evidence().getByText("Les décisions portent sur la lecture actuelle de ce plan.")).toBeTruthy();
  });

  // Review of #483 (written before the fix): « Plans du poste » compared the plan only, so under an earlier reading the
  // current reading of the same plan counted as shown and could not be opened.
  it("opens the current reading of the plan from an old bookmark's earlier reading", async () => {
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    const plans = within(evidence().getByRole("list", { name: "Plans du poste" }));
    const rdc = plans.getByRole("button", { name: /^Plan RDC/ });
    expect(rdc.getAttribute("aria-current")).toBeNull();
    fireEvent.click(rdc);
    await settle();
    expect(new URLSearchParams(window.location.search).get("lecture")).toBe(JOB_RDC);
    expect(calls.plans.at(-1)).toEqual({ itemId: ITEMS.basin, planKey: PLAN_RDC, jobId: JOB_RDC, source: null });
    expect(evidence().queryByText(/Lecture antérieure du poste sur ce plan/)).toBeNull();
    expect(evidence().getByRole("table", { name: "Observations" })).toBeTruthy();
  });

  // Before the detail is opened to members (review of #465): a later manual entry and the current journal were shown
  // under an earlier reading.
  it("shows neither a later entry nor the journal under an earlier reading", async () => {
    const entry = { itemId: ITEMS.basin, scope: "affaire" as const, planKey: null, revision: 1, quantity: 5, unit: "u",
      category: "site_survey" as const, note: null, included: true, actorId: MEMBER, at: "2026-11-21T11:00:00.000Z", previous: null };
    open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }), { entries: [entry] });
    await settle();
    expect(evidence().queryByText(/Saisi pour le poste/)).toBeNull();
    expect(evidence().queryByTestId(`poste-historique-${ITEMS.basin}`)).toBeNull();
    expect(fetches.filter((url) => url.includes("/history"))).toEqual([]);
    expect(evidence().getByText("L’historique porte sur la lecture actuelle du poste.")).toBeTruthy();
  });

  it("opens nothing for a plan, an answer or an observation that is not this item's", async () => {
    const answer = basinLine.readings[0]!.answer!.answerId;
    const scanAnswer = DETAIL_READINGS.find(({ itemId }) => itemId === ITEMS.scan)!.answer!.answerId;
    for (const named of [
      address({ planKey: PLAN_SCAN }),
      address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: scanAnswer }),
      address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-r1-1" }),
      address({ source: { documentId: PLAN_SCAN, generation: null } }),
    ]) {
      const { calls } = open(named);
      await settle();
      expect(screen.getByText(MISMATCH)).toBeTruthy();
      expect(calls.plans).toEqual([]);
      cleanup();
    }
  });

  // Before the detail is opened to members (review of #465): an item never measured, named with a job that read the
  // plan for another item, was shown as « Lecture antérieure du poste ».
  it("opens nothing for another item's reading of a plan it shares", async () => {
    const { calls } = open(address({ itemId: ITEMS.toMeasure, planKey: PLAN_RDC, jobId: JOB_RDC }));
    await settle();
    expect(screen.getByText(MISMATCH)).toBeTruthy();
    expect(screen.queryByText(/Lecture antérieure/)).toBeNull();
    expect(calls.plans).toEqual([]);
  });

  // Before the detail is opened to members (review of #465): an address naming an observation of page 7 with page=3
  // selected the observation and drew page 3.
  it("opens nothing for an observation named with another page, and drops the observation when a page is turned", async () => {
    const answer = basinLine.readings[0]!.answer!.answerId;
    open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-rdc-7", page: 3 }));
    await settle();
    expect(screen.getByText(MISMATCH)).toBeTruthy();
    cleanup();
    open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-rdc-7" }));
    await settle();
    expect(rendered.at(-1)?.page).toBe(7);
    fireEvent.click(screen.getByRole("button", { name: "Page précédente" }));
    await settle();
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_RDC}&lecture=${JOB_RDC}&page=6&reponse=${answer}`);
    expect(rendered.at(-1)?.page).toBe(6);
    expect(evidence().getByRole("button", { name: /^Page 7/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("selects the observation an address names, and opens on its page", async () => {
    const answer = basinLine.readings[0]!.answer!.answerId;
    open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-rdc-7" }));
    await settle();
    expect(rendered.at(-1)?.page).toBe(7);
    expect(evidence().getByRole("button", { name: /^Page 7/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens an item outside the filter beside the queue, and says « not found » for an item foreign to the list", async () => {
    open(address({ itemId: ITEMS.outside }), { outside: [OUTSIDE_ITEM] });
    await settle();
    expect(selected()).toContain("Clapet coupe-feu");
    expect(screen.getAllByText("Hors du filtre")).toHaveLength(1);
    expect(within(list()).getAllByRole("option").map((option) => option.textContent?.split(/Mesuré|Non trouvé|À mesurer|Incertain/)[0]))
      .toEqual(["Clapet coupe-feu", "Lavabo céramique", "Siphon de sol", "Lavabo céramique", "WC suspendu", "Robinet de puisage"]);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Lavabo céramique");
    cleanup();
    const { calls } = open(address({ itemId: ITEMS.extra(99) }));
    await settle();
    expect(screen.getByText("Ce poste est introuvable dans la liste de l’affaire.")).toBeTruthy();
    expect(calls.plans).toEqual([]);
  });

  it("keeps two homonyms apart", async () => {
    open(address({ itemId: ITEMS.homonym }));
    await settle();
    expect(within(list()).getAllByRole("option").filter((option) => option.textContent?.startsWith("Lavabo céramique"))).toHaveLength(2);
    expect(selected()).toContain("Lavabo céramique");
    expect(evidence().getByText(/Plomberie \/ Logement gardien/)).toBeTruthy();
    expect(screen.getByText("Poste 3 sur 5")).toBeTruthy();
  });

  it("says a plan sent to the estimate is read only", async () => {
    const readings = DETAIL_READINGS.map((value) => (value.itemId === ITEMS.basin && value.planKey === PLAN_RDC ? { ...value, sent: true } : value));
    const { onGesture } = open(address({}), { readings });
    await settle();
    expect(evidence().getByTestId("poste-detail-sent").textContent).toContain("envoyé au devis");
    fireEvent.keyDown(list(), { key: "e" });
    expect(onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("« Écarter » ne s’applique pas à ce poste : plan déjà envoyé au devis.");
  });
});

describe("TakeoffItemDetail, one reader, one member", () => {
  // Review of #483 (written before the fix): the older events loaded for one item stayed under the next item shown.
  it("shows under an item only its own journal, older events included", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://app.test");
      const item = /\/items\/([^/]+)\/history/.exec(url.pathname)?.[1] ?? null;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const at = "2026-11-21T10:00:00.000Z";
      const events = item !== ITEMS.basin ? [] : offset === 0
        ? [{ id: 2, event: "accepted", planKey: PLAN_RDC, takeoffItemId: null, before: null, after: { kind: "accepted" }, actorId: MEMBER, at }]
        : [{ id: 1, event: "set_aside", planKey: PLAN_RDC, takeoffItemId: null, before: null, after: { reason: "duplicate" }, actorId: MEMBER, at }];
      return new Response(JSON.stringify({ ok: true, data: { projectId: DETAIL_PROJECT, itemId: item, events, offset, limit: 20,
        hasMore: item === ITEMS.basin && offset === 0, names: { [MEMBER]: MEMBER_NAME } } }), { status: 200 });
    }));
    open(address({}));
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: "Événements plus anciens" }));
    await settle();
    expect(evidence().getByText(/Écarté : doublon/)).toBeTruthy();
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).not.toContain("Lavabo céramique");
    expect(evidence().getByText("Aucune décision n’a encore été prise sur ce poste.")).toBeTruthy();
    expect(evidence().queryByText(/Écarté : doublon/)).toBeNull();
  });

  it("starts from nothing when its reader changes while it stays shown", async () => {
    const first = fixtureItemDetailReader({});
    // The other member reads the same item under another name, and may not review it.
    const second = fixtureItemDetailReader({ items: DETAIL_ITEMS.map((value) => (value.id === ITEMS.basin
      ? { ...value, label: "Lavabo (autre membre)" } : value)), canReview: false });
    const onGesture = vi.fn();
    const { rerender } = render(<Page initial={address({})} reader={first.reader} onBack={vi.fn()} onGesture={onGesture} />);
    await settle();
    expect(selected()).toContain("Lavabo céramique");
    rerender(<Page initial={address({})} reader={second.reader} onBack={vi.fn()} onGesture={onGesture} />);
    await settle();
    expect(second.calls.queue).toEqual([{ kind: "focus", itemId: ITEMS.basin }]);
    expect(second.calls.plans).toEqual([{ itemId: ITEMS.basin, planKey: PLAN_RDC, jobId: JOB_RDC, source: null }]);
    expect(selected()).toContain("Lavabo (autre membre)");
    fireEvent.keyDown(list(), { key: "v" });
    expect(onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("Un opérateur du métré de l’affaire peut revoir ce poste.");
  });

  it("hands a refused read of the table or of a plan to the page, which withdraws the detail", async () => {
    const { reader } = fixtureItemDetailReader({});
    const refused = new TakeoffApiError("Accès refusé à cette affaire.", 403, null, "FORBIDDEN");
    const onRefused = vi.fn(() => true);
    render(<TakeoffItemDetail projectId={DETAIL_PROJECT} address={address({})} tableQuery={TABLE} onBack={vi.fn()} onRefused={onRefused}
      reader={{ ...reader, readQueue: async () => { throw refused; } }} />);
    await settle();
    expect(onRefused).toHaveBeenCalledWith(refused);
    cleanup();
    const onPlanRefused = vi.fn(() => true);
    render(<TakeoffItemDetail projectId={DETAIL_PROJECT} address={address({})} tableQuery={TABLE} onBack={vi.fn()} onRefused={onPlanRefused}
      reader={{ ...reader, resolvePlan: async () => { throw new ItemDetailPlanError("FORBIDDEN", 403); } }} />);
    await settle();
    expect(onPlanRefused).toHaveBeenCalledWith(new ItemDetailPlanError("FORBIDDEN", 403));
  });

  it("resolves a dossier plan again each time it is opened, never keeping a copy or an absence", async () => {
    const views = planViews();
    const dossierR1 = views[`:${PLAN_R1}`]!;
    views[`:${PLAN_R1}`] = { ...dossierR1, plan: { ...dossierR1.plan, planFileId: null }, document: { kind: "unavailable", reason: "no_current_copy" } };
    const { calls } = open(address({ itemId: ITEMS.toMeasure, planKey: PLAN_R1 }), { views });
    await settle();
    expect(screen.getByText("Le dossier n’a pas de copie actuelle de ce plan.")).toBeTruthy();
    // The copy arrives in the dossier; the plan opened again shows it.
    views[`:${PLAN_R1}`] = dossierR1;
    fireEvent.click(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan RDC/ }));
    await settle();
    fireEvent.click(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan R\+1/ }));
    await settle();
    expect(calls.plans.map(({ planKey }) => planKey)).toEqual([PLAN_R1, PLAN_RDC, PLAN_R1]);
    expect(loads.at(-1)).toBe("https://files.test/dossier/52222222-2222-4222-8222-222222222222.pdf");
    expect(screen.queryByText("Le dossier n’a pas de copie actuelle de ce plan.")).toBeNull();
  });

  // Before the detail is opened to members (review of #465): a plan opened by its piece, then chosen in « Plans du
  // poste », was resolved and loaded a second time.
  it("does not open again the plan shown by its piece when it is chosen in « Plans du poste »", async () => {
    const { calls } = open(address({ itemId: ITEMS.toMeasure, source: { documentId: PLAN_RDC, generation: null } }));
    await settle();
    const plan = within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan RDC/ });
    expect(plan.getAttribute("aria-current")).toBe("true");
    fireEvent.click(plan);
    await settle();
    expect(calls.plans).toHaveLength(1);
    expect(loads).toHaveLength(1);
  });
});

describe("TakeoffItemDetail, navigation", () => {
  const extras = Array.from({ length: 4 }, (_, index) => ({ ...fixturePoste(index + 1, `Poste ajouté ${index + 1}`), id: ITEMS.extra(index) }));
  const many = { items: [DETAIL_ITEMS[0]!, ...extras], limit: 2 };

  it("moves between items in the frozen order by replacing the address in place, across a page of the table", async () => {
    const length = window.history.length;
    const { calls } = open(address({}), many);
    await settle();
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 1");
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.extra(0)}`);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 2");
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.extra(1)}`);
    expect(calls.queue).toEqual([{ kind: "focus", itemId: ITEMS.basin }, { kind: "page", offset: 2 }]);
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    await settle();
    expect(selected()).toContain("Poste ajouté 1");
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.extra(0)}`);
    // No history entry per arrow, and the page already read is not read again.
    expect(window.history.length).toBe(length);
    expect(calls.queue).toHaveLength(2);
  });

  it("writes only addresses that parse and open the same view after a reload: a page turned, an observation chosen", async () => {
    open(address({}));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    await settle();
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_RDC}&lecture=${JOB_RDC}&page=3`);
    expect(rendered.at(-1)?.page).toBe(3);
    reload();
    await settle();
    expect(rendered.at(-1)).toEqual({ url: attested(JOB_RDC, COPY_RDC), page: 3 });

    cleanup();
    window.history.replaceState(null, "", `${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}`);
    open(address({}));
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: /^Page 7/ }));
    await settle();
    const answer = basinLine.readings[0]!.answer!.answerId;
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_RDC}&lecture=${JOB_RDC}&page=7&reponse=${answer}&observation=o-rdc-7`);
    reload();
    await settle();
    expect(rendered.at(-1)?.page).toBe(7);
  });

  it("comes back to the table with the item shown in focus on the page that holds it", async () => {
    const { onBack } = open(address({ itemId: ITEMS.extra(2) }), many);
    await settle();
    fireEvent.keyDown(list(), { key: "Escape" });
    expect(onBack).toHaveBeenLastCalledWith(
      `${TAKEOFF}?postePlan=&posteState=measured&posteLimit=25&tab=jobs&posteOffset=2&posteFocus=${ITEMS.extra(2)}`);
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("does not reopen an item once Escape was pressed while a move waited for the next page", async () => {
    let release: () => void = () => undefined;
    const holdPages = new Promise<void>((resolve) => { release = resolve; });
    const { onBack } = open(address({ itemId: ITEMS.extra(0) }), { ...many, holdPages });
    await settle();
    const before = here();
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "Escape" });
    release();
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(here()).toBe(before);
    expect(selected()).toContain("Poste ajouté 1");
  });

  // Before the detail is opened to members (review of #465): a move waiting for a page overwrote an address the page gave
  // meanwhile (the router, a link), the same detail staying shown.
  it("drops a move still waiting for a page once the page gives another address", async () => {
    let release: () => void = () => undefined;
    const holdPages = new Promise<void>((resolve) => { release = resolve; });
    const { setAddress } = open(address({ itemId: ITEMS.extra(0) }), { ...many, holdPages });
    await settle();
    window.history.replaceState(null, "", `${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}`);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await setAddress(address({ itemId: ITEMS.basin }));
    release();
    await settle();
    expect(selected()).toContain("Lavabo céramique");
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}`);
  });

  it("turns to another plan of the item through the address", async () => {
    open(address({}));
    await settle();
    fireEvent.click(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan R\+1/ }));
    await settle();
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_R1}&lecture=${JOB_R1}`);
    expect(rendered.at(-1)?.page).toBe(1);
  });

  it("opens the PDF of a plan once: a page turned renders, it does not load", async () => {
    const { calls } = open(address({}));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    await settle();
    expect(rendered.map(({ page }) => page)).toEqual([2, 3, 4]);
    expect(loads).toEqual([attested(JOB_RDC, COPY_RDC)]);
    expect(destroyed).toEqual([]);
    expect(calls.plans).toHaveLength(1);
  });

  it("moves the focus to the evidence with Enter, once its panel is shown on a narrow screen", async () => {
    open(address({}));
    await settle();
    expect(document.activeElement).toBe(list());
    const panel = () => screen.getByTestId("poste-detail-evidence-panel");
    expect(panel().getAttribute("data-narrow-collapsed")).toBe("true");
    // Whether the panel was still folded at the moment the focus was asked for: a folded panel is not displayed.
    const focusOf = HTMLElement.prototype.focus;
    const asked: Array<{ text: string | null; folded: string | null }> = [];
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      asked.push({ text: this.textContent, folded: panel().getAttribute("data-narrow-collapsed") });
      focusOf.call(this, options);
    });
    fireEvent.keyDown(list(), { key: "Enter" });
    await settle();
    expect(asked.filter(({ text }) => text === "Lavabo céramique")).toEqual([{ text: "Lavabo céramique", folded: "false" }]);
    expect(document.activeElement?.textContent).toBe("Lavabo céramique");
    focus.mockRestore();
  });
});

describe("TakeoffItemDetail, the keyboard of the list", () => {
  it("asks for an eligible gesture, and says why another does not apply, without asking", async () => {
    const { onGesture } = open(address({}));
    await settle();
    fireEvent.keyDown(list(), { key: "e" });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "set_aside", line: basinLine, initial: null, key: expect.stringContaining(ITEMS.basin) });
    fireEvent.keyDown(list(), { key: "F2" });
    expect(onGesture).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("poste-detail-notice").textContent).toMatch(/^« Saisir une quantité » ne s’applique pas à ce poste : /);
    fireEvent.keyDown(list(), { key: "i" });
    expect(onGesture).toHaveBeenCalledTimes(1);
    // A notice belongs to its item: moving on clears it.
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(screen.queryByTestId("poste-detail-notice")).toBeNull();
  });

  it("opens the entry with a digit as its first character where an entry applies, Shift included (AZERTY digits)", async () => {
    const { onGesture } = open(address({ itemId: ITEMS.notFound }));
    await settle();
    fireEvent.keyDown(list(), { key: "7", shiftKey: true });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "enter_quantity", line: notFoundLine, initial: "7", key: expect.stringContaining(ITEMS.notFound) });
  });

  it("does nothing with a modifier or Shift, during a composition, for a member who cannot review, or for a key that would spend", async () => {
    const { onGesture, onBack } = open(address({}));
    await settle();
    const before = here();
    for (const event of [{ key: "v", ctrlKey: true }, { key: "v", metaKey: true }, { key: "ArrowDown", altKey: true },
      { key: "ArrowDown", shiftKey: true }, { key: "V", shiftKey: true }, { key: "v", isComposing: true }, { key: "r" }, { key: "R" },
      { key: "Delete" }, { key: "s" }]) {
      fireEvent.keyDown(list(), event);
    }
    await settle();
    expect(onGesture).not.toHaveBeenCalled();
    expect(here()).toBe(before);
    expect(selected()).toContain("Lavabo céramique");
    expect(onBack).not.toHaveBeenCalled();
    cleanup();
    const reader = open(address({}), { canReview: false });
    await settle();
    fireEvent.keyDown(list(), { key: "v" });
    expect(reader.onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("Un opérateur du métré de l’affaire peut revoir ce poste.");
  });
});

// Review of #485, written before the fixes: the counted marks of an earlier reading read the current answer's over the
// earlier plan; a save that reopens the item's acceptance left its decision shown.
describe("the counted marks of the item", () => {
  it("are read only for the item's current reading: an earlier reading shows none, and the way to the current one", async () => {
    const fetch = vi.fn<(url: RequestInfo | URL) => Promise<Response>>(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    expect(calls.plans[0]?.jobId).toBe(JOB_EARLIER);
    expect(fetch.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("count-marks"))).toEqual([]);
    expect(screen.getByTestId("reperes-lecture-ancienne")).toHaveTextContent("ceux de la lecture actuelle");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la lecture actuelle" }));
    await settle();
    expect(readItemDetailAddress(new URLSearchParams(window.location.search))).toMatchObject({ kind: "detail",
      address: { jobId: basinLine.readings[0]!.answer!.jobId } });
  });

  it("read the item again after a save of its marks, keeping the focus on the marks", async () => {
    const answerId = basinLine.readings[0]!.answer!.answerId;
    const markId = "d0000000-0000-4000-8000-000000000010";
    const viewer = "c0000000-0000-4000-8000-000000000010";
    let revision = 1;
    const summary = () => ({ revision, unit: "u", counted: true, proposed: 0, toAttribute: 0, retained: 1, removed: 0, pending: 0,
      reread: 0, scopePages: 2, verifiedPages: 0, quantity: null, state: "to_check", pages: [] });
    const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        revision += 1;
        return ok({ replayed: false, commandId: markId, revisions: { [answerId]: revision }, added: [], summaries: { [answerId]: summary() } });
      }
      return ok({ answerId, page: 2, revision, geometry: null, total: 1, loaded: 1, nextAfter: null, marks: [{ markId, x: 0.2, y: 0.2,
        box: null, origin: "manual", positionRevision: 0, createdBy: viewer, createdJobId: null, createdAt: "2026-11-22T09:00:00Z",
        movedBy: null, movedAt: null, state: "retained", priorState: null, reasonCode: null, reasonText: null, decidedBy: viewer,
        decidedAt: null, possibleDuplicates: [], others: [], proposals: [] }], summary: summary(), edit: { allowed: true, reason: null },
        viewerId: viewer, names: {} });
    }));
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, page: 2 }));
    await settle();
    const grid = screen.getByTestId("reperes-liste");
    grid.focus();
    fireEvent.keyDown(grid, { key: "p" });
    const linesRead = calls.lines.length;
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    await settle();
    expect(revision).toBe(2);
    expect(calls.lines.length).toBeGreaterThan(linesRead);
    expect(calls.lines.at(-1)).toBe(ITEMS.basin);
  });

  // Closing review of #485, written before the fixes: a save on another item replaced the line read again after the first
  // one's save (only the last item read again was kept); the keyboard fell to the document once « Enregistrer » went; a
  // page was declared verified while its sheet was still drawing.
  const marksRoutes = (viewer: string) => {
    const revisions: Record<string, number> = {};
    const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 });
    const summary = (answerId: string) => ({ revision: revisions[answerId] ?? 1, unit: "u", counted: true, proposed: 0, toAttribute: 0,
      retained: 0, removed: 0, pending: 0, reread: 0, scopePages: 2, verifiedPages: 0, quantity: null, state: "to_check", pages: [] });
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        const answerId = Object.keys((JSON.parse(String(init.body)) as { revisions: Record<string, number> }).revisions)[0]!;
        revisions[answerId] = (revisions[answerId] ?? 1) + 1;
        return ok({ replayed: false, commandId: "d0000000-0000-4000-8000-000000000099", revisions: { [answerId]: revisions[answerId] },
          added: [], summaries: { [answerId]: summary(answerId) } });
      }
      const read = new URL(String(url), "https://app.test");
      const answerId = read.searchParams.get("reponse") ?? "";
      return ok({ answerId, page: Number(read.searchParams.get("page")), revision: revisions[answerId] ?? 1, geometry: null, total: 0,
        loaded: 0, nextAfter: null, marks: [], summary: summary(answerId), edit: { allowed: true, reason: null }, viewerId: viewer, names: {} });
    }));
    return revisions;
  };

  it("keeps each item's line read again after a save of its marks, and the keyboard on the marks once « Enregistrer » goes", async () => {
    const revisions = marksRoutes("c0000000-0000-4000-8000-000000000010");
    const { reader } = open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, page: 2 }));
    // The database reopens the acceptance of an answer whose marks a save changed: its item, read again, is to decide.
    const original = reader.readLine;
    reader.readLine = async (itemId) => {
      const read = await original(itemId);
      return read && { ...read, line: { ...read.line, decision: "pending" as const,
        readings: read.line.readings.map((value) => ({ ...value, decision: null })) } };
    };
    await settle();
    expect(evidence().queryAllByText(/^Accepté/).length).toBeGreaterThan(0);
    const verifyAndSave = async () => {
      fireEvent.keyDown(screen.getByTestId("reperes-liste"), { key: "p" });
      const save = screen.getByRole("button", { name: "Enregistrer (1)" });
      save.focus();
      fireEvent.click(save);
      await settle();
    };
    await verifyAndSave();
    expect(revisions[basinLine.readings[0]!.answer!.answerId]).toBe(2);
    expect(evidence().queryAllByText(/^Accepté/)).toEqual([]);
    expect(document.activeElement).toBe(screen.getByTestId("reperes-liste"));
    // Another item, saved too; then back to the first one: its line read again after its save stands.
    fireEvent.click(within(list()).getByRole("option", { name: /Siphon de sol/ }));
    await settle();
    await verifyAndSave();
    expect(revisions[notFoundLine.readings[0]!.answer!.answerId]).toBe(2);
    fireEvent.click(within(list()).getAllByRole("option", { name: /Lavabo céramique/ })[0]!);
    await settle();
    expect(evidence().queryAllByText(/^Accepté/)).toEqual([]);
  });

  it("declares a page verified only once its sheet is drawn, never while it is still drawing", async () => {
    marksRoutes("c0000000-0000-4000-8000-000000000010");
    heldRenders.add(attested(JOB_RDC, COPY_RDC));
    open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, page: 2 }));
    await settle();
    expect(screen.getByLabelText("Rendu du plan")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("reperes-liste"), { key: "p" });
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Le plan de cette page n’est pas encore dessiné");
  });
});

// Review of #483, first independent review (its cases, written before the fixes and kept as written; the reading of
// JOB_EARLIER is said to be the other item's alone).
describe("TakeoffItemDetail, review of #483", () => {
  it("refuses a job which measured only another item on the same already-read plan", async () => {
    const readings = DETAIL_READINGS.map((r) => r.itemId === ITEMS.notFound && r.answer ? { ...r, answer: { ...r.answer, jobId: JOB_EARLIER } } : r);
    open(address({ itemId: ITEMS.basin, jobId: JOB_EARLIER, planKey: PLAN_RDC }), { readings, earlier: [] });
    await settle();
    expect(screen.queryByText(MISMATCH) !== null).toBe(true);
    expect(screen.queryByRole("complementary", { name: "Preuve et décisions du poste" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Décider du poste" })).toBeNull();
  });

  it("withdraws after the next page of a queue refuses the read", async () => {
    const { reader, onRefused } = open(address({ itemId: ITEMS.basin }), { limit: 1 });
    await settle();
    const original = reader.readQueue;
    reader.readQueue = async (r) => { if (r.kind === "page") throw new TakeoffApiError("Accès refusé", 403, null, "FORBIDDEN"); return original(r); };
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("returns on Escape once Enter has moved focus to evidence", async () => {
    const { onBack } = open(address({}));
    await settle();
    fireEvent.keyDown(list(), { key: "Enter" });
    await settle();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // One rule offers a gesture, read by the buttons and the keys: none under an earlier reading.
  it("asks for no gesture by key under an earlier reading, and says why", async () => {
    const { onGesture } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    for (const key of ["v", "e", "F2", "3"]) fireEvent.keyDown(list(), { key });
    expect(onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("Les décisions portent sur la lecture actuelle de ce plan.");
  });
});
