import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { basinLine, DETAIL_PROJECT, JOB_RDC, MEMBER, PLAN_RDC, planViews, SET } from "@/lib/takeoff/item-detail.test-fixtures";
import { itemDetailHref, readItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { fetchItemMeasureReadings, previewItemRemeasure, sendItemRemeasure } from "@/lib/takeoff/item-table-client";
import type { ItemRemeasureResult } from "@/lib/takeoff/item-table-contracts";
import { MeasureItemOnPlan } from "./MeasureItemOnPlan";

vi.mock("@/lib/takeoff/item-table-client", () => ({
  fetchItemMeasureReadings: vi.fn(), previewItemRemeasure: vi.fn(), sendItemRemeasure: vi.fn(),
}));
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); vi.resetAllMocks(); });

const openComparison = vi.fn();
function MeasureFromAddress() {
  const [query, setQuery] = useState(window.location.search);
  const read = readItemDetailAddress(new URLSearchParams(query));
  if (read.kind !== "detail") throw new Error("Expected an item detail address");
  const follow = (receipt: { requestId: string; jobId: string }) => {
    const href = itemDetailHref(DETAIL_PROJECT, { ...read.address, receipt }, query);
    window.history.replaceState(null, "", href);
    setQuery(window.location.search);
  };
  return <MeasureItemOnPlan projectId={DETAIL_PROJECT} line={basinLine} plan={planViews()[JOB_RDC + ":" + PLAN_RDC].plan}
    onOpenComparison={openComparison} receipt={read.address.receipt} onFollow={follow} page={1} listRevisionId={SET}
    onRefused={neverRefused} onRefresh={vi.fn()} onOpenCurrent={vi.fn()} />;
}
const neverRefused = () => false;
function openMeasure(search = "") {
  window.history.replaceState(null, "", `?poste=${basinLine.itemId}&plan=${PLAN_RDC}${search}`);
  return render(<MeasureFromAddress />);
}

