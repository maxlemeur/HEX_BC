import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffPreparationPanel } from "@/components/takeoff/TakeoffPreparationPanel";
import { createEmptyTakeoffPreparation, evaluateTakeoffPreparation, takeoffPreparationSourceSchema, type TakeoffPreparation } from "@/lib/takeoff/preparation";

const actions = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), confirm: vi.fn(), assist: vi.fn(), profiles: vi.fn(), saveProfile: vi.fn(), preview: vi.fn() }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff-preparation", () => ({
  loadTakeoffPreparationAction: actions.load,
  saveTakeoffPreparationAction: actions.save,
  confirmTakeoffPreparationAction: actions.confirm,
  assistTakeoffPreparationAction: actions.assist,
  loadTakeoffPreparationProfilesAction: actions.profiles,
  saveTakeoffPreparationProfileAction: actions.saveProfile,
  getTakeoffPreparationSourcePreviewAction: actions.preview,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE = takeoffPreparationSourceSchema.parse({ document_id: "plan-1", document_name: "Plan plomberie R+1.pdf", kind: "plan", revision: "A", source_version: "version-a", pages: [1], active: true, confirmed: true, plan_set_id: PLAN_SET_ID, page_count: 1 });

function completePreparation(): TakeoffPreparation {
  const draft = createEmptyTakeoffPreparation({ estimateVersionId: VERSION_ID });
  return { ...draft, objective: "count", objective_confirmed: true, scope: { ...draft.scope, lots: ["Plomberie"], levels: ["R+1"], zones: ["Zone 1"], exclusions: ["RDC"], confirmed: true }, sources: [SOURCE], conventions: { ...draft.conventions, unit: "u", measurement_basis: "documented", confirmed: true }, destination: { ...draft.destination, reviewer: "Chargé d'affaires", confirmed: true } };
}

function success<T>(data: T) { return { ok: true as const, data }; }

let stored: TakeoffPreparation;
let storedRevision: number;
let storedConfirmedAt: string | null;
function state() {
  return { draft: structuredClone(stored), revision: storedRevision, availableSources: [SOURCE], changedSourceIds: [], confirmedAt: storedConfirmedAt, confirmedBy: storedConfirmedAt ? "user" : null, sourceFingerprint: "files-a", readiness: evaluateTakeoffPreparation(stored) };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = completePreparation();
  storedRevision = 5;
  storedConfirmedAt = null;
  actions.load.mockImplementation(async () => success(state()));
  actions.save.mockImplementation(async ({ draft, expectedRevision }) => {
    if (expectedRevision !== storedRevision) throw new Error("La préparation a changé.");
    stored = structuredClone(draft);
    storedRevision++;
    storedConfirmedAt = null;
    return success(state());
  });
  actions.confirm.mockImplementation(async ({ expectedRevision }) => {
    if (expectedRevision !== storedRevision) throw new Error("La préparation a changé.");
    if (!storedConfirmedAt) storedRevision++;
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    return success(state());
  });
  actions.profiles.mockResolvedValue(success([]));
  actions.assist.mockResolvedValue({ ok: false, error: { status: 503, code: "AI_UNAVAILABLE", message: "Assistance indisponible", retryable: true } });
  actions.preview.mockResolvedValue(success({ url: "https://example.test/plan.pdf#page=1", name: SOURCE.document_name }));
});
afterEach(cleanup);

const props = { projectId: PROJECT_ID, planSetId: PLAN_SET_ID, estimateVersionId: VERSION_ID };

