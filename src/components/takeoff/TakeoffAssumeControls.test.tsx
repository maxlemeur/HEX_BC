import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiBillingSource } from "@/lib/ai/access/contracts";
import { UserProvider, type UserProfile } from "@/lib/auth/user-context";
import { FIXTURE_KEY_CONNECTION, FIXTURE_PLAN_CONNECTION, fixtureTakeoffPaymentOptions, NO_PAYMENT_OPTIONS } from "@/lib/takeoff/payment-settings.test-fixtures";

import { TakeoffAssumeControls } from "./TakeoffAssumeControls";

const assume = vi.hoisted(() => vi.fn());
const readPayment = vi.hoisted(() => vi.fn());
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ assumeTakeoffLaunchRequestAction: assume, readTakeoffPaymentOptionsAction: readPayment }));

const PROJECT = "ab100000-0000-4000-8000-000000000001";
const REQUEST = "ab100000-0000-4000-8000-000000000002";
const profile: UserProfile = { id: "ab100000-0000-4000-8000-000000000003", full_name: "Camille Fictive", phone: null, job_title: null,
  work_email: null, role: "buyer", ui_mode: "expert", tenant_id: "ab100000-0000-4000-8000-000000000004", tenant_role: "engineer" };
/** What `main` sends for this gesture: no payment choice. */
const AS_ON_MAIN = { projectId: PROJECT, requestId: REQUEST, seenRevision: 4, action: "take_on" };
const UNREADABLE = { ok: false, error: { status: 500, code: "INTERNAL_ERROR", message: "Les réglages IA du métré n’ont pas pu être lus.", retryable: false } } as const;
const pending = () => new Promise<never>(() => {});

/** `page`: the payer of Mon profil the dashboard rendered with; "absent" renders outside the dashboard. */
function renderControls(page: AiBillingSource | null | "absent") {
  const controls = <TakeoffAssumeControls projectId={PROJECT} requestId={REQUEST} revision={4} action="take_on"
    label="Prendre en charge avec mon forfait" busyLabel="Prise en charge…" onChanged={vi.fn()} />;
  return render(page === "absent" ? controls
    : <UserProvider initialUserEmail="camille@example.test" initialProfile={profile} aiDefaultSource={page}>{controls}</UserProvider>);
}
const withPlan = () => screen.getByRole("button", { name: "Prendre en charge avec mon forfait" });
const reloadButton = () => screen.getByRole("button", { name: "Recharger les réglages" });

beforeEach(() => {
  assume.mockReset().mockResolvedValue({ ok: true, data: {} });
  readPayment.mockReset().mockResolvedValue(NO_PAYMENT_OPTIONS);
});
afterEach(cleanup);

describe("a member whose profile pays with the ChatGPT plan", () => {
  it("takes the request on before the options are read, with the call made before the settings existed", async () => {
    readPayment.mockImplementation(pending);
    renderControls("chatgpt_plan");
    expect(withPlan()).toBeEnabled();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenCalledWith(AS_ON_MAIN));
  });

  it.each([
    ["the server could not read the options", () => Promise.resolve(UNREADABLE)],
    ["the read never reached the server", () => Promise.reject(new Error("fictional network failure"))],
  ] as const)("still takes it on when %s, and can reload them", async (_label, read) => {
    readPayment.mockImplementation(read);
    renderControls("chatgpt_plan");
    const notice = await screen.findByText(/Les réglages IA du métré n’ont pas pu être lus\. Vous pouvez lancer avec votre forfait ChatGPT/);
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByLabelText("Source IA")).toBeNull();
    expect(withPlan()).toBeEnabled();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenCalledWith(AS_ON_MAIN));

    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions("chatgpt_plan"));
    fireEvent.click(reloadButton());
    expect(await screen.findByLabelText("Source IA")).toHaveValue("chatgpt_plan");
    // The member asked: the plan's models are read from ChatGPT again. An opening reads the catalogue already held.
    expect(readPayment.mock.calls).toEqual([[{ projectId: PROJECT }], [{ projectId: PROJECT, live: true }]]);
    expect(screen.queryByRole("button", { name: "Recharger les réglages" })).toBeNull();
  });

  it("sends the key once the options say the profile now pays with it, and says the default source changed", async () => {
    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions("personal_api_key"));
    renderControls("chatgpt_plan");
    expect(withPlan()).toBeEnabled();
    expect(screen.queryByText(/Votre source par défaut a changé/)).toBeNull();
    const withKey = await screen.findByRole("button", { name: "Prendre en charge avec ma clé API" });
    // The gesture's label just changed under the member: one line says why.
    expect(screen.getByText("Votre source par défaut a changé : c’est maintenant votre clé API OpenAI.")).toHaveAttribute("role", "status");
    fireEvent.click(withKey);
    await waitFor(() => expect(assume).toHaveBeenCalledWith({ ...AS_ON_MAIN, paymentChoice: { source: "personal_api_key",
      model: "gpt-6.1-sol", effort: "medium", expectedConnectionId: FIXTURE_KEY_CONNECTION, expectedMaxCostCents: 2500 } }));
  });
});