it("keeps one immutable confirmation across a double click and a lost admission response", async () => {
  vi.mocked(fetchItemMeasureReadings).mockResolvedValue(null);
  vi.mocked(previewItemRemeasure).mockResolvedValue({
    plans: [{ key: PLAN_RDC, name: "RDC" }], items: [{ itemId: basinLine.itemId, label: basinLine.label }],
    payer: { memberId: MEMBER, name: "Léa" }, running: false, skipped: [], previewDigest: "a".repeat(64),
    subscription: { state: "ready", model: "usual", reasoningEffort: "low" },
    models: [{ id: "usual", name: "Usuel", reasoningEfforts: ["low"] }, { id: "other", name: "Autre", reasoningEfforts: ["high"] }],
    detail: { hostProof: "f".repeat(64), revision: "B", pages: [1, 2], pageCount: 2, previousPages: [1, 2], effect: "replace" },
    reading: { state: "ready", calls: 2, budgetTokens: 2000, summary: "Deux appels maximum." },
  });
  const response = Promise.withResolvers<ItemRemeasureResult>();
  vi.mocked(sendItemRemeasure).mockReturnValueOnce(response.promise).mockResolvedValueOnce({
    outcome: "replayed", requestId: SET, receipt: { intentKey: SET, jobId: JOB_RDC, state: "queued" },
  });
  openMeasure();
  fireEvent.click(screen.getByRole("button", { name: "Mesurer ce poste" }));
  const model = await screen.findByLabelText("Modèle");
  expect((model as HTMLSelectElement).value).toBe("usual");
  expect((screen.getByLabelText("Niveau de raisonnement") as HTMLSelectElement).value).toBe("low");
  fireEvent.change(model, { target: { value: "other" } });
  fireEvent.change(screen.getByLabelText("Niveau de raisonnement"), { target: { value: "high" } });
  expect(sendItemRemeasure).not.toHaveBeenCalled();
  const confirm = screen.getByRole("button", { name: "Mesurer avec mon forfait" });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(sendItemRemeasure).toHaveBeenCalledTimes(1);
  await act(async () => response.reject(new TakeoffApiError("Connexion interrompue", 0, null, null)));
  expect((model as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Retrouver le reçu" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const [first, replay] = vi.mocked(sendItemRemeasure).mock.calls;
  expect(first).toEqual(replay);
  expect(first[1]).toMatchObject({ item_ids: [basinLine.itemId], plan_keys: [PLAN_RDC], setting: { model: "other", reasoning_effort: "high" } });
  expect(screen.getByRole("status").textContent).toContain(SET);
});

it("follows its own receipt across a reload when a second tab admits another measure of the same item", async () => {
  vi.mocked(fetchItemMeasureReadings).mockResolvedValue(null);
  vi.mocked(previewItemRemeasure).mockResolvedValue({
    plans: [{ key: PLAN_RDC, name: "RDC" }], items: [{ itemId: basinLine.itemId, label: basinLine.label }],
    payer: { memberId: MEMBER, name: "Léa" }, running: false, skipped: [], previewDigest: "a".repeat(64),
    subscription: { state: "ready", model: "usual", reasoningEffort: "low" },
    models: [{ id: "usual", name: "Usuel", reasoningEfforts: ["low"] }, { id: "other", name: "Autre", reasoningEfforts: ["high"] }],
    detail: { hostProof: "f".repeat(64), revision: "B", pages: [1, 2], pageCount: 2, previousPages: [1, 2], effect: "replace" },
    reading: { state: "ready", calls: 2, budgetTokens: 2000, summary: "Deux appels maximum." },
  });

  const firstRequest = SET;
  const responseA = {requestId:firstRequest, jobId:JOB_RDC, state:"succeeded", reason:null, previous:null, latest:null} as const;
  let firstCompleted = false;
  const responseB = {...responseA, requestId:MEMBER, jobId:PLAN_RDC, state:"queued"} as const;
  vi.mocked(fetchItemMeasureReadings).mockResolvedValueOnce(null).mockImplementation(async (_project, _item, _plan, receipt) =>
    receipt?.jobId === JOB_RDC && receipt.requestId === firstRequest ? (firstCompleted ? responseA : { ...responseA, state: "running" }) : responseB);
  vi.mocked(sendItemRemeasure).mockResolvedValueOnce({outcome:"admitted", requestId:firstRequest,
    receipt:{intentKey:firstRequest,jobId:JOB_RDC,state:"queued"}});
  const firstTab = openMeasure();
  fireEvent.click(screen.getByRole("button", {name:"Mesurer ce poste"}));
  await screen.findByLabelText("Modèle");
  fireEvent.click(screen.getByRole("button", {name:"Mesurer avec mon forfait"}));
  const result = await screen.findByTestId("poste-mesure-resultat");
  expect(result.textContent).toContain(firstRequest);
  expect(result.textContent).toContain("Lecture en cours");

  firstCompleted = true;
  firstTab.unmount();
  render(<MeasureFromAddress />);
  const reopened = await screen.findByTestId("poste-mesure-resultat");
  expect(reopened.textContent).toContain(firstRequest);
  expect(reopened.textContent).toContain("Lecture terminée");
});

it("shows no result for an explicitly named foreign receipt even when the member has a recent measure", async () => {
  const own = { requestId: SET, jobId: JOB_RDC, state: "succeeded", reason: null, previous: null, latest: null } as const;
  vi.mocked(fetchItemMeasureReadings).mockImplementation(async (_project, _item, _plan, receipt) => receipt ? null : own);
  openMeasure(`&demandeMesure=${MEMBER}&analyseMesure=${PLAN_RDC}`);
  await waitFor(() => expect(fetchItemMeasureReadings).toHaveBeenCalledWith(DETAIL_PROJECT, basinLine.itemId, PLAN_RDC,
    { requestId: MEMBER, jobId: PLAN_RDC }));
  expect(screen.queryByTestId("poste-mesure-resultat")).toBeNull();
});

it("keeps the member’s marks on the current reading and opens the new proposals on their own comparison", async () => {
  const answer = { answerId: MEMBER, jobId: JOB_RDC, listRevisionId: SET, planFileId: SET, generation: null,
    outcome: "uncertain" as const, quantity: null, unit: "u", pages: [1, 2], unreadablePages: [], reasons: [], observations: [], comparisonOnly: false };
  vi.mocked(fetchItemMeasureReadings).mockResolvedValue({ jobId: PLAN_RDC, requestId: SET, state: "succeeded",
    reason: null, previous: answer, latest: { ...answer, jobId: PLAN_RDC, answerId: SET, comparisonOnly: true,
      coverage: [{ page: 1, vector_state: "no_layer", limited: false, tiles: ["read", "failed", "not_read", "not_read"] }] } });
  openMeasure();
  const result = await screen.findByTestId("poste-mesure-resultat");
  expect(result.textContent).toContain("Vos corrections restent sur la lecture actuelle");
  expect(result.textContent).toContain("Tuile 2 en échec");
  fireEvent.click(screen.getByRole("button", { name: "Voir les propositions de la comparaison" }));
  expect(openComparison).toHaveBeenCalledWith(PLAN_RDC, 1);
  expect(screen.getAllByRole("button", { name: "Mesurer tout le plan" })).toHaveLength(1);
});

it("warns before paying for proposals that cannot be adopted and offers the whole plan", async () => {
  vi.mocked(fetchItemMeasureReadings).mockResolvedValue(null);
  vi.mocked(previewItemRemeasure).mockImplementation(async (_project, _scope, _items, _seen, detail) => ({
    plans: [{ key: PLAN_RDC, name: "RDC" }], items: [{ itemId: basinLine.itemId, label: basinLine.label }],
    payer: { memberId: MEMBER, name: "Léa" }, running: false, skipped: [], previewDigest: "a".repeat(64),
    subscription: { state: "ready", model: "usual", reasoningEffort: null }, models: [{ id: "usual", name: "Usuel", reasoningEfforts: [] }],
    detail: { hostProof: "f".repeat(64), revision: "B", pages: detail?.page ? [1] : [1,2], pageCount: 2, previousPages: [1,2],
      effect: detail?.page ? "compare" : "replace", ...(detail?.proposeMarks && { markSchedule: {
        pages: [{ page: 1, width_points: 595 }], tile_calls: 4, other_calls: 2, total_calls: 6 } }) },
    reading: { state: "ready", calls: 2, budgetTokens: 2000, summary: "Lecture bornée." },
  }));
  openMeasure();
  fireEvent.click(screen.getByRole("button", { name: "Mesurer ce poste" }));
  await screen.findByLabelText("Modèle");
  const option = screen.getByRole("checkbox", { name: "Proposer des repères à vérifier" }) as HTMLInputElement;
  expect(option.checked).toBe(false);
  fireEvent.change(screen.getByLabelText("Portée"), { target: { value: "page" } });
  await screen.findByText(/La lecture précédente est indivisible/);
  fireEvent.click(option);
  expect((await screen.findByText(/ne pourront pas être adoptées/)).textContent).toContain("lecture seule");
  expect(screen.getByText(/4 appels de repérage/).textContent).toContain("6 appels au maximum");
  fireEvent.click(screen.getByRole("button", { name: "Mesurer tout le plan" }));
  await screen.findByText(/La nouvelle lecture remplacera/);
  expect(sendItemRemeasure).not.toHaveBeenCalled();
});
