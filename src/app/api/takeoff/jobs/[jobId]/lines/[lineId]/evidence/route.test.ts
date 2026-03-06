import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  fetchTakeoffLineEvidencePanel: vi.fn(),
  parseTakeoffLineEvidencePanelQuery: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/jobs/[jobId]/lines/[lineId]/evidence/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  fetchTakeoffLineEvidencePanel,
  parseTakeoffLineEvidencePanelQuery,
} from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("GET /api/takeoff/jobs/[jobId]/lines/[lineId]/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the query and route params to the server service", async () => {
    vi.mocked(parseTakeoffLineEvidencePanelQuery).mockReturnValue({
      version_id: VERSION_ID,
    });
    vi.mocked(fetchTakeoffLineEvidencePanel).mockResolvedValue({
      line_id: LINE_ID,
      version_id: VERSION_ID,
      job_id: JOB_ID,
      evidences: [],
      history: [],
    });

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/lines/${LINE_ID}/evidence?version_id=${VERSION_ID}`
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          lineId: LINE_ID,
        }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(parseTakeoffLineEvidencePanelQuery).toHaveBeenCalledWith({
      version_id: VERSION_ID,
    });
    expect(fetchTakeoffLineEvidencePanel).toHaveBeenCalledWith(JOB_ID, {
      version_id: VERSION_ID,
      line_id: LINE_ID,
    });
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(parseTakeoffLineEvidencePanelQuery).mockReturnValue({
      version_id: VERSION_ID,
    });
    vi.mocked(fetchTakeoffLineEvidencePanel).mockRejectedValue(
      new TakeoffError({
        status: 404,
        code: TakeoffErrorCode.NOT_FOUND,
        message: "Ligne DPGF introuvable.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/lines/${LINE_ID}/evidence?version_id=${VERSION_ID}`
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          lineId: LINE_ID,
        }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NOT_FOUND");
    expect(body.error?.message).toBe("Ligne DPGF introuvable.");
  });
});
