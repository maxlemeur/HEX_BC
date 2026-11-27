import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiAnalysisPreferences, ApiKeyAccessState } from "@/lib/ai/access/contracts";
import { readCachedLocalChatGptModelOptions, readLocalChatGptModelOptions } from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptAvailableModel } from "@/lib/ai/chatgpt-model-preferences";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { getStructuredAiAvailability } from "@/lib/ai/structured-ai";

const access = vi.hoisted(() => ({ state: vi.fn(), local: true, host: "localhost:3149" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: access.host }) }));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: () => ({ state: access.state }) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => access.local,
  assertLocalChatGptHost: (host: string) => { if (host !== "localhost:3149") throw new Error(); },
}));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({
  readCachedLocalChatGptModelOptions: vi.fn(),
  readLocalChatGptModelOptions: vi.fn(),
}));
vi.mock("@/lib/ai/structured-ai", () => ({ getStructuredAiAvailability: vi.fn() }));

const OWNER = { userId: "membre-fictif", tenantId: "equipe-fictive" };
const POLICY = { allowedSources: ["chatgpt_plan", "personal_api_key"] } as const;
const MODEL: ChatGptAvailableModel = {
  id: "modele-atelier", name: "Atelier", reasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium",
};
const OTHER: ChatGptAvailableModel = {
  id: "modele-lecture", name: "Lecture", reasoningEfforts: ["low"], defaultReasoningEffort: "low",
};
const PLAN_DEFAULT = { model: MODEL.id, reasoningEffort: "high" } as const;
const EMPTY = { status: "empty", placeLabel: "Sur ce Mac" } as const;

function savedKey(preferences: Partial<AiAnalysisPreferences> = {}): ApiKeyAccessState {
  return {
    status: "saved",
    connection: {
      provider: "openai", place: "local", placeLabel: "Sur ce Mac", suffix: "demo",
      verification: "models_listed", connectionId: "connexion-fictive", version: 7, savedAt: "2026-11-26",
      lastTest: null, lastUsedAt: null, offeredModels: [MODEL, OTHER].map((model) => ({ ...model, verified: true })),
    },
    analysisPreferences: { billingSource: "personal_api_key", apiModel: MODEL.id, ...preferences },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  access.local = true;
  access.host = "localhost:3149";
  access.state.mockResolvedValue(EMPTY);
  vi.mocked(getStructuredAiAvailability).mockResolvedValue({ available: true, message: "Forfait connecté." });
  vi.mocked(readLocalChatGptModelOptions).mockResolvedValue({ models: [MODEL, OTHER], preferences: PLAN_DEFAULT });
});

