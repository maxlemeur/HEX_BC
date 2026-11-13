import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ getLocalChatGptCredential: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-inference", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-local-inference")>(), assertLocalChatGptOverride: vi.fn(), callLocalChatGptStructured: vi.fn(),
}));

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { assertLocalChatGptOverride, callLocalChatGptStructured, LocalChatGptOverrideUnavailableError } from "@/lib/ai/chatgpt-local-inference";
import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { GROUP_LOCAL_MODEL_PROMPT_VERSION } from "@/lib/takeoff/vectors/group-local-model";
import { localGroupsCall, LocalGroupsRequestError, LocalGroupsStop } from "@/lib/takeoff/vectors/group-local-model-server";

// Ways the local plan's request (TI-704 option B, localGroupsCall) could keep
// sending after its access is gone or call the wrong thing, written before the
// fix (review of 13/11). The credential and the plan are mocks: no network.
// - a refused access, an expired renewal, a disconnected plan or another
//   account selected mid-job is taken for a failed request, and the job keeps
//   sending; a rate limit too;
// - a refused or unreachable model listing is reported as a model not offered;
//   one network blip of the listing, or of the credential's renewal, turns the
//   whole job to the rules;
// - the request is sent without the job's pinned profile, or with another model;
// - one malformed number in the answer loses the 8 groups, or its tokens.

const OWNER = { userId: "user-fixture", tenantId: "tenant-fixture" };
const CREDENTIAL = { accessToken: "fixture-token", model: "fixture-profile-model", reasoningEffort: null, profileId: "profile-fixture" };
const PINNED = { profileId: "profile-fixture", model: "fixture-profile-model", reasoningEffort: null };
const OVERRIDE = Object.freeze({ model: "gpt-6.1-sol", reasoningEffort: "low" as const });
const REQUEST = { prompt: "Classe les groupes fictifs.", images: [{ mimeType: "image/jpeg" as const, data: "AAAA", width: 1, height: 1, bytes: 3 }] };
const answered = (data: unknown, extra: Record<string, unknown> = {}) => ({ data, tokenCount: 1200, rawText: JSON.stringify(data), schemaError: null, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLocalChatGptCredential).mockResolvedValue(CREDENTIAL as never);
  vi.mocked(assertLocalChatGptOverride).mockResolvedValue(OVERRIDE);
  vi.mocked(callLocalChatGptStructured).mockResolvedValue(answered({ groupes: [{ groupe: "groupe_1", classe: "EU", probabilite: 0.9 }] }) as never);
});

