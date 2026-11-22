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
  };
  return state;
}

const answer: CountMarksAnswer = { answerId: ANSWER, jobId: JOB, scopePages: [2, 7] };
const targets: CountMarksTarget[] = [{ answerId: OTHER_ANSWER, itemId: OTHER_ITEM, label: "Lavabo double" }];

function frame(values: Partial<ItemDetailPageFrame> = {}): ItemDetailPageFrame {
  return { page: 7, size: SIZE, geometry: { viewBox: [0, 0, 1000, 500], rotation: 0, userUnit: 1 }, scale: 1, offset: { x: 0, y: 0 },
    frame: { width: 1000, height: 500 }, centre: vi.fn(), ...values };
}

function mount(reader: CountMarksReader, options: { page?: number; frame?: ItemDetailPageFrame } = {}) {
  const pageFrame = options.frame ?? frame();
  const result = render(
    <CountMarksScope projectId={PROJECT} answer={answer} page={options.page ?? 7} itemLabels={{ [OTHER_ITEM]: "Lavabo double" }}
      targets={targets} reader={reader}>
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
    render(<CountMarksScope projectId={PROJECT} answer={answer} page={7} itemLabels={{}} targets={[]} reader={served.reader}>
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
