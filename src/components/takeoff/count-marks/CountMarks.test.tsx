import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The counted marks of an item on its plan (lot 5): the layer, the accessible list, the count and the corrections, on
// fictional marks served by a reader double. Ways they could mislead, written with the screen:
// - machine marks alone shown as a count, or a last mark removed shown as « 0 »;
// - a gesture beside a retained mark sent without the member's word, or decided by the screen;
// - a stale revision losing the gestures typed, or saving them on a revision the member did not see;
// - the focus lost by a reload; a key acting in a field, with a modifier, or for a member who may only read;
// - a refused read leaving the marks on screen;
// - every mark of a large page drawn, or the number loaded shown as the total;
// - a mark placed by the keyboard at another point than the one shown, or on a new page without its geometry.

import { CountMarksLayer } from "@/components/takeoff/count-marks/CountMarksLayer";
import { CountMarksPanel } from "@/components/takeoff/count-marks/CountMarksPanel";
import { CountMarksScope, type CountMarksAnswer, type CountMarksTarget } from "@/components/takeoff/count-marks/CountMarksScope";
import { CountMarksTools } from "@/components/takeoff/count-marks/CountMarksTools";
import type { ItemDetailPageFrame } from "@/components/takeoff/item-detail/ItemDetailPlanPane";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import type { TakeoffCountMark, TakeoffCountMarkSummary } from "@/lib/takeoff/count-marks";
import type { CountMarksReader } from "@/lib/takeoff/count-marks-client";
import type { CountMarksEditRequest, CountMarksView } from "@/lib/takeoff/count-marks-contracts";

const PROJECT = "e0000000-0000-4000-8000-000000000001";
const ANSWER = "a0000000-0000-4000-8000-000000000001";
const OTHER_ANSWER = "a0000000-0000-4000-8000-000000000002";
const OTHER_ITEM = "b0000000-0000-4000-8000-000000000002";
const VIEWER = "c0000000-0000-4000-8000-000000000001";
const JOB = "f0000000-0000-4000-8000-000000000001";
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// A page of 1000 × 500 points: a point of the page is 0.001 across and 0.002 down.
const SIZE = { width: 1000, height: 500 };

const mark = (n: number, values: Partial<TakeoffCountMark> = {}): TakeoffCountMark => ({
  markId: id(n), x: 0.5, y: 0.5, box: null, origin: "machine", positionRevision: 0, createdBy: null, createdJobId: JOB,
  createdAt: "2026-11-22T10:00:00Z", movedBy: null, movedAt: null, state: "proposed", priorState: null, reasonCode: null,
  reasonText: null, decidedBy: null, decidedAt: null, possibleDuplicates: [], others: [], proposals: [], ...values,
});

const summary = (values: Partial<TakeoffCountMarkSummary> = {}): TakeoffCountMarkSummary => ({
  revision: 3, unit: "u", counted: true, proposed: 0, toAttribute: 0, retained: 0, removed: 0, pending: 0, reread: 0,
  scopePages: 2, verifiedPages: 0, quantity: null, state: "to_check", pages: [], ...values,
});

const view = (marks: TakeoffCountMark[], values: Partial<CountMarksView> = {}): CountMarksView => ({
  answerId: ANSWER, page: 7, revision: 3,
  geometry: { version: 1, view_box: [0, 0, 1000, 500], rotation: 0, user_unit: 1, width: 1000, height: 500, plan_file_id: JOB, plan_generation: null },
  total: marks.length, loaded: marks.length, nextAfter: null, marks, summary: summary({ proposed: marks.filter((m) => m.state === "proposed").length,
    retained: marks.filter((m) => m.state === "retained").length }), edit: { allowed: true, reason: null }, viewerId: VIEWER, names: {},
  ...values,
});

type Double = { reader: CountMarksReader; reads: Array<{ answerId: string; page: number; after?: string | null; states?: readonly string[] }>;
  edits: CountMarksEditRequest[]; next: CountMarksView[]; edit: (command: CountMarksEditRequest) => Promise<unknown>;
  /** A read held until it is released: what the screen shows while the marks are read again. */
  hold: Promise<void> | null };

function double(first: CountMarksView, options: { readError?: unknown } = {}): Double {
  const state: Double = {
    reads: [], edits: [], next: [], hold: null,
    edit: async () => ({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} }),
    reader: null as unknown as CountMarksReader,
  };
  let current = first;
  state.reader = {
    readPage: vi.fn(async (input) => {
      state.reads.push(input);
      if (state.hold) await state.hold;
      if (options.readError) throw options.readError;
      if (input.states?.includes("removed")) return { ...current, marks: current.marks.filter((m) => m.state === "removed") };
      if (input.answerId !== ANSWER) return view([], { answerId: input.answerId, revision: 11 });
      // The lot after a cursor: the rest of the page, here empty.
      if (input.after) return { ...current, marks: [], loaded: 0, nextAfter: null };
      if (state.next.length) current = state.next.shift()!;
      return current;
    }) as CountMarksReader["readPage"],
    edit: vi.fn(async (command: CountMarksEditRequest) => {
      state.edits.push(command);
      return state.edit(command);
    }) as CountMarksReader["edit"],
    readHistory: vi.fn(async () => ({ answerId: ANSWER, events: [], next: null, viewerId: VIEWER, names: {} })) as CountMarksReader["readHistory"],
    // The other items of the reading, read from the server whatever the table shows.
    readTargets: vi.fn(async (input: { answerId: string }) => ({ answerId: input.answerId, targets })) as CountMarksReader["readTargets"],
  };
  return state;
}

const answer: CountMarksAnswer = { answerId: ANSWER, jobId: JOB, scopePages: [2, 7] };
const targets: CountMarksTarget[] = [{ answerId: OTHER_ANSWER, itemId: OTHER_ITEM, label: "Lavabo double", scopePages: [2, 7] }];

function frame(values: Partial<ItemDetailPageFrame> = {}): ItemDetailPageFrame {
  return { page: 7, size: SIZE, geometry: { viewBox: [0, 0, 1000, 500], rotation: 0, userUnit: 1 }, scale: 1, offset: { x: 0, y: 0 },
    frame: { width: 1000, height: 500 }, centre: vi.fn(), painted: true, ...values };
}

function mount(reader: CountMarksReader, options: { page?: number; frame?: ItemDetailPageFrame } = {}) {
  const pageFrame = options.frame ?? frame();
  const result = render(
    <CountMarksScope projectId={PROJECT} answer={answer} page={options.page ?? 7} itemLabels={{ [OTHER_ITEM]: "Lavabo double" }}
      reader={reader}>
      <div><CountMarksTools /><CountMarksLayer frame={pageFrame} /><CountMarksPanel /></div>
    </CountMarksScope>,
  );
  return { ...result, pageFrame };
}

const list = () => screen.getByTestId("reperes-liste");
const key = (target: Element, value: string, more: Record<string, unknown> = {}) => fireEvent.keyDown(target, { key: value, ...more });

