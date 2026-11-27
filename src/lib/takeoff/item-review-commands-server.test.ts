import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ readLocalChatGptSubscription: vi.fn() }));
vi.mock("./launch-request-server", () => ({ readAffaireTakeoffLaunchState: vi.fn() }));
vi.mock("./item-measure-catalogue-server", () => ({ readMeasureCatalogue: vi.fn() }));
vi.mock("./payment-server", () => ({ resolveTakeoffPayment: vi.fn(), sealTakeoffPayment: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./item-remeasure-server", () => ({ planTakeoffItemRemeasure: vi.fn(), launchTakeoffItemRemeasure: vi.fn(),
  replayTakeoffItemRemeasure: vi.fn() }));
vi.mock("./item-table-server", () => ({ loadItemLines: vi.fn(), itemReviewerRight: vi.fn() }));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({ recomputeTakeoffRulesQuietly: vi.fn(async () => ({ lines: 1, skipped: 0 })) }));

import { resolveTakeoffPayment, sealTakeoffPayment } from "./payment-server";
import { readMeasureCatalogue } from "./item-measure-catalogue-server";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readLocalChatGptSubscription } from "@/lib/ai/chatgpt-takeoff";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { buildItemLines, type ItemReviewTarget, type ItemTableRow } from "./item-table";
import type { ItemRemeasureCommand, ItemReviewCommand } from "./item-table-contracts";
import { FIXTURE_PLANS, fixtureAnswer, fixtureItemId, fixturePoste, fixtureReading } from "./item-table.test-fixtures";
import { itemReviewerRight, loadItemLines } from "./item-table-server";
import {
  launchTakeoffItemRemeasure,
  planTakeoffItemRemeasure,
  replayTakeoffItemRemeasure,
  type TakeoffItemRemeasurePlan,
} from "./item-remeasure-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";
import { previewItemRemeasure, runItemRemeasure, runItemReviewCommand } from "./item-review-commands-server";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const TENANT = "77777777-7777-4777-8777-777777777777";
const INTENT = "66666666-6666-4666-8666-666666666666";
const JOB = "33333333-3333-4333-8333-333333333333";
const VERSION = "88888888-8888-4888-8888-888888888888";
const LIST = "44444444-4444-4444-8444-444444444444";

const rows = (): ItemTableRow[] => [
  { item: fixturePoste(1, "WC"), state: "measured", decision: "pending", entry: null,
    coverage: { expected: 1, answered: 1, inFlight: 0, ended: 0 }, readings: [fixtureReading(1, "plan-rdc", fixtureAnswer("measured", 2))] },
  { item: fixturePoste(2, "Baignoire"), state: "not_found", decision: "pending", entry: null,
    coverage: { expected: 1, answered: 1, inFlight: 0, ended: 0 }, readings: [fixtureReading(2, "plan-rdc", fixtureAnswer("not_found", null))] },
  { item: fixturePoste(3, "Receveur de douche"), state: "to_measure", decision: "none", entry: null,
    coverage: { expected: 0, answered: 0, inFlight: 0, ended: 0 }, readings: [] },
];
let lines = buildItemLines(rows(), { plans: FIXTURE_PLANS, scope: { kind: "affaire" } });
const targetsOf = (ids: number[]) => lines.filter(({ itemId }) => ids.map(fixtureItemId).includes(itemId)).map(({ targets }) => targets);

