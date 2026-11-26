import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "127.0.0.1:3153" }) }));
vi.mock("@/lib/estimates/batch", () => ({ executeEstimateBatch: vi.fn() }));
vi.mock("@/lib/estimates/server-context", () => ({ getAuthenticatedContext: vi.fn(), getVersionAccessOrThrow: vi.fn() }));
vi.mock("@/lib/estimates/section-copy-read-server", () => ({ readAllItemsForCopy: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({ readLocalChatGptModelOptions: vi.fn() }));
vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn(), getStructuredAiAvailability: vi.fn() }));
vi.mock("@/lib/ai/decisions", () => ({
  OPENAI_DECISIONS_MODEL: "gpt-6-luna", callOpenAiDecisions: vi.fn(), getOpenAiDecisionsCapability: vi.fn(),
}));
const key = vi.hoisted(() => ({ state: vi.fn(), prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: () => key }));

import { POST } from "@/app/api/estimates/[versionId]/price-reuse/arbitration/route";
import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { readLocalChatGptModelOptions } from "@/lib/ai/chatgpt-local-inference";
import { callOpenAiDecisions, getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { executeEstimateBatch } from "@/lib/estimates/batch";
import { readAllItemsForCopy } from "@/lib/estimates/section-copy-read-server";
import { getAuthenticatedContext, getVersionAccessOrThrow } from "@/lib/estimates/server-context";
import { forbidden } from "@/lib/http/api-error";

const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const OWNER = { userId: id(1), tenantId: id(2) };
const TARGET_VERSION = id(3);
const REFERENCE_VERSION = id(4);
const UPDATED_AT = "2026-11-26T10:00:00Z";
const CANDIDATES = [id(7), id(8)];
const OUTSIDE_SCOPE = id(9);
const TARGETS = Array.from({ length: 101 }, (_, index) => id(100 + index));
const planModels = ["plan-a", "plan-b"].map((model) => ({
  id: model, name: model, reasoningEfforts: ["low", "high"] as ("low" | "high")[], defaultReasoningEffort: "low" as const,
}));
const line = (lineId: string, unitPrice: number, title = "Vanne d’arrêt DN 80") => ({
  id: lineId, item_type: "line", parent_id: null, title, unit_code: "u", pricing_status: "priced",
  unit_price_ht_cents: unitPrice, h_mo_per_unit: null,
});

function submit(body: Record<string, unknown>) {
  const request = new Request(`http://127.0.0.1:3153/api/estimates/${TARGET_VERSION}/price-reuse/arbitration`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference_version_id: REFERENCE_VERSION, reference_updated_at: UPDATED_AT, line_ids: [TARGETS[0]], ...body }),
  });
  return POST(request, { params: Promise.resolve({ versionId: TARGET_VERSION }) });
}

