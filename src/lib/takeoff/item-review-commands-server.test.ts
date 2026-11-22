import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ readLocalChatGptSubscription: vi.fn() }));
vi.mock("./launch-request-server", () => ({ readAffaireTakeoffLaunchState: vi.fn() }));
vi.mock("./item-table-server", () => ({ loadItemTable: vi.fn(), itemReviewerRight: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readLocalChatGptSubscription } from "@/lib/ai/chatgpt-takeoff";
import { buildItemTable, type ItemReviewTarget } from "./item-table";
import type { ItemReviewCommand } from "./item-table-contracts";
import { FIXTURE_PLANS, fixtureAnswer, fixtureItemId, fixturePoste, fixtureReading } from "./item-table.test-fixtures";
import { itemReviewerRight, loadItemTable } from "./item-table-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";
import { previewItemRemeasure, runItemRemeasure, runItemReviewCommand } from "./item-review-commands-server";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const INTENT = "66666666-6666-4666-8666-666666666666";

const ITEMS = [fixturePoste(1, "WC"), fixturePoste(2, "Baignoire"), fixturePoste(3, "Receveur de douche")];
const READINGS = [
  fixtureReading(1, "plan-rdc", fixtureAnswer("measured", 2)),
  fixtureReading(2, "plan-rdc", fixtureAnswer("not_found", null)),
];
const view = (readings = READINGS) => buildItemTable({ items: ITEMS, plans: FIXTURE_PLANS, readings, entries: [], scope: { kind: "affaire" } });
const targetsOf = (ids: number[], table = view()) =>
  table.lines.filter(({ itemId }) => ids.map(fixtureItemId).includes(itemId)).map(({ targets }) => targets);
const access = { context: { userId: MEMBER, tenantId: "77777777-7777-4777-8777-777777777777", supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Léa Martin" }, error: null }) }) }) }),
} }, project: { id: PROJECT } };

function command(gesture: ItemReviewCommand["gesture"], targets: ItemReviewTarget[], extra: Record<string, unknown> = {}) {
  return { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" }, gesture, targets, ...extra } as ItemReviewCommand;
}

async function refusal(promise: Promise<unknown>) {
  return promise.then(() => { throw new Error("expected a refusal"); }, (error: { status: number; code: string; details?: unknown; message: string }) => error);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAffaireAccess).mockResolvedValue(access as never);
  vi.mocked(itemReviewerRight).mockResolvedValue(true);
  vi.mocked(loadItemTable).mockImplementation(async () => ({ access, list: null, facts: { plans: FIXTURE_PLANS, readings: READINGS, entries: [] },
    view: view() }) as never);
  vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-a",
    reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
  vi.mocked(readAffaireTakeoffLaunchState).mockResolvedValue({ request: null } as never);
});

