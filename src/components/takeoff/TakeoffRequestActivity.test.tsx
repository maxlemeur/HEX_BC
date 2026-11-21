import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIXTURE_PROJECT,
  fixtureActivityJob,
  fixtureActivityResponse,
  fixtureJob,
  fixtureRequest,
  fixtureThreePlans,
  fixtureUnit,
} from "@/lib/takeoff/request-activity.test-fixtures";
import type { TakeoffRequestActivityResponse } from "@/lib/takeoff/request-activity-contracts";

const history = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn() }));
const assume = vi.hoisted(() => vi.fn());
const cancel = vi.hoisted(() => vi.fn());
vi.mock("./useTakeoffRequestActivity", () => ({
  useTakeoffRequestActivity: () => ({ data: history.data, error: undefined, isLoading: false, mutate: history.mutate, refreshMs: 0 }),
}));
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ assumeTakeoffLaunchRequestAction: assume }));
vi.mock("@/lib/takeoff/client", () => ({ cancelTakeoffJob: cancel, resubmitTakeoffJob: vi.fn(), isTakeoffApiError: () => false }));
vi.mock("@/components/takeoff/TakeoffPlanLocationDialog", () => ({
  TakeoffPlanLocationDialog: ({ documentName, fileId }: { documentName: string; fileId: string }) => (
    <div role="dialog" aria-label="Bâtiment et niveau">{documentName} · {fileId}</div>
  ),
}));

import { TakeoffRequestActivity } from "./TakeoffRequestActivity";

function renderActivity(data: TakeoffRequestActivityResponse | undefined, extra: { linked?: string | null; error?: unknown } = {}) {
  const onChanged = vi.fn();
  const onShowLatest = vi.fn();
  const view = (next: TakeoffRequestActivityResponse | undefined) => (
    <TakeoffRequestActivity projectId={FIXTURE_PROJECT} viewerKey="tenant:member"
      linked={extra.linked ? { view: "request", target: extra.linked } : null}
      live={{ data: next, error: extra.error, isLoading: false, refused: false, refreshMs: next?.live ? 5_000 : 0, refresh: vi.fn() }}
      onShowLatest={onShowLatest} onChanged={onChanged} />
  );
  const result = render(view(data));
  return { ...result, onChanged, onShowLatest, rerenderWith: (next: TakeoffRequestActivityResponse) => result.rerender(view(next)) };
}

const units = () => screen.getAllByTestId("takeoff-request-unit");

