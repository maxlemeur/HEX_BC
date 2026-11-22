import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ readLocalChatGptSubscription: vi.fn() }));
vi.mock("./launch-request-server", () => ({ readAffaireTakeoffLaunchState: vi.fn() }));
vi.mock("./item-table-server", () => ({ loadItemLines: vi.fn(), itemReviewerRight: vi.fn() }));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({ recomputeTakeoffRulesQuietly: vi.fn(async () => ({ lines: 1, skipped: 0 })) }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readLocalChatGptSubscription } from "@/lib/ai/chatgpt-takeoff";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { buildItemLines, type ItemReviewTarget, type ItemTableRow } from "./item-table";
import type { ItemReviewCommand } from "./item-table-contracts";
import { FIXTURE_PLANS, fixtureAnswer, fixtureItemId, fixturePoste, fixtureReading } from "./item-table.test-fixtures";
import { itemReviewerRight, loadItemLines } from "./item-table-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";
import { previewItemRemeasure, runItemRemeasure, runItemReviewCommand } from "./item-review-commands-server";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const TENANT = "77777777-7777-4777-8777-777777777777";
const INTENT = "66666666-6666-4666-8666-666666666666";
const JOB = "33333333-3333-4333-8333-333333333333";
const VERSION = "88888888-8888-4888-8888-888888888888";

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
  vi.mocked(loadItemLines).mockImplementation(async () => ({ lines, plans: FIXTURE_PLANS }) as never);
  review.mockResolvedValue({ data: { outcome: "applied", applied: [], skipped: [], replayed: false }, error: null });
  vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-a",
    reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
  vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ request: null } as never);
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
  it("shows the member who confirms as the payer, the setting of their profile, the plans and the items", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    expect(preview).toMatchObject({
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
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    expect(preview.subscription).toEqual({ state: "unavailable",
      reason: "Connectez votre forfait ChatGPT dans Mon profil avant de demander une nouvelle mesure." });
    expect(await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: preview.plans.map(({ key }) => key), setting: null, preview_digest: preview.previewDigest })))
      .toMatchObject({ status: 422, code: "AI_PROVIDER" });
  });

  it("refuses a confirmation of another preview: another payer, setting, plans or items", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-b",
      reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
    expect(await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: preview.plans.map(({ key }) => key), setting: null, preview_digest: preview.previewDigest })))
      .toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE" });
  });

  it("admits nothing while the manual request cannot take a selection of items (its own pull request)", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    expect(await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: preview.plans.map(({ key }) => key), setting: { reasoning_effort: "high" },
      preview_digest: preview.previewDigest }))).toMatchObject({ status: 503, code: "TAKEOFF_ITEM_REVIEW_UNAVAILABLE" });
  });
});
