import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callOpenAiDecisions, getOpenAiDecisionsCapability, parseOpenAiDecisionAnswers, type OpenAiDecisionQuestion } from "@/lib/ai/decisions";

const owner = { tenantId: "tenant-a", userId: "user-a" };
const choice: OpenAiDecisionQuestion = { type: "choice", name: "category", instructions: "Classer la pièce", choices: [{ value: "plan" }, { value: "unknown" }] };
const predicate: OpenAiDecisionQuestion = { type: "predicate", name: "clear", instructions: "Le point est-il documenté ?" };
const input = { owner, context: { tenantId: owner.tenantId, projectId: "project-a", preparationFingerprint: "fixed-sources" },
  evidence: { file: "plan.pdf", revision: "A" }, questions: [choice, predicate] };
const fetchMock = vi.fn();
const usage = { input_tokens: 42, output_tokens: 0, total_tokens: 42 };
const answered = { name: "category", type: "choice", choice: "plan", confidence: 0.8,
  probabilities: [{ value: "plan", probability: 0.8 }, { value: "unknown", probability: 0.2 }] };

beforeEach(() => {
  vi.stubEnv("MERGEONE_OPENAI_DECISIONS", "1");
  vi.stubEnv("OPENAI_DECISIONS_API_KEY", "fixture-api-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Decisions access and transport", () => {
  it("does not call any provider without explicit opt-in or a dedicated key", async () => {
    vi.stubEnv("MERGEONE_OPENAI_DECISIONS", "");
    expect(getOpenAiDecisionsCapability().status).toBe("disabled");
    expect((await callOpenAiDecisions(input)).status).toBe("unavailable");
    vi.stubEnv("MERGEONE_OPENAI_DECISIONS", "1");
    vi.stubEnv("OPENAI_DECISIONS_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "must-not-be-used");
    expect(getOpenAiDecisionsCapability().status).toBe("not_configured");
    await callOpenAiDecisions(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a tenant mismatch before a request is sent", async () => {
    await expect(callOpenAiDecisions({ ...input, context: { ...input.context, tenantId: "tenant-b" } })).rejects.toThrow("tenant autorisé");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the documented fixed endpoint, JSON input and separate API credential", async () => {
    fetchMock.mockResolvedValue(Response.json({ model: "gpt-6-luna", usage,
      answers: [answered, { name: "clear", type: "refusal" }] }));
    const result = await callOpenAiDecisions(input);
    expect(result.status).toBe("partial");
    expect(result.answers.map((answer) => answer.status)).toEqual(["answered", "refused"]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/decisions");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_json", data: input.evidence }] }]);
    expect(options.headers.authorization).toBe("Bearer fixture-api-key");
    expect(result.provenance.usage).toEqual(usage);
    expect(JSON.stringify(result)).not.toContain("fixture-api-key");
  });

  it("partitions request identity and provider cache by tenant and user", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ model: "gpt-6-luna", usage, answers: [] })));
    const first = await callOpenAiDecisions(input);
    const second = await callOpenAiDecisions({ ...input, owner: { tenantId: "tenant-b", userId: "user-b" }, context: { ...input.context, tenantId: "tenant-b" } });
    expect(first.provenance.request_fingerprint).not.toBe(second.provenance.request_fingerprint);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt_cache_key).not.toBe(JSON.parse(fetchMock.mock.calls[1][1].body).prompt_cache_key);
  });

  it("returns a safe quota error without retry or raw provider data", async () => {
    fetchMock.mockResolvedValue(new Response("secret-provider-body", { status: 429 }));
    const result = await callOpenAiDecisions(input);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("limite API");
    expect(JSON.stringify(result)).not.toContain("secret-provider-body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the manual outcome for network errors and rejects malformed provider envelopes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Bearer private-token"));
    expect((await callOpenAiDecisions(input)).status).toBe("failed");
    fetchMock.mockResolvedValueOnce(Response.json({ model: "other-model", usage, answers: [answered] }));
    expect((await callOpenAiDecisions(input)).status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("independent Decisions answer validation", () => {
  it("keeps missing, refusal, unknown choices and valid answers distinct", () => {
    const questions: OpenAiDecisionQuestion[] = [choice, predicate, { ...predicate, name: "missing" }, { ...choice, name: "invented" }];
    expect(parseOpenAiDecisionAnswers(questions, { answers: [answered,
      { name: "clear", type: "refusal" }, { ...answered, name: "invented", choice: "not-a-candidate" },
    ] }).map((answer) => answer.status)).toEqual(["answered", "refused", "missing", "invalid"]);
  });

  it("rejects duplicate answers and score levels outside the supplied rubric", () => {
    const score: OpenAiDecisionQuestion = { name: "priority", type: "score", instructions: "Priorité", levels: [{ label: "low" }, { label: "high" }] };
    expect(parseOpenAiDecisionAnswers([choice, score], { answers: [answered, answered,
      { type: "score", name: "priority", score: 2, confidence: 1, probabilities: [{ value: 2, label: "invented", probability: 1 }] },
    ] }).map((answer) => answer.status)).toEqual(["invalid", "invalid"]);
  });

  it("keeps boolean and string choices distinct", () => {
    const typed: OpenAiDecisionQuestion = { ...choice, choices: [{ value: true }, { value: false }] };
    expect(parseOpenAiDecisionAnswers([typed], { answers: [{ ...answered, choice: "true" }] })[0].status).toBe("invalid");
  });
});