describe("AI request resolver", () => {
  it("loads only cached plan options and keeps the saved default payer for a read-only screen", async () => {
    access.state.mockResolvedValue(savedKey({ apiReasoningEffort: "medium" }));
    vi.mocked(readCachedLocalChatGptModelOptions).mockResolvedValue({ models: [MODEL], preferences: PLAN_DEFAULT });
    const { defaultSource, options } = await readAiRequestOptions(OWNER, POLICY, "cached");
    expect(defaultSource).toBe("personal_api_key");
    expect(options.personal_api_key).toMatchObject({ preferences: { model: MODEL.id, reasoningEffort: "medium" } });
    expect(options.chatgpt_plan).toMatchObject({ preferences: PLAN_DEFAULT });
    expect(readLocalChatGptModelOptions).not.toHaveBeenCalled();
  });

  it("takes the same plan default for options and dispatch when there is no profile yet", async () => {
    const { defaultSource, options } = await readAiRequestOptions(OWNER, POLICY);
    expect(defaultSource).toBe("chatgpt_plan");
    expect(options.chatgpt_plan).toMatchObject({ preferences: PLAN_DEFAULT });
    expect(await resolveAiRequest(OWNER, POLICY)).toEqual({
      ok: true, source: defaultSource, preferences: PLAN_DEFAULT, connection: null,
    });
    expect(access.state).toHaveBeenCalledWith(OWNER);
    expect(readLocalChatGptModelOptions).toHaveBeenCalledWith(OWNER);
  });

  it("offers a saved API key with compatible models before the member saves any preferences", async () => {
    access.state.mockResolvedValue({ ...savedKey(), analysisPreferences: undefined });

    const { defaultSource, options } = await readAiRequestOptions(OWNER, POLICY);
    expect(defaultSource).toBe("chatgpt_plan");
    expect(options.personal_api_key).toMatchObject({
      ok: true, models: [{ id: MODEL.id }, { id: OTHER.id }],
      preferences: { model: MODEL.id, reasoningEffort: "medium" },
    });
    expect(await resolveAiRequest(OWNER, POLICY, { source: "personal_api_key", model: OTHER.id })).toMatchObject({
      ok: true, source: "personal_api_key", preferences: { model: OTHER.id, reasoningEffort: "low" },
      connection: { id: "connexion-fictive", version: 7 },
    });
  });

  it.each(["notice", "exception"] as const)("leaves the payer unset when reading the profile produces a %s", async (failure) => {
    if (failure === "notice") access.state.mockResolvedValue({ ...EMPTY, notice: "Fichier illisible." });
    else access.state.mockRejectedValue(new Error("private failure details"));

    expect((await readAiRequestOptions(OWNER, POLICY)).defaultSource).toBeNull();
    expect(await resolveAiRequest(OWNER, POLICY)).toEqual({
      ok: false, reason: "profile_unreadable", message: "Les préférences de Mon profil n’ont pas pu être lues.",
    });
    expect(await resolveAiRequest(OWNER, POLICY, { source: "chatgpt_plan" })).toMatchObject({ ok: true, source: "chatgpt_plan" });
    expect(await resolveAiRequest(OWNER, { ...POLICY, sourcePolicy: "profile" }, { source: "chatgpt_plan" }))
      .toMatchObject({ ok: false, reason: "profile_unreadable" });
  });

  it("rejects a source excluded by the screen and a payer change on a profile-locked screen", async () => {
    access.state.mockResolvedValue(savedKey());
    expect(await resolveAiRequest(OWNER, { allowedSources: ["chatgpt_plan"] }, { source: "personal_api_key" }))
      .toMatchObject({ ok: false, reason: "source_not_allowed" });
    expect(await resolveAiRequest(OWNER, { ...POLICY, sourcePolicy: "profile" }, { source: "chatgpt_plan" }))
      .toMatchObject({ ok: false, reason: "source_changed", message: "La source IA a changé dans Mon profil. Rechargez la demande pour reprendre." });
    expect(readLocalChatGptModelOptions).not.toHaveBeenCalled();
  });

  it.each(["disabled", "other_host", "missing_key"] as const)("refuses an unavailable key (%s) without trying the plan", async (failure) => {
    if (failure === "disabled") access.local = false;
    if (failure === "other_host") access.host = "autre-hote.example";
    expect(await resolveAiRequest(OWNER, POLICY, { source: "personal_api_key" }))
      .toMatchObject({ ok: false, reason: "source_unavailable" });
    expect(readLocalChatGptModelOptions).not.toHaveBeenCalled();
  });

  it("refuses the missing plan and a failed catalogue with French messages", async () => {
    vi.mocked(getStructuredAiAvailability).mockResolvedValueOnce({ available: false, message: "Reconnectez votre forfait." });
    expect(await resolveAiRequest(OWNER, POLICY)).toEqual({ ok: false, reason: "source_unavailable", message: "Reconnectez votre forfait." });
    vi.mocked(readLocalChatGptModelOptions).mockRejectedValueOnce(new Error("private failure details"));
    expect(await resolveAiRequest(OWNER, POLICY)).toEqual({
      ok: false, reason: "source_unavailable", message: "Les modèles de votre forfait ChatGPT sont indisponibles. Vérifiez la connexion dans Mon profil.",
    });
  });

  it("does not substitute a model when the saved API model is no longer offered", async () => {
    access.state.mockResolvedValue(savedKey({ apiModel: "modele-retire" }));
    const options = await readAiRequestOptions(OWNER, POLICY);
    const refusal = { ok: false, reason: "no_model", message: "Configurez votre clé API OpenAI et son modèle dans Mon profil." };
    expect(options.defaultSource).toBe("personal_api_key");
    expect(options.options.personal_api_key).toEqual(refusal);
    expect(await resolveAiRequest(OWNER, POLICY)).toEqual(refusal);
  });

  it("verifies the connection confirmed by the member before validating that key's requested model", async () => {
    access.state.mockResolvedValue(savedKey());
    expect(await resolveAiRequest(OWNER, POLICY, {
      source: "personal_api_key", expectedConnectionId: "ancienne-connexion", model: "modele-de-l-ancienne-cle",
    })).toEqual({
      ok: false, reason: "connection_changed",
      message: "La clé ou les modèles disponibles ont changé. Rechargez la demande pour reprendre.",
    });
    expect(await resolveAiRequest(OWNER, POLICY, {
      source: "personal_api_key", expectedConnectionId: "connexion-fictive",
    })).toMatchObject({ ok: true, connection: { id: "connexion-fictive", version: 7 } });
  });

  it.each(["chatgpt_plan", "personal_api_key"] as const)("checks the explicit model and effort against %s", async (source) => {
    access.state.mockResolvedValue(savedKey());
    expect(await resolveAiRequest(OWNER, POLICY, { source, model: "modele-absent" })).toEqual({
      ok: false, reason: "model_unavailable", message: "Ce modèle n’est pas proposé par la source d’IA choisie.",
    });
    expect(await resolveAiRequest(OWNER, POLICY, { source, model: OTHER.id, effort: "high" })).toEqual({
      ok: false, reason: "effort_unavailable", message: "Ce niveau de raisonnement n’est pas proposé pour le modèle choisi.",
    });
    expect(await resolveAiRequest(OWNER, POLICY, { source, model: OTHER.id })).toMatchObject({
      ok: true, source, preferences: { model: OTHER.id, reasoningEffort: "low" },
    });
    expect(await resolveAiRequest(OWNER, POLICY, { source, model: OTHER.id, effort: null })).toMatchObject({
      ok: true, source, preferences: { model: OTHER.id, reasoningEffort: null },
    });
  });

  it.each(["chatgpt_plan", "personal_api_key"] as const)("uses only valid overrides for the requested usage and %s", async (source) => {
    const photoPreferences = { model: OTHER.id, reasoningEffort: "low" } as const;
    access.state.mockResolvedValue(savedKey({
      billingSource: source, apiReasoningEffort: "max",
      overrides: {
        photos: { [source]: photoPreferences },
        takeoff_lab: { [source]: { model: OTHER.id, reasoningEffort: "high" } },
      },
    }));
    const photos = { ...POLICY, usage: "photos" } as const;
    expect((await readAiRequestOptions(OWNER, photos)).options[source]).toMatchObject({ preferences: photoPreferences });
    expect(await resolveAiRequest(OWNER, photos)).toMatchObject({ ok: true, source, preferences: photoPreferences });
    const preferences = { model: MODEL.id, reasoningEffort: source === "chatgpt_plan" ? "high" : "medium" };
    expect(await resolveAiRequest(OWNER, { ...POLICY, usage: "takeoff_lab" })).toMatchObject({ ok: true, source, preferences });
    expect(await resolveAiRequest(OWNER, POLICY)).toMatchObject({ ok: true, source, preferences });
    if (source === "personal_api_key") {
      expect(await resolveAiRequest(OWNER, POLICY)).toMatchObject({ connection: { id: "connexion-fictive", version: 7 } });
    }
  });
});