describe("TakeoffPreparationPanel", () => {
  it("allows editing and saving without an estimate target while keeping launch disabled", async () => {
    stored.destination.estimate_version_id = null;
    const user = userEvent.setup();
    const onLaunch = vi.fn();
    render(<TakeoffPreparationPanel {...props} estimateVersionId={null} launchDisabled onLaunch={onLaunch} />);
    await user.click(await screen.findByRole("button", { name: /Ce que je veux mesurer/ }));
    const lots = screen.getByRole("textbox", { name: "Lots" });
    expect(lots).toBeEnabled();
    await user.clear(lots);
    await user.type(lots, "Électricité");
    await user.click(screen.getByLabelText("Je confirme ce périmètre"));
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.scope.lots).toEqual(["Électricité"]));
    expect(stored.destination.estimate_version_id).toBeNull();
    await user.click(screen.getByRole("button", { name: /Vérifier et lancer/ }));
    await user.click(screen.getByLabelText("Je confirme la destination et la revue des résultats"));
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("resumes the recap and confirms a plan-only count before launching the returned revision", async () => {
    const onLaunch = vi.fn().mockResolvedValue(undefined);
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    expect(launch).toBeEnabled();
    expect(screen.queryByText(/La comparaison nécessite le DPGF/)).not.toBeInTheDocument();
    await userEvent.setup().click(launch);
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(6));
    expect(actions.confirm).toHaveBeenCalledWith({ projectId: PROJECT_ID, expectedRevision: 5 });
  });

  it("reuses the confirmed receipt for a retry and explicitly renews unchanged answers for an intentional new analysis", async () => {
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const original = structuredClone(stored);
    const user = userEvent.setup();
    const onLaunch = vi.fn().mockRejectedValue(new Error("Traitement indisponible"));
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).not.toHaveBeenCalled();
    await user.click(launch);
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(5));
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.confirm).toHaveBeenLastCalledWith({ projectId: PROJECT_ID, expectedRevision: 5 });
    expect(screen.getByText("Conserve vos réponses et ouvre une nouvelle préparation.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Préparer une nouvelle analyse" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save).toHaveBeenLastCalledWith({ projectId: PROJECT_ID, draft: original, expectedRevision: 5 });
    expect(stored).toEqual(original);
    expect(storedConfirmedAt).toBeNull();
    expect(await screen.findByText(/Nouvelle préparation enregistrée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Préparer une nouvelle analyse" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(7));
    expect(actions.confirm).toHaveBeenLastCalledWith({ projectId: PROJECT_ID, expectedRevision: 6 });
    expect(stored).toEqual(original);
  });

  it("reopens a confirmed source-version request on its current fork without changing its destination or revision", async () => {
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const forkVersionId = "44444444-4444-4444-8444-444444444444";
    const original = structuredClone(stored);
    const user = userEvent.setup();
    const onLaunch = vi.fn().mockRejectedValue(new Error("Réponse interrompue"));
    render(<TakeoffPreparationPanel {...props} estimateVersionId={forkVersionId} onLaunch={onLaunch} />);
    await user.click(await screen.findByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).not.toHaveBeenCalled();
    expect(stored.destination.estimate_version_id).toBe(VERSION_ID);
    expect(screen.getByText(/La destination enregistrée est conservée/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(5));
    expect(actions.confirm).toHaveBeenCalledWith({ projectId: PROJECT_ID, expectedRevision: 5 });
    expect(stored).toEqual(original);
    expect(actions.save).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    await user.type(screen.getByRole("textbox", { name: "Exclusions" }), ", Zone 2");
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.scope.exclusions).toEqual(["RDC", "Zone 2"]));
    expect(stored.destination.estimate_version_id).toBe(VERSION_ID);
  });

  it("invalidates the destination after an explicit version-picker choice", async () => {
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const chosenVersionId = "44444444-4444-4444-8444-444444444444";
    const user = userEvent.setup();
    const view = render(<TakeoffPreparationPanel {...props} targetSelectionKey={0} onLaunch={vi.fn()} />);
    await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    view.rerender(<TakeoffPreparationPanel {...props} estimateVersionId={chosenVersionId} targetSelectionKey={1} onLaunch={vi.fn()} />);
    expect(await screen.findByLabelText("Je confirme la destination et la revue des résultats")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5, draft: expect.objectContaining({ destination: expect.objectContaining({ estimate_version_id: chosenVersionId, confirmed: false }) }) })));
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
  });

  it("keeps the confirmation revision after a failed launch, then saves new exclusions without a stale-write error", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn().mockRejectedValue(new Error("Traitement indisponible"));
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText("Impossible de confirmer le lancement. Vos réponses sont conservées.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    const exclusions = screen.getByRole("textbox", { name: "Exclusions" });
    await user.clear(exclusions);
    await user.type(exclusions, "RDC, Zone 2");
    expect(exclusions).toHaveValue("RDC, Zone 2");
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 6, draft: expect.objectContaining({ scope: expect.objectContaining({ exclusions: ["RDC", "Zone 2"], confirmed: false }) }) })));
    expect(screen.getByLabelText("Je confirme ce périmètre")).not.toBeChecked();
  });

  it("retains saved scope after reopening and leaves unanswered purchase losses null", async () => {
    stored.objective = "prepare_purchase";
    stored.conventions = { ...stored.conventions, purchase: { deductions: "Aucune", waste_percent: null, rounding: "Barre entière", packaging: "Barre de 3 m" }, confirmed: false };
    const user = userEvent.setup();
    const view = render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    const losses = await screen.findByRole("spinbutton", { name: "Pertes (%)" });
    expect(losses).toHaveValue(null);
    await user.type(losses, "0");
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.conventions.purchase?.waste_percent).toBe(0));
    view.unmount();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    expect(await screen.findByRole("spinbutton", { name: "Pertes (%)" })).toHaveValue(0);
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByRole("textbox", { name: "Niveaux" })).toHaveValue("R+1");
    expect(screen.getByRole("textbox", { name: "Zones" })).toHaveValue("Zone 1");
  });

  it("blocks an uncalibrated length and preserves unknown calibration numbers as null", async () => {
    stored.objective = "measure_length";
    stored.conventions.unit = "m";
    stored.conventions.measurement_basis = "unknown";
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Vérifier et lancer/ }));
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
    expect(screen.getByText(/Une mesure géométrique nécessite/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Points à préciser/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Base de mesure" }), "calibrated");
    await user.selectOptions(screen.getByRole("combobox", { name: "Plan de calibration" }), SOURCE.document_id);
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.conventions.calibration).toEqual(expect.objectContaining({ document_id: SOURCE.document_id, page: null, reference_length: null, measured_span: null, measured_span_unit: null })));
  });

  it("keeps malformed page input visible and blocks its confirmation instead of broadening to all pages", async () => {
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Mes documents/ }));
    const pages = screen.getByRole("textbox", { name: `Pages de ${SOURCE.document_name}` });
    fireEvent.change(pages, { target: { value: "1, invalid" } });
    expect(pages).toHaveValue("1, invalid");
    expect(pages).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByLabelText("Je confirme les pièces actives et leurs révisions"));
    await user.click(screen.getByRole("button", { name: /Vérifier et lancer/ }));
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
  });

  it("shows a safe source-conflict response and keeps answers available for revalidation", async () => {
    const message = "Les sources ont changé. Vérifiez les documents avant une nouvelle confirmation.";
    actions.confirm.mockResolvedValueOnce({ ok: false, error: { status: 409, code: "TAKEOFF_CONFLICT", message, retryable: false } });
    const onLaunch = vi.fn();
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reprendre la dernière préparation" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByRole("textbox", { name: "Niveaux" })).toHaveValue("R+1");
    expect(screen.getByRole("textbox", { name: "Exclusions" })).toHaveValue("RDC");
  });

  it("uses a plain-language fallback for unexpected transport errors", async () => {
    actions.confirm.mockRejectedValueOnce(new Error("Minified React error #441; internal detail"));
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText("Impossible de confirmer le lancement. Vos réponses sont conservées.")).toBeInTheDocument();
    expect(screen.queryByText(/Minified React/)).not.toBeInTheDocument();
  });

  it("keeps confirmed business fields when assistance fails and opens the exact source page", async () => {
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await user.click(await screen.findByText("Assistance au cadrage"));
    await user.click(screen.getByRole("button", { name: "Proposer un cadrage" }));
    expect(await screen.findByText(/Assistance indisponible/)).toHaveTextContent(/réponses sont conservées/);
    await user.click(screen.getByRole("button", { name: /Mes documents/ }));
    await user.click(screen.getByRole("button", { name: `Voir ${SOURCE.document_name} — page 1` }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith({ projectId: PROJECT_ID, documentId: SOURCE.document_id, page: 1 }));
    expect(screen.getByTitle(`Aperçu de ${SOURCE.document_name}, page 1`)).toHaveAttribute("src", "https://example.test/plan.pdf#page=1");
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByLabelText("Je confirme cet objectif")).toBeChecked();
    expect(screen.getByLabelText("Je confirme ce périmètre")).toBeChecked();
  });
});
