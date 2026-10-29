import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ getLocalChatGptCredential: vi.fn() }));
import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { listLocalChatGptModels, selectLocalChatGptModel, selectLocalChatGptPreferences } from "@/lib/ai/chatgpt-local-inference";
import { readChatGptStore, saveChatGptStore } from "@/lib/ai/chatgpt-local-store";

const owner = { userId: "user-a", tenantId: "tenant-a" };
const terra = { slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", visibility: "list" };
const sol = { slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" };
let directory: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "mergeone-chatgpt-preferences-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  await saveChatGptStore(owner, { selectedId: "profile-a", profiles: [{
    id: "profile-a", clientId: "client-a", issuer: "https://auth.openai.com", subject: "subject-a",
    email: "fixture@example.test", model: null, reasoningEffort: null, accessToken: "fixture-only-access",
    refreshToken: "fixture-only-refresh", scopes: ["chatgpt.tokens.use.direct"],
  }] });
  vi.mocked(getLocalChatGptCredential).mockImplementation(async (target) => {
    const store = await readChatGptStore(target);
    const profile = store.profiles.find((entry) => entry.id === store.selectedId);
    return profile ? { accessToken: profile.accessToken!, model: profile.model, reasoningEffort: profile.reasoningEffort, profileId: profile.id } : null;
  });
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ models: [terra, sol] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe("persisted ChatGPT model and reasoning preferences", () => {
  it("selects accessible Terra for an unset profile, with automatic effort and unchanged credentials", async () => {
    const models = await listLocalChatGptModels(owner);
    expect(models.find((model) => model.id === terra.slug)?.reasoningEfforts).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect((await readChatGptStore(owner)).profiles[0]).toMatchObject({
      model: terra.slug, reasoningEffort: null, accessToken: "fixture-only-access", refreshToken: "fixture-only-refresh",
    });
    expect(JSON.stringify(models)).not.toContain("fixture-only");
  });

  it("preserves an explicit model and effort instead of overwriting them with the default", async () => {
    const store = await readChatGptStore(owner);
    store.profiles[0].model = sol.slug;
    store.profiles[0].reasoningEffort = "high";
    await saveChatGptStore(owner, store);
    await listLocalChatGptModels(owner);
    expect((await readChatGptStore(owner)).profiles[0]).toMatchObject({ model: sol.slug, reasoningEffort: "high" });
  });

  it("reads an existing private profile without an effort field without changing its model or tokens", async () => {
    const privateDirectory = path.join(directory, ".private", "chatgpt-local");
    const [name] = (await readdir(privateDirectory)).filter((file) => file.endsWith(".json"));
    const file = path.join(privateDirectory, name);
    const previous = JSON.parse(await readFile(file, "utf8"));
    previous.profiles[0].model = sol.slug;
    delete previous.profiles[0].reasoningEffort;
    await writeFile(file, JSON.stringify(previous), { mode: 0o600 });
    const restored = await readChatGptStore(owner);
    expect(restored.profiles[0]).toMatchObject({ model: sol.slug, reasoningEffort: null, accessToken: "fixture-only-access", refreshToken: "fixture-only-refresh" });
    await listLocalChatGptModels(owner);
    expect((await readChatGptStore(owner)).profiles[0].model).toBe(sol.slug);
  });

  it("does not invent another default when Terra is unavailable to this account", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ models: [sol] }));
    await listLocalChatGptModels(owner);
    expect((await readChatGptStore(owner)).profiles[0].model).toBeNull();
  });

  it("resets incompatible effort on model change but rejects an invalid effort on the same model", async () => {
    await selectLocalChatGptPreferences(owner, { model: terra.slug, reasoningEffort: "none" });
    expect(await selectLocalChatGptModel(owner, sol.slug)).toEqual({ model: sol.slug, reasoningEffort: null, effortReset: true });
    await expect(selectLocalChatGptPreferences(owner, { model: sol.slug, reasoningEffort: "none" })).rejects.toThrow("n’est pas disponible");
    expect((await readChatGptStore(owner)).profiles[0]).toMatchObject({ model: sol.slug, reasoningEffort: null });
  });

  it("uses advertised reasoning metadata for unknown models and otherwise offers only automatic effort", async () => {
    fetchMock.mockImplementation(async () => Response.json({ models: [
      { slug: "custom-reasoner", display_name: "Custom", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }], default_reasoning_level: "high" },
      { slug: "custom-unadvertised", display_name: "Other", visibility: "list" },
    ] }));
    expect(await listLocalChatGptModels(owner)).toEqual([
      { id: "custom-reasoner", name: "Custom", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "high" },
      { id: "custom-unadvertised", name: "Other", reasoningEfforts: [], defaultReasoningEffort: null },
    ]);
    await selectLocalChatGptPreferences(owner, { model: "custom-reasoner", reasoningEffort: "high" });
    expect(await selectLocalChatGptPreferences(owner, { model: "custom-unadvertised", reasoningEffort: "high" })).toMatchObject({ reasoningEffort: null, effortReset: true });
  });

  it("does not mutate preferences for an unavailable model or unsupported effort value", async () => {
    await selectLocalChatGptPreferences(owner, { model: terra.slug, reasoningEffort: "medium" });
    await expect(selectLocalChatGptPreferences(owner, { model: "not-in-catalog", reasoningEffort: "high" })).rejects.toThrow("indisponible");
    await expect(selectLocalChatGptPreferences(owner, { model: terra.slug, reasoningEffort: "ultra" as never })).rejects.toThrow();
    expect((await readChatGptStore(owner)).profiles[0]).toMatchObject({ model: terra.slug, reasoningEffort: "medium" });
  });

  it("keeps tenant/owner stores separate", async () => {
    await expect(selectLocalChatGptPreferences({ ...owner, tenantId: "other-tenant" }, { model: terra.slug, reasoningEffort: "high" })).rejects.toThrow("Connectez");
    expect((await readChatGptStore(owner)).profiles[0]).toMatchObject({ model: null, reasoningEffort: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
