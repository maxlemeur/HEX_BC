import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/takeoff/launch-request-units-server", () => ({ readTakeoffLaunchRequestUnits: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { readItemMeasureReadings } from "@/lib/takeoff/item-measure-readings-server";
import { readTakeoffLaunchRequestUnits } from "@/lib/takeoff/launch-request-units-server";
import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";

const TENANT = "cccccccc-0000-4000-8000-000000000010";
const PROJECT = "cccccccc-0000-4000-8000-000000000020";
const MEMBER = "cccccccc-0000-4000-8000-000000000001";
const REQUEST = "cccccccc-0000-4000-8000-000000000030";
const JOB = "cccccccc-0000-4000-8000-000000000040";
const ITEM = "cccccccc-0000-4000-8000-000000000050";
const PLAN = "plan:cccccccc-0000-4000-8000-000000000060";

function read(source: "personal_api_key" | "chatgpt_plan", reasonCode: string) {
  const session = createSupabaseFake({ tables: { takeoff_jobs: () => ({ data: { id: JOB, launch_request_id: REQUEST,
    preparation_snapshot: { remeasure_item: ITEM, remeasure_plan: PLAN, execution_selection: { source } } }, error: null }) } });
  vi.mocked(requireAffaireAccess).mockResolvedValue({ context: { supabase: session.client, userId: MEMBER, tenantId: TENANT },
    project: { id: PROJECT } } as never);
  vi.mocked(readTakeoffLaunchRequestUnits).mockResolvedValue({ requestId: REQUEST, format: "per_plan",
    units: [{ key: PLAN, ordinal: 1, planFileId: null, logicalId: null, name: "Plan A.pdf", pages: [], jobId: JOB, state: "failed",
      reasonCode, retryAt: null, updatedAt: "2026-11-27T09:00:00.000Z", reviewable: false }],
    coverage: { expected: 1, queued: 0, running: 0, succeeded: 0, failed: 1, canceled: 0, not_started: 0 },
    usage: { tokensObserved: 0, costCentsObserved: 0, unknownCalls: 0 } });
  return readItemMeasureReadings(PROJECT, ITEM, PLAN);
}

// Follow-up of #684's review: the measure of an item on a plan reads its plan's code alone, and its own snapshot says
// whether the member's key paid it. A stop at a limit of that key names none: the activity's plan says which.
describe("readItemMeasureReadings: the reason of a stopped measure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names no limit of a request a key paid", async () => {
    expect((await read("personal_api_key", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED"))?.reason)
      .toBe("Une limite de cette demande payée avec la clé API OpenAI est atteinte : le motif est indiqué sur ce plan dans le suivi du métré.");
  });

  it("keeps the budget's fact on a plan's subscription, and any other code's fact with the key", async () => {
    expect((await read("chatgpt_plan", "TAKEOFF_REQUEST_BUDGET_EXHAUSTED"))?.reason)
      .toBe("Le budget de cette analyse était épuisé : ce plan n’a pas été lu en entier.");
    expect((await read("personal_api_key", "AI_TIMEOUT"))?.reason).toBe("Délai dépassé.");
  });
});