describe("a member whose profile does not pay with the ChatGPT plan", () => {
  it("says nothing about the default source when the options name the payer the page rendered with", async () => {
    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions("personal_api_key"));
    renderControls("personal_api_key");
    await waitFor(() => expect(screen.getByRole("button", { name: "Prendre en charge avec ma clé API" })).toBeEnabled());
    expect(screen.queryByText(/Votre source par défaut a changé/)).toBeNull();
  });

  it("waits for the key's options", () => {
    readPayment.mockImplementation(pending);
    renderControls("personal_api_key");
    expect(screen.getByRole("button", { name: "Prendre en charge avec ma clé API" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Lecture des réglages du métré…");
  });

  it.each([
    ["the key", "personal_api_key", "Prendre en charge avec ma clé API", /Votre source IA par défaut est votre clé API OpenAI : rechargez les réglages avant de lancer\. Rien n’est lancé avec votre forfait à sa place\./],
    ["an unreadable profile", null, "Prendre en charge avec mon forfait", /Rechargez les réglages avant de lancer\./],
    ["a page that did not read the profile", "absent", "Prendre en charge avec mon forfait", /Rechargez les réglages avant de lancer\./],
  ] as const)("stays blocked on %s when the options cannot be read: nothing falls back to the plan", async (_label, page, name, message) => {
    readPayment.mockResolvedValue(UNREADABLE);
    renderControls(page);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(assume).not.toHaveBeenCalled();

    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions("personal_api_key"));
    fireEvent.click(reloadButton());
    fireEvent.click(await screen.findByRole("button", { name: "Prendre en charge avec ma clé API" }));
    await waitFor(() => expect(assume).toHaveBeenCalledWith(expect.objectContaining({
      paymentChoice: expect.objectContaining({ source: "personal_api_key", expectedMaxCostCents: 2500 }) })));
  });

  it("is offered no choice and sends none when the member may not pay the affaire's takeoff", async () => {
    renderControls("personal_api_key");
    await waitFor(() => expect(withPlan()).toBeEnabled());
    expect(screen.queryByLabelText("Source IA")).toBeNull();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenCalledWith(AS_ON_MAIN));
  });
});