// The plan of a request reading the selection: what the preview shows (its calls and budget) and what the admission seals.
const PLANNED = { planSetId: "99999999-9999-4999-8999-999999999999", preparationRevision: 3, planFileIds: [], planKeys: [],
  predecessorJobId: JOB, listRevisionId: "44444444-4444-4444-8444-444444444444", askedItemIds: [], snapshot: {},
  manifest: { budget: { tokens: 66_000, cost_cents: 0 }, plans: [] },
  bounds: { ok: true, items: 1, plans: 2, readingCalls: 2, classifierCalls: 0, minutes: 2, maxRequestCalls: 200, maxPlanCalls: 100,
    maxPlanPages: 2000, calls: 2, tokens: 60_000, requestBudgetTokens: 66_000, answerBytes: 1_000, units: [], exceeded: [] },
} as unknown as TakeoffItemRemeasurePlan;
const review = vi.fn();
let jobs: Array<{ id: string; estimate_version_id: string | null; project_id: string }> = [];
const access = { context: { userId: MEMBER, tenantId: TENANT, supabase: {
  rpc: review,
  from: (table: string) => table === "takeoff_jobs"
    ? { select: () => ({ eq: () => ({ in: async () => ({ data: jobs, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Léa Martin" }, error: null }) }) }) },
} }, project: { id: PROJECT } };

function command(gesture: ItemReviewCommand["gesture"], targets: ItemReviewTarget[], extra: Record<string, unknown> = {}) {
  return { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" }, gesture, targets, ...extra } as ItemReviewCommand;
}

async function refusal(promise: Promise<unknown>) {
  return promise.then(() => { throw new Error("expected a refusal"); }, (error: { status: number; code: string; details?: unknown; message: string }) => error);
}

beforeEach(() => {
  vi.clearAllMocks();
  jobs = [{ id: JOB, estimate_version_id: null, project_id: PROJECT }];
  lines = buildItemLines(rows(), { plans: FIXTURE_PLANS, scope: { kind: "affaire" } });
  vi.mocked(requireAffaireAccess).mockResolvedValue(access as never);
  vi.mocked(itemReviewerRight).mockResolvedValue(true);
  vi.mocked(loadItemLines).mockImplementation(async () => ({ lines, plans: FIXTURE_PLANS, list: { revisionId: LIST, revision: 3,
    itemCount: 3 } }) as never);
  review.mockResolvedValue({ data: { outcome: "applied", applied: [], skipped: [], replayed: false }, error: null });
  vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-a",
    reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
  vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ request: null } as never);
  vi.mocked(planTakeoffItemRemeasure).mockResolvedValue({ plan: PLANNED });
  vi.mocked(replayTakeoffItemRemeasure).mockResolvedValue(null);
  vi.mocked(launchTakeoffItemRemeasure).mockResolvedValue({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
});

describe("runItemReviewCommand", () => {
  it("refuses a member who is not a takeoff operator of the affaire before reading the table", async () => {
    vi.mocked(itemReviewerRight).mockResolvedValue(false);
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1])))))
      .toMatchObject({ status: 403, code: "TAKEOFF_ITEM_REVIEW_FORBIDDEN" });
    expect(loadItemLines).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it("refuses a malformed command before any read: an item twice, « Autre » without its note, a value missing", async () => {
    const [wc] = targetsOf([1]);
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", [wc, wc])))).toMatchObject({ status: 422 });
    expect(await refusal(runItemReviewCommand(PROJECT, command("set_aside", [wc], { reason: "other", note: " a " }))))
      .toMatchObject({ status: 422, message: expect.stringContaining("« Autre »") });
    expect(await refusal(runItemReviewCommand(PROJECT, command("enter_quantity", targetsOf([1, 2]), {
      values: [{ item_id: fixtureItemId(2), quantity: 1, unit: "u" }], entry: { category: "site_survey" } }))))
      .toMatchObject({ status: 422, message: "Chaque poste de la sélection reçoit sa propre valeur, saisie à part." });
    expect(requireAffaireAccess).not.toHaveBeenCalled();
  });

  it("sends the database the member's targets as read and the items the server found eligible, the others with their reason", async () => {
    review.mockResolvedValue({ data: { outcome: "applied", applied: [{ item_id: fixtureItemId(1), answers: 1 }],
      skipped: [{ item_id: fixtureItemId(2), label: "Baignoire", reason: "not_measured" }], replayed: false }, error: null });
    const result = await runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1, 2])));
    const [name, args] = review.mock.calls[0];
    expect(name).toBe("review_takeoff_items");
    expect(args).toEqual({ p_tenant_id: TENANT, p_project_id: PROJECT, p_command: {
      command_version: 1, intent_key: INTENT, gesture: "accept_measured", scope: { kind: "affaire" },
      targets: targetsOf([1, 2]).map((target) => ({ item_id: target.itemId, entry_revision: 0,
        answers: target.answers.map((answer) => ({ answer_id: answer.answerId, decision_revision: 0, entry_revision: 0,
          marks_revision: 0 })) })),
      apply: [fixtureItemId(1)], skipped: [{ item_id: fixtureItemId(2), label: "Baignoire", reason: "not_measured" }] } });
    expect(result).toEqual({ outcome: "applied", applied: [{ itemId: fixtureItemId(1), label: "WC", answers: 1 }],
      skipped: [{ itemId: fixtureItemId(2), label: "Baignoire", reason: "not_measured" }] });
  });

  // Review of #485: a selection stale here went to the database with nothing to apply, which the database, finding it
  // current, recorded as done (nothing done, and its intention replaying that).
  it("still asks the database when the selection looks stale here, with every item to apply, never with none", async () => {
    const seen = targetsOf([1, 2]);
    lines = buildItemLines(rows().map((row) => row.item.id === fixtureItemId(1)
      ? { ...row, decision: "accepted", readings: row.readings.map((reading) => ({ ...reading,
        decision: { kind: "accepted", revision: 1, actorId: MEMBER, at: "2026-11-22T09:00:00Z" }, decisionRevision: 1 })) } : row),
    { plans: FIXTURE_PLANS, scope: { kind: "affaire" } });
    // A replay of the same command answers what it answered.
    review.mockResolvedValue({ data: { outcome: "applied", applied: [{ item_id: fixtureItemId(1), answers: 1 }], skipped: [],
      replayed: true }, error: null });
    const result = await runItemReviewCommand(PROJECT, command("accept_measured", seen));
    expect(review.mock.calls[0][1].p_command).toMatchObject({ apply: [fixtureItemId(1), fixtureItemId(2)], skipped: [] });
    expect(result.outcome).toBe("replayed");
    // Otherwise the database refuses it as stale, or applies the whole selection it finds current and eligible: either
    // way the command it records is never one that applied nothing on a stale selection.
    review.mockResolvedValue({ data: { outcome: "stale", stale: [fixtureItemId(1)] }, error: null });
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", seen))))
      .toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE" });
    expect(review.mock.calls[1][1].p_command).toMatchObject({ apply: [fixtureItemId(1), fixtureItemId(2)], skipped: [] });
  });

  it("plans a set aside or a reinstatement on its items whatever the marks did since the selection (an acceptance only certifies them)", async () => {
    const frozen = targetsOf([1]).map((target) => ({ ...target, answers: target.answers.map((answer) => ({ ...answer, marksRevision: 3 })) }));
    lines = buildItemLines(rows().map((row) => row.item.id === fixtureItemId(1)
      ? { ...row, readings: row.readings.map((reading) => ({ ...reading, marksRevision: 4 })) } : row),
    { plans: FIXTURE_PLANS, scope: { kind: "affaire" } });
    review.mockResolvedValue({ data: { outcome: "applied", applied: [{ item_id: fixtureItemId(1), answers: 1 }], skipped: [],
      replayed: false }, error: null });
    const result = await runItemReviewCommand(PROJECT, command("set_aside", frozen, { reason: "duplicate" }));
    expect(review.mock.calls[0][1].p_command).toMatchObject({ apply: [fixtureItemId(1)], skipped: [] });
    expect(result).toMatchObject({ outcome: "applied", applied: [{ itemId: fixtureItemId(1), label: "WC", answers: 1 }] });
    // An acceptance on the same selection is stale: all its items go, the database judges.
    await runItemReviewCommand(PROJECT, command("accept_measured", frozen));
    expect(review.mock.calls[1][1].p_command).toMatchObject({ apply: [fixtureItemId(1)], skipped: [] });
  });

  it("sends the identifiers of a selection as the database writes them, in lower case, so that what it applies names its targets", async () => {
    const upper = targetsOf([1]).map((target) => ({ ...target, itemId: target.itemId.toUpperCase(),
      answers: target.answers.map((answer) => ({ ...answer, answerId: answer.answerId.toUpperCase() })) }));
    await runItemReviewCommand(PROJECT, command("set_aside", upper, { reason: "duplicate" }));
    const sent = review.mock.calls[0][1].p_command;
    expect(sent.targets).toEqual(targetsOf([1]).map((target) => expect.objectContaining({ item_id: target.itemId,
      answers: target.answers.map((answer) => expect.objectContaining({ answer_id: answer.answerId })) })));
    expect(sent).toMatchObject({ apply: [fixtureItemId(1)], skipped: [] });
  });

  it("refuses a stale selection the database found, naming its lines: nothing applied", async () => {
    review.mockResolvedValue({ data: { outcome: "stale", stale: [fixtureItemId(1)] }, error: null });
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1])))))
      .toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE", details: { stale: [{ itemId: fixtureItemId(1), label: "WC" }] } });
  });

  it("words the database's refusals itself, never with its text", async () => {
    review.mockResolvedValue({ data: null, error: { message: "TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT" } });
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1])))))
      .toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT" });
    review.mockResolvedValue({ data: null, error: { message: "TAKEOFF_ITEM_REVIEW_FORBIDDEN" } });
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1])))))
      .toMatchObject({ status: 403, message: "Seul un opérateur du métré de l’affaire peut revoir les postes." });
  });

  it("sends every value the member typed, and the set aside's reason and note", async () => {
    await runItemReviewCommand(PROJECT, command("enter_quantity", targetsOf([1, 2]), {
      values: [{ item_id: fixtureItemId(1), quantity: 4, unit: "u" }, { item_id: fixtureItemId(2), quantity: 1, unit: "u" }],
      entry: { category: "site_survey" } }));
    expect(review.mock.calls[0][1].p_command).toMatchObject({ apply: [fixtureItemId(2)],
      values: [{ item_id: fixtureItemId(1), quantity: 4, unit: "u" }, { item_id: fixtureItemId(2), quantity: 1, unit: "u" }],
      entry: { category: "site_survey" } });
    await runItemReviewCommand(PROJECT, command("set_aside", targetsOf([2]), { reason: "other", note: " Prévu au lot chauffage " }));
    expect(review.mock.calls[1][1].p_command).toMatchObject({ reason: "other", note: "Prévu au lot chauffage" });
  });

  it("computes again the rules of the jobs the database names, on a replay too, as a member's save of a row does", async () => {
    const answered = (rulesJobs: string[], replayed = false) => review.mockResolvedValueOnce({ data: { outcome: "applied",
      applied: [{ item_id: fixtureItemId(1), answers: 1 }], skipped: [], rules_jobs: rulesJobs, replayed }, error: null });
    answered([JOB]);
    await runItemReviewCommand(PROJECT, command("set_aside", targetsOf([1]), { reason: "duplicate" }));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledWith({ tenantId: TENANT, jobId: JOB, projectId: PROJECT, context: "item_review" });
    // A replay of the same command: nothing decided again, the refresh a stopped server owed is finished.
    answered([JOB], true);
    await runItemReviewCommand(PROJECT, command("set_aside", targetsOf([1]), { reason: "duplicate" }));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledTimes(2);
    jobs = [{ id: JOB, estimate_version_id: VERSION, project_id: PROJECT }];
    answered([JOB]);
    await runItemReviewCommand(PROJECT, command("reinstate", targetsOf([1])));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenLastCalledWith({ tenantId: TENANT, estimateVersionId: VERSION, context: "item_review" });
    // An answer that names no job (an acceptance, a set aside without positive rows) computes nothing.
    answered([]);
    await runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1])));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledTimes(3);
  });
});