beforeEach(() => {
  window.sessionStorage.clear();
  let n = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => `e1000000-0000-4000-8000-${String(++n).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the count", () => {
  it("says machine marks alone are proposed, to check, with no quantity", async () => {
    mount(double(view([mark(1), mark(2, { x: 0.1 })])).reader);
    expect(await screen.findByTestId("reperes-etat")).toHaveTextContent("Repères proposés à vérifier");
    expect(screen.getByTestId("reperes-proposes")).toHaveTextContent("2");
    expect(screen.getByTestId("reperes-quantite")).toHaveTextContent("—");
  });

  it("shows the quantity of a verified scope, and no quantity, never 0, once the last mark is removed", async () => {
    const verified = double(view([mark(1, { state: "retained" })], { summary: summary({ retained: 3, reread: 3, verifiedPages: 2, quantity: 3,
      state: "verified" }) }));
    const { unmount } = mount(verified.reader);
    expect(await screen.findByTestId("reperes-quantite")).toHaveTextContent("3 u");
    expect(screen.getByTestId("reperes-relus")).toHaveTextContent("3");
    unmount();
    mount(double(view([], { summary: summary({ removed: 4, verifiedPages: 2, state: "no_mark_retained" }) })).reader);
    expect(await screen.findByTestId("reperes-etat")).toHaveTextContent("Aucun repère retenu");
    expect(screen.getByTestId("reperes-quantite")).toHaveTextContent("—");
    expect(screen.getByTestId("reperes-quantite")).not.toHaveTextContent("0");
  });
});

describe("the list and its keys", () => {
  it("reaches each mark without a pointer, centres it, and keeps the focus through the reload of a save", async () => {
    const served = double(view([mark(1, { x: 0.2, y: 0.3 }), mark(2, { x: 0.6, y: 0.4 })]));
    const { pageFrame } = mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    served.next.push(view([mark(1, { x: 0.2, y: 0.3, state: "retained" }), mark(2, { x: 0.6, y: 0.4 })], { revision: 4 }));
    grid.focus();
    key(grid, "ArrowDown");
    expect(pageFrame.centre).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0.2, y: 0.3 }));
    expect(grid).toHaveAttribute("aria-activedescendant", `repere-${id(1)}`);
    key(grid, "r");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    expect(screen.getByTestId("reperes-apres")).toHaveTextContent("Après enregistrement : 1 repère retenu, 1 à décider.");
    let release = () => {};
    served.hold = new Promise<void>((resolve) => { release = resolve; });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits).toEqual([{ intentKey: expect.any(String), revisions: { [ANSWER]: 3 },
      gestures: [{ op: "retain", answer_id: ANSWER, mark_id: id(1) }] }]);
    // While the marks are read again, the list stays with the focus.
    expect(screen.getByLabelText("Rechargement des repères")).toBeInTheDocument();
    expect(document.activeElement).toBe(list());
    served.hold = null;
    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId("reperes-session")).toBeNull());
    expect(document.activeElement).toBe(list());
    expect(list()).toHaveAttribute("aria-activedescendant", `repere-${id(1)}`);
  });

  it("stays out of a field, a modifier and a member who may only read", async () => {
    const served = double(view([mark(1)], { edit: { allowed: false, reason: "forbidden" } }));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    expect(screen.getByTestId("reperes-lecture-seule")).toHaveTextContent("Lecture seule : un opérateur du métré de l’affaire peut corriger ces repères.");
    expect(screen.queryByRole("button", { name: "Ajouter un repère" })).toBeNull();
    key(grid, "ArrowDown");
    key(grid, "r", { ctrlKey: true });
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    key(grid, "r");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Un opérateur du métré de l’affaire peut corriger ces repères.");
  });

  it("says a plan already sent is read-only", async () => {
    mount(double(view([mark(1)], { edit: { allowed: false, reason: "sent" } })).reader);
    expect(await screen.findByTestId("reperes-lecture-seule")).toHaveTextContent("Ce plan a déjà été envoyé au devis");
  });

  it("asks the reason of a removal, a note for « Autre motif »", async () => {
    const served = double(view([mark(1)]));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "ArrowDown");
    key(grid, "Delete");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Autre motif" }));
    expect(within(dialog).getByRole("button", { name: "Retirer le repère" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: " posé ailleurs " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer le repère" }));
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("Retrait du repère 1 : autre motif — posé ailleurs");
  });
});

describe("review of #485", () => {
  it("keeps a gesture made while a save is on its way, saved next; a gesture being sent is not changed meanwhile", async () => {
    const served = double(view([mark(1, { x: 0.1 }), mark(2, { x: 0.8 })]));
    let finish = () => {};
    served.edit = () => new Promise((resolve) => {
      finish = () => resolve({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    });
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    key(grid, "End");
    key(grid, "r");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("2 modifications non enregistrées");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("en cours d’enregistrement");
    const sending = within(screen.getByTestId("reperes-session")).getAllByRole("button", { name: "Annuler ce geste" })[0]!;
    expect(sending).toBeDisabled();
    expect(served.edits[0]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(1) }]);
    await act(async () => finish());
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("Retenue du repère 2");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[1]).toMatchObject({ revisions: { [ANSWER]: 4 }, gestures: [{ op: "retain", answer_id: ANSWER, mark_id: id(2) }] });
  });

  it("never shows a page read at two revisions: the member is told, and reads again", async () => {
    const served = double(view([]));
    let n = 0;
    const steady = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => {
      if (n >= 4) return steady(input);
      n += 1;
      return view([mark(n)], { revision: n, nextAfter: n % 2 ? id(n) : null });
    }) as typeof steady;
    mount(served.reader);
    expect(await screen.findByTestId("reperes-changent")).toHaveTextContent("Les repères de ce poste changent pendant leur lecture");
    expect(n).toBe(4);
    expect(screen.queryAllByTestId("repere")).toEqual([]);
    expect(screen.queryByTestId("reperes-liste")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Relire" }));
    expect(await screen.findByTestId("reperes-liste")).toBeInTheDocument();
  });

  it("asks « same object » or « distinct » about each retained mark the database names when it refuses a gesture", async () => {
    const served = double(view([mark(1)]));
    // A retained mark beside the proposal, not among the marks loaded (beyond the lots read).
    served.edit = async () => { throw new TakeoffApiError("x", 409, { gesture: 1, twins: [id(9)], addedKeys: [] },
      "TAKEOFF_MARKS_OBJECT_DUPLICATE"); };
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    const question = await screen.findByTestId("reperes-question-refus");
    expect(within(question).getByRole("button", { name: "Objet distinct" })).toBeInTheDocument();
    served.edit = async () => ({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    fireEvent.click(within(question).getByRole("button", { name: "Même objet qu’un repère retenu hors de la liste chargée" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[1]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(1), object: "same", same_as: id(9) }]);
  });

  it("starts the cross at the centre of the part of the page shown, and gives it the keyboard from the list", async () => {
    // Zoom 4: the frame shows the top-left quarter of the page across and down.
    mount(double(view([mark(1)])).reader, { frame: frame({ scale: 4 }) });
    const grid = await screen.findByTestId("reperes-liste");
    grid.focus();
    key(grid, "n");
    const cross = screen.getByTestId("reperes-reticule");
    expect(parseFloat(cross.style.left)).toBe(12.5);
    expect(parseFloat(cross.style.top)).toBe(12.5);
    expect(document.activeElement).toBe(screen.getByTestId("reperes-calque"));
  });

  it("verifies a page only on its sheet displayed", async () => {
    const served = double(view([mark(1, { state: "retained" })]));
    render(<CountMarksScope projectId={PROJECT} answer={answer} page={7} itemLabels={{}} reader={served.reader}>
      <CountMarksPanel />
    </CountMarksScope>);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "p");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Une page se vérifie sur son plan affiché");
  });

  it("reaches every removed mark, to the last cursor", async () => {
    const served = double(view([]));
    served.reader.readPage = vi.fn(async (input) => (input.states?.includes("removed")
      ? view([mark(input.after ? 2 : 1, { state: "removed", reasonCode: "duplicate" })], { total: 2, nextAfter: input.after ? null : id(1) })
      : view([]))) as CountMarksReader["readPage"];
    mount(served.reader);
    await screen.findByTestId("reperes-liste");
    fireEvent.click(screen.getByRole("checkbox"));
    const removed = await screen.findByTestId("reperes-retires");
    expect(removed).toHaveTextContent("1 autre repère retiré.");
    await act(async () => {
      fireEvent.click(within(removed).getByRole("button", { name: "Afficher la suite" }));
    });
    expect(within(screen.getByTestId("reperes-retires")).getAllByRole("button", { name: "Rétablir" })).toHaveLength(2);
  });

  it("says no mark is retained once the last one is removed, before the page is verified again", async () => {
    mount(double(view([], { summary: summary({ retained: 0, removed: 1, quantity: null, state: "to_verify_again" }) })).reader);
    expect(await screen.findByTestId("reperes-etat")).toHaveTextContent("À vérifier à nouveau · Aucun repère retenu");
    expect(screen.getByTestId("reperes-quantite")).toHaveTextContent("—");
  });

  it("asks for the marks of a newer reading in every lot, and shows them to retain", async () => {
    const served = double(view([mark(1), mark(2, { x: 0.8, state: "pending" })], { nextAfter: id(2) }));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    const lots = vi.mocked(served.reader.readPage).mock.calls.map(([input]) => input).filter((input) => !input.states?.includes("removed"));
    expect(lots.length).toBeGreaterThanOrEqual(2);
    for (const input of lots) expect(input.states).toEqual(["proposed", "to_attribute", "retained", "pending"]);
    expect(within(grid).getByText("Nouvelle lecture à examiner")).toBeInTheDocument();
    key(grid, "End");
    key(grid, "r");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[0]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(2) }]);
  });

  it("never sends the identifier of a mark not saved yet: the same object as an unsaved addition drops the addition", async () => {
    // A proposal at the centre of the page; the member adds a mark on it (distinct), then retains the proposal and says
    // it is the same object as the addition.
    const served = double(view([mark(1, { x: 0.5, y: 0.5 })]));
    mount(served.reader);
    const layer = await screen.findByTestId("reperes-calque");
    key(layer, "n");
    key(layer, "Enter");
    expect(screen.queryByTestId("reperes-question")).toBeNull();
    const grid = list();
    key(grid, "Home");
    expect(grid).toHaveAttribute("aria-activedescendant", `repere-${id(1)}`);
    key(grid, "r");
    const question = await screen.findByTestId("reperes-question");
    fireEvent.click(within(question).getByRole("button", { name: /Même objet que votre ajout non enregistré/ }));
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(JSON.stringify(served.edits)).not.toContain("draft:");
    expect(served.edits[0]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(1) }]);
  });
});

// The closing review of #485, written before the fixes (fictional marks):
// - an addition being sent withdrawn through the « same object » question while its save was on its way;
// - a page declared verified while its sheet was not drawn yet;
// - two retained neighbours the screen had not loaded offered as two identical choices;
// - an addition not saved yet given to another item, its display identifier sent as a mark's;
// - « Afficher la suite » clicked twice appending one lot twice and hiding the last removed mark;
// - one mark both retained on the page and restorable in the removed list, read at two revisions;
// - a mark placed by the keyboard while no part of the page was in the frame.
describe("closing review of #485", () => {
  it("never changes what is being sent, the « same object » question included", async () => {
    const served = double(view([mark(1)]));
    let done = () => {};
    served.edit = () => new Promise((resolve) => {
      done = () => resolve({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    });
    mount(served.reader);
    const layer = await screen.findByTestId("reperes-calque");
    key(layer, "n");
    key(layer, "Enter");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    key(list(), "Home");
    key(list(), "r");
    fireEvent.click(within(await screen.findByTestId("reperes-question")).getByRole("button", { name: /Même objet que votre ajout/ }));
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Ce geste est en cours d’enregistrement");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("en cours d’enregistrement");
    await act(async () => done());
    expect(served.edits).toHaveLength(1);
    expect(served.edits[0]!.gestures).toEqual([expect.objectContaining({ op: "add" })]);
    expect(screen.queryByTestId("reperes-session")).toBeNull();
  });

  it("gives a save's reply to the answer and the member that started it, never to the answer shown since", async () => {
    const served = double(view([mark(1)]));
    let release = () => {};
    served.edit = () => new Promise((resolve) => {
      release = () => resolve({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    });
    const show = (answerId: string) => (
      <CountMarksScope projectId={PROJECT} answer={{ ...answer, answerId }} page={7} itemLabels={{}} reader={served.reader}>
        <CountMarksTools /><CountMarksLayer frame={frame()} /><CountMarksPanel />
      </CountMarksScope>
    );
    const shown = render(show(ANSWER));
    let grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    // The member opens another item's answer while the save is on its way, and verifies its page there.
    shown.rerender(show(OTHER_ANSWER));
    grid = await screen.findByTestId("reperes-liste");
    key(grid, "p");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    const readsOfA = served.reads.filter(({ answerId }) => answerId === ANSWER).length;
    await act(async () => release());
    // What is shown stays the other answer's: its page, its session on its own revision, no word of the save.
    expect(screen.getByTestId("reperes-liste")).toBeInTheDocument();
    expect(screen.queryByText("Chargement des repères…")).toBeNull();
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    expect(screen.queryByTestId("reperes-avis")?.textContent ?? "").not.toContain("enregistrée.");
    const stored = (answerId: string) => window.sessionStorage.getItem(`metre-reperes:${VIEWER}:${answerId}`);
    expect(JSON.parse(stored(OTHER_ANSWER)!)).toMatchObject({ answerId: OTHER_ANSWER, revision: 11 });
    // The saved answer's own session is cleared of what was sent, and its page is not read for a screen that left it.
    expect(stored(ANSWER)).toBeNull();
    expect(served.reads.filter(({ answerId }) => answerId === ANSWER)).toHaveLength(readsOfA);
    shown.rerender(show(ANSWER));
    expect(await screen.findByTestId("reperes-liste")).toBeInTheDocument();
    expect(screen.queryByTestId("reperes-session")).toBeNull();
  });

  it("puts the keyboard where the member continues once « Enregistrer » is gone: the list", async () => {
    const served = double(view([mark(1)]));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    const button = screen.getByRole("button", { name: "Enregistrer (1)" });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).toBeNull();
    expect(document.activeElement).toBe(list());
  });

  // CI of b7e8df9d: the button disabled while its save runs loses the focus (a browser's focus fixup, a blur in jsdom)
  // before the session bar unmounts; the keyboard came back only when the unmount came first.
  it.each([
    { order: "the focus dropped by the disabled button before the bar unmounts", drop: true },
    { order: "the bar unmounting with the focus still on its button", drop: false },
  ])("gives the keyboard back to the list after a save, $order", async ({ drop }) => {
    const served = double(view([mark(1)]));
    let release = () => {};
    served.edit = () => new Promise((resolve) => {
      release = () => resolve({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    });
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    const button = screen.getByRole("button", { name: "Enregistrer (1)" });
    button.focus();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    if (drop) act(() => button.blur());
    await act(async () => release());
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).toBeNull();
    expect(document.activeElement).toBe(list());
  });

  it("declares a page verified only once its sheet is drawn", async () => {
    const served = double(view([mark(1, { state: "retained" })]));
    mount(served.reader, { frame: frame({ painted: false }) });
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "p");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Le plan de cette page n’est pas encore dessiné");
  });

  it("names each retained neighbour of a refusal by its number and its place, loading it if needed, and centres the one chosen", async () => {
    const served = double(view([mark(1)], { nextAfter: id(1), total: 3 }));
    const steady = served.reader.readPage;
    // The two retained neighbours are in the page's next lot, beyond the lots the screen read at first.
    let lotsReadable = false;
    served.reader.readPage = vi.fn(async (input) => {
      if (input.after === id(1) && !input.states?.includes("removed")) {
        if (!lotsReadable) return { ...view([], { total: 3 }), nextAfter: id(1) };
        return view([mark(9, { state: "retained", x: 0.501 }), mark(10, { state: "retained", x: 0.499, y: 0.502 })],
          { total: 3, nextAfter: null });
      }
      return steady(input);
    }) as typeof steady;
    served.edit = async () => { throw new TakeoffApiError("x", 409, { gesture: 1, twins: [id(9), id(10)], addedKeys: [] },
      "TAKEOFF_MARKS_OBJECT_DUPLICATE"); };
    const { pageFrame } = mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    lotsReadable = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    const question = await screen.findByTestId("reperes-question-refus");
    const choices = await within(question).findAllByRole("button", { name: /^Même objet que le repère \d+ \(/ });
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Même objet que le repère 2 (50,1 % × 50,0 %)", "Même objet que le repère 3 (49,9 % × 50,2 %)"]);
    served.edit = async () => ({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    vi.mocked(pageFrame.centre).mockClear();
    fireEvent.focus(choices[1]!);
    expect(pageFrame.centre).toHaveBeenCalledWith(expect.objectContaining({ x: 0.499, y: 0.502 }));
    fireEvent.click(choices[1]!);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[1]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(1), object: "same", same_as: id(10) }]);
  });

  it("never gives an addition not saved yet to another item: it says so, and the save names only marks the database knows", async () => {
    const served = double(view([]));
    mount(served.reader);
    const layer = await screen.findByTestId("reperes-calque");
    key(layer, "n");
    key(layer, "Enter");
    key(list(), "a");
    expect(screen.queryByRole("radio", { name: "Lavabo double" })).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Enregistrez d’abord cet ajout");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    const { countMarksEditRequestSchema } = await import("@/lib/takeoff/count-marks-contracts");
    expect(JSON.stringify(served.edits)).not.toContain("draft:");
    expect(countMarksEditRequestSchema.safeParse(served.edits[0]).success).toBe(true);
  });

  it("reads one lot per cursor, never appends a lot twice, and offers the next lot while a cursor remains", async () => {
    const served = double(view([]));
    let release = () => {};
    const wait = new Promise<void>((resolve) => { release = resolve; });
    served.reader.readPage = vi.fn(async (input) => {
      if (!input.states?.includes("removed")) return view([]);
      if (input.after === id(1)) await wait;
      const n = input.after === id(2) ? 3 : input.after ? 2 : 1;
      return view([mark(n, { state: "removed" })], { total: 3, nextAfter: n < 3 ? id(n) : null });
    }) as CountMarksReader["readPage"];
    mount(served.reader);
    await screen.findByTestId("reperes-liste");
    fireEvent.click(screen.getByRole("checkbox"));
    await screen.findByTestId("reperes-retires");
    const more = screen.getByRole("button", { name: "Afficher la suite" });
    fireEvent.click(more);
    fireEvent.click(more);
    await act(async () => release());
    expect(vi.mocked(served.reader.readPage).mock.calls.filter(([input]) => input.after === id(1))).toHaveLength(1);
    await act(async () => {
      fireEvent.click(within(screen.getByTestId("reperes-retires")).getByRole("button", { name: "Afficher la suite" }));
    });
    expect(within(screen.getByTestId("reperes-retires")).getAllByRole("button", { name: "Rétablir" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Afficher la suite" })).toBeNull();
  });

  it("reads the page and its removed marks at one revision: read again, the member told, the gestures kept", async () => {
    // The page read at revision 3 (mark 1 retained); another member removes it (revision 4) before the removed list is read.
    const served = double(view([mark(1, { state: "retained" }), mark(2, { x: 0.1 })]));
    const steady = served.reader.readPage;
    let removedSince = false;
    served.reader.readPage = vi.fn(async (input) => {
      if (!removedSince) return steady(input);
      const marks = [mark(1, { state: "removed", priorState: "retained", reasonCode: "duplicate" }), mark(2, { x: 0.1 })];
      const at4 = view(marks, { revision: 4, summary: summary({ revision: 4, proposed: 1, removed: 1 }) });
      return input.states?.includes("removed") ? { ...at4, marks: at4.marks.filter((m) => m.state === "removed") }
        : { ...at4, marks: at4.marks.filter((m) => m.state !== "removed") };
    }) as typeof steady;
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "End");
    key(grid, "r");
    removedSince = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    const removed = await screen.findByTestId("reperes-retires");
    expect(within(removed).getAllByRole("button", { name: "Rétablir" })).toHaveLength(1);
    expect(list().querySelector(`#repere-${id(1)}`)).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Votre modification est gardée");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
  });

  it("reads the history at the page's revision: a later event reads the page again", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    let later = false;
    served.reader.readPage = vi.fn(async (input) => (later
      ? view([mark(1, { state: "retained" })], { revision: 4, summary: summary({ revision: 4, retained: 1 }) }) : steady(input))) as typeof steady;
    served.reader.readHistory = vi.fn(async () => {
      later = true;
      return { answerId: ANSWER, viewerId: VIEWER, names: {}, next: null, events: [{ eventId: id(500), revision: 4, ordinal: 1,
        gesture: "retain" as const, markId: id(1), page: 7, before: { state: "proposed" }, after: { state: "retained" }, reasonCode: null,
        reasonText: null, evidence: [], actorKind: "member" as const, actorId: VIEWER, occurredAt: "2026-11-22T11:00:00Z" }] };
    }) as CountMarksReader["readHistory"];
    mount(served.reader);
    await screen.findByTestId("reperes-liste");
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Historique" }));
    });
    expect(await screen.findByTestId("reperes-historique")).toHaveTextContent("révision 4");
    fireEvent.click(screen.getByRole("tab", { name: "Liste" }));
    expect(within(list()).getByText("Retenu")).toBeInTheDocument();
  });

  it("places a mark by the keyboard only on a part of the page in the frame, and says so otherwise", async () => {
    const served = double(view([mark(1, { state: "retained" })]));
    mount(served.reader, { frame: frame({ offset: { x: 1200, y: 0 } }) });
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "n");
    expect(screen.queryByTestId("reperes-reticule")).toBeNull();
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Aucune partie de la page n’est dans le cadre");
    key(grid, "Home");
    key(grid, "m");
    expect(screen.queryByTestId("reperes-reticule")).toBeNull();
    key(screen.getByTestId("reperes-calque"), "Enter");
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).toBeNull();
  });
});

