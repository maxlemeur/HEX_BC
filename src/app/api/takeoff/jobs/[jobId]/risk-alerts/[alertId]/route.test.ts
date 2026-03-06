import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  updateTakeoffRiskAlertStatus: vi.fn(),
}));

import { PATCH } from "@/app/api/takeoff/jobs/[jobId]/risk-alerts/[alertId]/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { updateTakeoffRiskAlertStatus } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ALERT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("PATCH /api/takeoff/jobs/[jobId]/risk-alerts/[alertId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the risk alert status", async () => {
    vi.mocked(updateTakeoffRiskAlertStatus).mockResolvedValue({
      alert: {
        alert_id: ALERT_ID,
        scope_type: "line",
        scope_id: "44444444-4444-4444-8444-444444444444",
        scope_label: "Doublage acoustique",
        line_id: "44444444-4444-4444-8444-444444444444",
        lot_id: null,
        cause_code: "missing_proof",
        cause_label: "Preuve absente",
        severity: "warning",
        risk_score: 40,
        status: "assumed",
        margin_bucket: "thin",
        reason_labels: ["Aucune preuve active hors DPGF sur la ligne."],
        provenance: [],
        review_note: "Controle humain effectue.",
        reviewed_at: "2026-03-06T10:00:00.000Z",
        reviewed_by: "55555555-5555-4555-8555-555555555555",
        created_at: "2026-03-06T09:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        metadata: {},
      },
    });

    const response = await PATCH(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/risk-alerts/${ALERT_ID}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version_id: VERSION_ID,
            status: "assumed",
            review_note: "Controle humain effectue.",
          }),
        }
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          alertId: ALERT_ID,
        }),
      }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateTakeoffRiskAlertStatus).toHaveBeenCalledWith(JOB_ID, ALERT_ID, {
      version_id: VERSION_ID,
      status: "assumed",
      review_note: "Controle humain effectue.",
    });
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(updateTakeoffRiskAlertStatus).mockRejectedValue(
      new TakeoffError({
        status: 422,
        code: TakeoffErrorCode.VALIDATION_ERROR,
        message: "Une note humaine explicite est obligatoire.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const response = await PATCH(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/risk-alerts/${ALERT_ID}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            version_id: VERSION_ID,
            status: "assumed",
            review_note: "",
          }),
        }
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          alertId: ALERT_ID,
        }),
      }
    );

    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});
