import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The second depth of the review (lot 5): the detail of an item on its plan, on fictional lines shaped by lot 4's read
// contract. Ways it could mislead, written with the screen:
// - an answer without a quantity drawn with a point, or without the pages searched;
// - an item never measured shown without its plan, or a scanned plan (no vector page) not drawn;
// - a move between items adding a history entry, losing its place across a page of the table, or a poll moving it;
// - the way back losing the table's filter, page or the item in focus;
// - a key acting in a field, with a modifier, or a gesture applied where the server would not, or a key that spends;
// - an old bookmark of an earlier reading showing the current reading's evidence over the earlier plan;
// - an item outside the filter (a radar link) refused, or an item foreign to the list shown.
// pdfjs is replaced by documents of nine pages; the reader by fixtures (item-detail.test-fixtures.ts).

const { getDocument, loads } = vi.hoisted(() => ({ getDocument: vi.fn(), loads: [] as string[] }));
vi.mock("pdfjs-dist", () => ({ getDocument, GlobalWorkerOptions: {} }));

import { TakeoffItemDetail, type ItemDetailGestureRequest } from "@/components/takeoff/item-detail/TakeoffItemDetail";
import { readItemDetailAddress, type ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import type { ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import {
  DETAIL_PROJECT, ITEMS, JOB_EARLIER, JOB_R1, JOB_RDC, JOB_SCAN, PLAN_R1, PLAN_RDC, PLAN_SCAN, basinLine, fixtureItemDetailReader,
  homonymLine, notFoundLine, outsideLine, planViews, scanLine, toMeasureLine,
} from "@/lib/takeoff/item-detail.test-fixtures";

const rendered: Array<{ url: string; page: number }> = [];
getDocument.mockImplementation(({ url }: { url: string }) => {
  loads.push(url);
  return {
    promise: Promise.resolve({
      numPages: 9,
      getPage: (number: number) => (number > 9 ? Promise.reject(new Error("Invalid page request.")) : Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 1190.55 * scale, height: 841.89 * scale }),
        render: () => {
          rendered.push({ url, page: number });
          return { promise: Promise.resolve(), cancel: () => undefined };
        },
      })),
    }),
    destroy: () => Promise.resolve(),
  };
});

const TABLE = "postePlan=&posteState=measured&posteLimit=25&tab=jobs";
const lines = [basinLine, notFoundLine, toMeasureLine, homonymLine, scanLine];

function address(overrides: Partial<ItemDetailAddress>): ItemDetailAddress {
  return { itemId: ITEMS.basin, planKey: null, jobId: null, page: null, source: null, answerId: null, observationId: null,
    versionId: null, ...overrides };
}

