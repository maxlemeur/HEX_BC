import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchMetreDialog } from "@/components/affaires/LaunchMetreDialog";
import { UserProvider, useUserContext } from "@/lib/auth/user-context";
import type { UserProfile } from "@/lib/auth/user-context";
import { TakeoffPreparationPanel } from "@/components/takeoff/TakeoffPreparationPanel";
import { createEmptyTakeoffPreparation, evaluateTakeoffPreparation, takeoffPreparationSourceSchema, type TakeoffPreparation } from "@/lib/takeoff/preparation";
import { buildDeducedTakeoffPreparation, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import type { RelaunchPlanChoice } from "@/lib/takeoff/relaunch-plan-choice-server";
import { FIXTURE_KEY_CONNECTION, fixtureTakeoffPaymentOptions, NO_PAYMENT_OPTIONS } from "@/lib/takeoff/payment-settings.test-fixtures";

const readRelaunchPlans = vi.hoisted(() => vi.fn());
const readPayment = vi.hoisted(() => vi.fn());
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  readTakeoffPaymentOptionsAction: readPayment,
  readRelaunchPlanChoiceAction: readRelaunchPlans,
  launchPreparedTakeoffFromPlanSetAction: vi.fn(),
  launchPreparedTakeoffFromSourceVersionPlanSetAction: vi.fn(),
  relaunchTakeoffAction: vi.fn(),
}));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => ({}) }));

// Each part of the panel's one read has its own mock, as each part fails on its own on the server.
const actions = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), confirm: vi.fn(), assist: vi.fn(), profiles: vi.fn(), saveProfile: vi.fn(), preview: vi.fn(), triageAvailability: vi.fn(), chatGpt: vi.fn(), triage: vi.fn() }));
vi.mock("@/app/dashboard/affaires/_actions/takeoff-preparation", () => ({
  loadTakeoffPreparationPanelAction: async (projectId: string) => {
    const [preparation, profiles, pageTriage, chatGpt] = await Promise.all([actions.load(projectId), actions.profiles(), actions.triageAvailability(projectId), actions.chatGpt()]);
    return { preparation, profiles, pageTriage, chatGpt };
  },
  loadTakeoffExecutionPreviewAction: actions.chatGpt,
  saveTakeoffPreparationAction: actions.save,
  confirmTakeoffPreparationAction: actions.confirm,
  assistTakeoffPreparationAction: actions.assist,
  saveTakeoffPreparationProfileAction: actions.saveProfile,
  getTakeoffPreparationSourcePreviewAction: actions.preview,
  proposeTakeoffPageTriageAction: actions.triage,
}));