describe("runItemReviewCommand", () => {
  it("refuses a member who is not a takeoff operator of the affaire before reading the table", async () => {
    vi.mocked(itemReviewerRight).mockResolvedValue(false);
    const error = await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1]))));
    expect(error).toMatchObject({ status: 403, code: "TAKEOFF_ITEM_REVIEW_FORBIDDEN" });
    expect(loadItemTable).not.toHaveBeenCalled();
  });

  it("refuses a malformed command before any read: an item twice, « Autre » without its note, a value missing", async () => {
    const [wc] = targetsOf([1]);
    expect(await refusal(runItemReviewCommand(PROJECT, command("accept_measured", [wc, wc])))).toMatchObject({ status: 422 });
    expect(await refusal(runItemReviewCommand(PROJECT, command("set_aside", [wc], { reason: "other", note: " a " }))))
      .toMatchObject({ status: 422, message: expect.stringContaining("« Autre »") });
    const both = targetsOf([1, 2]);
    expect(await refusal(runItemReviewCommand(PROJECT, command("enter_quantity", both, {
      values: [{ item_id: fixtureItemId(2), quantity: 1, unit: "u" }], entry: { category: "site_survey" } }))))
      .toMatchObject({ status: 422, message: "Chaque poste de la sélection reçoit sa propre valeur, saisie à part." });
    expect(await refusal(runItemReviewCommand(PROJECT, command("enter_quantity", targetsOf([2]), {
      values: [{ item_id: fixtureItemId(2), quantity: 1, unit: "u" }], entry: { category: "hypothesis", note: "court" } }))))
      .toMatchObject({ status: 422 });
    expect(requireAffaireAccess).not.toHaveBeenCalled();
  });

  it("applies nothing on a stale selection and names its lines", async () => {
    const seen = targetsOf([1, 2]);
    const moved = view([fixtureReading(1, "plan-rdc", { ...READINGS[0].answer!, revision: "2" }), READINGS[1]]);
    vi.mocked(loadItemTable).mockResolvedValue({ access, list: null, facts: { plans: [], readings: [], entries: [] }, view: moved } as never);
    const error = await refusal(runItemReviewCommand(PROJECT, command("accept_measured", seen)));
    expect(error).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE",
      details: { stale: [{ itemId: fixtureItemId(1), label: "WC" }] } });
  });

  it("writes nothing when no line of the selection is eligible, and says why for each", async () => {
    await expect(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([2, 3])))).resolves.toEqual({
      outcome: "applied", applied: [],
      skipped: [{ itemId: fixtureItemId(2), label: "Baignoire", reason: "not_measured" },
        { itemId: fixtureItemId(3), label: "Receveur de douche", reason: "not_measured" }] });
  });

  it("refuses to write the decisions while they cannot be stored: nothing is written", async () => {
    const error = await refusal(runItemReviewCommand(PROJECT, command("accept_measured", targetsOf([1]))));
    expect(error).toMatchObject({ status: 503, code: "TAKEOFF_ITEM_REVIEW_UNAVAILABLE" });
  });
});

describe("remeasure of a selection", () => {
  it("shows the member who confirms as the payer, the setting of their profile, the plans and the items", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    expect(preview).toMatchObject({
      payer: { memberId: MEMBER, name: "Léa Martin" },
      subscription: { state: "ready", model: "modele-a", reasoningEffort: "medium" },
      // An item no plan read yet is measured on every plan of the affaire.
      plans: [{ key: "plan-rdc", name: "Plan RDC" }, { key: "plan-r1", name: "Plan R+1" }],
      items: [{ itemId: fixtureItemId(3), label: "Receveur de douche" }],
      running: false, skipped: [],
    });
    expect(readLocalChatGptSubscription).toHaveBeenCalledWith({ userId: MEMBER, tenantId: access.context.tenantId }, "localhost:3000");
  });

  it("says in French why the subscription cannot pay, and refuses the confirmation", async () => {
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: "CHATGPT_NOT_CONNECTED", selection: null });
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    expect(preview.subscription).toEqual({ state: "unavailable",
      reason: "Connectez votre forfait ChatGPT dans Mon profil avant de demander une nouvelle mesure." });
    const error = await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: ["plan-rdc", "plan-r1"], setting: null, preview_digest: preview.previewDigest }));
    expect(error).toMatchObject({ status: 422, code: "AI_PROVIDER" });
  });

  it("refuses a confirmation of another preview: another payer, setting, plans or items", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    vi.mocked(readLocalChatGptSubscription).mockResolvedValue({ issue: null, selection: { profileId: "p", model: "modele-b",
      reasoningEffort: "medium", hostId: "h", authorizationId: "a" } });
    const error = await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: ["plan-rdc", "plan-r1"], setting: null, preview_digest: preview.previewDigest }));
    expect(error).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_REVIEW_STALE" });
  });

  it("admits nothing while the manual request cannot take a selection of items", async () => {
    const preview = await previewItemRemeasure(PROJECT, { scope: { kind: "affaire" }, itemIds: [fixtureItemId(3)] });
    const error = await refusal(runItemRemeasure(PROJECT, { command_version: 1, intent_key: INTENT, scope: { kind: "affaire" },
      item_ids: [fixtureItemId(3)], plan_keys: ["plan-rdc", "plan-r1"], setting: { reasoning_effort: "high" },
      preview_digest: preview.previewDigest }));
    expect(error).toMatchObject({ status: 503, code: "TAKEOFF_ITEM_REVIEW_UNAVAILABLE" });
  });
});
