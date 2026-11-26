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
  // What the database holds when the gesture arrives: who may pay, the notice it would show, the request's mandate.
  const state = { payer: true, notice: "a".repeat(64), mandateRevision: 7, allowedAction: "take_on", itemList: "ready" };
  const rpc = vi.fn(async (name: string) => {
    if (name === "takeoff_payer_may_launch") return { data: state.payer, error: null };
    if (name === "takeoff_launch_is_active" || name === "takeoff_plan_dispatch_is_active") return { data: false, error: null };
    if (name === "replay_manual_takeoff_plan_request") return { data: [], error: null };
    if (name === "seal_takeoff_api_mandate") return { data: null, error: null };
    if (name === "takeoff_payer_notice") return { data: state.notice, error: null };
    if (name === "takeoff_launch_request_action") return { data: state.allowedAction, error: null };
    if (name === "confirm_affaire_brief_plan_choice") {
      return { data: [{ outcome: "confirmed", request_id: null, state: null, reason_code: null, payer_id: null }], error: null };
    }
    if (name === "take_on_takeoff_launch_request") {
      return { data: [{ outcome: "mandated", request_id: id(5), state: "blocked", reason_code: null, payer_id: id(2) }], error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const request = { maybeSingle: async () => ({ data: { mandate_revision: state.mandateRevision }, error: null }) };
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => request }) }) }) }));
  const context = { tenantId: id(1), userId: id(2), tenantRole: "engineer",
    supabase: { auth: { getClaims: async () => ({ data: { claims: {} } }) } } };
  return { id, context, rpc, from, state, costCents: 2500, connectionId: id(8), readBriefPlans: vi.fn() };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: async () => fixture.context }));
vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: async (id: string) => ({ context: fixture.context, project: { id } }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: fixture.rpc, from: fixture.from }) }));
vi.mock("@/lib/ai/chatgpt-local-store", async (original) => ({
  ...await original<typeof import("@/lib/ai/chatgpt-local-store")>(), getChatGptHostId: async () => `urn:uuid:${fixture.id(99)}`,
}));
vi.mock("@/lib/ai/access/openai-api", async (original) => ({
  ...await original<typeof import("@/lib/ai/access/openai-api")>(),
  openAiApiKeyAccess: () => ({ state: async () => ({ status: "saved", connection: { connectionId: fixture.connectionId, version: 1 } }) }),
}));
vi.mock("@/lib/takeoff/item-list-seal-server", async (original) => ({
  ...await original<typeof import("./item-list-seal-server")>(),
  sealedMeasuringOrder: async () => fixture.state.itemList === "ready" ? { order: { kind: "free" }, items: [] } : { blocked: "ITEM_LIST_TO_PREPARE" },
}));
vi.mock("@/lib/takeoff/preparation-repository", async (original) => ({
  ...await original<typeof import("./preparation-repository")>(), assertPreparationProjectAccess: vi.fn(),
}));
vi.mock("@/lib/takeoff/preparation-server", async (original) => ({
  ...await original<typeof import("./preparation-server")>(),
  assertConfirmedTakeoffPreparation: async () => ({ execution_selection: null, preparation: { sources: [] } }),
}));
vi.mock("@/lib/takeoff/job-creation-repository", async (original) => ({
  ...await original<typeof import("./job-creation-repository")>(),
  getTakeoffJobById: vi.fn(), getTakeoffPlanSetJobByPreparation: vi.fn(), assertEstimateVersionAccessibleAsDraft: vi.fn(),
  resolvePlanSetSourceFile: vi.fn(async () => ({})),
}));
vi.mock("@/lib/takeoff/brief-plan-choice-server", async (original) => ({
  ...await original<typeof import("./brief-plan-choice-server")>(), readBriefPlanOptions: fixture.readBriefPlans,
  attestBriefPlanChoice: async () => ({ plans: {} }),
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

const remeasureCommand = () => remeasure(new Request("http://localhost/remeasure", { method: "POST", body: JSON.stringify({
  command_version: ITEM_REVIEW_COMMAND_VERSION, scope: { kind: "affaire" }, item_ids: [itemId], plan_keys: [planId],
  seen: { list_revision_id: null, targets: [{ itemId, entryRevision: 0, answers: [] }] },
  intent_key: fixture.id(10), preview_digest: digest, setting: null, payment_choice: choice,
}) }), { params: Promise.resolve({ projectId }) });
const assume = (action: "take_on" | "resume") =>
  assumeTakeoffLaunchRequestAction({ projectId, requestId, seenRevision: 7, action, paymentChoice: choice });
const called = () => fixture.rpc.mock.calls.map(([name]) => name);

beforeEach(() => {
  fixture.costCents = 2500;
  fixture.connectionId = fixture.id(8);
  Object.assign(fixture.state, { payer: true, notice: digest, mandateRevision: 7, allowedAction: "take_on", itemList: "ready" });
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
    const response = await remeasureCommand();
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

// A payment choice is accepted from a payer only (takeoff_payer_may_launch): anyone else is refused before anything is read
// about their key, and nothing is recorded.
describe("a payment choice sent by a member who may not pay the affaire's takeoff", () => {
  const forbidden = { status: 403, code: "FORBIDDEN", message: "Votre rôle ne permet pas de payer le métré de cette affaire." };

  it.each([
    ["launch on a draft", () => launchPreparedTakeoffFromPlanSetAction({ ...launch, versionId })],
    ["launch on a copied version", () => launchPreparedTakeoffFromSourceVersionPlanSetAction({ ...launch, sourceVersionId: versionId })],
    ["take on", () => assume("take_on")],
    ["resume", () => assume("resume")],
    ["relaunch", () => relaunchTakeoffAction({ ...launch, intentKey: fixture.id(10), predecessorJobId: null })],
  ] as const)("is refused at %s, with no mandate", async (_label, gesture) => {
    fixture.state.payer = false;
    expect(await gesture()).toMatchObject({ ok: false, error: forbidden });
    expect(called()).not.toContain("seal_takeoff_api_mandate");
  });

  it("is refused at brief confirmation, with no mandate and no confirmation", async () => {
    fixture.state.payer = false;
    await expect(confirmAffaireBrief(brief)).rejects.toMatchObject(forbidden);
    expect(called()).not.toContain("seal_takeoff_api_mandate");
    expect(called()).not.toContain("confirm_affaire_brief_plan_choice");
  });

  it("is refused at remeasure confirmation, with no mandate", async () => {
    fixture.state.payer = false;
    const response = await remeasureCommand();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { message: forbidden.message } });
    expect(called()).not.toContain("seal_takeoff_api_mandate");
  });
});

// The mandate is recorded by the last call before the one that creates the request: a refusal the server can see first
// leaves no row.
describe("a gesture with a personal key refused after its settings were accepted", () => {
  it("records no mandate when the payer notice changed since the brief dialog showed it", async () => {
    fixture.state.notice = "b".repeat(64);
    expect(await confirmAffaireBrief(brief)).toMatchObject({ ok: false, code: "TAKEOFF_PAYER_NOTICE_CHANGED", reloadSettings: true });
    expect(called()).toContain("takeoff_payer_notice");
    expect(called()).not.toContain("seal_takeoff_api_mandate");
    expect(called()).not.toContain("confirm_affaire_brief_plan_choice");
  });

  it("records the brief's mandate immediately before the confirmation that names it", async () => {
    expect(await confirmAffaireBrief(brief)).toMatchObject({ ok: true, status: "confirme" });
    expect(called().slice(-2)).toEqual(["seal_takeoff_api_mandate", "confirm_affaire_brief_plan_choice"]);
    const [, sealed] = fixture.rpc.mock.calls.find(([name]) => name === "seal_takeoff_api_mandate") as unknown as [string, Record<string, unknown>];
    const [, confirmed] = fixture.rpc.mock.calls.at(-1) as unknown as [string, { p_selection: { authorizationId: string; source: string } }];
    expect(confirmed.p_selection).toMatchObject({ source: "personal_api_key", authorizationId: sealed.p_id });
    expect(sealed).toMatchObject({ p_tenant_id: fixture.context.tenantId, p_project_id: projectId, p_payer_id: fixture.context.userId,
      p_settings: { connectionId: choice.expectedConnectionId, maxNanoUsd: 25_000_000_000, maxTokens: 400_000 } });
  });

  it.each([
    ["take on", "take_on", { mandateRevision: 8 }],
    ["resume", "resume", { mandateRevision: 8, allowedAction: "resume" }],
    ["take on a request that now offers another gesture", "take_on", { allowedAction: "none" }],
    ["resume a request that now offers another gesture", "resume", { allowedAction: "take_on" }],
  ] as const)("records no mandate when the request moved before %s", async (_label, action, moved) => {
    Object.assign(fixture.state, moved);
    expect(await assume(action)).toMatchObject({ ok: false, error: { status: 409, code: "CONFLICT",
      message: expect.stringContaining("a changé depuis votre lecture") } });
    expect(called()).not.toContain("seal_takeoff_api_mandate");
    expect(called()).not.toContain("take_on_takeoff_launch_request");
  });

  it.each(["take_on", "resume"] as const)("records the mandate immediately before the %s it pays", async (action) => {
    fixture.state.allowedAction = action;
    expect(await assume(action)).toMatchObject({ ok: true, data: { requestId } });
    const names = called();
    const take = names.indexOf("take_on_takeoff_launch_request");
    expect(names[take - 1]).toBe("seal_takeoff_api_mandate");
    expect(names.filter((name) => name === "seal_takeoff_api_mandate")).toHaveLength(1);
  });

  it("records no mandate when a relaunch is refused after its payment was resolved", async () => {
    fixture.state.itemList = "to_prepare";
    expect(await relaunchTakeoffAction({ ...launch, intentKey: fixture.id(10), predecessorJobId: null })).toMatchObject({
      ok: false, error: { status: 409, message: expect.stringContaining("La liste des postes est à préparer") } });
    expect(called()).not.toContain("seal_takeoff_api_mandate");
    expect(called()).not.toContain("launch_manual_takeoff_request");
  });
});
