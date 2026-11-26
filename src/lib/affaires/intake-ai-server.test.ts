import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { createIntakeAiRunner, IntakeAiBudgetStopped, readIntakeAiBatch, resolveIntakeAiSelection, type IntakeAiBatch } from "./intake-ai-server";

const { prepare, execute, resolveRequest, plan } = vi.hoisted(() => ({
  prepare: vi.fn(), execute: vi.fn(), resolveRequest: vi.fn(), plan: vi.fn(),
}));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: () => ({ prepare, execute }) }));
vi.mock("@/lib/ai/request-settings-server", () => ({ resolveAiRequest: resolveRequest }));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({ callLocalChatGptStructured: plan }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-workflow-owner", () => ({
  resolveChatGptIntakeOwner: async () => owner,
}));

const owner = { userId: "e933b17e-e613-401b-93a0-068dfa72aa1f", tenantId: "5587dd1d-75c4-4fb5-a246-d3c7bed177f8" };
const id = "56f99d58-60b0-45f0-a9a4-d6303b834855";
const key = { id: "fictional-key-grant", version: 4 };
const preferences = { model: "gpt-6.2-sol", reasoningEffort: "medium" } as const;
const batch: IntakeAiBatch = {
  id, launch_id: id, project_id: id, tenant_id: owner.tenantId, payer_id: owner.userId,
  selection: { source: "personal_api_key", connection: key, preferences },
  remaining_nano_usd: 2_000_000_000, ceiling_nano_usd: 2_000_000_000,
  budget_stop_message: null, finished_at: null,
};
const options = { schema: z.object({ answer: z.string() }), prompt: "Pièce fictive", beforeSend: vi.fn() };

describe("recorded intake requests", () => {
  beforeEach(() => vi.resetAllMocks());

  it("validates and pins the request's model, effort and key identity at the action boundary", async () => {
    const choice = { source: "personal_api_key", expectedConnectionId: key.id, model: preferences.model, effort: preferences.reasoningEffort } as const;
    resolveRequest.mockResolvedValue({ ok: true, source: choice.source, connection: key, preferences });
    expect(await resolveIntakeAiSelection(owner, choice)).toEqual(batch.selection);
    expect(resolveRequest).toHaveBeenCalledExactlyOnceWith(owner, { allowedSources: ["chatgpt_plan", "personal_api_key"] }, choice);
    resolveRequest.mockResolvedValue({ ok: false, message: "Clé remplacée." });
    await expect(resolveIntakeAiSelection(owner, choice)).rejects.toThrow("Clé remplacée.");
  });

  it("reuses the stored source and one durable balance across documents, OCR, brief and a new worker", async () => {
    let remaining = batch.remaining_nano_usd;
    let stopped = false;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "read_affaire_intake_ai_batch") return { data: { ...batch,
        remaining_nano_usd: remaining, budget_stop_message: stopped ? "Lot interrompu." : null } };
      if (name === "reserve_affaire_intake_ai_call") {
        if (args.p_bound === null) { stopped = true; return { data: null }; }
        remaining -= Number(args.p_bound);
        return { data: "receipt" };
      }
      if (name === "settle_affaire_intake_ai_call") {
        remaining += 700_000_000 - Number(args.p_cost);
        return { data: null };
      }
      throw new Error(`Unexpected call ${name}`);
    });
    const service = { rpc } as never;
    prepare.mockImplementation(async (_owner, input) => {
      await input.beforeSend();
      if (input.allotmentNanoUsd < 700_000_000) throw new ApiKeyError("AI_KEY_CEILING");
      return { boundNanoUsd: 700_000_000 };
    });
    execute.mockImplementation(async (_owner, _prepared, input) => {
      await input.beforeSend();
      return { data: { answer: "Fictif" }, model: "modèle-retourné", costNanoUsd: 500_000_000, schemaError: null };
    });
    const runner = createIntakeAiRunner(service, batch, "first");
    await expect(runner.run("classification", { ...options, files: [{ mimeType: "text/plain", data: Buffer.from("Extrait fictif").toString("base64") }] }))
      .resolves.toMatchObject({ receipt: { source: "personal_api_key", model: "modèle-retourné", reasoningEffort: "medium" } });
    await runner.run("classification", options);
    const resumed = createIntakeAiRunner(service, (await readIntakeAiBatch(service, id))!, "second");
    await resumed.run("transcription", options);
    await expect(resumed.run("brief", options)).rejects.toBeInstanceOf(IntakeAiBudgetStopped);
    await expect(resumed.run("classification", options)).rejects.toThrow("Lot interrompu.");
    expect(prepare.mock.calls.map(([, input]) => [input.model, input.reasoningEffort, input.allotmentNanoUsd])).toEqual([
      ["gpt-6.2-sol", "medium", 2_000_000_000], ["gpt-6.2-sol", "medium", 1_500_000_000],
      ["gpt-6.1-terra", "high", 1_000_000_000], ["gpt-6.2-sol", "medium", 500_000_000],
    ]);
    expect(prepare).toHaveBeenNthCalledWith(1, owner, expect.objectContaining({
      expectedConnectionId: key.id, expectedVersion: key.version, prompt: expect.stringContaining("Extrait fictif"), files: [],
    }));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith("reserve_affaire_intake_ai_call", expect.objectContaining({ p_stage: "brief", p_bound: null, p_lease_token: "second" }));
    expect(resolveRequest).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
  });

  it("reuses the recorded plan grant and preference without resolving a request", async () => {
    const connection = { profileId: "original-plan", authorizationId: "original-grant" };
    plan.mockResolvedValue({ data: { answer: "Fictif" }, model: preferences.model, reasoningEffort: "medium" });
    const runner = createIntakeAiRunner({} as never, { ...batch, selection: { source: "chatgpt_plan", preferences, connection } }, "lease");
    await runner.run("brief", options);
    expect(plan).toHaveBeenCalledExactlyOnceWith({ ...owner, connection }, options, undefined, preferences, { allowUnselectedModel: true });
    expect(resolveRequest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

it("a resumed worker closes a stopped launch using its recorded balance and notice", async () => {
  vi.clearAllMocks();
  const { processAffaireIntakeAnalysisLaunch } = await import("./intake-analysis-server");
  const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
  const message = new IntakeAiBudgetStopped().message;
  const rpc = vi.fn(async (name: string) => {
    if (name === "read_affaire_intake_ai_batch") return { data: { ...batch, budget_stop_message: message }, error: null };
    if (name === "claim_affaire_intake_analysis_launch") return { data: [{ upload_id: id, project_id: id,
      payer_id: owner.userId, tenant_id: owner.tenantId, read_scans: true, attempt_count: 2 }], error: null };
    if (["renew_affaire_intake_upload_lease", "intake_payer_can_write", "finish_affaire_intake_upload_attempt"].includes(name)) {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected query ${name}`);
  });
  const from = vi.fn();
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc, from } as never);
  await expect(processAffaireIntakeAnalysisLaunch(id, null)).resolves.toBe(id);
  expect(rpc).toHaveBeenLastCalledWith("finish_affaire_intake_upload_attempt", expect.objectContaining({
    p_upload_id: id, p_status: "failed", p_last_error: message,
  }));
  expect(from).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(resolveRequest).not.toHaveBeenCalled();
});
