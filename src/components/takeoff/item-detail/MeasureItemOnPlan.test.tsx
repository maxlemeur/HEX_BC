import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { basinLine, DETAIL_PROJECT, JOB_RDC, MEMBER, PLAN_RDC, planViews, SET } from "@/lib/takeoff/item-detail.test-fixtures";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { fetchItemMeasureReadings, previewItemRemeasure, sendItemRemeasure } from "@/lib/takeoff/item-table-client";
import type { ItemRemeasureResult } from "@/lib/takeoff/item-table-contracts";
import { MeasureItemOnPlan } from "./MeasureItemOnPlan";

vi.mock("@/lib/takeoff/item-table-client", () => ({
  fetchItemMeasureReadings: vi.fn(), previewItemRemeasure: vi.fn(), sendItemRemeasure: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

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
  render(<MeasureItemOnPlan projectId={DETAIL_PROJECT} line={basinLine} plan={planViews()[JOB_RDC + ":" + PLAN_RDC].plan}
    page={1} listRevisionId={SET} onRefused={() => false} onRefresh={vi.fn()} onOpenCurrent={vi.fn()} />);
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

it("follows its own receipt when a second tab has since admitted another measure of the same item", async () => {
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
  const responseB = {...responseA, requestId:MEMBER, jobId:PLAN_RDC, state:"queued"} as const;
  vi.mocked(fetchItemMeasureReadings).mockResolvedValueOnce(null).mockImplementation(async (_project, _item, _plan, receipt) =>
    receipt?.jobId === JOB_RDC && receipt.requestId === firstRequest ? responseA : responseB);
  vi.mocked(sendItemRemeasure).mockResolvedValueOnce({outcome:"admitted", requestId:firstRequest,
    receipt:{intentKey:firstRequest,jobId:JOB_RDC,state:"queued"}});
  render(<MeasureItemOnPlan projectId={DETAIL_PROJECT} line={basinLine} plan={planViews()[JOB_RDC + ":" + PLAN_RDC].plan}
    page={1} listRevisionId={SET} onRefused={() => false} onRefresh={vi.fn()} onOpenCurrent={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", {name:"Mesurer ce poste"}));
  await screen.findByLabelText("Modèle");
  fireEvent.click(screen.getByRole("button", {name:"Mesurer avec mon forfait"}));
  const result = await screen.findByTestId("poste-mesure-resultat");
  expect(result.textContent).toContain(firstRequest);
  expect(result.textContent).toContain("Lecture terminée");
});