describe("remeasure of a selection", () => {
  // What the member saw of the selection: the table's list revision and each item's readings, as its lines showed them.
  const seen = (ids: number[], list = LIST) => ({ list_revision_id: list, targets: targetsOf(ids) });
  const preview = (ids: number[], view = seen(ids)) => previewItemRemeasure(PROJECT, { scope: { kind: "affaire" },
    itemIds: ids.map(fixtureItemId), seen: view });
  const confirmation = async (ids: number[], extra: Partial<ItemRemeasureCommand> = {}): Promise<ItemRemeasureCommand> => {
    const shown = await preview(ids);
    return { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" }, item_ids: shown.items.map(({ itemId }) => itemId),
      plan_keys: shown.plans.map(({ key }) => key), setting: null, preview_digest: shown.previewDigest, seen: seen(ids), ...extra };
  };
  it("binds the remeasure preview and confirmation to the selected key and its ceiling", async () => {
    const selection = { profileId: "fixture", authorizationId: "fixture", model: "personal_api_key",
      source: "personal_api_key", hostId: "api-host", reasoningEffort: null } as const;
    const preferences = { model: "gpt-6.1-terra", reasoningEffort: "high" } as const;
    const paymentChoice = { source: "personal_api_key", model: preferences.model, effort: preferences.reasoningEffort,
      expectedConnectionId: "fictional-connection" } as const;
    const apiMandate = { ...preferences, connectionId: paymentChoice.expectedConnectionId, connectionVersion: 1,
      hostId: selection.hostId, maxTokens: 400_000, maxNanoUsd: 25_000_000_000 };
    vi.mocked(resolveTakeoffPayment).mockResolvedValue({ selection, preferences, apiMandate });
    const scope = { kind: "affaire" } as const;
    const shown = await previewItemRemeasure(PROJECT, { scope, itemIds: [fixtureItemId(3)], seen: seen([3]), paymentChoice });
    expect(shown).toMatchObject({ payer: { memberId: MEMBER }, payment: { source: "personal_api_key", maxCostCents: 2500 },
      subscription: { state: "ready", ...preferences } });
    const command = { ...(await confirmation([3])), preview_digest: shown.previewDigest, payment_choice: paymentChoice };
    vi.mocked(resolveTakeoffPayment).mockResolvedValueOnce({ selection: { ...selection, authorizationId: "updated-budget" },
      preferences, apiMandate: { ...apiMandate, maxNanoUsd: 24_000_000_000 } });
    await expect(runItemRemeasure(PROJECT, command)).rejects.toMatchObject({ status: 409 });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
    // Refused on what the preview showed: the key's mandate was resolved, never recorded.
    expect(sealTakeoffPayment).not.toHaveBeenCalled();
    // The admission records it itself, after its own refusals: nothing before it does.
    vi.mocked(launchTakeoffItemRemeasure).mockImplementationOnce(async (_context, input) => {
      expect(sealTakeoffPayment).not.toHaveBeenCalled();
      await input.beforeAdmission?.();
      return { outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" };
    });
    await expect(runItemRemeasure(PROJECT, command)).resolves.toMatchObject({ outcome: "admitted" });
    expect(launchTakeoffItemRemeasure).toHaveBeenCalledWith(access.context, expect.objectContaining({ selection }));
    expect(sealTakeoffPayment).toHaveBeenCalledExactlyOnceWith({ ...access.context, projectId: PROJECT },
      { selection, preferences, apiMandate }, undefined);
  });

  it("requires the same Mac and an available model and effort for the measure on a plan", async () => {
    const scope = { kind: "plan" as const, planKey: "plan-rdc" };
    const detail = { fileId: JOB, generation: "B", contentSha256: "a".repeat(64), page: null };
    const prepared = { ...PLANNED, snapshot: { preparation: { sources: [] } },
      manifest: { ...PLANNED.manifest, plans: [{ plan_file_id: JOB, generation: "B", pages: [2, 7], page_count: 7 }] } };
    vi.mocked(planTakeoffItemRemeasure).mockResolvedValue({ plan: prepared as unknown as TakeoffItemRemeasurePlan });
    vi.mocked(readMeasureCatalogue).mockResolvedValue({ models: [{ id: "other", name: "Autre", reasoningEfforts: ["low"] }] });
    const shown = await previewItemRemeasure(PROJECT, { scope, itemIds: [fixtureItemId(3)], detail, seen: seen([3]) });
    expect(shown.detail?.effect).toBe("first");
    const command: ItemRemeasureCommand = { command_version: 1, intent_key: INTENT, scope, detail, item_ids: [fixtureItemId(3)],
      plan_keys: [scope.planKey], seen: seen([3]), preview_digest: shown.previewDigest, host_proof: shown.detail!.hostProof!,
      setting: { model: "other", reasoning_effort: "high" } };
    expect(await refusal(runItemRemeasure(PROJECT, command))).toMatchObject({ status: 422, message: expect.stringContaining("indisponible") });
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-a",
      reasoningEffort: "medium", hostId: "another-mac", authorizationId: "a" } });
    expect(await refusal(runItemRemeasure(PROJECT, command))).toMatchObject({ status: 409, message: expect.stringContaining("autre Mac") });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  /** A new reading of the item published since: its answer on its plan replaced (another answer id). */
  const readAgain = (item: number) => {
    lines = buildItemLines(rows().map((row) => row.item.id === fixtureItemId(item) ? { ...row,
      readings: [fixtureReading(item, "plan-rdc", fixtureAnswer("measured", 4, { answerId: "99999999-0000-4000-8000-000000000099" }))] }
      : row), { plans: FIXTURE_PLANS, scope: { kind: "affaire" } });
  };

  it("shows the member who confirms as the payer, the setting of their profile, the plans and the items", async () => {
    expect(await preview([3])).toMatchObject({
      payer: { memberId: MEMBER, name: "Léa Martin" },
      subscription: { state: "ready", model: "modele-a", reasoningEffort: "medium" },
      // An item no plan read yet is measured on every plan the list was read on.
      plans: [{ key: "plan-r1", name: "Plan R+1" }, { key: "plan-rdc", name: "Plan RDC" }],
      items: [{ itemId: fixtureItemId(3), label: "Receveur de douche" }],
      running: false, skipped: [],
    });
    expect(readLocalChatGptSubscription).toHaveBeenCalledWith({ userId: MEMBER, tenantId: TENANT }, "localhost:3000");
  });

  it("says in French why the subscription cannot pay, and refuses the confirmation", async () => {
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: "CHATGPT_NOT_CONNECTED", selection: null });
    const shown = await preview([3]);
    expect(shown.subscription).toEqual({ state: "unavailable",
      reason: "Connectez votre forfait ChatGPT dans Mon profil avant de demander une nouvelle mesure." });
    expect(await refusal(runItemRemeasure(PROJECT, await confirmation([3])))).toMatchObject({ status: 422, code: "AI_PROVIDER" });
  });

  it("refuses a confirmation of another preview: another payer, setting, plans or items", async () => {
    const body = await confirmation([3]);
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-b",
      reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
    expect(await refusal(runItemRemeasure(PROJECT, body))).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE" });
  });

  it("shows the paid calls and the budget its admission reserves, as planned on the items asked", async () => {
    expect((await preview([3])).reading).toEqual({ state: "ready", calls: 2, budgetTokens: 66_000,
      summary: "Lecture de 1 poste sur 2 plans : 2 appels de lecture, environ 2 min sur un Mac." });
    expect(planTakeoffItemRemeasure).toHaveBeenCalledWith(access.context, { projectId: PROJECT, planKeys: ["plan-r1", "plan-rdc"],
      itemIds: [fixtureItemId(3)], selection: null });
  });

  it("says why a reading that cannot be bounded is refused, before anything is paid", async () => {
    vi.mocked(planTakeoffItemRemeasure).mockResolvedValue({ refusal: "Ces plans ne peuvent pas être lus seuls avec la préparation confirmée : revoyez les options du métré." });
    expect((await preview([3])).reading).toEqual({ state: "refused",
      reason: "Ces plans ne peuvent pas être lus seuls avec la préparation confirmée : revoyez les options du métré." });
    expect(await refusal(runItemRemeasure(PROJECT, await confirmation([3])))).toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  it("admits the confirmation with the profile's setting as it is, the readings the member saw and what was confirmed", async () => {
    const answer = lines.find(({ itemId }) => itemId === fixtureItemId(2))!.readings[0].answer!.answerId.toLowerCase();
    const sealed = { profileId: "p", model: "modele-a", reasoningEffort: "medium", hostId: "h", authorizationId: "a" };
    // No setting, or the profile's own effort named: the same selection sealed, the confirmation as it was sent.
    for (const setting of [null, { reasoning_effort: "medium" as const }]) {
      vi.clearAllMocks();
      const body = await confirmation([2], { setting });
      expect(body.item_ids).toEqual([fixtureItemId(2)]);
      await expect(runItemRemeasure(PROJECT, body)).resolves.toEqual({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
      expect(planTakeoffItemRemeasure).toHaveBeenLastCalledWith(access.context, { projectId: PROJECT, planKeys: body.plan_keys,
        itemIds: [fixtureItemId(2)], selection: sealed });
      expect(launchTakeoffItemRemeasure).toHaveBeenCalledWith(access.context, { projectId: PROJECT, intentKey: INTENT, plan: PLANNED,
        selection: sealed, targets: [{ item_id: fixtureItemId(2), answers: [answer] }], host: "localhost:3000",
        confirmation: { preview_digest: body.preview_digest, setting } });
    }
  });

  // The Mac reads a request with its payer's profile as it is, and refuses one sealed with another effort: an effort for
  // one request alone is not offered yet, so a confirmation naming one is refused before anything is replayed or planned.
  it("refuses a confirmation at another effort than the profile's, before anything is replayed, planned or launched", async () => {
    for (const reasoningEffort of ["medium", null] as const) {
      vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-a",
        reasoningEffort, hostId: "h", authorizationId: "a" } });
      const body = await confirmation([2], { setting: { reasoning_effort: "high" } });
      vi.clearAllMocks();
      expect(await refusal(runItemRemeasure(PROJECT, body))).toMatchObject({ status: 422, code: "VALIDATION_ERROR",
        message: "Cette demande utilise le réglage de Mon profil : un autre effort pour elle seule n’est pas encore possible. Rouvrez l’aperçu et confirmez avec le réglage de Mon profil." });
      expect(replayTakeoffItemRemeasure).not.toHaveBeenCalled();
      expect(planTakeoffItemRemeasure).not.toHaveBeenCalled();
      expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
    }
  });

  it("answers stale with the items the database found read again, by their labels; nothing is admitted", async () => {
    vi.mocked(launchTakeoffItemRemeasure).mockResolvedValue({ outcome: "stale", stale: [fixtureItemId(2).toUpperCase()] });
    expect(await refusal(runItemRemeasure(PROJECT, await confirmation([2])))).toMatchObject({ status: 409,
      code: "TAKEOFF_ITEM_REVIEW_STALE", details: { stale: [{ itemId: fixtureItemId(2).toUpperCase(), label: "Baignoire" }] } });
  });

  // Case 6: what the member ticked is what is compared, never the readings the server finds when the dialog opens.
  it("answers stale, naming the item, when its reading was replaced between the tick and the preview", async () => {
    const ticked = seen([2]);
    readAgain(2);
    expect(await refusal(preview([2], ticked))).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE",
      details: { stale: [{ itemId: fixtureItemId(2), label: "Baignoire" }] } });
    expect(await refusal(preview([2], seen([2], "44444444-4444-4444-8444-000000000000")))).toMatchObject({ status: 409,
      details: { stale: [{ itemId: fixtureItemId(2), label: "Baignoire" }] } });
  });

  it("names the items, and admits nothing, when a reading was replaced between the preview and the confirmation", async () => {
    const body = await confirmation([2]);
    readAgain(2);
    expect(await refusal(runItemRemeasure(PROJECT, body))).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE",
      details: { stale: [{ itemId: fixtureItemId(2), label: "Baignoire" }] } });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  // Case 4: the plan admitted is the plan the member confirmed.
  it("admits nothing when the plan made for the admission is not the one the member confirmed", async () => {
    const body = await confirmation([2]);
    vi.mocked(planTakeoffItemRemeasure).mockResolvedValueOnce({ plan: PLANNED }).mockResolvedValueOnce({ plan: { ...PLANNED,
      preparationRevision: 4, bounds: { ...PLANNED.bounds, calls: 4 }, manifest: { ...PLANNED.manifest, budget: { tokens: 132_000,
        cost_cents: 0 } } } as TakeoffItemRemeasurePlan });
    expect(await refusal(runItemRemeasure(PROJECT, body))).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE",
      details: { stale: [{ itemId: fixtureItemId(2), label: "Baignoire" }] } });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  // The preview confirmed holds the preparation it was planned on: confirmed again since (another revision, other pages),
  // the same selection needs a new confirmation, even with the same calls and budget.
  it("asks for a new confirmation when the preparation was confirmed again since the preview, with the same calls and budget", async () => {
    const plan = (revision: number, pages: number[]) => ({ ...PLANNED, preparationRevision: revision, manifest: { ...PLANNED.manifest,
      plans: [{ plan_file_id: "aaaaaaaa-0000-4000-8000-000000000050", logical_id: "plan-rdc", content_sha256: "e".repeat(64), pages,
        page_count: 9 }] } }) as unknown as TakeoffItemRemeasurePlan;
    vi.mocked(planTakeoffItemRemeasure).mockResolvedValue({ plan: plan(3, [2, 7]) });
    const body = await confirmation([2]);
    vi.mocked(planTakeoffItemRemeasure).mockResolvedValue({ plan: plan(4, [2]) });
    expect(await refusal(runItemRemeasure(PROJECT, body))).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE" });
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  // Case 3: a receipt answers only the confirmation it was written for, by the identity the database digests.
  it("replays a lost answer by what the member confirmed alone, before planning anything", async () => {
    const body = await confirmation([2], { setting: { reasoning_effort: "medium" } });
    vi.clearAllMocks();
    vi.mocked(replayTakeoffItemRemeasure).mockResolvedValue({ outcome: "replayed", requestId: "55555555-5555-4555-8555-555555555555" });
    await expect(runItemRemeasure(PROJECT, body)).resolves.toEqual({ outcome: "replayed", requestId: "55555555-5555-4555-8555-555555555555" });
    const answer = lines.find(({ itemId }) => itemId === fixtureItemId(2))!.readings[0].answer!.answerId.toLowerCase();
    expect(replayTakeoffItemRemeasure).toHaveBeenCalledWith(access.context, { projectId: PROJECT, intentKey: INTENT,
      planKeys: body.plan_keys, listRevisionId: LIST, targets: [{ item_id: fixtureItemId(2), answers: [answer] }],
      selection: { profileId: "p", model: "modele-a", reasoningEffort: "medium", hostId: "h", authorizationId: "a" },
      confirmation: { preview_digest: body.preview_digest, setting: { reasoning_effort: "medium" } } });
    expect(planTakeoffItemRemeasure).not.toHaveBeenCalled();
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  it("leaves another confirmation under the key to the database: a strict superset, another preview, a removed effort", async () => {
    const body = await confirmation([2], { setting: { reasoning_effort: "medium" } });
    const conflict = Object.assign(new Error("conflict"), { status: 409, code: "CONFLICT" });
    vi.mocked(replayTakeoffItemRemeasure).mockRejectedValue(conflict);
    for (const other of [{ ...body, item_ids: [fixtureItemId(1), fixtureItemId(2)], seen: seen([1, 2]) },
      { ...body, preview_digest: "f".repeat(64) }, { ...body, setting: null }]) {
      expect(await refusal(runItemRemeasure(PROJECT, other))).toBe(conflict);
    }
    const sent = vi.mocked(replayTakeoffItemRemeasure).mock.calls.map(([, input]) => input);
    expect(sent.map(({ targets }) => targets.map(({ item_id: id }) => id))).toEqual([[fixtureItemId(1), fixtureItemId(2)],
      [fixtureItemId(2)], [fixtureItemId(2)]]);
    expect(sent.map(({ confirmation: confirmed }) => confirmed)).toEqual([
      { preview_digest: body.preview_digest, setting: { reasoning_effort: "medium" } },
      { preview_digest: "f".repeat(64), setting: { reasoning_effort: "medium" } },
      { preview_digest: body.preview_digest, setting: null }]);
    expect(sent.map(({ selection }) => selection.reasoningEffort)).toEqual(["medium", "medium", "medium"]);
    expect(launchTakeoffItemRemeasure).not.toHaveBeenCalled();
  });

  it("answers a receipt to nobody who lost the right to launch on the affaire", async () => {
    vi.mocked(itemReviewerRight).mockResolvedValue(false);
    vi.mocked(replayTakeoffItemRemeasure).mockResolvedValue({ outcome: "replayed", requestId: "55555555-5555-4555-8555-555555555555" });
    expect(await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(2)], plan_keys: ["plan-rdc"], setting: null, preview_digest: "b".repeat(64), seen: seen([2]) })))
      .toMatchObject({ status: 403, code: "TAKEOFF_ITEM_REVIEW_FORBIDDEN" });
    expect(replayTakeoffItemRemeasure).not.toHaveBeenCalled();
  });
});