describe("the setting shown for an untouched plan", () => {
  const options = () => {
    const shown = fixtureTakeoffPaymentOptions("chatgpt_plan");
    if (!shown.ok || !shown.data.options.chatgpt_plan?.ok) throw new Error("fixture");
    const plan = shown.data.options.chatgpt_plan;
    // Mon profil keeps « medium »; the model now offers low and high only, so the validated setting falls back to automatic.
    plan.models = plan.models.map((model) => ({ ...model, reasoningEfforts: ["low", "high"], defaultReasoningEffort: null })) as typeof plan.models;
    plan.preferences = { model: "modele-forfait", reasoningEffort: null };
    shown.data.planSetting = { model: "modele-forfait", reasoningEffort: "medium" };
    return shown;
  };

  it("is the profile's own, as a request without a choice sends it, until the member chooses another", async () => {
    readPayment.mockResolvedValue(options());
    renderControls("chatgpt_plan");
    const effort = await screen.findByLabelText("Effort de raisonnement");
    expect(effort).toHaveValue("medium");
    expect(screen.getByRole("option", { name: "Moyen · sélection actuelle" })).toBeDisabled();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenCalledWith(AS_ON_MAIN));

    fireEvent.change(effort, { target: { value: "high" } });
    expect(effort).toHaveValue("high");
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenLastCalledWith({ ...AS_ON_MAIN, paymentChoice: { source: "chatgpt_plan",
      model: "modele-forfait", effort: "high", expectedConnectionId: FIXTURE_PLAN_CONNECTION } }));
  });

  // The profile's model is no longer in the catalogue the server holds: a request without a choice still pins it. The
  // selector shows that model and says so, never the catalogue's default.
  it("is the profile's own model even when the catalogue no longer lists it, and says so", async () => {
    const shown = options();
    if (!shown.ok) throw new Error("fixture");
    shown.data.planSetting = { model: "modele-retire", reasoningEffort: "medium" };
    readPayment.mockResolvedValue(shown);
    renderControls("chatgpt_plan");
    const model = await screen.findByLabelText("Modèle");
    expect(model).toHaveValue("modele-retire");
    expect(screen.getByRole("option", { name: "modele-retire (absent du catalogue)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Effort de raisonnement")).toHaveValue("medium");
    expect(screen.getByText("Le modèle de Mon profil (modele-retire) n’est plus dans le catalogue de votre forfait ChatGPT. "
      + "La demande l’utilise tel quel tant que vous n’en choisissez pas un autre.")).toHaveAttribute("role", "status");
    expect(reloadButton()).toBeEnabled();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenCalledWith(AS_ON_MAIN));

    // A model of the catalogue chosen instead is an explicit choice: the absent model is offered no more.
    fireEvent.change(model, { target: { value: "modele-forfait" } });
    expect(screen.queryByRole("option", { name: /absent du catalogue/ })).toBeNull();
    expect(screen.queryByText(/n’est plus dans le catalogue/)).toBeNull();
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenLastCalledWith({ ...AS_ON_MAIN, paymentChoice: expect.objectContaining({
      source: "chatgpt_plan", model: "modele-forfait", expectedConnectionId: FIXTURE_PLAN_CONNECTION }) }));
  });

  it("is the validated one when the server asked for an explicit choice: it is what the choice carries", async () => {
    readPayment.mockResolvedValue(options());
    assume.mockResolvedValueOnce({ ok: false, error: { status: 422, code: "TAKEOFF_PAYMENT_CHOICE_REQUIRED",
      message: "Choisissez qui paiera le métré avant de reprendre la demande.", retryable: false } });
    renderControls("chatgpt_plan");
    const effort = await screen.findByLabelText("Effort de raisonnement");
    fireEvent.click(withPlan());
    await waitFor(() => expect(effort).toHaveValue("auto"));
    fireEvent.click(withPlan());
    await waitFor(() => expect(assume).toHaveBeenLastCalledWith({ ...AS_ON_MAIN, paymentChoice: { source: "chatgpt_plan",
      model: "modele-forfait", effort: null, expectedConnectionId: FIXTURE_PLAN_CONNECTION } }));
  });
});

describe("the gesture's button in the affaire's takeoff zone", () => {
  it("keeps its medium size and fills the width its wrapper is given", () => {
    render(<TakeoffAssumeControls projectId={PROJECT} requestId={REQUEST} revision={4} action="take_on" size="md"
      label="Prendre en charge avec mon forfait" busyLabel="Prise en charge…" className="min-h-11 max-sm:w-full sm:min-h-9"
      wrapperClassName="max-sm:w-full" onChanged={vi.fn()} />);
    const button = withPlan();
    expect(button).toHaveClass("max-sm:w-full", "min-h-11");
    expect(button.parentElement).toHaveClass("max-sm:w-full", "min-w-0");
  });
});