const pageContributions = vi.hoisted(() => ({ job: vi.fn(), launch: vi.fn() }));
vi.mock("@/lib/takeoff/page-contributions-client", () => ({
  fetchTakeoffJobPageContributions: pageContributions.job,
  fetchLaunchPageContributions: pageContributions.launch,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE = takeoffPreparationSourceSchema.parse({ document_id: "plan-1", document_name: "Plan plomberie R+1.pdf", kind: "plan", revision: "A", source_version: "version-a", pages: [1], active: true, confirmed: true, plan_set_id: PLAN_SET_ID, page_count: 1 });
const SECOND_PLAN = { ...SOURCE, document_id: "plan-2", document_name: "Plan plomberie R+2.pdf" };
const relaunchPlans: RelaunchPlanChoice = {
  planSetId: PLAN_SET_ID, checkedPlanSetId: PLAN_SET_ID, eligiblePlanSetIds: [PLAN_SET_ID],
  currentIds: [SOURCE.document_id, SECOND_PLAN.document_id], defaultIds: [SOURCE.document_id, SECOND_PLAN.document_id],
  states: { [SOURCE.document_id]: "failed", [SECOND_PLAN.document_id]: "not_analysed" },
  readThrough: {}, stops: {}, unavailable: {}, withoutCopy: [],
};

function completePreparation(): TakeoffPreparation {
  const draft = createEmptyTakeoffPreparation({ estimateVersionId: VERSION_ID });
  return { ...draft, processing: { level: "C", provider: "chatgpt" }, objective: "count", objective_confirmed: true, scope: { ...draft.scope, lots: ["Plomberie"], levels: ["R+1"], zones: ["Zone 1"], exclusions: ["RDC"], confirmed: true }, sources: [SOURCE], conventions: { ...draft.conventions, unit: "u", measurement_basis: "documented", confirmed: true }, destination: { ...draft.destination, kind: "estimate_review", reviewer: "Chargé d'affaires", confirmed: true } };
}

function success<T>(data: T) { return { ok: true as const, data }; }

let stored: TakeoffPreparation;
let storedRevision: number;
let storedConfirmedAt: string | null;
let availableSources: TakeoffPreparation["sources"];
function state() {
  return { draft: structuredClone(stored), revision: storedRevision, availableSources, changedSourceIds: [], needsSave: false, confirmedAt: storedConfirmedAt, confirmedBy: storedConfirmedAt ? "user" : null, sourceFingerprint: "files-a", readiness: evaluateTakeoffPreparation(stored) };
}

beforeEach(() => {
  readPayment.mockReset().mockResolvedValue(NO_PAYMENT_OPTIONS);
  // Reset rather than clear: a `*Once` queue left by a test that failed early must not answer this one.
  for (const mock of [...Object.values(actions), ...Object.values(pageContributions)]) mock.mockReset();
  pageContributions.launch.mockResolvedValue({ version_id: VERSION_ID, pages: [], jobs: [], unidentified_item_ids: [], other_takeoff_line_count: 0 });
  stored = completePreparation();
  storedRevision = 5;
  storedConfirmedAt = null;
  availableSources = [SOURCE];
  actions.chatGpt.mockResolvedValue(null);
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
    return success({ ...state(), retainedPlanFileIds: stored.sources.filter(s => s.active && s.kind === "plan").map(s => s.document_id) });
  });
  actions.profiles.mockResolvedValue(success([]));
  actions.triageAvailability.mockResolvedValue(success({ status: "disabled", message: "Decisions n’est pas activé pour le métré.", model: "gpt-6-luna", max_pages: 60 }));
});
afterEach(cleanup);

const props = { projectId: PROJECT_ID, planSetId: PLAN_SET_ID, estimateVersionId: VERSION_ID };

async function openOptions() {
  const options = await screen.findByRole("button", { name: "Options du métré" });
  if (options.getAttribute("aria-expanded") !== "true") fireEvent.click(options);
}

describe("TakeoffPreparationPanel", () => {
  it("shows the key profile defaults and seals the changed model and effort for one launch", async () => {
    const defaults = fixtureTakeoffPaymentOptions();
    readPayment.mockResolvedValue(defaults);
    actions.chatGpt.mockImplementation(async (input) => input ? success({ fingerprint: "c".repeat(64) }) : null);
    const onLaunch = vi.fn();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    expect(await screen.findByLabelText("Source IA")).toHaveValue("personal_api_key");
    expect(screen.getByLabelText("Modèle")).toHaveValue("gpt-6.1-sol");
    expect(screen.getByText(/Plafond pour cette demande.*25.*US/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Modèle"), { target: { value: "gpt-6.2-sol" } });
    fireEvent.change(screen.getByLabelText(/effort|raisonnement/i), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    const choice = { source: "personal_api_key", model: "gpt-6.2-sol", effort: "high", expectedConnectionId: FIXTURE_KEY_CONNECTION, expectedMaxCostCents: 2500 };
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(6, 1, undefined, choice));
    expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({ paymentChoice: choice, expectedExecutionFingerprint: "c".repeat(64) }));
    expect(actions.saveProfile).not.toHaveBeenCalled();
    cleanup();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    expect(await screen.findByLabelText("Modèle")).toHaveValue("gpt-6.1-sol");
  });

  it("keeps the existing preparation confirmation on an untouched ChatGPT default", async () => {
    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions("chatgpt_plan"));
    actions.chatGpt.mockResolvedValue({ model: "modele-forfait", reasoningEffort: "medium", fingerprint: "d".repeat(64) });
    const onLaunch = vi.fn();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    expect(await screen.findByLabelText("Source IA")).toHaveValue("chatgpt_plan");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(6, 1));
    expect(actions.confirm).toHaveBeenCalledWith({ projectId: PROJECT_ID, expectedRevision: 5, expectedExecutionFingerprint: "d".repeat(64) });
  });
  it("keeps the member's unticked plan and launch count during and after reconnecting", async () => {
    stored.sources = [SOURCE, SECOND_PLAN];
    availableSources = stored.sources;
    let completeRefresh!: (result: ReturnType<typeof success<RelaunchPlanChoice>>) => void;
    readRelaunchPlans.mockReset().mockResolvedValueOnce(success(relaunchPlans))
      .mockImplementationOnce(() => new Promise((resolve) => { completeRefresh = resolve; }));
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LaunchMetreDialog open onOpenChange={vi.fn()} projectId={PROJECT_ID} currentVersion={null}
        plansContext={{ defaultPlanSetId: PLAN_SET_ID }}
        availablePlanSets={[{ id: PLAN_SET_ID, name: "Plans plomberie", fileCount: 2 }]}
        launchMode={{ kind: "request", predecessorJobId: VERSION_ID, planDispatch: true }} />
    </SWRConfig>);
    const plan = () => screen.getByRole("checkbox", { name: /Plan plomberie R\+2\.pdf\s*Non lu/ });
    await screen.findByRole("button", { name: "Relancer 2 plans avec mon forfait" });
    await userEvent.setup().click(plan());
    expect(plan()).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Relancer 1 plan avec mon forfait" })).toBeEnabled();

    fireEvent(window, new Event("online"));
    await waitFor(() => expect(readRelaunchPlans).toHaveBeenCalledTimes(2));
    expect(plan()).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Relancer 1 plan avec mon forfait" })).toBeEnabled();

    await act(async () => { completeRefresh(success({ ...relaunchPlans, states: { ...relaunchPlans.states, [SOURCE.document_id]: "not_analysed" } })); });
    expect(screen.getByRole("checkbox", { name: /Plan plomberie R\+1\.pdf\s*Non lu/ })).toBeChecked();
    expect(plan()).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Relancer 1 plan avec mon forfait" })).toBeEnabled();
  });

  it("keeps unsaved options when an updated selection asks for a new click", async () => {
    stored.sources = [SOURCE, SECOND_PLAN];
    availableSources = stored.sources;
    const refresh = vi.fn().mockResolvedValue({ ...relaunchPlans, defaultIds: [SECOND_PLAN.document_id],
      states: { ...relaunchPlans.states, [SOURCE.document_id]: "analysed" } });
    const onLaunch = vi.fn();
    render(<TakeoffPreparationPanel {...props} planChoice="required" relaunchPlans={relaunchPlans}
      onRefreshRelaunchPlans={refresh} onLaunch={onLaunch} />);
    await openOptions();
    fireEvent.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    fireEvent.change(screen.getByLabelText("Exclusions"), { target: { value: "RDC, Zone 3" } });
    fireEvent.click(screen.getByLabelText("Je confirme ce périmètre"));
    fireEvent.click(screen.getByRole("button", { name: /Vérifier et lancer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Relancer 2 plans avec mon forfait" }));
    await screen.findByText(/La sélection a été actualisée/);
    expect(actions.confirm).not.toHaveBeenCalled();
    expect(onLaunch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByLabelText("Exclusions")).toHaveValue("RDC, Zone 3");
  });

  // TI-682 lot D, PR 1: at the launch, the plan pages the target version already holds from an earlier takeoff are
  // named; the launch stays possible. Written before the notice existed.
  it("names the pages of the chosen plans the target version already holds, and keeps the launch open", async () => {
    pageContributions.launch.mockResolvedValue({ version_id: VERSION_ID, other_takeoff_line_count: 4, unidentified_item_ids: [],
      jobs: [{ id: "66666666-6666-4666-8666-666666666666", estimate_version_id: VERSION_ID, created_at: "2026-11-10T09:30:00.000Z", source_file_name: SOURCE.document_name }],
      pages: [{ file_name: SOURCE.document_name, page: 1, item_ids: [], earlier: [{ job_id: "66666666-6666-4666-8666-666666666666", line_count: 4, takeoff_item_ids: [] }], own_line_count: 0 }] });
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    const notice = await screen.findByRole("region", { name: "Pages déjà au devis" });
    expect(notice).toHaveTextContent("Plan plomberie R+1.pdf, page 1 : déjà au devis par le métré du 10/11/2026");
    expect(pageContributions.launch).toHaveBeenCalledWith({ estimate_version_id: VERSION_ID, documents: [
      { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: SOURCE.document_name, pages: [1] }] }, expect.anything());
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeEnabled();
  });

  // TI-720 moved the list of business profiles from the scope step to the panel, which reads it once: a profile
  // saved on the step must stay listed when the step appears again, without a new read.
  it("keeps a profile saved on the scope step listed after leaving the step, without reading the list again", async () => {
    actions.saveProfile.mockImplementation(async ({ profile }) => success(profile));
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await openOptions();
    await user.click(await screen.findByRole("button", { name: /Ce que je veux mesurer/ }));
    await user.click(screen.getByText("Réutiliser un profil métier"));
    await user.type(screen.getByLabelText("Nom du nouveau profil"), "Plomberie R+1");
    await user.click(screen.getByRole("button", { name: "Enregistrer ce cadrage comme profil" }));
    expect(await screen.findByText(/Profil enregistré/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mes documents/ }));
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByRole("option", { name: "Plomberie R+1 · version 1" })).toBeInTheDocument();
    expect(actions.profiles).toHaveBeenCalledTimes(1);
  });

  // TI-720: the panel's one read answers each part on its own. A refused profile list or page triage availability
  // names itself on its step and leaves the preparation usable.
  it("keeps the preparation usable and names the part that could not be read when one part of its read fails", async () => {
    actions.profiles.mockResolvedValue({ ok: false, error: { status: 503, code: "TAKEOFF_ACTION_UNAVAILABLE", message: "Impossible de charger les profils de préparation.", retryable: true } });
    actions.triageAvailability.mockResolvedValue({ ok: false, error: { status: 403, code: "FORBIDDEN", message: "Accès refusé.", retryable: false } });
    stored.scope = { ...stored.scope, confirmed: false };
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await openOptions();
    await user.click(await screen.findByRole("button", { name: /Mes documents/ }));
    expect(screen.getByRole("region", { name: "Tri des pages" })).toHaveTextContent("La disponibilité du tri des pages n’a pas pu être vérifiée.");
    expect(screen.getByRole("button", { name: "Proposer le tri des pages" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    expect(screen.getByText("Impossible de charger les profils de préparation.")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Je confirme ce périmètre"));
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    expect(await screen.findByText("Préparation enregistrée · révision 6")).toBeInTheDocument();
    expect(stored.scope.confirmed).toBe(true);
  });

  it("keeps the selected pages and objective when an initial load arrives late", async () => {
    const original = state();
    const pending: Array<(value: ReturnType<typeof success<typeof original>>) => void> = [];
    actions.load.mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }));
    render(<StrictMode><TakeoffPreparationPanel {...props} onLaunch={vi.fn()} /></StrictMode>);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[0](success(original)); });

    expect(screen.queryByRole("button", { name: "Options du métré" })).not.toBeInTheDocument();
    await act(async () => { pending[1](success(original)); });
    await openOptions();
    fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
    fireEvent.change(screen.getByLabelText(`Pages de ${SOURCE.document_name}`), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    fireEvent.change(screen.getByLabelText("Objectif du métré"), { target: { value: "extract_quantities" } });

    expect(screen.getByLabelText("Objectif du métré")).toHaveValue("extract_quantities");
    fireEvent.click(screen.getByRole("button", { name: /Mes documents/ }));
    expect(screen.getByLabelText(`Pages de ${SOURCE.document_name}`)).toHaveValue("");
  });

  it("keeps edits made while recovering a preparation and does not silently replace them", async () => {
    actions.save.mockRejectedValueOnce(new Error("Save failed"));
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Confirmer et lancer le métré" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Tri des pages" })).not.toBeInTheDocument();
    await openOptions();
    fireEvent.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
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

  it("shows deduced detail and launches a newly attested preparation without opening the options", async () => {
    stored = buildDeducedTakeoffPreparation({ sources: [SOURCE], planSetId: PLAN_SET_ID });
    actions.load.mockImplementation(async () => success({ ...state(), needsSave: true }));
    const onLaunch = vi.fn();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    expect(screen.getByText("Tout mesurer")).toBeInTheDocument();
    expect(screen.getByText(/Unité par ouvrage/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
    await userEvent.setup().click(launch);
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(7, 1));
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("shows a deduced draft as unsaved and leaves source verification pending", async () => {
    stored = buildDeducedTakeoffPreparation({ sources: [{ ...SOURCE, confirmed: false }], planSetId: PLAN_SET_ID });
    actions.load.mockResolvedValue(success({ ...state(), revision: null, needsSave: true }));
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    expect(await screen.findByText("Préparation à enregistrer")).toBeInTheDocument();
    await openOptions();
    expect(screen.getByText("Préparation à enregistrer")).toBeInTheDocument();
    expect(screen.getByText("Les sources seront vérifiées au lancement. Les résultats resteront à vérifier.")).toBeInTheDocument();
    expect(screen.queryByText(/Préparation complète|Préparation enregistrée/)).not.toBeInTheDocument();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.confirm).not.toHaveBeenCalled();
  });

  it("keeps one version of a plan when the member's revision choices go round in a circle", async () => {
    const revisions = ["A", "B", "C"].map((index) => ({ ...SOURCE, document_id: `plan-${index}`, document_name: `Plan rev ${index}.pdf`,
      revision: index, source_version: `version-${index}`, content_hash: index.toLowerCase().repeat(64) }));
    availableSources = revisions;
    stored = buildDeducedTakeoffPreparation({ sources: revisions, planSetId: PLAN_SET_ID });
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await openOptions();
    fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
    const pair = (left: string, right: string) => screen.getAllByRole("group", { name: "Quelle version retenir ?" })
      .find((group) => within(group).queryByText(new RegExp(`^Plan rev ${left}[.]pdf`)) && within(group).queryByText(new RegExp(`^Plan rev ${right}[.]pdf`)))!;
    fireEvent.click(within(pair("A", "B")).getByRole("button", { name: "Retenir Plan rev A.pdf" }));
    fireEvent.click(within(pair("B", "C")).getByRole("button", { name: "Retenir Plan rev B.pdf" }));
    fireEvent.click(within(pair("A", "C")).getByRole("button", { name: "Retenir Plan rev C.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const saved = actions.save.mock.lastCall![0].draft as TakeoffPreparation;
    expect(resolveDeducedPlanVersions(saved).sources.filter(({ active }) => active).map(({ document_name }) => document_name)).toEqual(["Plan rev C.pdf"]);
    expect(within(pair("B", "C")).getByRole("button", { name: "Retenir Plan rev B.pdf" })).toHaveAttribute("aria-pressed", "false");
  });

  it("asks for a new click and shows the new ChatGPT selection when it changed after the recap", async () => {
    const shown = { model: "modele-a", reasoningEffort: "medium", fingerprint: "a".repeat(64) };
    const changed = { model: "modele-b", reasoningEffort: "high", fingerprint: "b".repeat(64) };
    actions.chatGpt.mockResolvedValueOnce(shown).mockResolvedValueOnce(success(changed));
    const message = "Le compte, le modèle ou l’effort ChatGPT a changé. Vérifiez la sélection affichée et confirmez de nouveau.";
    const confirmed = actions.confirm.getMockImplementation()!;
    actions.confirm.mockResolvedValueOnce({ ok: false, error: { status: 409, code: "TAKEOFF_CHATGPT_SELECTION_CHANGED", message, retryable: false } })
      .mockImplementation(confirmed);
    const onLaunch = vi.fn();
    const user = userEvent.setup();
    render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    expect(await screen.findByText(/^modele-a · Effort moyen[.]/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(/^modele-b · Effort élevé[.]/)).toBeInTheDocument();
    expect(actions.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ expectedExecutionFingerprint: shown.fingerprint }));
    expect(onLaunch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalled());
    expect(actions.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ expectedExecutionFingerprint: changed.fingerprint }));
  });

  it("shows a piece that left the dossier and removes it from the preparation", async () => {
    const other = { ...SOURCE, document_id: "plan-2", document_name: "Plan plomberie R+2.pdf", source_version: "version-b" };
    const missing = { ...SOURCE, source_version: "", content_hash: null, active: false };
    availableSources = [other];
    stored = buildDeducedTakeoffPreparation({ sources: [other], planSetId: PLAN_SET_ID });
    stored.sources = [missing, ...stored.sources];
    stored.plan_revision_decisions = [];
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await openOptions();
    fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
    expect(screen.getByText("Cette pièce n’est plus dans le dossier.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Retirer ${SOURCE.document_name} de la préparation` }));
    expect(screen.queryByLabelText(`Utiliser ${SOURCE.document_name}`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const saved = actions.save.mock.lastCall![0].draft as TakeoffPreparation;
    expect(saved.sources.map(({ document_id }) => document_id)).toEqual(["plan-2"]);
    expect(screen.queryByRole("button", { name: `Retirer ${other.document_name} de la préparation` })).not.toBeInTheDocument();
  });

  it.each([["Garder l’indice A", { revision: "A", revision_reading_settled: "B" }], ["Retenir l’indice B", { revision: "B", revision_reading_settled: "B" }]] as const)(
    "lets the member settle a title-block index that differs from the retained one (%s)", async (choice, expected) => {
      stored = buildDeducedTakeoffPreparation({ sources: [{ ...SOURCE, plan_identity: { number: null, building: null, level: null, discipline: null, revision: "B" } }], planSetId: PLAN_SET_ID });
      render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
      expect(await screen.findByText(/^Le cartouche de « Plan plomberie R\+1[.]pdf » indique l’indice B/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
      await openOptions();
      fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
      fireEvent.click(screen.getByRole("button", { name: choice }));
      fireEvent.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
      await waitFor(() => expect(actions.save).toHaveBeenCalled());
      const saved = (actions.save.mock.lastCall![0].draft as TakeoffPreparation).sources[0];
      expect(saved).toMatchObject(expected);
      fireEvent.click(screen.getByRole("button", { name: /Vérifier et lancer/ }));
      expect(screen.queryByText(/^Le cartouche de/)).not.toBeInTheDocument();
    });

  it("proposes the page triage of an untouched deduced draft without a manual save first", async () => {
    const storedPlan = { ...SOURCE, file_path: "tenant/plans/plan-1.pdf" };
    availableSources = [storedPlan];
    stored = buildDeducedTakeoffPreparation({ sources: [storedPlan], planSetId: PLAN_SET_ID });
    actions.load.mockResolvedValueOnce(success({ ...state(), revision: null, needsSave: true }));
    actions.triageAvailability.mockResolvedValue(success({ status: "available", message: "Tri disponible.", model: "gpt-6-luna", max_pages: 60 }));
    actions.triage.mockImplementation(async () => success({ state: state(), outcome: { message: "Pages proposées.", stop_reason: null } }));
    // The first save of a deduced draft has no revision to compare.
    actions.save.mockImplementationOnce(async ({ draft, expectedRevision }) => {
      if (expectedRevision !== null) throw new Error("La préparation a changé.");
      stored = structuredClone(draft);
      storedRevision = 6;
      return success(state());
    });
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await openOptions();
    fireEvent.click(await screen.findByRole("button", { name: /Mes documents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Proposer le tri des pages" }));
await waitFor(() => expect(actions.triage).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 6, documentId: SOURCE.document_id })));
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("La préparation n’est pas enregistrée.")).not.toBeInTheDocument();
  });

  it("includes the selected building in the closed-options recap", async () => {
    stored.scope.buildings = ["Bâtiment Ouest"];
    render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    expect(screen.getByText(/Bâtiment Ouest/)).toBeInTheDocument();
  });

  it("clears the displayed preparation immediately when the active tenant changes", async () => {
    const profile: UserProfile = { id: "user-a", full_name: "User", phone: null, job_title: null, work_email: null, role: "admin", ui_mode: "simplified", tenant_id: "tenant-a", tenant_role: "admin" };
    let resolveLoad: (value: unknown) => void = () => undefined;
    actions.load.mockResolvedValueOnce(success(state())).mockImplementationOnce(() => new Promise((resolve) => { resolveLoad = resolve; }));
    function SwitchTenant() {
      const { setProfile } = useUserContext();
      return <button type="button" onClick={() => setProfile({ ...profile, tenant_id: "tenant-b" })}>Changer d’organisation</button>;
    }
    render(<UserProvider initialUserEmail="user@example.test" initialProfile={profile}><SwitchTenant /><TakeoffPreparationPanel {...props} onLaunch={vi.fn()} /></UserProvider>);
    expect(await screen.findByText(/Analyse détaillée avec votre forfait ChatGPT/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Changer d’organisation" }));
    expect(screen.queryByText(/Analyse détaillée avec votre forfait ChatGPT/)).not.toBeInTheDocument();
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
    const { rerender } = render(<TakeoffPreparationPanel {...props} onLaunch={onLaunch} />);
    const launch = await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    await openOptions();
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).not.toHaveBeenCalled();
    await user.click(launch);
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(5, 1));
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
    await waitFor(() => expect(onLaunch).toHaveBeenLastCalledWith(7, 1));
    expect(actions.confirm).toHaveBeenLastCalledWith({ projectId: PROJECT_ID, expectedRevision: 6 });
    expect(stored).toEqual(original);

    const nextSetId = "44444444-4444-4444-8444-444444444444";
    const nextDraft = buildDeducedTakeoffPreparation({ sources: [{ ...SOURCE, plan_set_id: nextSetId }], planSetId: nextSetId });
    actions.load.mockResolvedValueOnce(success({ ...state(), draft: nextDraft, confirmedAt: null, needsSave: true }));
    rerender(<TakeoffPreparationPanel {...props} planSetId={nextSetId} onLaunch={onLaunch} />);
    expect(await screen.findByText("Préparation à enregistrer")).toBeInTheDocument();
    expect(screen.queryByText(/Nouvelle préparation enregistrée/)).not.toBeInTheDocument();
  });

  it("reopens a confirmed source-version request on its current fork without changing its destination or revision", async () => {
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const forkVersionId = "44444444-4444-4444-8444-444444444444";
    const original = structuredClone(stored);
    const user = userEvent.setup();
    const onLaunch = vi.fn().mockRejectedValue(new Error("Réponse interrompue"));
    render(<TakeoffPreparationPanel {...props} estimateVersionId={forkVersionId} onLaunch={onLaunch} />);
    await openOptions();
    await user.click(await screen.findByRole("button", { name: "Enregistrer maintenant" }));
    expect(actions.save).not.toHaveBeenCalled();
    expect(stored.destination.estimate_version_id).toBe(VERSION_ID);
    expect(screen.getByText("La destination de la préparation diffère de la version cible sélectionnée.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(5, 1));
    expect(actions.confirm).toHaveBeenCalledWith({ projectId: PROJECT_ID, expectedRevision: 5 });
    expect(stored).toEqual(original);
    expect(actions.save).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Ce que je veux mesurer/ }));
    await user.type(screen.getByRole("textbox", { name: "Exclusions" }), ", Zone 2");
    await user.click(screen.getByRole("button", { name: "Enregistrer maintenant" }));
    await waitFor(() => expect(stored.scope.exclusions).toEqual(["RDC", "Zone 2"]));
    expect(stored.destination.estimate_version_id).toBe(VERSION_ID);
  });

  it("invalidates a specialized destination when the operator explicitly binds a different version", async () => {
    storedConfirmedAt = "2026-10-29T12:00:00Z";
    const chosenVersionId = "44444444-4444-4444-8444-444444444444";
    const user = userEvent.setup();
    const view = render(<TakeoffPreparationPanel {...props} onLaunch={vi.fn()} />);
    await screen.findByRole("button", { name: "Confirmer et lancer le métré" });
    view.rerender(<TakeoffPreparationPanel {...props} estimateVersionId={chosenVersionId} onLaunch={vi.fn()} />);
    await openOptions();
    await user.click(screen.getByRole("button", { name: "Utiliser la version cible sélectionnée" }));
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
    await openOptions();
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
    await openOptions();
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
    await openOptions();
    await user.click(await screen.findByRole("button", { name: /Mes documents/ }));
    const pages = screen.getByRole("textbox", { name: `Pages de ${SOURCE.document_name}` });
    fireEvent.change(pages, { target: { value: "1, invalid" } });
    expect(pages).toHaveValue("1, invalid");
    expect(pages).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: /Vérifier et lancer/ }));
    expect(screen.getByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
  });
});
