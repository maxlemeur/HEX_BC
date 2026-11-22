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
  fetchFrozenItemSelection: vi.fn(),
  sendItemReviewCommand: vi.fn(),
  previewItemRemeasure: vi.fn(),
  sendItemRemeasure: vi.fn(),
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
    fixtureReading(4, RDC, fixtureAnswer("uncertain", null, { reasonCode: "diameter_unreadable", reasonText: "Le diamètre n’est pas lisible." })),
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
const tick = (label: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Sélectionner le poste « ${label} »` }));

beforeEach(() => {
  searchParams = new URLSearchParams();
  window.sessionStorage.clear();
  client.fetchItemTable.mockImplementation(async () => table());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it("says a missing value by a yellow cell, not by a message, and keeps orange for what blocks", async () => {
    client.fetchItemTable.mockResolvedValue(fixtureItemTable({
      items: [...ITEMS, fixturePoste(6, "Nourrice", { expectedUnit: null }),
        fixturePoste(7, "Évacuation EU", { origin: "dpgf", expectedUnit: "ml", referenceQuantity: 30, dpgfReference: "3.2.1" })],
      readings: [...SCENARIO, fixtureReading(6, RDC, fixtureAnswer("not_found", null)),
        fixtureReading(7, RDC, fixtureAnswer("measured", 36, { observations: [{ observationId: "eu",
          quantity: 36, unit: "ml", page: 1, evidence: "tracé", confidence: 0.9, method: "vector", role: "contribution",
          takeoffItemId: null }], quantity: { quantity: 36, unit: "ml" } }))],
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
    expect(within(row("Vanne DN32")).getByText("Motif de la lecture")).not.toHaveClass("text-warning");
  });

  it("asks for a new measure of one item: payer, setting, plans and items shown, then an explicit confirmation", async () => {
    client.previewItemRemeasure.mockResolvedValue(fixtureRemeasurePreview({ items: [{ itemId: fixtureItemId(5), label: "Receveur de douche" }] }));
    client.sendItemRemeasure.mockResolvedValue({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
    renderTable();
    await screen.findByRole("row", { name: /Receveur de douche/ });
    tick("Receveur de douche");
    fireEvent.click(screen.getByRole("button", { name: "Demander une nouvelle mesure (1)" }));
    const preview = await screen.findByTestId("poste-remeasure-preview");
    expect(client.previewItemRemeasure).toHaveBeenCalledWith(FIXTURE_ITEM_PROJECT, { kind: "affaire" }, [fixtureItemId(5)]);
    expect(preview).toHaveTextContent("Forfait utilisé : celui de Léa Martin");
    expect(preview).toHaveTextContent("Réglage de Mon profil : modele-a · effort moyen.");
    expect(preview).toHaveTextContent("Plan RDC");
    expect(preview).toHaveTextContent("1 poste mesuré");
    fireEvent.change(within(preview).getByRole("combobox", { name: "Effort pour cette demande seulement" }), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la demande sur mon forfait" }));
    await waitFor(() => expect(client.sendItemRemeasure).toHaveBeenCalledTimes(1));
    expect(client.sendItemRemeasure.mock.calls[0][1]).toMatchObject({ item_ids: [fixtureItemId(5)], plan_keys: [RDC, R1],
      setting: { reasoning_effort: "high" }, preview_digest: "a".repeat(64) });
    expect(await screen.findByTestId("poste-notice")).toHaveTextContent("Nouvelle mesure demandée");
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

  it("says the list is not recorded yet instead of an empty table", async () => {
    client.fetchItemTable.mockResolvedValue(fixtureItemTable({ items: [], listed: false }) satisfies ItemTableResponse);
    renderTable();
    expect(await screen.findByText(/La liste des postes n’est pas encore enregistrée/)).toBeInTheDocument();
    await act(async () => undefined);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
