import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  bulkUpdateEstimateItems: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/items/bulk/route";
import { conflict } from "@/lib/estimates/errors";
import { bulkUpdateEstimateItems } from "@/lib/estimates/server";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";
const NEXT_UPDATED_AT = "2026-02-21T10:00:01.000Z";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/items/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses If-Match when provided and accepts bare array payloads", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 1,
      version: {
        id: VERSION_ID,
        updated_at: NEXT_UPDATED_AT,
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/bulk`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": `  ${UPDATED_AT}  `,
        },
        body: JSON.stringify([
          {
            id: ITEM_ID,
            title: "Ligne test",
          },
        ]),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [
        {
          id: ITEM_ID,
          title: "Ligne test",
        },
      ],
      UPDATED_AT,
      undefined
    );
  });

  it("falls back to updated_at in the payload when If-Match is missing", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 1,
      version: {
        id: VERSION_ID,
        updated_at: NEXT_UPDATED_AT,
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/bulk`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updated_at: ` ${UPDATED_AT} `,
          updates: [
            {
              id: ITEM_ID,
              title: "Ligne test",
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());

    expect(response.status).toBe(200);
    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [
        {
          id: ITEM_ID,
          title: "Ligne test",
        },
      ],
      UPDATED_AT,
      undefined
    );
  });

  it("forwards version_patch even when updates is empty", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: NEXT_UPDATED_AT,
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/bulk`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": UPDATED_AT,
        },
        body: JSON.stringify({
          updates: [],
          version_patch: {
            total_ht_cents: 12000,
            total_tax_cents: 2400,
            total_ttc_cents: 14400,
          },
        }),
      }
    );

    const response = await POST(request, makeParams());

    expect(response.status).toBe(200);
    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [],
      UPDATED_AT,
      {
        total_ht_cents: 12000,
        total_tax_cents: 2400,
        total_ttc_cents: 14400,
      }
    );
  });

  it("returns 400 VALIDATION_ERROR when updates contain duplicate ids", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/bulk`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updates: [
            {
              id: ITEM_ID,
              title: "A",
            },
            {
              id: ITEM_ID,
              title: "B",
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: false;
      error: {
        code: string;
        details?: {
          issues?: Array<{ path: string; message: string }>;
        };
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.issues?.some((issue) => issue.path === "updates.1.id")).toBe(
      true
    );
    expect(vi.mocked(bulkUpdateEstimateItems)).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const request = new Request(
      "http://localhost/api/estimates/not-a-uuid/items/bulk",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          updates: [
            {
              id: ITEM_ID,
              title: "Ligne test",
            },
          ],
        }),
      }
    );

    const response = await POST(request, makeParams("not-a-uuid"));
    const body = (await response.json()) as {
      ok: false;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(bulkUpdateEstimateItems)).not.toHaveBeenCalled();
  });

  it("maps stale errors from server to 409 CONFLICT", async () => {
    vi.mocked(bulkUpdateEstimateItems).mockRejectedValue(
      conflict("La liste de mise a jour est obsolete.", {
        expected_count: 2,
        updated_count: 1,
      })
    );

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/items/bulk`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": UPDATED_AT,
        },
        body: JSON.stringify([
          {
            id: ITEM_ID,
            title: "Ligne test",
          },
        ]),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: {
          expected_count?: number;
          updated_count?: number;
        };
      };
    };

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toContain("obsolete");
    expect(body.error.details).toEqual({
      expected_count: 2,
      updated_count: 1,
    });
  });
});
