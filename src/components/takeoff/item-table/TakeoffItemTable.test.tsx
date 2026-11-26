import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffApiError } from "@/lib/takeoff/client-http";
import {
  FIXTURE_ITEM_PROJECT,
  fixtureAnswer,
  fixtureItemId,
  fixtureItemTable,
  fixturePoste,
  fixtureReading,
  fixtureRemeasurePreview,
} from "@/lib/takeoff/item-table.test-fixtures";
import type { ItemTableResponse } from "@/lib/takeoff/item-table-contracts";

const client = vi.hoisted(() => ({
  fetchItemTable: vi.fn(),
  fetchMeasureReview: vi.fn(),
  fetchFrozenItemSelection: vi.fn(),
  sendItemReviewCommand: vi.fn(),
  previewItemRemeasure: vi.fn(),
  sendItemRemeasure: vi.fn(),
  fetchItemHistory: vi.fn(),
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

import { TakeoffItemTable } from "./TakeoffItemTable";

const RDC = "plan-rdc";
const R1 = "plan-r1";
const ITEMS = [
  fixturePoste(0, "Lavabo"),
  fixturePoste(1, "WC"),
  fixturePoste(2, "Évier"),
  fixturePoste(3, "Baignoire"),
  fixturePoste(4, "Vanne DN32", { sectionPath: ["Plomberie", "Robinetterie"] }),
  fixturePoste(5, "Receveur de douche", { origin: "manual", sectionPath: ["Postes ajoutés"] }),
];

function readings() {
  return [
    fixtureReading(0, RDC, fixtureAnswer("measured", 3)), fixtureReading(0, R1, "running"),
    fixtureReading(1, RDC, fixtureAnswer("measured", 2)), fixtureReading(1, R1, fixtureAnswer("not_found", null)),
    fixtureReading(2, RDC, fixtureAnswer("measured", 1, { anomalies: ["hypothesis"] })),
    fixtureReading(2, R1, fixtureAnswer("not_found", null)),
    fixtureReading(3, RDC, fixtureAnswer("not_found", null)), fixtureReading(3, R1, fixtureAnswer("not_found", null)),
    fixtureReading(4, RDC, fixtureAnswer("uncertain", null, { reasonCode: "QUALIFIER_UNREADABLE", reasonText: "Le diamètre n’est pas lisible." })),
    fixtureReading(4, R1, fixtureAnswer("not_found", null)),
  ];
}

const SCENARIO = readings();
const table = (extra: Partial<Parameters<typeof fixtureItemTable>[0]> = {}) =>
  fixtureItemTable({ items: ITEMS, readings: SCENARIO, ...extra });

function renderTable(props: { signature?: string } = {}) {
  const view = (next: { signature?: string }) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TakeoffItemTable projectId={FIXTURE_ITEM_PROJECT} viewerKey="tenant:member" {...next} />
    </SWRConfig>
  );
  const rendered = render(view(props));
  return { ...rendered, rerenderWith: (next: { signature?: string }) => rendered.rerender(view(next)) };
}

const row = (label: string) => screen.getByRole("row", { name: new RegExp(label) });
const refused = () => new TakeoffApiError("Accès refusé à cette affaire.", 403, null, null);
/** The server's frozen selection of the items asked, from a read of the table. */
const freezeFrom = (response: ItemTableResponse) => async (_project: string, _scope: unknown,
  selection: { kind: string; itemIds?: string[] }) => {
  const lines = response.page.lines.filter(({ itemId }) => selection.kind !== "items" || selection.itemIds?.includes(itemId));
  return { count: lines.length, missing: [], eligible: { accept_measured: 0, set_aside: 0, reinstate: 0, enter_quantity: 0,
    include_entry: 0, remeasure: 0 }, items: lines.map(({ itemId, label, targets }) => ({ itemId, label, target: targets, eligible: [] })) };
};
const readAgain = (item: number, revision: string) => table({ readings: SCENARIO.map((reading) =>
  reading.itemId === fixtureItemId(item) && reading.answer ? { ...reading, answer: { ...reading.answer, revision } } : reading) });
const tick = (label: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Sélectionner le poste « ${label} »` }));

beforeEach(() => {
  searchParams = new URLSearchParams();
  window.sessionStorage.clear();
  client.fetchItemTable.mockImplementation(async () => table());
  client.fetchFrozenItemSelection.mockImplementation(freezeFrom(table()));
  client.fetchItemHistory.mockImplementation(async (_project: string, itemId: string) => ({ projectId: FIXTURE_ITEM_PROJECT, itemId,
    events: [], offset: 0, limit: 20, hasMore: false, names: {} }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The last reading of #496 (lot 5 follow-ups): a row's journal opened, the table unmounted and shown again on the same
// journal while its first read was still on its way; that read's refusal reached only the table no longer shown.
describe("TakeoffItemTable, a journal's refusal", () => {
  it("withdraws the table shown again on the same journal, the first read's refusal reaching whoever shows it now", async () => {
    const cache = new Map();
    let reject: (error: unknown) => void = () => undefined;
    client.fetchItemHistory.mockImplementation(() => new Promise((_, rejecting) => { reject = rejecting; }));
    const draw = (present: boolean) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 2000 }}>
        {present ? <TakeoffItemTable projectId={FIXTURE_ITEM_PROJECT} viewerKey="tenant:member" /> : null}
      </SWRConfig>
    );
    const shown = render(draw(true));
    fireEvent.click(await screen.findByRole("button", { name: "Détail du poste « WC »" }));
    await waitFor(() => expect(client.fetchItemHistory).toHaveBeenCalledTimes(1));
    shown.rerender(draw(false));
    shown.rerender(draw(true));
    fireEvent.click(await screen.findByRole("button", { name: "Détail du poste « WC »" }));
    expect(client.fetchItemHistory).toHaveBeenCalledTimes(1);
    await act(async () => reject(refused()));
    await waitFor(() => expect(screen.queryByRole("table", { name: "Postes du métré" })).toBeNull());
  });
});

describe("TakeoffItemTable", () => {
  it("shows a reader every item with its state, its partial total and its coverage, without any gesture", async () => {
    client.fetchItemTable.mockResolvedValue(table({ canReview: false }));
    renderTable();
    const lavabo = await screen.findByRole("row", { name: /Lavabo/ });
    expect(lavabo).toHaveTextContent("En lecture");
    expect(lavabo).toHaveTextContent("3 u");
    expect(lavabo).toHaveTextContent("partiel");
    expect(within(lavabo).getByRole("cell", { name: "1/2" })).toBeInTheDocument();
    expect(row("Receveur de douche")).toHaveTextContent("À mesurer");
    // Not found is an absence observed (« — »); an item no plan read has nothing in its cells, and no message either.
    expect(within(row("Baignoire")).getByRole("cell", { name: "—" })).toBeInTheDocument();
    expect(within(row("Receveur de douche")).queryByRole("cell", { name: "—" })).not.toBeInTheDocument();
    expect(row("Receveur de douche")).not.toHaveTextContent("Rien à décider");
    expect(row("Vanne DN32")).toHaveTextContent("Incertain");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "Gestes sur la sélection" })).not.toBeInTheDocument();
    expect(screen.getByText("Un opérateur du métré de l’affaire peut revoir ces postes.")).toBeInTheDocument();
    // The decisions to take come first, the document order after.
    const order = screen.getAllByRole("row").slice(1).map((line) => within(line).getByRole("rowheader").textContent);
    expect(order[order.length - 1]).toMatch(/^Receveur de douche/);
  });

  it("keeps a selection across pages and after a reload, and counts what each gesture applies to", async () => {
    searchParams = new URLSearchParams("posteLimit=25");
    client.fetchItemTable.mockImplementation(async (_project: string, address: { offset: number }) =>
      table({ limit: 25, offset: address.offset }));
    const first = renderTable();
    await screen.findByRole("row", { name: /WC/ });
    tick("WC");
    tick("Baignoire");
    tick("Receveur de douche");
    const toolbar = screen.getByRole("toolbar", { name: "Gestes sur la sélection" });
    expect(within(toolbar).getByTestId("poste-selection-count")).toHaveTextContent("3 postes sélectionnés");
    expect(within(toolbar).getByRole("button", { name: "Accepter les mesurés sans anomalie (1)" })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: "Écarter la sélection (2)" })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: "Demander une nouvelle mesure (3)" })).toBeEnabled();

    first.unmount();
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    await waitFor(() => expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("3 postes sélectionnés"));
    expect(screen.getByRole("checkbox", { name: "Sélectionner le poste « Baignoire »" })).toBeChecked();
  });

  it("selects every result of the filter, beyond the page shown, from the server's frozen selection", async () => {
    const frozen = { count: 6, missing: [], eligible: { accept_measured: 1, set_aside: 5, reinstate: 0, enter_quantity: 2, include_entry: 0, remeasure: 5 },
      items: table().page.lines.map(({ itemId, label, targets }) => ({ itemId, label, target: targets, eligible: ["set_aside" as const] })) };
    client.fetchFrozenItemSelection.mockResolvedValue(frozen);
    renderTable();
    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner les 6 résultats du filtre" }));
    await waitFor(() => expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("6 postes sélectionnés"));
    expect(client.fetchFrozenItemSelection).toHaveBeenCalledWith(FIXTURE_ITEM_PROJECT, { kind: "affaire" }, { kind: "filter", filter: {} });
  });

  it("accepts on the revisions seen when the lines were ticked, and refuses a stale selection without applying anything", async () => {
    const { rerenderWith } = renderTable({ signature: "a" });
    await screen.findByRole("row", { name: /WC/ });
    tick("WC");
    tick("Évier");
    const seen = table().page.lines.filter(({ label }) => label === "WC" || label === "Évier").map(({ targets }) => targets);

    // A result arrives: the table is read again, the selection keeps what was seen.
    const newer = table({ readings: SCENARIO.map((reading) => reading.itemId === fixtureItemId(1) && reading.answer
      ? { ...reading, answer: { ...reading.answer, revision: "2" } } : reading) });
    client.fetchItemTable.mockResolvedValue(newer);
    rerenderWith({ signature: "b" });
    await waitFor(() => expect(client.fetchItemTable).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("checkbox", { name: "Sélectionner le poste « WC »" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Accepter les mesurés sans anomalie (1)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Portée : toute l’affaire · 1 poste accepté sur 2 postes sélectionnés");
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("Des postes ont changé.", 409,
      { stale: [{ itemId: fixtureItemId(1), label: "WC" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    client.fetchFrozenItemSelection.mockResolvedValue({ count: 2, missing: [], eligible: { accept_measured: 1, set_aside: 2, reinstate: 0,
      enter_quantity: 0, include_entry: 0, remeasure: 2 },
    items: newer.page.lines.filter(({ label }) => label === "WC" || label === "Évier")
      .map(({ itemId, label, targets }) => ({ itemId, label, target: targets, eligible: ["accept_measured" as const] })) });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accepter 1 poste" }));

    await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1));
    const [, command] = client.sendItemReviewCommand.mock.calls[0];
    expect(command).toMatchObject({ command_version: 1, gesture: "accept_measured", scope: { kind: "affaire" } });
    expect(command.targets).toEqual(seen);
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("Rien n’a été appliqué : WC a changé depuis la sélection.");
    expect(client.fetchFrozenItemSelection).toHaveBeenCalledWith(FIXTURE_ITEM_PROJECT, { kind: "affaire" },
      { kind: "items", itemIds: [fixtureItemId(1), fixtureItemId(2)] });
  });

  // A completion applies only to what started it: the refresh of a selection after a stale refusal lands on a selection
  // the member cleared meanwhile, which it must leave empty (POSTE-REVUE01's « 6 postes sélectionnés »).
  it("keeps a selection cleared while its refresh after a stale refusal is still on its way, and says it was refreshed only once it was", async () => {
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    tick("WC");
    tick("Évier");
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("Des postes ont changé.", 409,
      { stale: [{ itemId: fixtureItemId(1), label: "WC" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    let release: (value: Awaited<ReturnType<typeof client.fetchFrozenItemSelection>>) => void = () => {};
    client.fetchFrozenItemSelection.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Accepter les mesurés sans anomalie (1)" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Accepter 1 poste" }));
    const notice = await screen.findByTestId("poste-notice");
    expect(notice).toHaveTextContent("Rien n’a été appliqué : WC a changé depuis la sélection.");
    // The refresh is on its way: nothing says it happened yet.
    expect(notice).not.toHaveTextContent("rafraîchie");
    await waitFor(() => expect(client.fetchFrozenItemSelection).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Vider la sélection" }));
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("0 poste sélectionné");
    await act(async () => {
      release(freezeFrom(table())(FIXTURE_ITEM_PROJECT, { kind: "affaire" }, { kind: "items", itemIds: [fixtureItemId(1), fixtureItemId(2)] }) as never);
    });
    // The refresh landed on a selection the member had cleared: it stays as the member left it.
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("0 poste sélectionné");
    expect(screen.getByTestId("poste-notice")).not.toHaveTextContent("rafraîchie");
    tick("Baignoire");
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("1 poste sélectionné");
  });

  it("says the selection was refreshed once its refresh after a stale refusal applied", async () => {
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    tick("WC");
    tick("Évier");
    client.sendItemReviewCommand.mockRejectedValue(new TakeoffApiError("Des postes ont changé.", 409,
      { stale: [{ itemId: fixtureItemId(1), label: "WC" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    fireEvent.click(screen.getByRole("button", { name: "Accepter les mesurés sans anomalie (1)" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Accepter 1 poste" }));
    await waitFor(() => expect(screen.getByTestId("poste-notice")).toHaveTextContent(
      "Rien n’a été appliqué : WC a changé depuis la sélection. La sélection a été rafraîchie : vérifiez-la, puis confirmez de nouveau."));
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("2 postes sélectionnés");
  });

  // « Tous les résultats du filtre » follows the same rule.
  it("keeps a selection the member changed while « tous les résultats du filtre » was on its way", async () => {
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    let release: (value: Awaited<ReturnType<typeof client.fetchFrozenItemSelection>>) => void = () => {};
    client.fetchFrozenItemSelection.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /Sélectionner les \d+ résultats du filtre/ }));
    await waitFor(() => expect(client.fetchFrozenItemSelection).toHaveBeenCalledTimes(1));
    tick("WC");
    await act(async () => {
      release(freezeFrom(table())(FIXTURE_ITEM_PROJECT, { kind: "affaire" }, { kind: "filter" }) as never);
    });
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("1 poste sélectionné");
  });

  // The remeasure's preview follows the same rule.
  it("shows a remeasure's preview only in the dialog it was asked for", async () => {
    let release: (value: Awaited<ReturnType<typeof client.previewItemRemeasure>>) => void = () => {};
    client.previewItemRemeasure.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    tick("Baignoire");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    await waitFor(() => expect(client.previewItemRemeasure).toHaveBeenCalledTimes(1));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Annuler" }));
    client.previewItemRemeasure.mockResolvedValueOnce(fixtureRemeasurePreview({ items: [{ itemId: fixtureItemId(3), label: "Baignoire" }],
      previewDigest: "b".repeat(64) }));
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    await screen.findByTestId("poste-remeasure-preview");
    await act(async () => { release(fixtureRemeasurePreview({ previewDigest: "a".repeat(64) }) as never); });
    // The first dialog's preview, arriving late, never replaces the one shown.
    client.sendItemRemeasure.mockResolvedValue({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" }));
    await waitFor(() => expect(client.sendItemRemeasure).toHaveBeenCalledTimes(1));
    expect(client.sendItemRemeasure.mock.calls[0][1]).toMatchObject({ preview_digest: "b".repeat(64) });
  });

  it("sets the selection aside with one reason chosen once, confirmed by Enter, a note required for « Autre »", async () => {
    client.sendItemReviewCommand.mockResolvedValue({ outcome: "applied", applied: [{ itemId: fixtureItemId(3), label: "Baignoire", answers: 2 }],
      skipped: [{ itemId: fixtureItemId(5), label: "Receveur de douche", reason: "no_answer" }] });
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    tick("Baignoire");
    tick("Receveur de douche");
    fireEvent.click(screen.getByRole("button", { name: "Écarter la sélection (1)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("1 poste et 2 lectures écartés sur 2 postes sélectionnés");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Autre" }));
    const confirm = within(dialog).getByRole("button", { name: "Écarter 1 poste" });
    expect(confirm).toBeDisabled();
    const note = within(dialog).getByRole("textbox", { name: "Note (obligatoire)" });
    fireEvent.change(note, { target: { value: "Prévu au lot chauffage" } });
    fireEvent.keyDown(note, { key: "Enter" });
    await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1));
    expect(client.sendItemReviewCommand.mock.calls[0][1]).toMatchObject({ gesture: "set_aside", reason: "other",
      note: "Prévu au lot chauffage" });
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("1 poste écarté. Laissés : Receveur de douche (aucune lecture à écarter).");
    // The line applied leaves the selection; the one left out stays.
    expect(screen.getByTestId("poste-selection-count")).toHaveTextContent("1 poste sélectionné");
  });

  it("records a value per item entered apart, one category for the selection, and keeps a typed value across a new read", async () => {
    client.sendItemReviewCommand.mockResolvedValue({ outcome: "applied", applied: [], skipped: [] });
    const { rerenderWith } = renderTable({ signature: "a" });
    await screen.findByRole("row", { name: /Baignoire/ });
    expect(screen.queryByRole("textbox", { name: "Quantité saisie pour « WC »" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Vanne DN32 »" }), { target: { value: "2,5" } });

    // The plan still read on Lavabo answers: the table is read again with that result.
    client.fetchItemTable.mockResolvedValue(table({ readings: SCENARIO.map((reading) =>
      reading.itemId === fixtureItemId(0) && reading.planKey === R1 ? fixtureReading(0, R1, fixtureAnswer("measured", 2)) : reading) }));
    rerenderWith({ signature: "b" });
    await waitFor(() => expect(row("Lavabo")).toHaveTextContent("Mesuré"));
    expect(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" })).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les saisies (2)" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Baignoire : 1 u");
    expect(dialog).toHaveTextContent("Vanne DN32 : 2,5 u");
    fireEvent.change(within(dialog).getByLabelText("Portée de la saisie"), { target: { value: "affaire" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Ce qui fonde ces quantités" }), { target: { value: "hypothesis" } });
    const note = within(dialog).getByRole("textbox", { name: "Ce qui est supposé (obligatoire)" });
    fireEvent.change(note, { target: { value: "trop court" } });
    expect(within(dialog).getByRole("button", { name: "Enregistrer" })).toBeEnabled();
    fireEvent.change(note, { target: { value: "court" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Une hypothèse doit dire ce qui est supposé");
    expect(within(dialog).getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    fireEvent.change(note, { target: { value: "Selon le CCTP, une baignoire par logement." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(1));
    expect(client.sendItemReviewCommand.mock.calls[0][1]).toMatchObject({
      gesture: "enter_quantity",
      values: [{ item_id: fixtureItemId(3), quantity: 1, unit: "u" }, { item_id: fixtureItemId(4), quantity: 2.5, unit: "u" }],
      entry: { category: "hypothesis", note: "Selon le CCTP, une baignoire par logement." },
    });
  });

  it("keeps the values being typed for the tab after a reload, in the scope they were typed in", async () => {
    const first = renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Unité saisie pour « Baignoire »" }), { target: { value: "ens" } });
    first.unmount();
    // The tab reloaded: the values typed are back, ready to save.
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" })).toHaveValue("1"));
    expect(screen.getByRole("textbox", { name: "Unité saisie pour « Baignoire »" })).toHaveValue("ens");
    expect(screen.getByRole("button", { name: "Enregistrer les saisies (1)" })).toBeEnabled();
  });

  it("withdraws the table, its detail and its dialogs when its read is refused, whatever it showed before", async () => {
    const { rerenderWith } = renderTable({ signature: "a" });
    await screen.findByRole("row", { name: /Lavabo/ });
    fireEvent.click(screen.getByRole("button", { name: "Détail du poste « Lavabo »" }));
    tick("WC");
    fireEvent.click(await screen.findByRole("button", { name: "Écarter la sélection (1)" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // The member's access was removed: the next read is refused.
    client.fetchItemTable.mockRejectedValue(new TakeoffApiError("Accès refusé à cette affaire.", 403, null, null));
    rerenderWith({ signature: "b" });
    expect(await screen.findByTestId("poste-refus")).toHaveTextContent("Accès refusé à cette affaire.");
    expect(screen.queryByRole("table", { name: "Postes du métré" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/Lavabo/)).not.toBeInTheDocument();
  });

  it("withdraws the table, its detail and its history when an older page of the history is refused", async () => {
    client.fetchItemHistory.mockImplementation(async (_project: string, itemId: string, page: { offset: number }) => {
      if (page.offset > 0) throw refused();
      return { projectId: FIXTURE_ITEM_PROJECT, itemId, events: [], offset: 0, limit: 20, hasMore: true, names: {} };
    });
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    fireEvent.click(screen.getByRole("button", { name: "Détail du poste « WC »" }));
    fireEvent.click(await screen.findByRole("button", { name: "Événements plus anciens" }));
    expect(await screen.findByTestId("poste-refus")).toHaveTextContent("Accès refusé à cette affaire.");
    expect(screen.queryByRole("table", { name: "Postes du métré" })).not.toBeInTheDocument();
    expect(screen.queryByTestId(`poste-historique-${fixtureItemId(1)}`)).not.toBeInTheDocument();
  });

  it("withdraws the table when « all results » of the filter is refused, not a notice beside it", async () => {
    client.fetchFrozenItemSelection.mockRejectedValue(refused());
    renderTable();
    fireEvent.click(await screen.findByRole("button", { name: "Sélectionner les 6 résultats du filtre" }));
    expect(await screen.findByTestId("poste-refus")).toHaveTextContent("Accès refusé à cette affaire.");
    expect(screen.queryByRole("table", { name: "Postes du métré" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("poste-notice")).not.toBeInTheDocument();
  });

  it("keeps a draft whose unit is typed before its quantity", async () => {
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Unité saisie pour « Baignoire »" }), { target: { value: "ens" } });
    expect(screen.getByRole("textbox", { name: "Unité saisie pour « Baignoire »" })).toHaveValue("ens");
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les saisies (1)" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Baignoire : 2 ens");
  });

  it("sends a draft with the targets of its line as it is now: after a stale refusal, and after a reload", async () => {
    const save = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Enregistrer les saisies (1)" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Portée de la saisie"), { target: { value: "affaire" } });
      fireEvent.change(within(dialog).getByRole("combobox", { name: "Ce qui fonde ces quantités" }), { target: { value: "site_survey" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    };
    const targetsOf = (response: ItemTableResponse) => [response.page.lines.find(({ itemId }) => itemId === fixtureItemId(3))!.targets];
    client.sendItemReviewCommand.mockRejectedValueOnce(new TakeoffApiError("Des postes ont changé.", 409,
      { stale: [{ itemId: fixtureItemId(3), label: "Baignoire" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    const first = renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "1" } });
    // The bathtub is read again before the save: the save is stale.
    const second = readAgain(3, "2");
    client.fetchItemTable.mockResolvedValue(second);
    client.fetchFrozenItemSelection.mockImplementation(freezeFrom(second));
    await save();
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("Rien n’a été appliqué : Baignoire a changé");
    expect(client.sendItemReviewCommand.mock.calls[0][1].targets).toEqual(targetsOf(table()));
    client.sendItemReviewCommand.mockRejectedValueOnce(new TakeoffApiError("Des postes ont changé.", 409,
      { stale: [{ itemId: fixtureItemId(3), label: "Baignoire" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    await save();
    await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(2));
    expect(client.sendItemReviewCommand.mock.calls[1][1].targets).toEqual(targetsOf(second));
    // Read again once more while the tab reloads: the draft comes back with the line as it is now.
    first.unmount();
    const third = readAgain(3, "3");
    client.fetchItemTable.mockResolvedValue(third);
    client.fetchFrozenItemSelection.mockImplementation(freezeFrom(third));
    client.sendItemReviewCommand.mockResolvedValue({ outcome: "applied", applied: [], skipped: [] });
    renderTable();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" })).toHaveValue("1"));
    await save();
    await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(3));
    expect(client.sendItemReviewCommand.mock.calls[2][1].targets).toEqual(targetsOf(third));
  });

  it("reads the open history again with the table after a review", async () => {
    const event = { id: 1, event: "set_aside" as const, planKey: RDC, takeoffItemId: null, before: { kind: "none" },
      after: { kind: "set_aside", reason: "duplicate", note: null }, actorId: "22222222-2222-4222-8222-222222222222",
      at: "2026-11-22T10:00:00.000Z" };
    client.fetchItemHistory.mockImplementation(async (_project: string, itemId: string) => ({ projectId: FIXTURE_ITEM_PROJECT, itemId,
      events: client.sendItemReviewCommand.mock.calls.length ? [event] : [], offset: 0, limit: 20, hasMore: false,
      names: { "22222222-2222-4222-8222-222222222222": "Léa Martin" } }));
    client.sendItemReviewCommand.mockResolvedValue({ outcome: "applied", applied: [{ itemId: fixtureItemId(3), label: "Baignoire",
      answers: 2 }], skipped: [] });
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    fireEvent.click(screen.getByRole("button", { name: "Détail du poste « Baignoire »" }));
    const history = await screen.findByTestId(`poste-historique-${fixtureItemId(3)}`);
    expect(history).toHaveTextContent("Aucune décision n’a encore été prise sur ce poste.");
    tick("Baignoire");
    fireEvent.click(screen.getByRole("button", { name: "Écarter la sélection (1)" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Doublon" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Écarter 1 poste" }));
    await waitFor(() => expect(screen.getByTestId(`poste-historique-${fixtureItemId(3)}`)).toHaveTextContent("Écarté : doublon"));
    expect(screen.getByTestId(`poste-historique-${fixtureItemId(3)}`)).toHaveTextContent("Léa Martin");
  });

  it("tells in the detail who set the line aside, why, and who reinstated it", async () => {
    client.fetchItemHistory.mockResolvedValue({ projectId: FIXTURE_ITEM_PROJECT, itemId: fixtureItemId(1), offset: 0, limit: 20,
      hasMore: false, names: { "22222222-2222-4222-8222-222222222222": "Léa Martin", "33333333-3333-4333-8333-333333333333": "Paul Durand" },
      events: [
        { id: 3, event: "reinstated", planKey: null, takeoffItemId: null, before: { kind: "set_aside" },
          after: { kind: "none", restored: "changed" }, actorId: "33333333-3333-4333-8333-333333333333", at: "2026-11-22T10:00:00.000Z" },
        { id: 2, event: "set_aside", planKey: RDC, takeoffItemId: null, before: { kind: "accepted" },
          after: { kind: "set_aside", reason: "duplicate", note: null }, actorId: "22222222-2222-4222-8222-222222222222",
          at: "2026-11-22T09:00:00.000Z" },
      ] });
    renderTable();
    await screen.findByRole("row", { name: /WC/ });
    fireEvent.click(screen.getByRole("button", { name: "Détail du poste « WC »" }));
    const history = await screen.findByTestId(`poste-historique-${fixtureItemId(1)}`);
    expect(history).toHaveTextContent("Écarté : doublon");
    expect(history).toHaveTextContent("Léa Martin");
    expect(history).toHaveTextContent("Réintégré : une ligne avait changé entre-temps, à décider de nouveau");
    expect(history).toHaveTextContent("Paul Durand");
    expect(client.fetchItemHistory).toHaveBeenCalledWith(FIXTURE_ITEM_PROJECT, fixtureItemId(1), { offset: 0, limit: 20 });
  });

  it("says a missing value by a yellow cell, not by a message, and keeps orange for what blocks", async () => {
    client.fetchItemTable.mockResolvedValue(fixtureItemTable({
      items: [...ITEMS, fixturePoste(6, "Nourrice", { expectedUnit: null }),
        fixturePoste(7, "Évacuation EU", { origin: "dpgf", expectedUnit: "ml", referenceQuantity: 30, dpgfReference: "3.2.1" })],
      readings: [...SCENARIO, fixtureReading(6, RDC, fixtureAnswer("not_found", null)),
        fixtureReading(7, RDC, fixtureAnswer("measured", 36, { observations: [{ observationId: "eu",
          quantity: 36, unit: "ml", page: 1, evidence: "tracé", confidence: 0.9, method: "vector", role: "contribution",
          takeoffItemId: null, row: { quantity: 36, unit: "ml", isVerified: false, isExcluded: false } }],
          quantity: { quantity: 36, unit: "ml" } }))],
    }));
    renderTable();
    const nourrice = await screen.findByRole("row", { name: /Nourrice/ });
    expect(within(nourrice).getByText("Unité à préciser").closest("td")).toHaveClass("bg-warning-subtle");
    expect(within(nourrice).queryByText("À préciser")).not.toBeInTheDocument();

    // A value typed takes the item's expected unit unless another is typed (shown as the field's placeholder).
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "1" } });
    const expected = screen.getByRole("textbox", { name: "Unité saisie pour « Baignoire »" });
    expect(expected).toHaveValue("");
    expect(expected).toHaveAttribute("placeholder", "u");
    expect(expected.closest("td")).not.toHaveClass("bg-warning-light");
    expect(screen.getByRole("button", { name: "Enregistrer les saisies (1)" })).toBeInTheDocument();
    // Without an expected unit, a value typed without its unit turns the unit's cell yellow and is not counted.
    fireEvent.change(screen.getByRole("textbox", { name: "Quantité saisie pour « Nourrice »" }), { target: { value: "2" } });
    const unit = screen.getByRole("textbox", { name: "Unité saisie pour « Nourrice »" });
    expect(unit.closest("td")).toHaveClass("bg-warning-light");
    expect(screen.getByRole("button", { name: "Enregistrer les saisies (1)" })).toBeInTheDocument();
    fireEvent.change(unit, { target: { value: "u" } });
    expect(unit.closest("td")).not.toHaveClass("bg-warning-light");
    expect(screen.getByRole("button", { name: "Enregistrer les saisies (2)" })).toBeInTheDocument();

    // The gap above 1 % and the anomaly keep the line out of the acceptance: orange; a remark stays quiet.
    const eu = row("Évacuation EU");
    expect(within(eu).getByText("+20 %")).toHaveClass("text-warning");
    expect(within(eu).getByText("Écart à la DPGF à vérifier")).toHaveClass("text-warning");
    expect(within(row("Évier")).getByText("Hypothèse")).toHaveClass("text-warning");
    expect(within(row("Vanne DN32")).getByText("Réseau, matière ou diamètre illisible.")).not.toHaveClass("text-warning");
  });

  it("asks for a new measure of one item: payer, setting, plans and items shown, then an explicit confirmation", async () => {
    client.previewItemRemeasure.mockResolvedValue(fixtureRemeasurePreview({ items: [{ itemId: fixtureItemId(5), label: "Receveur de douche" }] }));
    client.sendItemRemeasure.mockResolvedValue({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
    renderTable();
    await screen.findByRole("row", { name: /Receveur de douche/ });
    tick("Receveur de douche");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    const preview = await screen.findByTestId("poste-remeasure-preview");
    // What the member saw goes with it: the list revision shown and the line's readings, frozen when it was ticked.
    const shownLine = table().page.lines.find(({ itemId }) => itemId === fixtureItemId(5))!;
    const seen = { list_revision_id: table().list!.revisionId, targets: [shownLine.targets] };
    expect(client.previewItemRemeasure).toHaveBeenCalledWith(FIXTURE_ITEM_PROJECT, { kind: "affaire" }, [fixtureItemId(5)], seen);
    expect(preview).toHaveTextContent("Forfait utilisé : celui de Léa Martin");
    // The profile's setting, used as it is: no effort is offered for this request alone (the Mac would refuse another).
    expect(preview).toHaveTextContent("Réglage de Mon profil : modele-a · effort moyen. La demande l’utilise tel quel.");
    expect(within(preview).queryByRole("combobox")).not.toBeInTheDocument();
    expect(preview).toHaveTextContent("Plan RDC");
    expect(preview).toHaveTextContent("1 poste mesuré");
    // What its admission reads and reserves on the member's subscription, sized on the items asked.
    expect(screen.getByTestId("poste-remeasure-reading")).toHaveTextContent(
      "1 poste lu sur 2 plans, en 2 appels payants. Budget réservé sur votre forfait : 66 000 jetons au plus (2 appels payants).");
    const reads = client.fetchItemTable.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" }));
    await waitFor(() => expect(client.sendItemRemeasure).toHaveBeenCalledTimes(1));
    expect(client.sendItemRemeasure.mock.calls[0][1]).toMatchObject({ item_ids: [fixtureItemId(5)], plan_keys: [RDC, R1],
      setting: null, preview_digest: "a".repeat(64), seen });
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("Nouvelle mesure demandée");
    // The table is read again at once: the items asked now read « En lecture » on their plans.
    await waitFor(() => expect(client.fetchItemTable.mock.calls.length).toBeGreaterThan(reads));
  });

  it("says why the reading of the selection is refused before anything is paid, and offers no confirmation", async () => {
    client.previewItemRemeasure.mockResolvedValue(fixtureRemeasurePreview({ reading: { state: "refused",
      reason: "Ces plans ne peuvent pas être lus seuls avec la préparation confirmée : revoyez les options du métré." } }));
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    tick("Baignoire");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("revoyez les options du métré");
    expect(screen.queryByTestId("poste-remeasure-reading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" })).toBeDisabled();
  });

  it("names the items a confirmation found read again since the preview, and applies nothing", async () => {
    client.previewItemRemeasure.mockResolvedValue(fixtureRemeasurePreview());
    client.sendItemRemeasure.mockRejectedValue(new TakeoffApiError("Des postes de la sélection ont changé depuis son affichage.", 409,
      { stale: [{ itemId: fixtureItemId(3), label: "Baignoire" }] }, "TAKEOFF_ITEM_REVIEW_STALE"));
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    tick("Baignoire");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    await screen.findByTestId("poste-remeasure-preview");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" }));
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("Rien n’a été appliqué : Baignoire a changé depuis la sélection.");
  });

  it("shows the previous count in an expanded plan row without offering to accept it during a new reading", async () => {
    searchParams.set("postePlan", RDC);
    const reading = { ...fixtureReading(1, RDC, fixtureAnswer("measured", 2)), unit: "running" as const,
      reading: "in_flight" as const, attempt: { unit: "running" as const, reason: null },
      verifiedMarks: { revision: 1, verified: true, counted: true, quantity: 1, unit: "u", pages: [2] } };
    client.fetchItemTable.mockResolvedValue(table({ scope: { kind: "plan", planKey: RDC }, readings: [reading] }));
    renderTable();
    fireEvent.click(await screen.findByRole("button", { name: "Détail du poste « WC »" }));
    const detail = await screen.findByTestId(`poste-detail-${fixtureItemId(1)}`);
    expect(detail).toHaveTextContent("Nouvelle mesure en cours");
    expect(detail).toHaveTextContent("Comptage vérifié");
    expect(within(detail).queryByRole("group", { name: "Quantité retenue pour ce poste sur ce plan" })).not.toBeInTheDocument();
  });

  it("shows in the detail the earlier reading kept, and that its new measure did not end, with its reason", async () => {
    client.fetchItemTable.mockResolvedValue(table({ readings: SCENARIO.map((reading) => reading.itemId === fixtureItemId(3)
      && reading.planKey === RDC ? { ...reading, unit: "failed" as const,
        attempt: { unit: "failed" as const, reason: "Le service d’analyse n’a pas pu terminer le métré." } } : reading) }));
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    fireEvent.click(screen.getByRole("button", { name: "Détail du poste « Baignoire »" }));
    const detail = await screen.findByTestId(`poste-detail-${fixtureItemId(3)}`);
    expect(within(detail).getByTestId(`poste-reading-attempt-${RDC}`)).toHaveTextContent(
      "La nouvelle mesure de ce plan n’a pas abouti : Le service d’analyse n’a pas pu terminer le métré. La lecture précédente ci-dessous reste celle retenue.");
    expect(detail).toHaveTextContent("Plan RDC · A · RDC · Non trouvé");
    expect(within(detail).queryByTestId(`poste-reading-attempt-${R1}`)).not.toBeInTheDocument();
  });

  it("keeps the selection ready, without a confirmation, while another analysis of the affaire runs", async () => {
    client.previewItemRemeasure.mockResolvedValue(fixtureRemeasurePreview({ running: true }));
    renderTable();
    await screen.findByRole("row", { name: /Baignoire/ });
    tick("Baignoire");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    expect(await screen.findByTestId("poste-remeasure-preview")).toHaveTextContent("la sélection reste prête");
    expect(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" })).toBeDisabled();
  });

  it("opens on the item an address focuses, and writes its filters to the address", async () => {
    searchParams = new URLSearchParams(`posteFocus=${fixtureItemId(1)}`);
    renderTable();
    expect(await screen.findByRole("row", { name: /WC/ })).toHaveAttribute("aria-current", "true");
    expect(client.fetchItemTable.mock.calls[0][1]).toMatchObject({ focusItemId: fixtureItemId(1) });
    fireEvent.change(screen.getByRole("combobox", { name: "État" }), { target: { value: "not_found" } });
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("posteState=not_found"), { scroll: false });
  });

  it("opens an item's detail on its plan from its line, and gives the keyboard back to that line when the detail closes", async () => {
    searchParams = new URLSearchParams("posteState=measured&tab=jobs");
    renderTable();
    const link = await screen.findByRole("link", { name: "Détail de « Lavabo » sur le plan" });
    const lavabo = table().page.lines.find(({ label }) => label === "Lavabo")!;
    const jobId = lavabo.readings.find(({ planKey }) => planKey === RDC)!.answer!.jobId;
    expect(link).toHaveAttribute("href",
      `/dashboard/affaires/${FIXTURE_ITEM_PROJECT}/takeoff?posteState=measured&tab=jobs&poste=${fixtureItemId(0)}&plan=${RDC}&lecture=${jobId}`);
    expect(link).not.toHaveFocus();
    cleanup();
    // Back from the detail, the table opens on the item it showed last, its « Détail » holding the keyboard.
    searchParams = new URLSearchParams(`posteState=measured&tab=jobs&posteFocus=${fixtureItemId(1)}`);
    renderTable();
    const back = await screen.findByRole("link", { name: "Détail de « WC » sur le plan" });
    await waitFor(() => expect(back).toHaveFocus());
  });

  it("says the list is not recorded yet instead of an empty table", async () => {
    client.fetchItemTable.mockResolvedValue(fixtureItemTable({ items: [], listed: false }) satisfies ItemTableResponse);
    renderTable();
    expect(await screen.findByText(/La liste des postes n’est pas encore enregistrée/)).toBeInTheDocument();
    await act(async () => undefined);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

it("targets the second contribution when only it needs a justification", async () => {
  const answer = fixtureAnswer("measured", 3, { anomalies: ["rule_failed"] });
  const second = fixtureItemId(8);
  answer.observations.push({ ...answer.observations[0], observationId: "second", takeoffItemId: second });
  client.fetchMeasureReview.mockResolvedValue({ answer_id: answer.answerId, rows: [
    { id: answer.observations[0].takeoffItemId, needs_justification: false }, { id: second, needs_justification: true },
  ] });
  client.fetchItemTable.mockResolvedValue(table({ readings: [fixtureReading(0, RDC, answer)] }));
  renderTable();
  fireEvent.click(await screen.findByRole("button", { name: "Détail du poste « Lavabo »" }));
  const link = await screen.findByRole("link", { name: "Voir la preuve et corriger dans la revue ciblée" });
  await waitFor(() => expect(link).toHaveAttribute("href", expect.stringContaining(`contribution=${second}`)));
  expect(new URL(link.getAttribute("href")!, "http://localhost").searchParams.get("line")).toBe(second);
});

it("retries an uncertain entry with exactly the frozen command, including its intention", async () => {
  client.sendItemReviewCommand.mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValue({ outcome: "applied", applied: [], skipped: [] });
  renderTable();
  fireEvent.change(await screen.findByRole("textbox", { name: "Quantité saisie pour « Baignoire »" }), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer les saisies (1)" }));
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Portée de la saisie"), { target: { value: "affaire" } });
  fireEvent.change(dialog.getByLabelText("Ce qui fonde ces quantités"), { target: { value: "site_survey" } });
  fireEvent.click(dialog.getByRole("button", { name: "Enregistrer" }));
  fireEvent.click(await dialog.findByRole("button", { name: "Réessayer la même saisie" }));
  await waitFor(() => expect(client.sendItemReviewCommand).toHaveBeenCalledTimes(2));
  expect(client.sendItemReviewCommand.mock.calls[1]).toEqual(client.sendItemReviewCommand.mock.calls[0]);
});
