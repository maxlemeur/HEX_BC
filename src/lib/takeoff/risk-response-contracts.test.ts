import { describe, expect, it } from "vitest";
import { buildTakeoffRiskRadarResponse } from "@/lib/takeoff/risk-radar";
import { parseTakeoffRiskRadarResponse, parseUpdateTakeoffRiskAlertStatusResponse } from "@/lib/takeoff/risk-response-contracts";
import { riskAlertFixture, JOB_ID, VERSION_ID, OTHER_ID, EVIDENCE_ID, PROJECT_ID, LOT_ID, ACTOR_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const identity = { jobId: JOB_ID, versionId: VERSION_ID };
function radar(status?: "to_process" | "assumed") {
  return buildTakeoffRiskRadarResponse({
    jobId: JOB_ID, versionId: VERSION_ID, projectId: PROJECT_ID, projectLabel: "Affaire test",
    alerts: [riskAlertFixture(), riskAlertFixture({ alert_id: OTHER_ID, status: "assumed", review_note: "Vérifié", reviewed_at: NOW, reviewed_by: ACTOR_ID })],
    lotLabelById: new Map([[LOT_ID, "Plomberie"]]), filters: { status },
  });
}

describe("takeoff risk response contracts", () => {
  it("retains actual radar output including global summaries with filtered alerts", () => {
    expect(parseTakeoffRiskRadarResponse(radar(), identity)).toEqual(radar());
    expect(parseTakeoffRiskRadarResponse(radar("assumed"), { ...identity, status: "assumed" })).toEqual(radar("assumed"));
    expect(radar("assumed").summary.to_process_count).toBe(1);
  });
  it("accepts valid uppercase request identities and historical null job attribution", () => {
    const data = radar();
    data.items[0].takeoff_job_id = null;
    expect(parseTakeoffRiskRadarResponse(data, { jobId: JOB_ID.toUpperCase(), versionId: VERSION_ID.toUpperCase() })).toEqual(data);
  });
  it.each([
    { job_id: OTHER_ID }, { version_id: OTHER_ID },
    { summary: { ...radar().summary, warning_count: 5 } },
    { project: { ...radar().project, scope_type: "lot" } },
    { lots: [radar().lots[0], radar().lots[0]] },
    { items: [riskAlertFixture(), riskAlertFixture()] },
    { items: [{ ...riskAlertFixture(), risk_score: 101 }] },
    { items: [{ ...riskAlertFixture(), takeoff_job_id: OTHER_ID }] },
    { items: [{ ...riskAlertFixture(), cause_code: "unexpected" }] },
    { items: [{ ...riskAlertFixture(), provenance: [{ kind: "invalid" }] }] },
  ])("rejects malformed radar data %#", (patch) => {
    expect(() => parseTakeoffRiskRadarResponse({ ...radar(), ...patch }, identity)).toThrow();
  });
  it.each([{ status: "assumed" as const }, { severity: "critical" as const }, { scope: "project" as const }, { lotId: OTHER_ID }])("checks requested filter affinity %#", (filters) => {
    expect(() => parseTakeoffRiskRadarResponse(radar(), { ...identity, ...filters })).toThrow();
  });
  it("validates the review status and the actual review evidence", () => {
    const data = { alert: riskAlertFixture({ status: "assumed", review_note: "Vérifié", reviewed_at: NOW, reviewed_by: ACTOR_ID }) };
    expect(parseUpdateTakeoffRiskAlertStatusResponse(data, { jobId: JOB_ID, alertId: EVIDENCE_ID, status: "assumed", reviewNote: " Vérifié " })).toEqual(data);
    const reopened = { alert: riskAlertFixture() };
    expect(parseUpdateTakeoffRiskAlertStatusResponse(reopened, { jobId: JOB_ID, alertId: EVIDENCE_ID, status: "to_process", reviewNote: "ignored" })).toEqual(reopened);
  });
  it.each([{ alert_id: OTHER_ID }, { takeoff_job_id: OTHER_ID }, { status: "false_positive" }, { reviewed_at: null }, { reviewed_by: null }, { review_note: "Different" }])("rejects inconsistent reviewed status %#", (patch) => {
    expect(() => parseUpdateTakeoffRiskAlertStatusResponse({ alert: { ...riskAlertFixture({
      status: "assumed", review_note: "Vérifié", reviewed_at: NOW, reviewed_by: ACTOR_ID,
    }), ...patch } }, { jobId: JOB_ID, alertId: EVIDENCE_ID, status: "assumed", reviewNote: "Vérifié" })).toThrow();
  });
});