// Follow-ups of #483 and #485 (lot 5), written before the fixes (fictional marks):
// - a mark restored from the removed list was neither drawn nor listed until saved: a restored proposal could not be
//   retained in the same session, and the page could be declared verified with it undecided (the whole save refused);
// - a refusal for a possible duplicate beside the retained marks of a reattribution's target named marks the screen
//   could not load, show or centre.
describe("follow-ups of lot 5", () => {
  /** A page served as the database serves it: the lots in the states asked, the removed marks on demand. */
  function byStates(first: CountMarksView) {
    const served = double(first);
    served.reader.readPage = vi.fn(async (input) => {
      served.reads.push(input);
      const states = input.states ?? ["proposed", "to_attribute", "retained"];
      const marks = first.marks.filter((value) => states.includes(value.state));
      return { ...first, answerId: input.answerId, marks, total: marks.length, loaded: marks.length, nextAfter: null };
    }) as CountMarksReader["readPage"];
    return served;
  }
  const removedProposal = mark(2, { x: 0.3, y: 0.3, state: "removed", priorState: "proposed", reasonCode: "duplicate" });

  it("shows a mark restored from the removed list on the plan and in the list, to retain in the same session", async () => {
    const served = byStates(view([mark(1, { state: "retained" }), removedProposal]));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    expect(within(grid).queryByText("Proposé")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(await screen.findByTestId("reperes-retires")).getByRole("button", { name: "Rétablir" }));
    // Restored, not saved: the proposal is drawn and listed, operable like the others, and nothing says it changed.
    expect(screen.getAllByTestId("repere").find((element) => element.dataset.mark === id(2))).toHaveAttribute("data-state", "proposed");
    expect(list().querySelector(`#repere-${id(2)}`)).not.toBeNull();
    expect(screen.getByTestId("reperes-session")).not.toHaveTextContent("à revoir");
    // The page is not declared verified while it is undecided, and the screen says why.
    key(grid, "p");
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Un repère rétabli reste à décider sur cette page");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    key(grid, "End");
    expect(grid).toHaveAttribute("aria-activedescendant", `repere-${id(2)}`);
    key(grid, "r");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("2 modifications non enregistrées");
    key(grid, "p");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (3)" }));
    });
    expect(served.edits[0]!.gestures).toEqual([{ op: "restore", answer_id: ANSWER, mark_id: id(2) },
      { op: "retain", answer_id: ANSWER, mark_id: id(2) }, { op: "verify", answer_id: ANSWER, pages: [7] }]);
  });

  it("offers every other item of the sealed reading as a destination, whatever the table shows", async () => {
    const served = double(view([mark(1)]));
    const third = { answerId: "a0000000-0000-4000-8000-000000000003", itemId: "b0000000-0000-4000-8000-000000000003",
      label: "Robinet (fictif)", scopePages: [7] };
    served.reader.readTargets = vi.fn(async (input: { answerId: string }) => ({ answerId: input.answerId,
      targets: [...targets, third] })) as CountMarksReader["readTargets"];
    // The detail gives no destination: the screen reads the reading's, once.
    render(<CountMarksScope projectId={PROJECT} answer={answer} page={7} itemLabels={{}} reader={served.reader}>
      <CountMarksTools /><CountMarksLayer frame={frame()} /><CountMarksPanel />
    </CountMarksScope>);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "a");
    expect(await screen.findByRole("radio", { name: "Robinet (fictif)" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Lavabo double" })).toBeInTheDocument();
    expect(served.reader.readTargets).toHaveBeenCalledWith({ answerId: ANSWER });
    fireEvent.click(screen.getByRole("radio", { name: "Robinet (fictif)" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Affecter" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[0]!.gestures).toEqual([{ op: "reattribute", answer_id: ANSWER, mark_id: id(1), to_answer_id: third.answerId }]);
  });

  it("loads, names and centres a duplicate neighbour retained for a reattribution's target, the source's marks kept", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => {
      if (input.answerId !== OTHER_ANSWER) return steady(input);
      served.reads.push(input);
      const marks = input.states?.includes("retained") ? [mark(20, { state: "retained", x: 0.501 })] : [];
      return view(marks, { answerId: OTHER_ANSWER, revision: 11 });
    }) as typeof steady;
    // The target already retains a mark beside the one given to it: the database names it.
    served.edit = async () => { throw new TakeoffApiError("x", 409, { gesture: 1, twins: [id(20)], addedKeys: [] },
      "TAKEOFF_MARKS_OBJECT_DUPLICATE"); };
    const { pageFrame } = mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "a");
    fireEvent.click(await screen.findByRole("radio", { name: "Lavabo double" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Affecter" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    const question = await screen.findByTestId("reperes-question-refus");
    const choice = await within(question).findByRole("button",
      { name: "Même objet que le repère retenu de « Lavabo double » (50,1 % × 50,0 %) : ne pas affecter" });
    expect(served.reads).toContainEqual(expect.objectContaining({ answerId: OTHER_ANSWER, page: 7, states: ["retained"] }));
    vi.mocked(pageFrame.centre).mockClear();
    fireEvent.focus(choice);
    expect(pageFrame.centre).toHaveBeenCalledWith(expect.objectContaining({ x: 0.501, y: 0.5 }));
    fireEvent.click(choice);
    // The reattribution is withdrawn; the source's mark stays listed, as it was.
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(list().querySelector(`#repere-${id(1)}`)).not.toBeNull();
  });

  it("withdraws the marks at once when a read of this screen is refused for the right, whatever answer is shown", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    let refuse: (error: unknown) => void = () => undefined;
    let first = true;
    served.reader.readPage = vi.fn(async (input) => {
      if (input.answerId === ANSWER && first) {
        first = false;
        return new Promise((_, reject) => { refuse = reject; });
      }
      return steady(input);
    }) as typeof steady;
    const show = (answerId: string, project = PROJECT) => (
      <CountMarksScope projectId={project} answer={{ ...answer, answerId }} page={7} itemLabels={{}} reader={served.reader}>
        <CountMarksTools /><CountMarksLayer frame={frame()} /><CountMarksPanel />
      </CountMarksScope>
    );
    const shown = render(show(ANSWER));
    shown.rerender(show(OTHER_ANSWER));
    expect(await screen.findByTestId("reperes-liste")).toBeInTheDocument();
    await act(async () => refuse(new TakeoffApiError("Accès refusé.", 403, null, "FORBIDDEN")));
    expect(screen.getByTestId("reperes-refus")).toBeInTheDocument();
    expect(screen.queryByTestId("reperes-liste")).toBeNull();
  });

  it("discards a refusal of the right for a previous scope", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    let refuse: (error: unknown) => void = () => undefined;
    let first = true;
    served.reader.readPage = vi.fn(async (input) => {
      if (first) {
        first = false;
        return new Promise((_, reject) => { refuse = reject; });
      }
      return steady(input);
    }) as typeof steady;
    const show = (project: string) => (
      <CountMarksScope projectId={project} answer={answer} page={7} itemLabels={{}} reader={served.reader}>
        <CountMarksPanel />
      </CountMarksScope>
    );
    const shown = render(show(PROJECT));
    shown.rerender(show("e0000000-0000-4000-8000-000000000002"));
    expect(await screen.findByTestId("reperes-liste")).toBeInTheDocument();
    await act(async () => refuse(new TakeoffApiError("Accès refusé.", 403, null, "FORBIDDEN")));
    expect(screen.getByTestId("reperes-liste")).toBeInTheDocument();
  });

  it("refuses to restore a proposal on a page the session declares verified, and says so", async () => {
    const served = byStates(view([mark(1, { state: "retained" }), removedProposal]));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "p");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(await screen.findByTestId("reperes-retires")).getByRole("button", { name: "Rétablir" }));
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("La page 7 est déclarée vérifiée dans vos modifications");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
  });
});

