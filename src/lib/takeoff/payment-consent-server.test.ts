import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmAffaireBrief, readAffaireBriefChoices } from "@/app/dashboard/affaires/_actions/intake";
import {
  assumeTakeoffLaunchRequestAction, launchPreparedTakeoffFromPlanSetAction, launchPreparedTakeoffFromSourceVersionPlanSetAction,
  readTakeoffPaymentOptionsAction, relaunchTakeoffAction,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { POST as remeasure } from "@/app/api/affaires/[projectId]/takeoff/items/remeasure/route";
import { ITEM_REVIEW_COMMAND_VERSION } from "@/lib/takeoff/item-table-contracts";
import { TAKEOFF_PAYMENT_SETTINGS_CHANGED } from "@/lib/takeoff/payment-choice";

const fixture = vi.hoisted(() => {
  const id = (n: number) => `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const rpc = vi.fn(async (name: string) => {
    if (name === "takeoff_payer_may_launch") return { data: true, error: null };
    if (name === "takeoff_launch_is_active" || name === "takeoff_plan_dispatch_is_active") return { data: false, error: null };
    if (name === "replay_manual_takeoff_plan_request") return { data: [], error: null };
    if (name === "seal_takeoff_api_mandate") return { data: null, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const context = { tenantId: id(1), userId: id(2), tenantRole: "engineer",
    supabase: { auth: { getClaims: async () => ({ data: { claims: {} } }) } } };
  return { id, context, rpc, costCents: 2500, connectionId: id(8), readBriefPlans: vi.fn() };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: async () => fixture.context }));
vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: async (id: string) => ({ context: fixture.context, project: { id } }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: fixture.rpc }) }));
vi.mock("@/lib/takeoff/preparation-repository", async (original) => ({
  ...await original<typeof import("./preparation-repository")>(), assertPreparationProjectAccess: vi.fn(),
}));
vi.mock("@/lib/takeoff/preparation-server", async (original) => ({
  ...await original<typeof import("./preparation-server")>(), assertConfirmedTakeoffPreparation: async () => ({ execution_selection: null }),
}));
vi.mock("@/lib/takeoff/job-creation-repository", async (original) => ({
  ...await original<typeof import("./job-creation-repository")>(),
  getTakeoffJobById: vi.fn(), getTakeoffPlanSetJobByPreparation: vi.fn(), assertEstimateVersionAccessibleAsDraft: vi.fn(),
}));
vi.mock("@/lib/takeoff/brief-plan-choice-server", async (original) => ({
  ...await original<typeof import("./brief-plan-choice-server")>(), readBriefPlanOptions: fixture.readBriefPlans,
}));
vi.mock("@/lib/takeoff/item-table-server", async (original) => ({
  ...await original<typeof import("./item-table-server")>(), itemReviewerRight: async () => true,
}));
vi.mock("@/lib/ai/chatgpt-local-auth", async (original) => ({
  ...await original<typeof import("@/lib/ai/chatgpt-local-auth")>(), assertLocalChatGptHost: vi.fn(),
}));
vi.mock("@/lib/ai/chatgpt-takeoff", async (original) => ({
  ...await original<typeof import("@/lib/ai/chatgpt-takeoff")>(),
  readLocalChatGptSubscription: async () => ({ issue: "CHATGPT_NOT_CONNECTED", selection: null }),
}));
vi.mock("@/lib/ai/request-settings-server", () => ({
  readAiRequestOptions: async () => ({ defaultSource: "personal_api_key", options: {} }),
  resolveAiRequest: async () => ({
    ok: true, source: "personal_api_key", preferences: { model: "gpt-6.1-sol", reasoningEffort: "medium" },
    connection: { id: fixture.connectionId, version: 1 },
  }),
}));
vi.mock("@/lib/takeoff/feature-flags", async (original) => ({
  ...await original<typeof import("./feature-flags")>(), takeoffModuleDefault: () => true, assertTakeoffEnabled: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: async () => ({ maxTotalTokens: 400_000, maxCostCents: fixture.costCents }),
}));

const projectId = fixture.id(3);
const planSetId = fixture.id(4);
const requestId = fixture.id(5);
const versionId = fixture.id(6);
const planId = fixture.id(7);
const itemId = fixture.id(9);
const digest = "a".repeat(64);
const choice = { source: "personal_api_key", model: "gpt-6.1-sol", effort: "medium",
  expectedConnectionId: fixture.id(8), expectedMaxCostCents: 2500 } as const;
const launch = { projectId, planSetId, preparationRevision: 3, level: "C", provider: "chatgpt", paymentChoice: choice } as const;
const brief = { projectId, expectedUpdatedAt: "2026-11-26T10:00:00Z", plans: [{ id: planId, version: digest }],
  payerNotice: digest, paymentChoice: choice };
const refusal = { code: TAKEOFF_PAYMENT_SETTINGS_CHANGED, message: expect.stringMatching(/Le plafond du métré a changé.*Rechargez/u), reloadSettings: true };

beforeEach(() => {
  fixture.costCents = 2500;
  fixture.connectionId = fixture.id(8);
  fixture.rpc.mockClear();
  fixture.readBriefPlans.mockReset();
});

describe("the amount accepted for a takeoff with a personal key", () => {
  const submission = async () => {
    const shown = await readTakeoffPaymentOptionsAction({ projectId });
    expect(shown).toMatchObject({ ok: true, data: { maxCostCents: choice.expectedMaxCostCents } });
    fixture.costCents = 5000;
  };

  it.each([
    ["launch on a draft", () => launchPreparedTakeoffFromPlanSetAction({ ...launch, versionId })],
    ["launch on a copied version", () => launchPreparedTakeoffFromSourceVersionPlanSetAction({ ...launch, sourceVersionId: versionId })],
    ["take on at the original mandate revision", () => assumeTakeoffLaunchRequestAction({ projectId, requestId, seenRevision: 7, action: "take_on", paymentChoice: choice })],
    ["resume at the original mandate revision", () => assumeTakeoffLaunchRequestAction({ projectId, requestId, seenRevision: 7, action: "resume", paymentChoice: choice })],
    ["relaunch", () => relaunchTakeoffAction({ ...launch, intentKey: fixture.id(10), predecessorJobId: null })],
  ] as const)("refuses to seal before %s", async (_label, gesture) => {
    await submission();
    expect(await gesture()).toMatchObject({ ok: false, error: refusal });
    expect(fixture.rpc.mock.calls.flat()).not.toContain("seal_takeoff_api_mandate");
  });

  it("refuses to seal at brief confirmation before checking the digest", async () => {
    await submission();
    expect(await confirmAffaireBrief(brief)).toMatchObject({ ok: false, ...refusal });
    expect(fixture.rpc.mock.calls.flat()).not.toContain("seal_takeoff_api_mandate");
  });

  it("refuses to seal at remeasure confirmation", async () => {
    await submission();
    const response = await remeasure(new Request("http://localhost/remeasure", { method: "POST", body: JSON.stringify({
      command_version: ITEM_REVIEW_COMMAND_VERSION, scope: { kind: "affaire" }, item_ids: [itemId], plan_keys: [planId],
      seen: { list_revision_id: null, targets: [{ itemId, entryRevision: 0, answers: [] }] },
      intent_key: fixture.id(10), preview_digest: digest, setting: null, payment_choice: choice,
    }) }), { params: Promise.resolve({ projectId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: refusal.code, message: refusal.message,
      details: { reloadSettings: true } } });
    expect(fixture.rpc.mock.calls.flat()).not.toContain("seal_takeoff_api_mandate");
  });

  it("returns a changed connection from the brief confirmation and lets unexpected failures propagate", async () => {
    fixture.connectionId = fixture.id(11);
    expect(await confirmAffaireBrief(brief)).toMatchObject({ ok: false, code: refusal.code, reloadSettings: true,
      message: "La connexion OpenAI a changé. Rechargez les réglages du métré." });
    expect(fixture.rpc.mock.calls.flat()).not.toContain("seal_takeoff_api_mandate");

    fixture.readBriefPlans.mockRejectedValueOnce(new Error("Fictional unexpected error"));
    await expect(readAffaireBriefChoices({ projectId })).rejects.toThrow("Fictional unexpected error");
  });
});