describe("the local plan's request (localGroupsCall, TI-704 option B)", () => {
  // The listing is read once per job: a failure that is no answer of the account (a network blip, an unreadable
  // listing) is read again once before it turns the whole job to the rules; the account's own answers are final.
  it.each([
    ["a refused access", new StructuredAiError("AI_AUTH_REQUIRED", "L’accès ChatGPT a été refusé.", 401), "local_access", 1],
    ["a rate limit", new StructuredAiError("AI_RATE_LIMIT", "ChatGPT limite les demandes.", 429), "local_quota", 1],
    ["an unreachable listing", new TypeError("fetch failed"), "local_access", 2],
    ["an unreadable catalogue", new z.ZodError([]), "local_access", 2],
    ["a listing that is not JSON", new SyntaxError("Unexpected token"), "local_access", 2],
    // Any other plain error of the listing is no model withdrawn.
    ["another plain error", new Error("Fictional listing failure."), "local_access", 2],
    ["the model not offered", new LocalChatGptOverrideUnavailableError(), "local_model_unavailable", 1],
  ])("stops the job's plan on %s of the model listing, under its own reason", async (_name, error, reason, reads) => {
    vi.mocked(assertLocalChatGptOverride).mockRejectedValue(error);
    const stop = await localGroupsCall(OWNER, PINNED).catch((caught: unknown) => caught);
    expect(stop).toBeInstanceOf(LocalGroupsStop);
    expect(stop).toMatchObject({ reason });
    expect(assertLocalChatGptOverride).toHaveBeenCalledTimes(reads);
  });

  it("reads the listing again once after a blip, and then sends with the model the account offers", async () => {
    vi.mocked(assertLocalChatGptOverride).mockRejectedValueOnce(new TypeError("fetch failed"));
    const call = await localGroupsCall(OWNER, PINNED);
    expect(assertLocalChatGptOverride).toHaveBeenCalledTimes(2);
    expect(await call(REQUEST)).toMatchObject({ totalTokens: 1200 });
    expect(callLocalChatGptStructured).toHaveBeenCalledWith(OWNER, expect.anything(), PINNED, OVERRIDE, { returnRawOnSchemaError: true });
  });

  it("stops on a credential that cannot be read or renewed, or another account than the job's", async () => {
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new Error("Reconnectez ChatGPT pour renouveler l’accès."));
    await expect(localGroupsCall(OWNER, PINNED)).rejects.toMatchObject({ reason: "local_access" });
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce(null);
    await expect(localGroupsCall(OWNER, PINNED)).rejects.toMatchObject({ reason: "local_access" });
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ ...CREDENTIAL, profileId: "other-profile" } as never);
    await expect(localGroupsCall(OWNER, PINNED)).rejects.toMatchObject({ reason: "local_access" });
    expect(assertLocalChatGptOverride).toHaveBeenCalledTimes(0);
  });

  it("reads the credential again once after a blip reaching OpenAI while it is renewed; a refused renewal is final", async () => {
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new ChatGptSignInError("network"));
    const call = await localGroupsCall(OWNER, PINNED);
    expect(getLocalChatGptCredential).toHaveBeenCalledTimes(2);
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new ChatGptSignInError("network"));
    expect(await call(REQUEST)).toMatchObject({ totalTokens: 1200 });
    expect(callLocalChatGptStructured).toHaveBeenCalledTimes(1);
    vi.mocked(getLocalChatGptCredential).mockClear();
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new ChatGptSignInError("network")).mockRejectedValueOnce(new ChatGptSignInError("network"));
    await expect(localGroupsCall(OWNER, PINNED)).rejects.toMatchObject({ reason: "local_access" });
    expect(getLocalChatGptCredential).toHaveBeenCalledTimes(2);
    vi.mocked(getLocalChatGptCredential).mockClear();
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new ChatGptSignInError("renewal"));
    await expect(localGroupsCall(OWNER, PINNED)).rejects.toMatchObject({ reason: "local_access" });
    expect(getLocalChatGptCredential).toHaveBeenCalledTimes(1);
  });

  it("checks the account before each request and stops at a quota, a rate limit or a refused access; a provider failure fails its request only", async () => {
    const call = await localGroupsCall(OWNER, PINNED);
    vi.mocked(getLocalChatGptCredential).mockRejectedValueOnce(new Error("Le forfait ChatGPT n’est plus autorisé. Reconnectez le compte."));
    await expect(call(REQUEST)).rejects.toMatchObject({ reason: "local_access" });
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ ...CREDENTIAL, profileId: "other-profile" } as never);
    await expect(call(REQUEST)).rejects.toMatchObject({ reason: "local_access" });
    expect(callLocalChatGptStructured).not.toHaveBeenCalled();
    for (const [error, reason] of [
      [new StructuredAiError("AI_QUOTA", "Limite du forfait ChatGPT atteinte.", 429), "local_quota"],
      [new StructuredAiError("AI_RATE_LIMIT", "ChatGPT limite les demandes.", 429), "local_quota"],
      [new StructuredAiError("AI_AUTH_REQUIRED", "L’accès ChatGPT a été refusé.", 401), "local_access"],
      [new ChatGptSignInError("expired"), "local_access"],
    ] as const) {
      vi.mocked(callLocalChatGptStructured).mockRejectedValueOnce(error);
      await expect(call(REQUEST), reason).rejects.toMatchObject({ reason });
    }
    vi.mocked(callLocalChatGptStructured).mockRejectedValueOnce(new StructuredAiError("AI_PROVIDER_FAILED", "ChatGPT n’a pas terminé la demande."));
    const failed = await call(REQUEST).catch((caught: unknown) => caught);
    expect(failed).toBeInstanceOf(StructuredAiError);
    expect(failed).not.toBeInstanceOf(LocalGroupsStop);
  });

  it("sends the measured model with the job's pinned profile, and reads a malformed answer group by group with its tokens", async () => {
    const call = await localGroupsCall(OWNER, PINNED);
    expect(assertLocalChatGptOverride).toHaveBeenCalledWith(OWNER, CREDENTIAL, { model: "gpt-6.1-sol", reasoningEffort: "low" });
    expect(await call(REQUEST)).toEqual({ data: { groupes: [{ groupe: "groupe_1", classe: "EU", probabilite: 0.9 }] }, totalTokens: 1200 });
    expect(callLocalChatGptStructured).toHaveBeenCalledWith(OWNER, expect.objectContaining({ prompt: REQUEST.prompt, timeoutMs: 180_000,
      files: [{ mimeType: "image/jpeg", data: "AAAA" }], context: { promptVersion: GROUP_LOCAL_MODEL_PROMPT_VERSION } }), PINNED, OVERRIDE,
    { returnRawOnSchemaError: true });
    const raw = { groupes: [{ groupe: "groupe_1", classe: "EU", probabilite: 85 }, { groupe: "groupe_2", classe: "fond", probabilite: 0.9 }] };
    vi.mocked(callLocalChatGptStructured).mockResolvedValueOnce({ data: null, tokenCount: 1200, rawText: JSON.stringify(raw),
      schemaError: new z.ZodError([]) } as never);
    expect(await call(REQUEST)).toEqual({ data: { groupes: [{ groupe: "groupe_1", classe: "EU", probabilite: null },
      { groupe: "groupe_2", classe: "fond", probabilite: 0.9 }] }, totalTokens: 1200 });
    vi.mocked(callLocalChatGptStructured).mockResolvedValueOnce({ data: null, tokenCount: 700, rawText: "pas du JSON",
      schemaError: new SyntaxError("Unexpected token") } as never);
    const unreadable = await call(REQUEST).catch((caught: unknown) => caught);
    expect(unreadable).toBeInstanceOf(LocalGroupsRequestError);
    expect(unreadable).toMatchObject({ totalTokens: 700 });
  });
});
