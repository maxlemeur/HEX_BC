import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/rules-engine", () => ({
  buildEstimateApprovalDecisionJournalCsv: vi.fn(),
  listEstimateApprovalDecisionJournal: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/approval-journal/route";
import {
  buildEstimateApprovalDecisionJournalCsv,
  listEstimateApprovalDecisionJournal,
} from "@/lib/estimates/rules-engine";

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

  it("loads filtered journal data in JSON", async () => {
    vi.mocked(listEstimateApprovalDecisionJournal).mockResolvedValue({
      events: [],
      availableAuthors: [],
      filters: {
        actorUserId: "22222222-2222-4222-8222-222222222222",
        decision: "approved_with_reservations",
      },
    } as never);

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/approval-journal?author=22222222-2222-4222-8222-222222222222&status=approved_with_reservations`,
      {
        method: "GET",
      }
    );

    const response = await GET(request, makeParams());
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        filters: {
          actorUserId: string | null;
          decision: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.filters).toEqual({
      actorUserId: "22222222-2222-4222-8222-222222222222",
      decision: "approved_with_reservations",
    });
    expect(vi.mocked(listEstimateApprovalDecisionJournal)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      actorUserId: "22222222-2222-4222-8222-222222222222",
      decision: "approved_with_reservations",
    });
  });

  it("exports the journal as csv", async () => {
    vi.mocked(listEstimateApprovalDecisionJournal).mockResolvedValue({
      events: [],
      availableAuthors: [],
      filters: {
        actorUserId: null,
        decision: null,
      },
    } as never);
    vi.mocked(buildEstimateApprovalDecisionJournalCsv).mockReturnValue(
      "date_decision;decision\n"
    );

    const request = new Request(
      `http://localhost/api/estimates/${VERSION_ID}/approval-journal?format=csv`,
      {
        method: "GET",
      }
    );

    const response = await GET(request, makeParams());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe("date_decision;decision\n");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      `approval-journal-${VERSION_ID}.csv`
    );
    expect(vi.mocked(buildEstimateApprovalDecisionJournalCsv)).toHaveBeenCalled();
  });
});
