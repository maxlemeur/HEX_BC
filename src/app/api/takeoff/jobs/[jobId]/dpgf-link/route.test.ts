import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  saveTakeoffDpgfManualLink: vi.fn(),
}));

import { PATCH } from "@/app/api/takeoff/jobs/[jobId]/dpgf-link/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { saveTakeoffDpgfManualLink } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const TAKEOFF_ITEM_ID = "44444444-4444-4444-8444-444444444444";

function buildPutRequest(body: unknown) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/dpgf-link`, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: Promise.resolve({ jobId: JOB_ID }),
    },
  ] as const;
}

describe("PATCH /api/takeoff/jobs/[jobId]/dpgf-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the payload to the server service", async () => {
    const payload = {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      takeoff_item_id: TAKEOFF_ITEM_ID,
    };

    vi.mocked(saveTakeoffDpgfManualLink).mockResolvedValue({
      deleted: false,
      link: {
        id: "55555555-5555-4555-8555-555555555555",
        tenant_id: "66666666-6666-4666-8666-666666666666",
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        takeoff_item_id: TAKEOFF_ITEM_ID,
        created_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        linked_by: null,
      },
    });

    const [request, context] = buildPutRequest(payload);
    const response = await PATCH(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(saveTakeoffDpgfManualLink).toHaveBeenCalledWith(JOB_ID, payload);
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(saveTakeoffDpgfManualLink).mockRejectedValue(
      new TakeoffError({
        status: 404,
        code: TakeoffErrorCode.NOT_FOUND,
        message: "Ligne DPGF introuvable.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const [request, context] = buildPutRequest({
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      takeoff_item_id: null,
    });

    const response = await PATCH(request, context);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(body.error?.message).toBe("Ligne DPGF introuvable.");
  });
});
