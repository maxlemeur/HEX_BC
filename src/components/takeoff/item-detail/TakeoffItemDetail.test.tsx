import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The second depth of the review (lot 5): the detail of an item on its plan, on fictional lines shaped by lot 4's read
// contract. Ways it could mislead, written with the screen:
// - an answer without a quantity drawn with a point, or without the pages searched;
// - an item never measured shown without its plan, or a scanned plan (no vector page) not drawn;
// - a move between items adding a history entry, losing its place across a page of the table, or a poll moving it;
// - the way back losing the table's filter, page or the item in focus;
// - a key acting in a field, with a modifier, or a gesture applied where the server would not, or a key that spends;
// - an old bookmark of an earlier reading showing the current reading's evidence over the earlier plan;
// - an item outside the filter (a radar link) refused, or an item foreign to the list shown.
// Review of PR 2, written before the fixes:
// - a new reader (another member) kept the previous member's queue, names and gestures;
// - a dossier copy resolved once kept as current, and an absence kept;
// - « verified » said of bytes never served, or of a reading that never ran;
// - « Page suivante » and an observation wrote an address the detail refused;
// - a plan, answer or observation of another item opened as this item's;
// - Escape undone by a move still waiting for the next page;
// - Shift + ↓ moved the item; Enter focused a panel still folded;
// - a page change opened the PDF a second time.
// pdfjs is replaced by documents of nine pages; the reader by fixtures (item-detail.test-fixtures.ts).

const { getDocument, loads, destroyed } = vi.hoisted(() => ({ getDocument: vi.fn(), loads: [] as string[], destroyed: [] as string[] }));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));

