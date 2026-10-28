import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getComparison } from "@/app/api/takeoff/jobs/[jobId]/dpgf-compare/route";
import { GET as getEvidence } from "@/app/api/takeoff/jobs/[jobId]/lines/[lineId]/evidence/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { buildTakeoffRowRiskMap } from "@/lib/takeoff/risk-radar";
import { comparisonFixture, evidencePanelFixture, JOB_ID, LINE_ID, OTHER_ID, VERSION_ID } from "@/lib/takeoff/read-contracts.test-fixtures";
import { takeoffDpgfComparisonQuerySchema, takeoffLineEvidencePanelQuerySchema } from "@/lib/takeoff/schemas";
import { fetchDpgfTakeoffComparison, fetchTakeoffActiveRiskAlerts, fetchTakeoffLineEvidencePanel } from "@/lib/takeoff/server";

vi.mock("@/lib/takeoff/server", () => ({
  fetchDpgfTakeoffComparison: vi.fn(), fetchTakeoffActiveRiskAlerts: vi.fn(), fetchTakeoffLineEvidencePanel: vi.fn(),
  parseTakeoffDpgfComparisonQuery: (input: unknown) => takeoffDpgfComparisonQuerySchema.parse(input),
  parseTakeoffLineEvidencePanelQuery: (input: unknown) => takeoffLineEvidencePanelQuerySchema.parse(input),
}));
vi.mock("@/lib/takeoff/risk-radar", () => ({ buildTakeoffRowRiskMap: vi.fn() }));

function requestComparison() {
  return getComparison(new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/dpgf-compare?version_id=${VERSION_ID}`), {
    params: Promise.resolve({ jobId: JOB_ID }),
  });
}

function requestEvidence() {
  return getEvidence(new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/lines/${LINE_ID}/evidence?version_id=${VERSION_ID}`), {
    params: Promise.resolve({ jobId: JOB_ID, lineId: LINE_ID }),
  });
}

describe("takeoff read route output contracts", () => {
  beforeEach(() => {
    vi.mocked(fetchDpgfTakeoffComparison).mockResolvedValue(comparisonFixture());
    vi.mocked(fetchTakeoffActiveRiskAlerts).mockResolvedValue([]);
    vi.mocked(fetchTakeoffLineEvidencePanel).mockResolvedValue(evidencePanelFixture());
    vi.mocked(buildTakeoffRowRiskMap).mockReturnValue(new Map());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.resetAllMocks(); vi.restoreAllMocks(); });

  it("returns the complete comparison after adding persisted risk", async () => {
    const risk = { score: 42, severity: "warning" as const, causes: ["Écart DPGF/métré"], status: "to_process" as const };
    vi.mocked(buildTakeoffRowRiskMap).mockReturnValue(new Map([[LINE_ID, risk]]));
    const response = await requestComparison();
    expect(response.status).toBe(200);
    const data = comparisonFixture();
    data.rows[0].risk = risk;
    expect(await response.json()).toEqual({ ok: true, data });
  });

  it("rejects malformed risk added by the route with 500 and no second synchronization", async () => {
    vi.mocked(buildTakeoffRowRiskMap).mockReturnValue(new Map([[LINE_ID, { score: "wrong" }]]) as never);
    const response = await requestComparison();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(fetchDpgfTakeoffComparison).toHaveBeenCalledTimes(1);
    expect(fetchTakeoffActiveRiskAlerts).toHaveBeenCalledTimes(1);
  });

  it.each([
    { job_id: OTHER_ID }, { version_id: OTHER_ID }, { view: "exceptions_only" },
    { summary: { ...comparisonFixture().summary, total_lines: -1 } },
    { rows: [{ ...comparisonFixture().rows[0], proofs: [{ type: "bogus" }] }] },
  ])("returns 500 for invalid comparison output, not a request validation error", async (patch) => {
    vi.mocked(fetchDpgfTakeoffComparison).mockResolvedValue({ ...comparisonFixture(), ...patch } as never);
    const response = await requestComparison();
    expect(response.status).toBe(500);
    expect(fetchDpgfTakeoffComparison).toHaveBeenCalledTimes(1);
  });

  it("returns active evidence and its replacement history", async () => {
    const response = await requestEvidence();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: evidencePanelFixture() });
  });

  it.each([
    { line_id: OTHER_ID }, { job_id: OTHER_ID }, { version_id: OTHER_ID },
    { evidences: [{ ...evidencePanelFixture().evidences[0], confidence_score: "wrong" }] },
    { history: [{ ...evidencePanelFixture().history[0], status: "active" }] },
  ])("returns 500 for invalid panel output without repeating evidence synchronization", async (patch) => {
    vi.mocked(fetchTakeoffLineEvidencePanel).mockResolvedValue({ ...evidencePanelFixture(), ...patch } as never);
    const response = await requestEvidence();
    expect(response.status).toBe(500);
    expect(fetchTakeoffLineEvidencePanel).toHaveBeenCalledTimes(1);
  });

  it("preserves request validation and authorization errors", async () => {
    const invalidQuery = await getComparison(new Request("http://localhost/api/takeoff?version_id=bad-id"), {
      params: Promise.resolve({ jobId: JOB_ID }),
    });
    expect(invalidQuery.status).toBe(400);
    expect(fetchDpgfTakeoffComparison).not.toHaveBeenCalled();
    vi.mocked(fetchTakeoffLineEvidencePanel).mockRejectedValue(new TakeoffError({
      status: 403, code: TakeoffErrorCode.FORBIDDEN, message: "Accès refusé", retryable: false, jobId: JOB_ID,
    }));
    expect((await requestEvidence()).status).toBe(403);
  });
});
