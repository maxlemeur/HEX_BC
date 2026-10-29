import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ isLocalChatGptEnabled: vi.fn().mockReturnValue(false), assertLocalChatGptHost: vi.fn(), hasLocalChatGptPlanAccess: (profile: { accessToken?: string; refreshToken?: string; scopes: string[] }) => Boolean(profile.accessToken && profile.refreshToken && profile.scopes.includes("chatgpt.tokens.use.direct")) }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ readChatGptStore: vi.fn() }));
vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));
vi.mock("@/lib/ai/decisions", () => ({ getOpenAiDecisionsCapability: vi.fn(), callOpenAiDecisions: vi.fn() }));
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { callOpenAiDecisions, getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { createEmptyTakeoffPreparation, evaluateTakeoffPreparation } from "@/lib/takeoff/preparation";
import { generateTakeoffPreparationAssistance, getTakeoffPreparationAssistanceCapabilities } from "@/lib/takeoff/preparation-assistance-server";

const owner = { userId: "user-a", tenantId: "tenant-a" };
function input() {
  const preparation = createEmptyTakeoffPreparation();
  preparation.sources = [{ document_id: "plan-a", document_name: "Plan R+1.pdf", source_version: "sha-a", revision: "A", kind: "plan",
    active: true, confirmed: false, pages: [1], file_path: "private-storage/plan.pdf", page_count: 1, plan_set_id: null, logical_document_id: null, content_hash: null, source_updated_at: null, mime_type: "application/pdf" }];
  return { owner, projectId: "project-a", preparation, sources: preparation.sources, revision: 1, sourceFingerprint: "sha-sources" };
}
const generated = { proposals: [
  { field: "scope.levels", values: ["R+1"], source_document_ids: ["plan-a"], explanation: "Niveau indiqué par la pièce" },
  { field: "scope.lots", values: ["Lot inventé"], source_document_ids: ["other-tenant-source"], explanation: "Référence invalide" },
], questions: [{ question: "La terrasse est-elle incluse ?", source_document_ids: ["plan-a"], explanation: "Zone à confirmer" }] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GEMINI_API_KEY", "fixture-not-used");
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile-a", profiles: [{ id: "profile-a", model: "fixture-model", accessToken: "fixture", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"] }] } as never);
  vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "disabled", model: "gpt-6-luna", billing: "separate_api", message: "Désactivé" });
  vi.mocked(callStructuredAi).mockResolvedValue({ data: generated, provider: "chatgpt", model: "fixture-model", tokenCount: 10 } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("structured preparation assistance", () => {
  it("returns sourced proposals only, without modifying or confirming existing preparation", async () => {
    const request = input();
    request.preparation.scope.levels = ["RDC"];
    request.preparation.scope.confirmed = true;
    const before = structuredClone(request.preparation);
    const result = await generateTakeoffPreparationAssistance({ ...request, instruction: "Ajouter R+1" });
    expect(result.status).toBe("available");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ field: "scope.levels", values: ["R+1"], source_document_ids: ["plan-a"], status: "proposed" });
    expect(request.preparation).toEqual(before);
    expect(result.provenance).toMatchObject({ tenant_id: "tenant-a", project_id: "project-a", revision: 1, model: "fixture-model", token_count: 10 });
    const prompt = vi.mocked(callStructuredAi).mock.calls[0][0].prompt;
    expect(prompt).toContain("Ajouter R+1");
    expect(prompt).not.toContain("private-storage");
    expect(vi.mocked(callStructuredAi).mock.calls[0][1]).toEqual(owner);
  });

  it("does not escalate after writing assistance fails", async () => {
    vi.mocked(callStructuredAi).mockRejectedValue(new Error("private provider error"));
    const result = await generateTakeoffPreparationAssistance(input());
    expect(result.status).toBe("failed");
    expect(result.proposals).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private provider error");
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(callOpenAiDecisions).not.toHaveBeenCalled();
  });

  it("keeps every blocking question despite a low or refused model priority", async () => {
    vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "available", model: "gpt-6-luna", billing: "separate_api", message: "API" });
    vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "partial", message: "Réponses partielles", answers: [
      { name: "question_0", status: "answered", value: 0 }, { name: "question_1", status: "refused", value: null },
      { name: "next_action", status: "answered", value: "launch" },
    ], provenance: { request_fingerprint: "request-a", model: "gpt-6-luna", usage: { input_tokens: 20, output_tokens: 0, total_tokens: 20 } } } as never);
    const request = input();
    request.preparation.unknowns = [{ id: "height", question: "Quelle hauteur retenir ?", impact: "blocking", status: "open",
      answer: null, responsible: null, source_document_id: "plan-a", page: 1 }];
    const before = evaluateTakeoffPreparation(request.preparation);
    const result = await generateTakeoffPreparationAssistance(request);
    expect(result.decisions.ordered_question_ids).toContain("height");
    expect(result.decisions.ordered_question_ids).toHaveLength(2);
    expect(result.decisions.next_action).toBeNull();
    expect(evaluateTakeoffPreparation(request.preparation)).toEqual(before);
    expect(before.can_launch).toBe(false);
  });

  it("keeps a selected but unconfigured ChatGPT account distinct from the paid API", async () => {
    vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile-a", profiles: [{ id: "profile-a", model: null, accessToken: "fixture", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"] }] } as never);
    const capabilities = await getTakeoffPreparationAssistanceCapabilities(owner);
    expect(capabilities.writing).toMatchObject({ status: "unavailable", provider: "chatgpt", billing: "chatgpt_plan" });
    const result = await generateTakeoffPreparationAssistance(input());
    expect(result.status).toBe("unavailable");
    expect(callStructuredAi).not.toHaveBeenCalled();
  });
});
