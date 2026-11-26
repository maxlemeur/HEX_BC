import { beforeEach, expect, it, vi } from "vitest";
import { launchAffaireIntakeAnalysis, readAffaireIntakeAiOptions, retryAffaireDocumentAnalysis } from "./intake";
import { createIntakeAiRunner, IntakeAiBudgetStopped, readIntakeAiBatch, resolveIntakeAiSelection } from "@/lib/affaires/intake-ai-server";
import { processAffaireIntakeAnalysisLaunch, retryAffaireDocumentAnalysis as retryDocument } from "@/lib/affaires/intake-analysis-server";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-derived-state-server";

const { rpc, after, access, planGrant } = vi.hoisted(() => ({ rpc: vi.fn(), after: vi.fn(), access: vi.fn(), planGrant: vi.fn() }));
vi.mock("next/server", async (actual) => ({ ...await actual<typeof import("next/server")>(), after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: access }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));
vi.mock("@/lib/affaires/intake-payer-server", async (actual) => ({
  ...await actual<typeof import("@/lib/affaires/intake-payer-server")>(),
  readSelectedIntakePlanConnection: planGrant,
}));
vi.mock("@/lib/ai/request-settings-server", () => ({
  readAiRequestOptions: vi.fn(async () => ({
    defaultSource: "chatgpt_plan",
    options: { chatgpt_plan: { ok: true, message: "Forfait fictif", models: [],
      preferences: { model: "fixture-plan", reasoningEffort: "high" }, connection: null } },
  })),
  resolveAiRequest: vi.fn(async () => ({
    ok: true, source: "chatgpt_plan", connection: null, preferences: { model: "fixture-plan", reasoningEffort: "high" },
  })),
}));
vi.mock("@/lib/affaires/intake-ai-server", async (actual) => ({
  ...await actual<typeof import("@/lib/affaires/intake-ai-server")>(),
  createIntakeAiRunner: vi.fn(), readIntakeAiBatch: vi.fn(), resolveIntakeAiSelection: vi.fn(),
}));
vi.mock("@/lib/affaires/intake-analysis-server", () => ({
  processAffaireIntakeAnalysisLaunch: vi.fn(), retryAffaireDocumentAnalysis: vi.fn(),
}));
vi.mock("@/lib/supabase/read-all", () => ({ readAllRowsInChunks: vi.fn() }));
vi.mock("@/lib/affaires/intake-derived-state-server", () => ({ refreshAffaireIntakeFromActiveDocuments: vi.fn() }));

const projectId = "12eac43b-087d-481e-a2fb-a151d1b76e2f";
const tenantId = "2b5bb144-d1ed-4033-b21d-24b3e5d39ce0";
const userId = "9527a3fa-551d-4787-9cd8-1767824d48ee";
const batchId = "980e45b3-a0cd-4e09-b293-da1eea1639d8";
const second = "c506d80b-91a5-44c0-9e63-0327ca5d2703";
const third = "0044dc58-3784-4077-8f50-6366b32c684a";
const choice = { source: "personal_api_key", expectedConnectionId: "fictive", model: "gpt-6.2-sol", effort: "high" } as const;
const selection = { source: choice.source, connection: { id: choice.expectedConnectionId, version: 4 },
  preferences: { model: choice.model, reasoningEffort: choice.effort } } as const;
const batch = { id: batchId, launch_id: null, project_id: projectId, payer_id: userId, tenant_id: tenantId,
  budget_stop_message: null, finished_at: null, selection, ceiling_nano_usd: 2_000_000_000, remaining_nano_usd: 2_000_000_000 } as const;

beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ project: { id: projectId }, context: { userId, tenantId } });
  vi.mocked(resolveIntakeAiSelection).mockResolvedValue(selection);
  vi.mocked(readIntakeAiBatch).mockResolvedValue(batch);
  vi.mocked(createIntakeAiRunner).mockReturnValue({ source: "personal_api_key", run: vi.fn() });
  vi.mocked(readAllRowsInChunks).mockImplementation(async ids => ({
    data: ids.map((id, index) => ({ id, file_name: `${index + 1}.txt` })), error: null,
  }));
});

it("starts the worker with an accepted lot id after recording the explicit authenticated choice", async () => {
  rpc.mockResolvedValue({ data: [{ outcome: "launched", batch_id: batchId, piece_count: 2 }] });
  await expect(launchAffaireIntakeAnalysis(projectId, choice)).resolves.toEqual({ message: "Analyse du dossier lancée." });
  expect(resolveIntakeAiSelection).toHaveBeenCalledWith({ userId, tenantId }, choice);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_affaire_intake_ai_batch", {
    p_project_id: projectId, p_tenant_id: tenantId, p_payer_id: userId, p_selection: selection, p_retry: false,
  });
  expect(processAffaireIntakeAnalysisLaunch).not.toHaveBeenCalled();
  await after.mock.calls[0][0]();
  expect(processAffaireIntakeAnalysisLaunch).toHaveBeenCalledExactlyOnceWith(batchId, null, {
    projectId, tenantId, payerId: userId,
  });
});

it("gives all retry documents the same persisted batch and leaves later documents untouched at the cap", async () => {
  rpc.mockResolvedValue({ data: [{ outcome: "retry", batch_id: batchId, piece_count: 0 }] });
  const readPage = vi.fn();
  vi.mocked(retryDocument).mockImplementationOnce(async input => {
    input.defer?.(readPage);
    return { uploadId: batchId, analyzed: true, usedFallback: false, preservedManualClassification: true, failure: undefined, warning: null };
  }).mockRejectedValueOnce(new IntakeAiBudgetStopped());
  const result = await retryAffaireDocumentAnalysis({ projectId, choice, documentIds: [projectId, second, third] });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_affaire_intake_ai_batch", expect.objectContaining({ p_retry: true, p_selection: selection }));
  expect(retryDocument).toHaveBeenCalledTimes(2);
  expect(vi.mocked(retryDocument).mock.calls[0][0].ai).toBe(vi.mocked(retryDocument).mock.calls[1][0].ai);
  expect(result.message).toContain("2,00 $ US");
  expect(result.failures).toContainEqual(expect.stringMatching(/^3.txt : analyse non lancée/));
  await after.mock.calls[0][0]();
  expect(readPage).toHaveBeenCalledOnce();
  expect(refreshAffaireIntakeFromActiveDocuments).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith("finish_affaire_intake_ai_retry", {
    p_batch_id: batchId, p_project_id: projectId, p_tenant_id: tenantId, p_payer_id: userId,
  });
});

it("refuses a different plan grant between display and acceptance before reserving a batch", async () => {
  const grantA = { profileId: "fixture-account-a", authorizationId: "fixture-grant-a" };
  const grantB = { profileId: "fixture-account-b", authorizationId: "fixture-grant-b" };
  planGrant.mockResolvedValueOnce(grantA).mockResolvedValueOnce(grantB);
  const real = await vi.importActual<typeof import("@/lib/affaires/intake-ai-server")>("@/lib/affaires/intake-ai-server");
  vi.mocked(resolveIntakeAiSelection).mockImplementation(real.resolveIntakeAiSelection);
  const shown = await readAffaireIntakeAiOptions(projectId);
  expect(shown.planConnectionId).toMatch(/^[0-9a-f]{64}$/);
  expect(await launchAffaireIntakeAnalysis(projectId, {
    source: "chatgpt_plan", model: "fixture-plan", effort: "high", expectedConnectionId: shown.planConnectionId!,
  })).toEqual({
    message: "Le forfait ChatGPT affiché a changé. Rechargez les réglages avant de lancer l’analyse.",
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});
