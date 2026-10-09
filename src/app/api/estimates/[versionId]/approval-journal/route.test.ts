import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/rules-engine", () => ({
  buildEstimateApprovalDecisionJournalCsv: vi.fn(),
  listEstimateApprovalDecisionJournal: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/approval-journal/route";
import { listEstimateApprovalDecisionJournal } from "@/lib/estimates/rules-engine";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function makeParams(versionId = VERSION_ID) {
  return { params: Promise.resolve({ versionId }) };
}

describe("GET /api/estimates/[versionId]/approval-journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 VALIDATION_ERROR when versionId is invalid", async () => {
    const request = new Request(
      "http://localhost/api/estimates/not-a-uuid/approval-journal",
      {
        method: "GET",
      }
    );

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
    expect(vi.mocked(listEstimateApprovalDecisionJournal)).not.toHaveBeenCalled();
  });
});