/** The page around the detail: the address is its state, replaced in place by each move. */
function Page({ initial, reader, onBack, onGesture, navigations }: {
  initial: ItemDetailAddress; reader: ItemDetailReader; onBack: (href: string) => void;
  onGesture?: (request: ItemDetailGestureRequest) => void; navigations: string[];
}) {
  const [shown, setShown] = useState(initial);
  return (
    <TakeoffItemDetail projectId={DETAIL_PROJECT} address={shown} reader={reader} tableQuery={TABLE} onBack={onBack} onGesture={onGesture}
      onNavigate={(href) => {
        navigations.push(href);
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
  const navigations: string[] = [];
  const onBack = vi.fn();
  const onGesture = vi.fn();
  const view = render(<Page initial={initial} reader={reader} onBack={onBack} onGesture={onGesture} navigations={navigations} />);
  return { ...view, calls, navigations, onBack, onGesture };
}

const evidence = () => within(screen.getByRole("complementary", { name: "Preuve et décisions du poste" }));
const list = () => screen.getByRole("listbox", { name: "Postes" });
const selected = () => within(list()).getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")?.textContent ?? null;
const vectorReads = () => (globalThis.fetch as unknown as { mock?: { calls: unknown[][] } }).mock?.calls
  .filter(([url]) => String(url).includes("/vector-pages")).length ?? 0;

afterEach(() => {
  cleanup();
  rendered.length = 0;
  loads.length = 0;
  vi.unstubAllGlobals();
});

describe("TakeoffItemDetail, the states of an item", () => {
  it("opens a measured item without anomaly on its first observation's page, with its evidence and its other plan", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { calls } = open(address({}));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_RDC, jobId: JOB_RDC, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: `/api/takeoff/jobs/${JOB_RDC}/vector-plans/51111111-1111-4111-8111-111111111111`, page: 2 });
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

  it("opens an item never measured on the plan the dossier retains, its bytes asked when shown", async () => {
    const { calls } = open(address({ itemId: ITEMS.toMeasure }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_R1, jobId: null, source: null }]);
    expect(calls.dossier).toEqual(["41111111-1111-4111-8111-111111111111/52222222-2222-4222-8222-222222222222"]);
    expect(loads).toEqual(["https://files.test/dossier/52222222-2222-4222-8222-222222222222.pdf"]);
    expect(evidence().getByText(/À mesurer : aucune analyse n’a encore lu ce poste sur ce plan/)).toBeTruthy();
    expect(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button").textContent).toBe("Plan R+1À mesurer");
  });

  it("draws a scanned plan read without any vector page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { calls } = open(address({ itemId: ITEMS.scan }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_SCAN, jobId: JOB_SCAN, source: null }]);
    expect(rendered.at(-1)).toEqual({ url: `/api/takeoff/jobs/${JOB_SCAN}/vector-plans/53333333-3333-4333-8333-333333333333`, page: 2 });
    expect(evidence().getByText("Valeur candidate (non mesurée) : 4 u")).toBeTruthy();
    expect(vectorReads()).toBe(0);
  });

  it("names the plan without drawing it when the original is unavailable", async () => {
    const views = planViews();
    views[`${JOB_RDC}:${PLAN_RDC}`] = { ...views[`${JOB_RDC}:${PLAN_RDC}`]!, document: { kind: "unavailable", reason: "original_unavailable" } };
    open(address({}), { lines, views });
    await settle();
    expect(screen.getByText("Plan d’origine indisponible : la copie lue par cette analyse n’est plus servie.")).toBeTruthy();
    expect(screen.getByText(/Plan RDC · génération 1 · lu le/)).toBeTruthy();
    expect(loads).toEqual([]);
  });

  it("opens an earlier reading of an old bookmark on that reading's plan, never with the current reading's evidence", async () => {
    const { calls } = open(address({ planKey: PLAN_RDC, jobId: JOB_EARLIER, page: 2 }));
    await settle();
    expect(calls.plans).toEqual([{ planKey: PLAN_RDC, jobId: JOB_EARLIER, source: null }]);
    expect(evidence().getByText(/Lecture antérieure du poste sur ce plan/)).toBeTruthy();
    expect(evidence().queryByRole("list", { name: "Observations" })).toBeNull();
    // Nor the current reading's decision as if it were the earlier one's.
    expect(evidence().queryByText(/Accepté par Camille Martin/)).toBeNull();
    expect(evidence().getByText("Les décisions portent sur la lecture actuelle de ce plan.")).toBeTruthy();
  });

  it("opens an item outside the filter beside the queue, and says « not found » for an item foreign to the list", async () => {
    open(address({ itemId: ITEMS.outside }), { lines, outside: [outsideLine] });
    await settle();
    expect(selected()).toContain("Clapet coupe-feu");
    expect(screen.getAllByText("Hors du filtre")).toHaveLength(1);
    // The filtered queue stays beside it, and down leads into it.
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

describe("TakeoffItemDetail, navigation", () => {
  it("moves between items in the frozen order by replacing the address, across a page of the table", async () => {
    const many = [basinLine, ...Array.from({ length: 4 }, (_, index) => ({ ...toMeasureLine, itemId: ITEMS.extra(index), position: index + 1,
      label: `Poste ajouté ${index + 1}` }))];
    const { calls, navigations } = open(address({}), { lines: many, limit: 2 });
    await settle();
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 1");
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    await settle();
    expect(selected()).toContain("Poste ajouté 2");
    expect(calls.queue).toEqual([{ kind: "focus", itemId: ITEMS.basin }, { kind: "page", offset: 2 }]);
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    await settle();
    expect(selected()).toContain("Poste ajouté 1");
    // Each move replaced the address in place (the page around keeps no entry per arrow), the table's parameters kept.
    expect(navigations).toEqual([
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?${TABLE}&poste=${ITEMS.extra(0)}`,
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?${TABLE}&poste=${ITEMS.extra(1)}`,
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?${TABLE}&poste=${ITEMS.extra(0)}`,
    ]);
    // The page already read is not read again.
    expect(calls.queue).toHaveLength(2);
  });

  it("comes back to the table with the item shown in focus on the page that holds it", async () => {
    const many = [basinLine, ...Array.from({ length: 4 }, (_, index) => ({ ...toMeasureLine, itemId: ITEMS.extra(index), position: index + 1,
      label: `Poste ajouté ${index + 1}` }))];
    const { onBack } = open(address({ itemId: ITEMS.extra(2) }), { lines: many, limit: 2 });
    await settle();
    fireEvent.keyDown(list(), { key: "Escape" });
    expect(onBack).toHaveBeenLastCalledWith(
      `/dashboard/affaires/${DETAIL_PROJECT}/takeoff?postePlan=&posteState=measured&posteLimit=25&tab=jobs&posteFocus=${ITEMS.extra(2)}&posteOffset=2`);
    fireEvent.click(screen.getByRole("button", { name: "Revenir aux postes" }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("turns to another plan of the item and to an observation's page through the address", async () => {
    const { navigations } = open(address({}));
    await settle();
    fireEvent.click(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan R\+1/ }));
    await settle();
    expect(navigations.at(-1)).toBe(`/dashboard/affaires/${DETAIL_PROJECT}/takeoff?${TABLE}&poste=${ITEMS.basin}&plan=${PLAN_R1}&lecture=${JOB_R1}`);
    expect(rendered.at(-1)?.page).toBe(1);
    fireEvent.click(within(evidence().getByRole("list", { name: "Plans du poste" })).getByRole("button", { name: /Plan RDC/ }));
    await settle();
    fireEvent.click(evidence().getByRole("button", { name: /page 7/ }));
    await settle();
    expect(navigations.at(-1)).toContain(`&page=7&reponse=`);
    expect(navigations.at(-1)).toContain("&observation=o-rdc-7");
    expect(rendered.at(-1)?.page).toBe(7);
  });

  it("moves the focus to the evidence with Enter", async () => {
    open(address({}));
    await settle();
    expect(document.activeElement).toBe(list());
    fireEvent.keyDown(list(), { key: "Enter" });
    expect(document.activeElement?.textContent).toBe("Lavabo céramique");
  });
});

describe("TakeoffItemDetail, the keyboard of the list", () => {
  it("asks for an eligible gesture, and says why another does not apply, without asking", async () => {
    const { onGesture } = open(address({}));
    await settle();
    fireEvent.keyDown(list(), { key: "v" });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "accept_measured", line: basinLine, initial: null });
    fireEvent.keyDown(list(), { key: "E" });
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

  it("opens the entry with a digit as its first character where an entry applies", async () => {
    const { onGesture } = open(address({ itemId: ITEMS.notFound }));
    await settle();
    fireEvent.keyDown(list(), { key: "7" });
    expect(onGesture).toHaveBeenLastCalledWith({ gesture: "enter_quantity", line: notFoundLine, initial: "7" });
  });

  it("does nothing with a modifier, during a composition, for a member who cannot review, or for a key that would spend", async () => {
    const { onGesture, navigations, onBack } = open(address({}));
    await settle();
    for (const event of [{ key: "v", ctrlKey: true }, { key: "v", metaKey: true }, { key: "ArrowDown", altKey: true },
      { key: "v", isComposing: true }, { key: "r" }, { key: "R" }, { key: "Delete" }, { key: "s" }]) {
      fireEvent.keyDown(list(), event);
    }
    await settle();
    expect(onGesture).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
    cleanup();
    const reader = open(address({}), { lines, canReview: false });
    await settle();
    fireEvent.keyDown(list(), { key: "v" });
    expect(reader.onGesture).not.toHaveBeenCalled();
    expect(screen.getByTestId("poste-detail-notice").textContent).toBe("Un opérateur du métré de l’affaire peut revoir ce poste.");
  });
});