function questions(prompt: string) {
  return (JSON.parse(prompt.split("\n").at(-1)!) as { questions: Array<{ question: string; choix: Array<{ valeur: string }> }> }).questions;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PORT", "3153");
  vi.stubEnv("MERGEONE_DEV_HOSTS", "");
  const maybeSingle = async () => ({ data: { version_number: 2 }, error: null });
  const query = { eq: () => query, maybeSingle };
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ ...OWNER, supabase: { from: () => ({ select: () => query }) } } as never);
  vi.mocked(getVersionAccessOrThrow).mockImplementation(async (_client, versionId) => ({
    version: { id: versionId, updated_at: UPDATED_AT, calc_engine_version: 3 },
    project: { id: versionId === TARGET_VERSION ? id(5) : id(6), name: "Atelier des Tilleuls" },
  }) as never);
  vi.mocked(readAllItemsForCopy).mockImplementation(async (_client, _tenantId, version) => (version.id === TARGET_VERSION
    ? [...TARGETS.map((lineId) => line(lineId, 0)), line(OUTSIDE_SCOPE, 0, "Évier double bac")]
    : [line(CANDIDATES[0], 1250), line(CANDIDATES[1], 1450)]) as never);
  vi.mocked(getStructuredAiAvailability).mockResolvedValue({ available: true, message: "Forfait connecté." });
  vi.mocked(readLocalChatGptModelOptions).mockResolvedValue({ models: planModels, preferences: { model: "plan-a", reasoningEffort: "low" } });
  vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "available", model: "gpt-6-luna", billing: "separate_api", message: "Configuré." });
  key.state.mockResolvedValue({
    status: "saved", connection: { connectionId: id(10), version: 4, offeredModels: [
      { id: "gpt-6.1-terra", name: "Terra", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
      { id: "gpt-6.2-sol", name: "Sol", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" },
    ] }, analysisPreferences: { billingSource: "personal_api_key", apiModel: "gpt-6.1-terra", apiReasoningEffort: "low" },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("price reuse arbitration route", () => {
  it("passes the authenticated member's chosen plan model and effort, and keeps an explicit no-match without confidence", async () => {
    vi.mocked(callStructuredAi).mockImplementation(async ({ prompt, schema }) => {
      const [first, second] = questions(prompt);
      expect(questions(prompt)).toHaveLength(2);
      return { data: schema.parse({ reponses: [
        { question: first.question, choix: "c1", confiance: 0.8 },
        { question: second.question, choix: second.choix.at(-1)!.valeur },
      ] }), model: "plan-b" } as never;
    });
    const response = await submit({ provider: "chatgpt", model: "plan-b", reasoning_effort: "high", line_ids: [...TARGETS.slice(0, 2), OUTSIDE_SCOPE] });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ provider: "chatgpt", model: "plan-b", status: "available", answers: [
      { line_id: TARGETS[0], reference_line_id: CANDIDATES[0], confidence: 0.8 },
      { line_id: TARGETS[1], reference_line_id: null, confidence: null, no_match: true },
    ] });
    expect(callStructuredAi).toHaveBeenCalledExactlyOnceWith(expect.anything(), OWNER, { model: "plan-b", reasoningEffort: "high" });
    expect(key.prepare).not.toHaveBeenCalled();
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
    expect(executeEstimateBatch).not.toHaveBeenCalled();
  });

  it("keeps the first batch when even one of the remaining questions cannot fit the shared key allotment", async () => {
    key.prepare.mockImplementation(async (_owner, input) => {
      if (input.allotmentNanoUsd < 40_000_000) throw new ApiKeyError("AI_KEY_CEILING");
      return { prompt: input.prompt };
    });
    key.execute.mockImplementation(async (_owner, { prompt }) => ({
      costNanoUsd: 70_000_000, model: "gpt-6.2-sol",
      data: { reponses: questions(prompt).map(({ question }) => ({ question, choix: "c1", confiance: 0.9 })) },
    }));
    const response = await submit({ provider: "personal_api_key", model: "gpt-6.2-sol", reasoning_effort: "high", line_ids: TARGETS });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ provider: "personal_api_key", status: "partial", model: "gpt-6.2-sol", message: expect.stringMatching(/budget.*restantes/i) });
    expect(data.answers).toHaveLength(TARGETS.length);
    expect(data.answers.filter((answer: { reference_line_id: string | null }) => answer.reference_line_id)).toHaveLength(50);
    expect(data.answers[50]).toEqual({ line_id: TARGETS[50], reference_line_id: null, confidence: null });
    const selected = { model: "gpt-6.2-sol", reasoningEffort: "high", expectedVersion: 4 };
    expect(key.prepare).toHaveBeenNthCalledWith(1, OWNER, expect.objectContaining({ ...selected, allotmentNanoUsd: 100_000_000 }));
    const retries = key.prepare.mock.calls.slice(1);
    expect(retries.map(([, input]) => questions(input.prompt).length)).toEqual([50, 25, 12, 6, 3, 1]);
    expect(retries).toEqual(retries.map(() => [OWNER, expect.objectContaining({ ...selected, allotmentNanoUsd: 30_000_000 })]));
    expect(key.execute).toHaveBeenCalledTimes(1);
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
    expect(executeEstimateBatch).not.toHaveBeenCalled();
  });

  it("keeps the fixed Decisions model and authenticated affaire scope", async () => {
    vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "available", message: "Prêt.", answers: [
      { name: "ligne_1", status: "answered", type: "choice", value: "c2", confidence: 0.8 },
    ] } as never);
    const response = await submit({ provider: "decisions" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ provider: "decisions", model: "gpt-6-luna", answers: [
      { line_id: TARGETS[0], reference_line_id: CANDIDATES[1] },
    ] });
    expect(callOpenAiDecisions).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ owner: OWNER,
      context: expect.objectContaining({ projectId: id(5), tenantId: OWNER.tenantId }),
    }));
    expect(key.state).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(executeEstimateBatch).not.toHaveBeenCalled();
  });

  it.each([
    [{ provider: "chatgpt", model: "absent" }, 422],
    [{ provider: "chatgpt", model: "plan-a", reasoning_effort: "max" }, 422],
    [{ provider: "personal_api_key", model: "plan-a" }, 422],
    [{ provider: "decisions", reasoning_effort: "high" }, 400],
    [{ provider: "decisions", reference_updated_at: "2026-11-25T10:00:00Z" }, 409],
  ])("refuses invalid arbitration %j before generation", async (body, status) => {
    const response = await submit(body);
    expect(response.status).toBe(status);
    expect(key.prepare).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
  });

  it("does not switch to another payer if the member's chosen key is unavailable", async () => {
    key.state.mockResolvedValue({ status: "empty" });
    const response = await submit({ provider: "personal_api_key" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ provider: "personal_api_key", status: "unavailable", message: expect.stringContaining("Mon profil") });
    expect(key.prepare).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
  });

  it("refuses inaccessible versions before loading AI options or comparing items", async () => {
    vi.mocked(getVersionAccessOrThrow).mockRejectedValueOnce(forbidden("Accès refusé."));
    const response = await submit({ provider: "personal_api_key" });
    expect(response.status).toBe(403);
    expect(readAllItemsForCopy).not.toHaveBeenCalled();
    expect(key.state).not.toHaveBeenCalled();
    expect(key.prepare).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
  });
});
