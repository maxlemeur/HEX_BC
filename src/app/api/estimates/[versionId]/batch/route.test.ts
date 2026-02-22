import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/batch", () => ({
  executeEstimateBatch: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/batch/route";
import { conflict } from "@/lib/estimates/errors";
import { executeEstimateBatch } from "@/lib/estimates/batch";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prioritizes If-Match and query dry_run over payload values", async () => {
    vi.mocked(executeEstimateBatch).mockResolvedValue({
      committed: false,
      results: [
        {
          index: 0,
          op: "create",
          status: "ok",
          data: {
            dry_run: true,
          },
        },
      ],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/batch?dry_run=true`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": ` ${UPDATED_AT} `,
        },
        body: JSON.stringify({
          concurrency_token: "2025-01-01T00:00:00.000Z",
          dry_run: false,
          operations: [
            {
              op: "create",
              data: {
                item_type: "section",
                title: "Nouveau chapitre",
              },
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const payload = (await response.json()) as {
      ok: true;
      data: {
        committed: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.committed).toBe(false);
    expect(vi.mocked(executeEstimateBatch)).toHaveBeenCalledWith(
      VERSION_ID,
      [
        {
          op: "create",
          data: {
            item_type: "section",
            title: "Nouveau chapitre",
          },
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
        dryRun: true,
      }
    );
  });

  it("falls back to body concurrency_token when If-Match is missing", async () => {
    vi.mocked(executeEstimateBatch).mockResolvedValue({
      committed: true,
      results: [],
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/batch?dry_run=false`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          concurrency_token: ` ${UPDATED_AT} `,
          operations: [
            {
              op: "delete",
              id: ITEM_ID,
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());

    expect(response.status).toBe(200);
    expect(vi.mocked(executeEstimateBatch)).toHaveBeenCalledWith(
      VERSION_ID,
      [
        {
          op: "delete",
          id: ITEM_ID,
        },
      ],
      {
        concurrencyToken: UPDATED_AT,
        dryRun: false,
      }
    );
  });

  it("returns 400 VALIDATION_ERROR when batch is empty", async () => {
    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operations: [],
      }),
    });

    const response = await POST(request, makeParams());
    const payload = (await response.json()) as {
      ok: false;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(executeEstimateBatch)).not.toHaveBeenCalled();
  });

  it("returns 409 CONFLICT when token precheck fails", async () => {
    vi.mocked(executeEstimateBatch).mockRejectedValue(
      conflict("Version modifiee par un autre utilisateur.", {
        updated_at: "2026-02-21T10:00:01.000Z",
      })
    );

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": UPDATED_AT,
      },
      body: JSON.stringify({
        operations: [
          {
            op: "delete",
            id: ITEM_ID,
          },
        ],
      }),
    });

    const response = await POST(request, makeParams());
    const payload = (await response.json()) as {
      ok: false;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("CONFLICT");
  });

  it("rejects invalid dry_run query values", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/batch?dry_run=maybe`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": UPDATED_AT,
        },
        body: JSON.stringify({
          operations: [
            {
              op: "delete",
              id: ITEM_ID,
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const payload = (await response.json()) as {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(payload.error.message).toBe("dry_run invalide.");
    expect(vi.mocked(executeEstimateBatch)).not.toHaveBeenCalled();
  });
});
