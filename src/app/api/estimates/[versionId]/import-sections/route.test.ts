import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  importSectionsFromVersion: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/import-sections/route";
import { importSectionsFromVersion } from "@/lib/estimates/server";

const TARGET_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID_1 = "33333333-3333-4333-8333-333333333333";
const SECTION_ID_2 = "44444444-4444-4444-8444-444444444444";

function makeParams(versionId = TARGET_VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/import-sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports sections from another estimate and returns a summary", async () => {
    vi.mocked(importSectionsFromVersion).mockResolvedValue({
      source_version_id: SOURCE_VERSION_ID,
      target_version_id: TARGET_VERSION_ID,
      mode: "append",
      imported_sections_count: 2,
      imported_lines_count: 6,
      created_section_ids: [SECTION_ID_1],
      created_line_ids: [SECTION_ID_2],
      totals: {
        total_ht_cents: 45000,
        total_tax_cents: 9000,
        total_ttc_cents: 54000,
      },
      version: {
        id: TARGET_VERSION_ID,
        updated_at: "2026-02-23T09:00:00.000Z",
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${TARGET_VERSION_ID}/import-sections`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceVersionId: SOURCE_VERSION_ID,
          sectionIds: [SECTION_ID_1, SECTION_ID_2],
          mode: "append",
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        imported_sections_count: number;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.imported_sections_count).toBe(2);
    expect(vi.mocked(importSectionsFromVersion)).toHaveBeenCalledWith(
      TARGET_VERSION_ID,
      {
        source_version_id: SOURCE_VERSION_ID,
        section_ids: [SECTION_ID_1, SECTION_ID_2],
        mode: "append",
      }
    );
  });

  it("returns 400 VALIDATION_ERROR when payload is invalid", async () => {
    const request = new Request(
      `http://localhost/api/estimates/${TARGET_VERSION_ID}/import-sections`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceVersionId: SOURCE_VERSION_ID,
          sectionIds: [SECTION_ID_1, "not-a-uuid"],
          mode: "invalid",
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(importSectionsFromVersion)).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const request = new Request(
      "http://localhost/api/estimates/not-a-uuid/import-sections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceVersionId: SOURCE_VERSION_ID,
          sectionIds: [SECTION_ID_1],
          mode: "merge",
        }),
      }
    );

    const response = await POST(request, makeParams("not-a-uuid"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(importSectionsFromVersion)).not.toHaveBeenCalled();
  });
});