// The independent reading of #496, written before the fixes (fictional marks):
// - a refusal of the right on a target's revision read during a rebase was swallowed, the marks left as they were;
// - a save refused for a lost session, then a read that failed, left the old marks and « Enregistrer » enabled; a 403
//   left editing on;
// - a reattribution offered an item the command always refuses (another unit, a page it did not read);
// - an earlier reading drew a decision the tab's session had staged, never saved;
// - undoing a retain left its page's verification, and the command refused the whole batch;
// - the duplicate question read the target's page shown, not the gesture's; mixed two revisions; inspected one mark.
describe("review of #496", () => {
  const refused = (status: number) => new TakeoffApiError("Refus", status, null, status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
  function show(reader: CountMarksReader, values: { page?: number; frame?: ItemDetailPageFrame; readOnly?: boolean;
    onRefused?: (caught: unknown) => boolean; showPage?: (page: number) => void } = {}) {
    return (
      <CountMarksScope projectId={PROJECT} answer={answer} page={values.page ?? 7} itemLabels={{}} reader={reader}
        readOnly={values.readOnly} onRefused={values.onRefused} showPage={values.showPage}>
        <CountMarksTools /><CountMarksLayer frame={values.frame ?? frame({ page: values.page ?? 7 })} /><CountMarksPanel />
      </CountMarksScope>
    );
  }

  it("withdraws the marks and tells the detail when a rebase's read of a target is refused for the right", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => {
      if (input.answerId === OTHER_ANSWER && served.edits.length) throw refused(403);
      return steady(input);
    }) as typeof steady;
    served.edit = async () => { throw new TakeoffApiError("x", 409, null, "TAKEOFF_MARKS_REVISION_CONFLICT"); };
    const onRefused = vi.fn(() => true);
    render(show(served.reader, { onRefused }));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "a");
    fireEvent.click(await screen.findByRole("radio", { name: "Lavabo double" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Affecter" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(screen.getByTestId("reperes-refus")).toBeInTheDocument();
    expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });

  it("withdraws at once a save refused for a lost session, whatever the read after it answers", async () => {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => {
      if (served.edits.length) throw new TakeoffApiError("Hors ligne", 0, null, null);
      return steady(input);
    }) as typeof steady;
    served.edit = async () => { throw refused(401); };
    const onRefused = vi.fn(() => true);
    render(show(served.reader, { onRefused }));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(screen.getByTestId("reperes-refus")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).toBeNull();
    expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it("stops editing at once a save refused 403, the read after it deciding only what may still be seen", async () => {
    const served = double(view([mark(1), mark(2, { x: 0.1 })]));
    served.edit = async () => { throw refused(403); };
    render(show(served.reader));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    // The read after it still allows editing (the edit's own check refused): no gesture is offered nonetheless.
    expect(screen.getByTestId("reperes-liste")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer (1)" })).toBeDisabled();
    key(list(), "End");
    key(list(), "r");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("1 modification non enregistrée");
  });

  it("offers as a destination only an item the command accepts for that mark: one whose answer read its page", async () => {
    const served = double(view([mark(1)]));
    served.reader.readTargets = vi.fn(async (input: { answerId: string }) => ({ answerId: input.answerId, targets: [
      { answerId: OTHER_ANSWER, itemId: OTHER_ITEM, label: "Lavabo double", scopePages: [7] },
      { answerId: "a0000000-0000-4000-8000-000000000003", itemId: "b0000000-0000-4000-8000-000000000003",
        label: "Robinet (fictif)", scopePages: [2] },
    ] })) as CountMarksReader["readTargets"];
    render(show(served.reader));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "a");
    expect(await screen.findByRole("radio", { name: "Lavabo double" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Robinet (fictif)" })).toBeNull();
  });

  it("draws an earlier reading from the server alone, the tab's staged decision kept apart, untouched", async () => {
    const served = double(view([mark(1)]));
    const before = render(show(served.reader));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "r");
    const stored = window.sessionStorage.getItem(`metre-reperes:${VIEWER}:${ANSWER}`);
    expect(stored).toContain("retain");
    before.unmount();
    render(show(served.reader, { readOnly: true }));
    await screen.findByTestId("reperes-liste");
    expect(screen.getByTestId("repere")).toHaveAttribute("data-state", "proposed");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(window.sessionStorage.getItem(`metre-reperes:${VIEWER}:${ANSWER}`)).toBe(stored);
  });

  it("takes a page's verification away with the undone gesture that leaves it undecided, and says so", async () => {
    const removedProposal = mark(2, { x: 0.3, y: 0.3, state: "removed", priorState: "proposed", reasonCode: "duplicate" });
    const first = view([mark(1, { state: "retained" }), removedProposal]);
    const served = double(first);
    served.reader.readPage = vi.fn(async (input) => {
      const states = input.states ?? ["proposed", "to_attribute", "retained"];
      const marks = first.marks.filter((value) => states.includes(value.state));
      return { ...first, marks, total: marks.length, loaded: marks.length };
    }) as CountMarksReader["readPage"];
    render(show(served.reader));
    const grid = await screen.findByTestId("reperes-liste");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(within(await screen.findByTestId("reperes-retires")).getByRole("button", { name: "Rétablir" }));
    key(grid, "End");
    key(grid, "r");
    key(grid, "p");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("3 modifications non enregistrées");
    // « Annuler ce geste » on the retain: the restored proposal is undecided again, the page's verification goes with it.
    fireEvent.click(within(screen.getByTestId("reperes-session")).getAllByRole("button", { name: "Annuler ce geste" })[1]!);
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("La déclaration de la page 7 vérifiée est retirée");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[0]!.gestures).toEqual([{ op: "restore", answer_id: ANSWER, mark_id: id(2) }]);
  });

  /** A reattribution staged on page 7, refused beside the target's retained marks named by the database. */
  async function refusedReattribution(options: { twins: string[]; lots: (input: { after?: string | null }) => CountMarksView;
    savedFrom?: number; showPage?: (page: number) => void }) {
    const served = double(view([mark(1)]));
    const steady = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => {
      if (input.answerId !== OTHER_ANSWER) return steady(input);
      served.reads.push(input);
      return input.states?.includes("retained") ? options.lots(input) : view([], { answerId: OTHER_ANSWER, revision: 11 });
    }) as typeof steady;
    served.edit = async () => { throw new TakeoffApiError("x", 409, { gesture: 1, twins: options.twins, addedKeys: [] },
      "TAKEOFF_MARKS_OBJECT_DUPLICATE"); };
    const frame7 = frame({ page: 7 });
    const shown = render(show(served.reader, { frame: frame7, showPage: options.showPage }));
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "Home");
    key(grid, "a");
    fireEvent.click(await screen.findByRole("radio", { name: "Lavabo double" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Affecter" }));
    });
    let current = frame7;
    if (options.savedFrom) {
      current = frame({ page: options.savedFrom });
      shown.rerender(show(served.reader, { page: options.savedFrom, frame: current, showPage: options.showPage }));
      await screen.findByTestId("reperes-liste");
    }
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    return { served, shown, question: await screen.findByTestId("reperes-question-refus"), frame: current, frame7 };
  }

  it("reads the target's neighbours on the refused gesture's page, and shows that sheet before centring one", async () => {
    const showPage = vi.fn();
    const { served, shown, frame7 } = await refusedReattribution({ twins: [id(20)], savedFrom: 2, showPage,
      lots: () => view([mark(20, { state: "retained", x: 0.501 })], { answerId: OTHER_ANSWER, page: 7, revision: 11 }) });
    expect(served.reads.filter((input) => input.answerId === OTHER_ANSWER && input.states?.includes("retained"))
      .map((input) => input.page)).toEqual([7]);
    const choice = await within(screen.getByTestId("reperes-question-refus")).findByRole("button",
      { name: /^Voir le repère retenu de « Lavabo double » \(50,1 % × 50,0 %\), page 7/ });
    fireEvent.click(choice);
    expect(showPage).toHaveBeenCalledWith(7);
    // The sheet of page 7 drawn, the neighbour is centred on it.
    shown.rerender(show(served.reader, { page: 7, frame: frame7, showPage }));
    await screen.findByTestId("reperes-liste");
    expect(frame7.centre).toHaveBeenCalledWith(expect.objectContaining({ x: 0.501, y: 0.5 }));
  });

  it("reads the target's neighbours at one revision, never two lots of two revisions in one question", async () => {
    let reads = 0;
    const { served } = await refusedReattribution({ twins: [id(20), id(21)], lots: (input) => {
      reads += 1;
      // The first attempt crosses a revision between its lots; the second reads both at revision 12.
      if (reads === 1) return view([mark(20, { state: "retained", x: 0.501 })], { answerId: OTHER_ANSWER, revision: 11, nextAfter: id(20) });
      if (reads === 2) return view([mark(21, { state: "retained", x: 0.502 })], { answerId: OTHER_ANSWER, revision: 12 });
      return input.after ? view([mark(21, { state: "retained", x: 0.503 })], { answerId: OTHER_ANSWER, revision: 12 })
        : view([mark(20, { state: "retained", x: 0.504 })], { answerId: OTHER_ANSWER, revision: 12, nextAfter: id(20) });
    } });
    const question = await screen.findByTestId("reperes-question-refus");
    expect(await within(question).findByRole("button", { name: /^Voir .*50,4 %/ })).toBeInTheDocument();
    expect(within(question).getByRole("button", { name: /^Voir .*50,3 %/ })).toBeInTheDocument();
    expect(question.textContent).not.toMatch(/50,1 %|50,2 %/);
    expect(served.reads.filter((input) => input.answerId === OTHER_ANSWER && input.states?.includes("retained"))).toHaveLength(4);
  });

  it("lets the member inspect every neighbour named, the second one included", async () => {
    await refusedReattribution({ twins: [id(20), id(21)],
      lots: () => view([mark(20, { state: "retained", x: 0.501 }), mark(21, { state: "retained", x: 0.502 })],
        { answerId: OTHER_ANSWER, revision: 11 }) });
    const question = await screen.findByTestId("reperes-question-refus");
    expect(await within(question).findByRole("button", { name: /^Voir .*50,1 %/ })).toBeInTheDocument();
    expect(within(question).getByRole("button", { name: /^Voir .*50,2 %/ })).toBeInTheDocument();
  });
});

describe("one object or two", () => {
  it("asks the member's word beside a retained mark, and sends it", async () => {
    // Mark 2 is 3 points across from the retained mark 1.
    const served = double(view([mark(1, { state: "retained" }), mark(2, { x: 0.503 })]));
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "ArrowDown");
    key(grid, "ArrowDown");
    key(grid, "r");
    const question = await screen.findByTestId("reperes-question");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
    expect(within(question).getByRole("button", { name: "Même objet que le repère 1" })).toBeInTheDocument();
    fireEvent.click(within(question).getByRole("button", { name: "Objet distinct" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits[0]!.gestures).toEqual([{ op: "retain", answer_id: ANSWER, mark_id: id(2), object: "distinct" }]);
  });

  it("asks it again when the database finds a neighbour the screen did not hold, never answering by itself", async () => {
    const served = double(view([mark(1)]));
    served.edit = async () => { throw new TakeoffApiError("texte de la base", 409, null, "TAKEOFF_MARKS_OBJECT_DUPLICATE"); };
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "ArrowDown");
    key(grid, "r");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(screen.getByTestId("reperes-avis")).toHaveTextContent("Un repère retenu pour ce poste est tout proche");
    expect(screen.getByTestId("reperes-avis")).not.toHaveTextContent("texte de la base");
    served.edit = async () => ({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 4 }, added: [], summaries: {} });
    fireEvent.click(screen.getByRole("button", { name: "Objet distinct" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits.map((command) => command.gestures[0])).toEqual([
      { op: "retain", answer_id: ANSWER, mark_id: id(1) }, { op: "retain", answer_id: ANSWER, mark_id: id(1), object: "distinct" }]);
    expect(served.edits[0]!.intentKey).not.toBe(served.edits[1]!.intentKey);
  });
});

describe("a stale revision", () => {
  it("reads the marks again, says what changed and keeps every gesture, saved again on the revision read", async () => {
    const served = double(view([mark(1), mark(2, { x: 0.1 })]));
    served.edit = async () => { throw new TakeoffApiError("x", 409, null, "TAKEOFF_MARKS_REVISION_CONFLICT"); };
    mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    grid.focus();
    key(grid, "ArrowDown");
    key(grid, "Delete");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Doublon" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Retirer le repère" }));
    // Another member added a mark meanwhile.
    served.next.push(view([mark(1), mark(2, { x: 0.1 }), mark(3, { x: 0.9, state: "retained", origin: "manual" })], { revision: 5 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(await screen.findByTestId("reperes-avis")).toHaveTextContent("Les repères ont changé depuis leur affichage : 1 ajouté. "
      + "Votre modification est gardée : vérifiez-les puis enregistrez de nouveau.");
    expect(screen.getByTestId("reperes-session")).toHaveTextContent("Retrait du repère 1 : doublon");
    // The removal's dialog gave the focus back to the list; the reload kept it there.
    expect(document.activeElement).toBe(list());
    served.edit = async () => ({ replayed: false, commandId: id(900), revisions: { [ANSWER]: 6 }, added: [], summaries: {} });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    expect(served.edits.map(({ revisions }) => revisions)).toEqual([{ [ANSWER]: 3 }, { [ANSWER]: 5 }]);
    expect(served.edits[1]!.gestures).toEqual(served.edits[0]!.gestures);
  });

  it("finds the gestures typed again after the detail is opened again in the same tab", async () => {
    const served = double(view([mark(1)]));
    const { unmount } = mount(served.reader);
    const grid = await screen.findByTestId("reperes-liste");
    key(grid, "ArrowDown");
    key(grid, "r");
    unmount();
    mount(served.reader);
    expect(await screen.findByTestId("reperes-session")).toHaveTextContent("Retenue du repère 1");
  });
});

describe("a refused read", () => {
  it("withdraws the layer, the list and the history", async () => {
    mount(double(view([mark(1)]), { readError: new TakeoffApiError("Accès refusé", 403, null, null) }).reader);
    expect(await screen.findByTestId("reperes-refus")).toHaveTextContent("Les repères de ce poste ne vous sont pas accessibles.");
    expect(screen.queryByTestId("reperes-liste")).toBeNull();
    expect(screen.queryByTestId("reperes-calque")).toBeNull();
    expect(screen.queryByRole("button", { name: "Repères du poste" })).toBeNull();
  });

  it("reads nothing for a page the answer did not read", async () => {
    const served = double(view([mark(1)]));
    mount(served.reader, { page: 5, frame: frame({ page: 5 }) });
    expect(await screen.findByText(/La page 5 n’a pas été lue pour ce poste/)).toBeInTheDocument();
    expect(served.reads).toEqual([]);
  });
});

describe("the layer", () => {
  it("draws only the marks of the part of the page shown, and says the server's total apart from the number loaded", async () => {
    const marks = [mark(1, { x: 0.1, y: 0.1 }), mark(2, { x: 0.9, y: 0.9 }), mark(3, { x: 0.3, y: 0.2, state: "removed" })];
    // Zoom 2, the frame shows the top-left quarter of the page.
    const served = double(view(marks, { total: 1500, nextAfter: id(3) }));
    // A page of 1,500 marks: every lot after the first has more after it.
    const first = served.reader.readPage;
    served.reader.readPage = vi.fn(async (input) => (input.after ? { ...(await first({ ...input, after: null })), marks: [], loaded: 0 }
      : first(input))) as typeof first;
    mount(served.reader,
      { frame: frame({ scale: 2, frame: { width: 1000, height: 500 } }) });
    const layer = await screen.findByTestId("reperes-calque");
    expect(within(layer).getAllByTestId("repere").map((element) => element.getAttribute("data-mark"))).toEqual([id(1)]);
    expect(screen.getByTestId("reperes-charges")).toHaveTextContent("Page 7 : 3 chargés sur 1500 au total");
    // Five lots read without asking, the rest on demand.
    expect(vi.mocked(served.reader.readPage).mock.calls.filter(([input]) => input.after)).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Charger la suite" })).toBeInTheDocument();
  });

  it("places a mark by the keyboard one point at a time, with the page's geometry on its first mark", async () => {
    const served = double(view([], { geometry: null }));
    mount(served.reader);
    const layer = await screen.findByTestId("reperes-calque");
    layer.focus();
    key(layer, "n");
    expect(layer).toHaveAttribute("data-mode", "add");
    key(layer, "ArrowRight");
    key(layer, "ArrowDown", { shiftKey: true });
    key(layer, "Enter");
    expect(layer).toHaveAttribute("data-mode", "idle");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer (1)" }));
    });
    const [gesture] = served.edits[0]!.gestures;
    expect(gesture).toMatchObject({ op: "add", answer_id: ANSWER, page: 7, x: 0.501, y: 0.52,
      geometry: { version: 1, view_box: [0, 0, 1000, 500], rotation: 0, user_unit: 1, width: 1000, height: 500 } });
  });

  it("leaves the pointing mode with Escape, placing nothing", async () => {
    mount(double(view([])).reader);
    const layer = await screen.findByTestId("reperes-calque");
    key(layer, "n");
    key(layer, "Escape");
    expect(layer).toHaveAttribute("data-mode", "idle");
    expect(screen.queryByTestId("reperes-session")).toBeNull();
  });
});
