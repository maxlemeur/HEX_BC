import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  badRequest: vi.fn(),
  createImportFromJsonBody: vi.fn(),
  createImportFromMultipartFormData: vi.fn(),
  listUserImports: vi.fn(),
  ok: vi.fn(),
  toErrorResponse: vi.fn(),
  unsupportedMediaType: vi.fn(),
}));

vi.mock("@/lib/imports/server", () => serverMocks);

import { GET } from "@/app/api/imports/route";

describe("GET /api/imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMocks.ok.mockImplementation((data: unknown) =>
      Response.json({
        ok: true,
        data,
      })
    );
    serverMocks.toErrorResponse.mockImplementation(() =>
      Response.json(
        {
          ok: false,
          error: { message: "Erreur" },
        },
        { status: 500 }
      )
    );
  });

  it("forwards project_id query param to listUserImports", async () => {
    serverMocks.listUserImports.mockResolvedValue([{ id: "import-1" }]);

    const request = new Request(
      "http://localhost/api/imports?project_id=33333333-3333-4333-8333-333333333333"
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(serverMocks.listUserImports).toHaveBeenCalledWith({
      projectId: "33333333-3333-4333-8333-333333333333",
    });
  });
});

