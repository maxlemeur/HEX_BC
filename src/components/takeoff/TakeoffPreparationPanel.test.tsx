import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProvider, useUserContext } from "@/components/UserContext";
import type { UserProfile } from "@/lib/auth/server";
import { TakeoffProviderSelect } from "@/components/takeoff/TakeoffProviderSelect";
import type { PreparationAdvancedControlsContext } from "@/components/takeoff/TakeoffPreparationPanel";
import { TakeoffPreparationPanel } from "@/components/takeoff/TakeoffPreparationPanel";
import { createEmptyTakeoffPreparation, evaluateTakeoffPreparation, takeoffPreparationSourceSchema, type TakeoffPreparation } from "@/lib/takeoff/preparation";

const loadChatGptConnectionMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/dashboard/_actions/chatgpt", () => ({ loadChatGptConnection: loadChatGptConnectionMock }));

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
  return { ...draft, processing: { level: "B", provider: "auto" }, objective: "count", objective_confirmed: true, scope: { ...draft.scope, lots: ["Plomberie"], levels: ["R+1"], zones: ["Zone 1"], exclusions: ["RDC"], confirmed: true }, sources: [SOURCE], conventions: { ...draft.conventions, unit: "u", measurement_basis: "documented", confirmed: true }, destination: { ...draft.destination, reviewer: "Chargé d'affaires", confirmed: true } };
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
  loadChatGptConnectionMock.mockResolvedValue(null);
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
});
afterEach(cleanup);

const props = { projectId: PROJECT_ID, planSetId: PLAN_SET_ID, estimateVersionId: VERSION_ID };

function processingControls({ processing, onProcessingChange, isConfirmed }: PreparationAdvancedControlsContext) {
  return <div>
    {(["A", "B", "C"] as const).map((level) => <label key={level}><input type="radio" name="persisted-processing-level" checked={processing.level === level} onChange={() => onProcessingChange({ level })} />{{ A: "Rapide", B: "Standard", C: "Détaillé" }[level]}</label>)}
    <TakeoffProviderSelect value={processing.provider} onChange={(provider) => onProcessingChange({ provider })} preserveAutomaticChoice={isConfirmed} />
  </div>;
}

describe("TakeoffPreparationPanel", () => {
  it("keeps the source revision and objective when an initial load arrives late", async () => {
    const original = state();
    const pending: Array<(value: ReturnType<typeof success<typeof original>>) => void> = [];
    actions.load.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    render(<StrictMode><TakeoffPreparationPanel {...props} onLaunch={vi.fn()} /></StrictMode>);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[0](success(original)); });

    // The UI may wait for the newest request; if it is already editable, the
    // late response must not erase what the user enters before it completes.
    const editableBeforeLatest = screen.queryByRole("button", { name: /Mes documents/ }) !== null;
    if (!editableBeforeLatest) await act(async () => { pending[1](success(original)); });
    fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
    fireEvent.change(screen.getByLabelText(`Révision de ${SOURCE.document_name}`), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    fireEvent.change(screen.getByLabelText("Objectif du métré"), { target: { value: "extract_quantities" } });
    if (editableBeforeLatest) await act(async () => { pending[1](success(original)); });

    expect(screen.getByLabelText("Objectif du métré")).toHaveValue("extract_quantities");
    fireEvent.click(screen.getByRole("button", { name: /Mes documents/ }));
    expect(screen.getByLabelText(`Révision de ${SOURCE.document_name}`)).toHaveValue("B");
  });

  it("keeps edits made while recovering a preparation and does not silently replace them", async () => {
    actions.save.mockRejectedValueOnce(new Error("Save failed"));
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ce que je veux mesurer/ }));
    fireEvent.change(screen.getByLabelText("Exclusions"), { target: { value: "RDC, Zone 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await screen.findByText(/L.enregistrement a échoué/);
    let finishReload: (value: ReturnType<typeof success<ReturnType<typeof state>>>) => void = () => undefined;
    const original = state();
    actions.load.mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Reprendre la dernière préparation" }));
    fireEvent.change(screen.getByLabelText("Exclusions"), { target: { value: "RDC, Zone 3" } });
    await act(async () => { finishReload(success(original)); });
    expect(screen.getByLabelText("Exclusions")).toHaveValue("RDC, Zone 3");
    expect(screen.getByText(/modifiée pendant le chargement/)).toBeInTheDocument();
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("preserves incompatible saved settings until an explicit repair rather than using the new source recommendation", async () => {
    stored.processing = { level: "C", provider: "chatgpt" };
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} recommendedLevel="A" compatibleLevels={["A"]} advancedControls={processingControls} onLaunch={vi.fn()} />);
    expect(await screen.findByText(/Le niveau enregistré n’est pas compatible/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
    await user.click(screen.getByText("Options avancées"));
    expect(screen.getByRole("radio", { name: "Détaillé" })).toBeChecked();
    expect(screen.getByLabelText("Fournisseur IA")).toHaveValue("chatgpt");
    expect(await screen.findByText(/Connectez votre forfait ChatGPT et choisissez un modèle/)).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: "Rapide" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.processing).toEqual({ level: "A", provider: "chatgpt" }));
  });

  it("initializes legacy unset processing once and never replaces it with a later recommendation", async () => {
    stored.processing = { level: null, provider: "auto" };
    const user = userEvent.setup();
    const view = render(<TakeoffPreparationPanel {...props} recommendedLevel="C" advancedControls={processingControls} onLaunch={vi.fn()} />);
    await user.click(await screen.findByText("Options avancées"));
    expect(screen.getByRole("radio", { name: "Détaillé" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.processing.level).toBe("C"));
    actions.save.mockClear();
    view.rerender(<TakeoffPreparationPanel {...props} recommendedLevel="B" advancedControls={processingControls} onLaunch={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Détaillé" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).not.toHaveBeenCalled();
  });

  it("clears the displayed preparation immediately when the active tenant changes", async () => {
    const profile: UserProfile = { id: "user-a", full_name: "User", phone: null, job_title: null, work_email: null, role: "admin", ui_mode: "simplified", tenant_id: "tenant-a", tenant_role: "admin" };
    let resolveLoad: (value: unknown) => void = () => undefined;
    actions.load.mockResolvedValueOnce(success(state())).mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    function SwitchTenant() {
      const { setProfile } = useUserContext();
      return <button type="button" onClick={() => setProfile({ ...profile, tenant_id: "tenant-b" })}>Changer d’organisation</button>;
    }
    render(<UserProvider initialUserEmail="user@example.test" initialProfile={profile}><SwitchTenant /><TakeoffPreparationPanel {...props} advancedControls={processingControls} onLaunch={vi.fn()} /></UserProvider>);
    expect(await screen.findByText(/Réglages du traitement : Standard/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Changer d’organisation" }));
    expect(screen.queryByText(/Réglages du traitement : Standard/)).not.toBeInTheDocument();
    expect(screen.getByText("Chargement de la préparation…")).toBeInTheDocument();
    resolveLoad({ ok: false, error: { status: 403, code: "FORBIDDEN", message: "Affaire inaccessible dans cette organisation.", retryable: false } });
    expect(await screen.findByText("Affaire inaccessible dans cette organisation.")).toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
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
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(5, { level: "B", provider: "auto" }));
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
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(7, { level: "B", provider: "auto" }));
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
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(5, { level: "B", provider: "auto" }));
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
});