import { TakeoffItemDetail, type ItemDetailGestureRequest } from "@/components/takeoff/item-detail/TakeoffItemDetail";
import { readItemDetailAddress, type ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import type { ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import {
  DETAIL_PROJECT, ITEMS, JOB_EARLIER, JOB_R1, JOB_RDC, JOB_SCAN, PLAN_R1, PLAN_RDC, PLAN_SCAN, basinLine, fixtureItemDetailReader,
  homonymLine, notFoundLine, outsideLine, planViews, scanLine, toMeasureLine,
} from "@/lib/takeoff/item-detail.test-fixtures";

const rendered: Array<{ url: string; page: number }> = [];
const failing = new Set<string>();
/** Bytes whose load never answers during the test (a slow route). */
const held = new Set<string>();
getDocument.mockImplementation(({ url }: { url: string }) => {
  loads.push(url);
  return {
    promise: held.has(url) ? new Promise(() => undefined) : failing.has(url) ? Promise.reject(new Error("Unexpected server response (404).")) : Promise.resolve({
      numPages: 9,
      getPage: (number: number) => (number > 9 ? Promise.reject(new Error("Invalid page request.")) : Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
        render: () => {
          rendered.push({ url, page: number });
          return { promise: Promise.resolve(), cancel: () => undefined };
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
const lines = [basinLine, notFoundLine, toMeasureLine, homonymLine, scanLine];
const attested = (job: string, copy: string) => `/api/takeoff/jobs/${job}/vector-plans/${copy}`;
const COPY_RDC = "51111111-1111-4111-8111-111111111111";

function address(overrides: Partial<ItemDetailAddress>): ItemDetailAddress {
  return { itemId: ITEMS.basin, planKey: null, jobId: null, page: null, source: null, answerId: null, observationId: null,
    versionId: null, ...overrides };
}

/** The page around the detail: it follows the address the detail replaces in place, as the router's search parameters do. */
function Page({ initial, reader, onBack, onGesture }: {
  initial: ItemDetailAddress; reader: ItemDetailReader; onBack: (href: string) => void;
  onGesture?: (request: ItemDetailGestureRequest) => void;
}) {
  const [shown, setShown] = useState(initial);
  return (
    <TakeoffItemDetail projectId={DETAIL_PROJECT} address={shown} reader={reader} tableQuery={TABLE} onBack={onBack} onGesture={onGesture}
      onAddressChange={(href) => {
        const read = readItemDetailAddress(new URL(href, "https://app.test").searchParams);
        if (read.kind === "detail") setShown(read.address);
      }} />
  );
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

function open(initial: ItemDetailAddress, options: Parameters<typeof fixtureItemDetailReader>[0] = { lines }) {
  const { reader, calls } = fixtureItemDetailReader(options);
  const onBack = vi.fn();
  const onGesture = vi.fn();
  const view = render(<Page initial={initial} reader={reader} onBack={onBack} onGesture={onGesture} />);
  return { ...view, reader, calls, onBack, onGesture };
}

const evidence = () => within(screen.getByRole("complementary", { name: "Preuve et décisions du poste" }));
const list = () => screen.getByRole("listbox", { name: "Postes" });
const selected = () => within(list()).getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")?.textContent ?? null;
const here = () => `${window.location.pathname}${window.location.search}`;
const vectorReads = () => (globalThis.fetch as unknown as { mock?: { calls: unknown[][] } }).mock?.calls
  .filter(([url]) => String(url).includes("/vector-pages")).length ?? 0;
/** The view a reload of the current address opens: the address read again, on a new detail. */
function reload(options: Parameters<typeof fixtureItemDetailReader>[0] = { lines }) {
  const read = readItemDetailAddress(new URLSearchParams(window.location.search));
  expect(read.kind).toBe("detail");
  cleanup();
  rendered.length = 0;
  return open((read as { address: ItemDetailAddress }).address, options);
}

beforeEach(() => {
  window.history.replaceState(null, "", `${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}`);
});

afterEach(() => {
  cleanup();
  rendered.length = 0;
  loads.length = 0;
  destroyed.length = 0;
  failing.clear();
  held.clear();
  vi.unstubAllGlobals();
});

describe("TakeoffItemDetail, the states of an item", () => {
  it("opens a measured item without anomaly on its first observation's page, with its evidence and its other plan", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { calls } = open(address({}));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_RDC, jobId: JOB_RDC, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: attested(JOB_RDC, COPY_RDC), page: 2 });
    expect(screen.getByText("Poste 1 sur 5")).toBeTruthy();
    const observations = within(evidence().getByRole("list", { name: "Observations" })).getAllByRole("button").map((item) => item.textContent);
    expect(observations).toEqual([
      "2 u · page 2 · Symbole lavabo, sanitaires hommes · confiance 92 %",
      "1 u · page 7 · Symbole lavabo, local ménage · confiance 88 %",
    ]);
    expect(evidence().getByText(/^Accepté par Camille Martin, le /)).toBeTruthy();
    expect(within(evidence().getByRole("list", { name: "Historique" })).getAllByRole("listitem").map((entry) => entry.textContent?.slice(-40)))
      .toEqual(["Lu sur Plan RDC : Mesuré", "Accepté par Camille Martin"].map((text) => expect.stringContaining(text)));
    const plans = within(evidence().getByRole("list", { name: "Plans du poste" })).getAllByRole("button");
    expect(plans.map((plan) => plan.textContent)).toEqual(["Plan RDC · RDCMesuré", "Plan R+1 · R+1Mesuré"]);
    expect(plans[0]!.getAttribute("aria-current")).toBe("true");
    expect(vectorReads()).toBe(0);
  });

  it("opens an answer without a quantity with the pages searched and no point, on the first page searched", async () => {
    open(address({ itemId: ITEMS.notFound }));
    await settle();
    expect(evidence().getByTestId("poste-detail-not-found").textContent)
      .toBe("Non trouvé sur les pages cherchées : 1, 3, 4. Aucun repère n’est proposé.");
    expect(evidence().queryByRole("list", { name: "Observations" })).toBeNull();
    expect(rendered.at(-1)?.page).toBe(1);
    expect(screen.getByLabelText("Page affichée")).toHaveValue("1");
  });

  it("opens an item never measured on the plan the dossier retains, by its signed address", async () => {
    const { calls } = open(address({ itemId: ITEMS.toMeasure }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_R1, jobId: null, source: null }]);
    expect(loads).toEqual(["https://files.test/dossier/52222222-2222-4222-8222-222222222222.pdf"]);
    expect(evidence().getByText(/À mesurer : aucune analyse n’a encore lu ce poste sur ce plan/)).toBeTruthy();
    expect(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button").textContent).toBe("Plan R+1À mesurer");
  });

  it("draws a scanned plan read without any vector page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { calls } = open(address({ itemId: ITEMS.scan }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_SCAN, jobId: JOB_SCAN, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: attested(JOB_SCAN, "53333333-3333-4333-8333-333333333333"), page: 2 });
    expect(evidence().getByText("Valeur candidate (non mesurée) : 4 u")).toBeTruthy();
    expect(vectorReads()).toBe(0);
  });

  it("names the plan without drawing it when the original is unavailable, and when it is not available to the member", async () => {
    const views = planViews();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, document: { kind: "unavailable", reason: "original_unavailable" } };
    open(address({}), { lines, views });
    await settle();
    expect(screen.getByText("Plan d’origine indisponible : la copie lue par cette analyse n’est plus servie.")).toBeTruthy();
    expect(screen.getByText(/Plan RDC · génération 1 · lu le/)).toBeTruthy();
    expect(loads).toEqual([]);
    cleanup();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, document: { kind: "unavailable", reason: "not_available_to_you" } };
    open(address({}), { lines, views });
    await settle();
    expect(screen.getByText("Ce plan n’est pas accessible avec vos droits.")).toBeTruthy();
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
    open(address({}), { lines, views });
    await settle();
    expect(evidence().queryByText(/lus par cette analyse/)).toBeNull();
    expect(evidence().getByText(/lecture en attente/)).toBeTruthy();
  });

  it("opens an earlier reading of an old bookmark on that reading's plan, never with the current reading's evidence", async () => {
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_RDC, jobId: JOB_EARLIER, source: null }]);
    expect(evidence().getByText(/Lecture antérieure du poste sur ce plan/)).toBeTruthy();
    expect(evidence().queryByRole("list", { name: "Observations" })).toBeNull();
    expect(evidence().queryByText(/Accepté par Camille Martin/)).toBeNull();
    expect(evidence().getByText("Les décisions portent sur la lecture actuelle de ce plan.")).toBeTruthy();
  });

  it("opens nothing for a plan, an answer or an observation that is not this item's", async () => {
    const answer = basinLine.readings[0]!.answer!.answerId;
    for (const named of [
      address({ planKey: PLAN_SCAN }),
      address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: scanLine.readings[0]!.answer!.answerId }),
      address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-r1-1" }),
      address({ source: { documentId: PLAN_SCAN, generation: null } }),
    ]) {
      const { calls } = open(named);
      await settle();
      expect(screen.getByText("Ce lien ne désigne pas une lecture de ce poste.")).toBeTruthy();
      expect(calls.plans).toEqual([]);
      cleanup();
    }
  });

  it("selects the observation an address names, and opens on its page", async () => {
    const answer = basinLine.readings[0]!.answer!.answerId;
    open(address({ planKey: PLAN_RDC, jobId: JOB_RDC, answerId: answer, observationId: "o-rdc-7" }));
    await settle();
    expect(rendered.at(-1)?.page).toBe(7);
    expect(evidence().getByRole("button", { name: /page 7/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens an item outside the filter beside the queue, and says « not found » for an item foreign to the list", async () => {
    open(address({ itemId: ITEMS.outside }), { lines, outside: [outsideLine] });
    await settle();
    expect(selected()).toContain("Clapet coupe-feu");
    expect(screen.getAllByText("Hors du filtre")).toHaveLength(1);
    expect(within(list()).getAllByRole("option").map((option) => option.textContent?.split(/Mesuré|Non trouvé|À mesurer|Incertain/)[0]))
      .toEqual(["Clapet coupe-feu", "Lavabo céramique", "Siphon de sol", "Robinet de puisage", "Lavabo céramique", "WC suspendu"]);
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
    expect(screen.getByText("Poste 4 sur 5")).toBeTruthy();
  });
});

describe("TakeoffItemDetail, one reader, one member", () => {
  it("starts from nothing when its reader changes while it stays shown", async () => {
    const first = fixtureItemDetailReader({ lines });
    const second = fixtureItemDetailReader({ lines: [], canReview: false });
    const onGesture = vi.fn();
    const { rerender } = render(<Page initial={address({})} reader={first.reader} onBack={vi.fn()} onGesture={onGesture} />);
    await settle();
    expect(selected()).toContain("Lavabo céramique");
    rerender(<Page initial={address({})} reader={second.reader} onBack={vi.fn()} onGesture={onGesture} />);
    await settle();
    expect(second.calls.queue).toEqual([{ kind: "focus", itemId: ITEMS.basin }]);
    expect(screen.queryByText("Lavabo céramique")).toBeNull();
    expect(screen.getByText("Ce poste est introuvable dans la liste de l’affaire.")).toBeTruthy();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it("resolves a dossier plan again each time it is opened, never keeping a copy or an absence", async () => {
    const views = planViews();
    const dossierR1 = views[`:${PLAN_R1}`]!;
    views[`:${PLAN_R1}`] = { ...dossierR1, plan: { ...dossierR1.plan, planFileId: null }, document: { kind: "unavailable", reason: "no_current_copy" } };
    const twoPlans = { ...toMeasureLine, remeasurePlans: [PLAN_R1, PLAN_RDC] };
    const { calls } = open(address({ itemId: ITEMS.toMeasure }), { lines: [twoPlans], views });
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
});

describe("TakeoffItemDetail, navigation", () => {
  const many = () => [basinLine, ...Array.from({ length: 4 }, (_, index) => ({ ...toMeasureLine, itemId: ITEMS.extra(index),
    position: index + 1, label: `Poste ajouté ${index + 1}` }))];

  it("moves between items in the frozen order by replacing the address in place, across a page of the table", async () => {
    const length = window.history.length;
    const { calls } = open(address({}), { lines: many(), limit: 2 });
    await settle();
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 1");
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.extra(0)}`);
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 2");
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
    fireEvent.click(evidence().getByRole("button", { name: /page 7/ }));
    await settle();
    const answer = basinLine.readings[0]!.answer!.answerId;
    expect(here()).toBe(`${TAKEOFF}?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_RDC}&lecture=${JOB_RDC}&page=7&reponse=${answer}&observation=o-rdc-7`);
    reload();
    await settle();
    expect(rendered.at(-1)?.page).toBe(7);
  });

  it("comes back to the table with the item shown in focus on the page that holds it", async () => {
    const { onBack } = open(address({ itemId: ITEMS.extra(2) }), { lines: many(), limit: 2 });
    await settle();
    fireEvent.keyDown(list(), { key: "Escape" });
    expect(onBack).toHaveBeenLastCalledWith(
      `${TAKEOFF}?postePlan=&posteState=measured&posteLimit=25&tab=jobs&posteFocus=${ITEMS.extra(2)}&posteOffset=2`);
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("does not reopen an item once Escape was pressed while a move waited for the next page", async () => {
    let release: () => void = () => undefined;
    const holdPages = new Promise<void>((resolve) => { release = resolve; });
    const { onBack } = open(address({ itemId: ITEMS.extra(0) }), { lines: many(), limit: 2, holdPages });
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
    fireEvent.keyDown(list(), { key: "v" });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "accept_measured", line: basinLine, initial: null });
    fireEvent.keyDown(list(), { key: "e" });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "set_aside", line: basinLine, initial: null });
    fireEvent.keyDown(list(), { key: "F2" });
    expect(onGesture).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("« Saisir une quantité » ne s’applique pas à ce poste : ni non trouvé ni incertain.");
    fireEvent.keyDown(list(), { key: "i" });
    expect(onGesture).toHaveBeenCalledTimes(2);
    // A notice belongs to its item: moving on clears it.
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(screen.queryByTestId("poste-detail-notice")).toBeNull();
  });

  it("opens the entry with a digit as its first character where an entry applies, Shift included (AZERTY digits)", async () => {
    const { onGesture } = open(address({ itemId: ITEMS.notFound }));
    await settle();
    fireEvent.keyDown(list(), { key: "7", shiftKey: true });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "enter_quantity", line: notFoundLine, initial: "7" });
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
    const reader = open(address({}), { lines, canReview: false });
    await settle();
    fireEvent.keyDown(list(), { key: "v" });
    expect(reader.onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("Un opérateur du métré de l’affaire peut revoir ce poste.");
  });
});
