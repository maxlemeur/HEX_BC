import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  importLinkedDpgfSourceIntoVersion: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/import-linked-dpgf/route";
import { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("POST /api/estimates/[versionId]/import-linked-dpgf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 after an incoherent result without treating the completed call as invalid input", async () => {
    vi.mocked(importLinkedDpgfSourceIntoVersion).mockResolvedValue({
      source_import_id: IMPORT_ID, target_version_id: VERSION_ID, created_section_id: SECTION_ID,
      created_line_ids: [], imported_lines_count: 1, skipped_lines_count: 0,
      totals: { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 },
      version: { id: VERSION_ID, updated_at: "2026-10-28T10:00:00.123456Z" },
    });
    const response = await POST(new Request(`http://localhost/api/estimates/${VERSION_ID}/import-linked-dpgf`, {
      method: "POST",
    }), makeParams());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(vi.mocked(importLinkedDpgfSourceIntoVersion)).toHaveBeenCalledTimes(1);
  });
});
