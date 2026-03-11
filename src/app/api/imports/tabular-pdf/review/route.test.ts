import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  badRequest: vi.fn(),
  ok: vi.fn(),
  reviewTabularPdfImport: vi.fn(),
  toErrorResponse: vi.fn(),
}));

vi.mock("@/lib/imports/server", () => serverMocks);

import { POST } from "@/app/api/imports/tabular-pdf/review/route";

describe("POST /api/imports/tabular-pdf/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMocks.ok.mockImplementation((data: unknown) =>
      Response.json({
        ok: true,
        data,
      })
    );
    serverMocks.badRequest.mockImplementation((message: string) => {
      throw new Error(message);
    });
    serverMocks.toErrorResponse.mockImplementation((error: unknown) =>
      Response.json(
        {
          ok: false,
          error: {
            message: error instanceof Error ? error.message : "Erreur",
          },
        },
        { status: 400 }
      )
    );
  });

  it("returns the tabular pdf review payload", async () => {
    serverMocks.reviewTabularPdfImport.mockReturnValue({
      review_state: "light_validation",
      tables: [],
    });

    const response = await POST(
      new Request("http://localhost/api/imports/tabular-pdf/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tables: [],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(serverMocks.reviewTabularPdfImport).toHaveBeenCalledWith({
      tables: [],
    });
  });

  it("returns a 400 on invalid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/imports/tabular-pdf/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{bad json",
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: {
        message: "Payload JSON invalide.",
      },
    });
  });
});