describe("TakeoffRequestActivity", () => {
  beforeEach(() => { history.data = undefined; });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows plan A ready to review while B is read and C waits, in the recorded order", () => {
    renderActivity(fixtureActivityResponse(fixtureThreePlans()));
    expect(screen.getByTestId("takeoff-request-coverage")).toHaveTextContent("1 plan lu sur 3 · 1 en lecture · 1 en attente");
    expect(units().map((unit) => unit.dataset.state)).toEqual(["succeeded", "running", "queued"]);
    const [a, b, c] = units();
    expect(within(a).getByText("Prêt à revoir")).toBeVisible();
    expect(within(a).getByText("pages 2, 7")).toBeVisible();
    expect(within(a).getByRole("link", { name: "Revoir Plan A — niveau 1.pdf" }))
      .toHaveAttribute("href", `/dashboard/affaires/${FIXTURE_PROJECT}/takeoff/${fixtureJob("a")}/review`);
    expect(within(b).queryByRole("link")).toBeNull();
    expect(within(b).getByText("En lecture")).toBeVisible();
    expect(within(c).getByText("En attente")).toBeVisible();
    // The operator may stop a plan not read yet.
    expect(within(b).getByRole("button", { name: "Annuler" })).toBeEnabled();
  });

  it("gives a reader the states and the review, never an action", () => {
    renderActivity(fixtureActivityResponse(fixtureThreePlans({ reader: true })));
    expect(screen.getByRole("link", { name: "Revoir Plan A — niveau 1.pdf" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Soumettre à nouveau" })).toBeNull();
  });

  it("keeps the focus where it is when another plan arrives in the background", () => {
    const { rerenderWith } = renderActivity(fixtureActivityResponse(fixtureThreePlans()));
    // The focus is on the very plan that arrives.
    const locate = within(units()[1]).getByRole("button", { name: "Bâtiment et niveau de Plan B — niveau 2.pdf" });
    locate.focus();
    rerenderWith(fixtureActivityResponse(fixtureThreePlans({ bDone: true }), { signature: "moved" }));
    expect(document.activeElement).toBe(locate);
    expect(screen.getByTestId("takeoff-request-coverage")).toHaveTextContent("2 plans lus sur 3 · 1 en attente");
    expect(screen.getByRole("link", { name: "Revoir Plan B — niveau 2.pdf" })).toBeVisible();
    // The older executions are read again after a transition, never on their own.
    expect(history.mutate).toHaveBeenCalledTimes(1);
  });

  it("opens the building and level of a plan in the plan location editor", () => {
    renderActivity(fixtureActivityResponse(fixtureThreePlans()));
    fireEvent.click(screen.getByRole("button", { name: "Bâtiment et niveau de Plan A — niveau 1.pdf" }));
    expect(screen.getByRole("dialog", { name: "Bâtiment et niveau" })).toHaveTextContent("Plan A — niveau 1.pdf");
  });

  it("says a read plan without retained line stays reviewable and that nothing is to be sent", () => {
    renderActivity(fixtureActivityResponse(fixtureRequest(
      [fixtureUnit("a", 1, { state: "succeeded", reviewable: true })], [fixtureActivityJob("a", { itemCount: 0 })])));
    expect(screen.getByText("Lu, aucune ligne retenue")).toBeVisible();
    expect(screen.getByText(/rien n’est à envoyer au devis/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Revoir/ })).toBeVisible();
  });

  it("tells why a plan failed and what this member may do, by the resume decision", () => {
    renderActivity(fixtureActivityResponse(fixtureRequest(
      [fixtureUnit("a", 1, { state: "failed", reasonCode: "TAKEOFF_PDF_CORRUPTED" })],
      [fixtureActivityJob("a", { errorCode: "TAKEOFF_PDF_CORRUPTED", resume: { action: "new_analysis", reason: "analysis_closed", availableAt: null } })],
    )));
    expect(screen.getByText("Le PDF est invalide ou protégé.")).toBeVisible();
    expect(screen.getByText(/Cette analyse est close\. Préparez une nouvelle analyse depuis l’affaire\./)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Revoir/ })).toBeNull();
  });

  it("shows lot 2's grouped analysis as one analysis of its plans, with their pages", () => {
    const grouped = fixtureRequest([fixtureUnit("d", 1, { key: "grouped", name: "Analyse groupée de 3 plans", planFileId: null,
      state: "succeeded", reviewable: true })], [fixtureActivityJob("d", { itemCount: 4 })]);
    renderActivity(fixtureActivityResponse({
      ...grouped,
      units: { ...grouped.units!, format: "grouped" },
      groupedPlans: [{ planFileId: null, name: "A.pdf", pages: [2, 7] }, { planFileId: null, name: "B.pdf", pages: [] },
        { planFileId: null, name: "C.pdf", pages: [1] }],
    }));
    expect(units()).toHaveLength(1);
    expect(screen.getByTestId("takeoff-request-coverage")).toHaveTextContent("Analyse groupée de 3 plans · lue");
    expect(within(screen.getByRole("list", { name: "Plans de l’analyse groupée" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("· pages 2, 7")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ouvrir la revue" })).toBeVisible();
  });

  it("offers the gesture the database allows on a request that waits for it, and only then", async () => {
    assume.mockResolvedValue({ ok: true, data: {} });
    const blocked = fixtureRequest(null, [], {
      reason: { code: "MANDATE_REQUIRED", message: "Métré non démarré — la confirmation du dossier n’a engagé aucun forfait ChatGPT." },
      action: { kind: "take_on", label: "Prendre en charge avec mon forfait", mandateRevision: 2 },
    });
    const { onChanged } = renderActivity(fixtureActivityResponse(blocked, { live: false }));
    expect(screen.getByText(/aucun forfait ChatGPT/)).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Prendre en charge avec mon forfait" })); });
    expect(assume).toHaveBeenCalledWith({ projectId: FIXTURE_PROJECT, requestId: blocked.id, seenRevision: 2, action: "take_on" });
    expect(onChanged).toHaveBeenCalled();
    cleanup();
    renderActivity(fixtureActivityResponse({ ...blocked, action: { kind: "none", label: null, mandateRevision: 2 } }, { live: false }));
    expect(screen.queryByRole("button", { name: /forfait/ })).toBeNull();
  });

  it("names the plans added since the analysis, which nothing reads by itself", () => {
    const closed = fixtureRequest([fixtureUnit("a", 1, { state: "succeeded", reviewable: true })], [fixtureActivityJob("a", { itemCount: 1 })], {
      state: "closed", outcome: "success", closedAt: "2026-11-21T09:10:00.000Z",
      dossierChanged: { added: [{ id: fixtureJob("e"), name: "Plan E — ajouté.pdf" }], replaced: [], removed: [] },
    });
    renderActivity(fixtureActivityResponse(closed, { live: false }));
    expect(screen.getByTestId("takeoff-request-dossier-changed")).toHaveTextContent("Plans ajoutés, non mesurés : « Plan E — ajouté.pdf »");
  });

  it("says so when the request an e-mail names is not visible, and leads back to the latest one", () => {
    const { onShowLatest } = renderActivity(fixtureActivityResponse(null, { view: "request", live: false }), { linked: fixtureJob("f") });
    expect(screen.getByText("Cette analyse n’est pas visible avec votre profil, ou elle n’existe plus.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Voir la dernière analyse de l’affaire" }));
    expect(onShowLatest).toHaveBeenCalled();
  });

  it("tells the last known state after a failed read", () => {
    renderActivity(fixtureActivityResponse(fixtureThreePlans()), { error: new Error("réseau") });
    expect(screen.getByTestId("takeoff-request-freshness")).toHaveTextContent(/Dernier état connu à .* : la lecture suivante a échoué\./);
    expect(screen.getByRole("button", { name: "Actualiser" })).toBeEnabled();
  });

  it("lists the older executions with their coverage, folded", () => {
    history.data = fixtureActivityResponse(null, { view: "history", history: [fixtureRequest(
      [fixtureUnit("a", 1, { state: "succeeded", reviewable: true }), fixtureUnit("b", 2, { state: "failed" })],
      [fixtureActivityJob("a", { itemCount: 1 })], { id: fixtureJob("e"), origin: "manual", intent: "reread_plans", state: "closed",
        outcome: "partial", closedAt: "2026-11-20T10:00:00.000Z" })], historyHasOlder: true });
    renderActivity(fixtureActivityResponse(fixtureThreePlans()));
    const older = screen.getByTestId("takeoff-request-history");
    expect(older).toHaveTextContent("Relance de l’analyse · Terminée en partie");
    expect(older).toHaveTextContent("1 plan lu sur 2 · 1 en échec");
    expect(within(older).getByRole("button", { name: "Plus anciennes" })).toBeVisible();
  });
});
