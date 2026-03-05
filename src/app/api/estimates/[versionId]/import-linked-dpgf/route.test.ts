import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  importLinkedDpgfSourceIntoVersion: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/import-linked-dpgf/route";
import { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";
const LINE_ID = "44444444-4444-4444-8444-444444444444";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/import-linked-dpgf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports linked DPGF source into target version", async () => {
    vi.mocked(importLinkedDpgfSourceIntoVersion).mockResolvedValue({
      source_import_id: IMPORT_ID,
      target_version_id: VERSION_ID,
      created_section_id: SECTION_ID,
      created_line_ids: [LINE_ID],
      imported_lines_count: 1,
      skipped_lines_count: 0,
      totals: {
        total_ht_cents: 10000,
        total_tax_cents: 2000,
        total_ttc_cents: 12000,
      },
      version: {
        id: VERSION_ID,
        updated_at: "2026-03-05T10:00:00.000Z",
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/import-linked-dpgf`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sectionTitle: "Import manuel DPGF",
        }),
      }
    );

    const response = await POST(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        source_import_id: string;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.source_import_id).toBe(IMPORT_ID);
    expect(vi.mocked(importLinkedDpgfSourceIntoVersion)).toHaveBeenCalledWith(
      VERSION_ID,
      {
        section_title: "Import manuel DPGF",
      }
    );
  });

  it("accepts an empty payload body", async () => {
    vi.mocked(importLinkedDpgfSourceIntoVersion).mockResolvedValue({
      source_import_id: IMPORT_ID,
      target_version_id: VERSION_ID,
      created_section_id: SECTION_ID,
      created_line_ids: [],
      imported_lines_count: 0,
      skipped_lines_count: 0,
      totals: {
        total_ht_cents: 0,
        total_tax_cents: 0,
        total_ttc_cents: 0,
      },
      version: {
        id: VERSION_ID,
        updated_at: "2026-03-05T10:00:00.000Z",
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/import-linked-dpgf`,
      {
        method: "POST",
      }
    );

    const response = await POST(request, makeParams());

    expect(response.status).toBe(201);
    expect(vi.mocked(importLinkedDpgfSourceIntoVersion)).toHaveBeenCalledWith(
      VERSION_ID,
      {}
    );
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const request = new Request(
      "http://localhost/api/estimates/not-a-uuid/import-linked-dpgf",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
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
    expect(vi.mocked(importLinkedDpgfSourceIntoVersion)).not.toHaveBeenCalled();
  });
});
