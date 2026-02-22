import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  listEstimateVersionEvents: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/events/route";
import { listEstimateVersionEvents } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("GET /api/estimates/[versionId]/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const request = new Request("http://localhost/api/estimates/not-a-uuid/events", {
      method: "GET",
    });

    const response = await GET(request, makeParams("not-a-uuid"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(listEstimateVersionEvents)).not.toHaveBeenCalled();
  });

  it("loads events for the requested estimate version", async () => {
    vi.mocked(listEstimateVersionEvents).mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        estimate_version_id: VERSION_ID,
        event_type: "sent",
        metadata: {},
        created_by: "33333333-3333-4333-8333-333333333333",
        actor_name: "Alice Admin",
        occurred_at: "2026-02-22T10:00:00.000Z",
        created_at: "2026-02-22T10:00:00.000Z",
      },
    ] as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/events`, {
      method: "GET",
    });

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: Array<{
        id: string;
        estimate_version_id: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.estimate_version_id).toBe(VERSION_ID);
    expect(vi.mocked(listEstimateVersionEvents)).toHaveBeenCalledWith(VERSION_ID);
  });
});
