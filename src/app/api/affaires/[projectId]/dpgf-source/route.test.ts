import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAffaireLinkedDpgfSource: vi.fn(),
}));

import { GET } from "@/app/api/affaires/[projectId]/dpgf-source/route";
import { getAffaireLinkedDpgfSource } from "@/lib/estimates/server";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";

function makeParams(projectId = PROJECT_ID) {
  return { params: Promise.resolve({ projectId }) };
}

describe("GET /api/affaires/[projectId]/dpgf-source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns linked DPGF source details for an affaire", async () => {
    vi.mocked(getAffaireLinkedDpgfSource).mockResolvedValue({
      import_id: IMPORT_ID,
      filename: "dpgf-source.xlsx",
      source_format: "xlsx",
      import_status: "completed",
      mapping_status: "mapped",
      imported_at: "2026-03-05T10:00:00.000Z",
      mapping_updated_at: "2026-03-05T10:05:00.000Z",
      parse_mode: "strict",
      row_count: 12,
      mapped_row_count: 11,
    } as never);

    const request = new Request(
      `http://localhost/api/affaires/${PROJECT_ID}/dpgf-source`
    );

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        import_id: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.import_id).toBe(IMPORT_ID);
    expect(vi.mocked(getAffaireLinkedDpgfSource)).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("returns 404 NOT_FOUND when projectId path param is invalid", async () => {
    const request = new Request(
      "http://localhost/api/affaires/not-a-uuid/dpgf-source"
    );

    const response = await GET(request, makeParams("not-a-uuid"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(vi.mocked(getAffaireLinkedDpgfSource)).not.toHaveBeenCalled();
  });
});
