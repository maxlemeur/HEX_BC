import { describe, expect, it } from "vitest";

import { buildDirectionSyntheticAlerts } from "@/lib/direction/alerts";
import type { TakeoffRiskAlert } from "@/lib/takeoff/types";

function createAlert(
  overrides: Partial<TakeoffRiskAlert> = {}
): TakeoffRiskAlert {
  return {
    alert_id: overrides.alert_id ?? "11111111-1111-4111-8111-111111111111",
    takeoff_job_id: overrides.takeoff_job_id ?? "job-1",
    scope_type: overrides.scope_type ?? "project",
    scope_id: overrides.scope_id ?? null,
    scope_label: overrides.scope_label ?? "Affaire test",
    line_id: overrides.line_id ?? null,
    lot_id: overrides.lot_id ?? null,
    cause_code: overrides.cause_code ?? "missing_proof",
    cause_label: overrides.cause_label ?? "Preuve absente",
    severity: overrides.severity ?? "warning",
    risk_score: overrides.risk_score ?? 62,
    status: overrides.status ?? "to_process",
    margin_bucket: overrides.margin_bucket ?? "thin",
    reason_labels: overrides.reason_labels ?? ["Source plan absente"],
    provenance: overrides.provenance ?? [],
    review_note: overrides.review_note ?? null,
    reviewed_at: overrides.reviewed_at ?? null,
    reviewed_by: overrides.reviewed_by ?? null,
    created_at: overrides.created_at ?? "2026-03-07T09:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-07T09:00:00.000Z",
    metadata: overrides.metadata ?? { takeoff_job_id: "job-1" },
  };
}

describe("buildDirectionSyntheticAlerts", () => {
  it("groups low margin and quantity gaps into a critical synthetic alert", () => {
    const alerts = buildDirectionSyntheticAlerts({
      projectId: "project-1",
      projectName: "Affaire test",
      versionId: "version-1",
      amountHtCents: 3_200_000,
      marginBp: 900,
      discountBp: 0,
      approvalStatus: "required",
      exceptionCount: 4,
      openHypothesesCount: 1,
      riskScore: 78,
      sendTargetAt: "2026-03-10T09:00:00.000Z",
      latestJobId: "job-1",
      alerts: [
        createAlert({
          cause_code: "dpgf_takeoff_gap",
          cause_label: "Ecart DPGF / metre",
          severity: "critical",
          risk_score: 78,
        }),
        createAlert({
          alert_id: "22222222-2222-4222-8222-222222222222",
          cause_code: "insufficient_margin",
          cause_label: "Marge insuffisante",
          severity: "warning",
          risk_score: 63,
        }),
      ],
    });

    expect(alerts[0]).toMatchObject({
      label: "Marge fragile avec ecarts ouverts",
      level: "critical",
      status: "to_process",
      jobId: "job-1",
    });
    expect(alerts[0]?.alertIds).toHaveLength(2);
  });

  it("falls back to a generic signal when no explicit rule matches", () => {
    const alerts = buildDirectionSyntheticAlerts({
      projectId: "project-1",
      projectName: "Affaire test",
      versionId: "version-1",
      amountHtCents: 500_000,
      marginBp: 2_500,
      discountBp: 0,
      approvalStatus: "approved",
      exceptionCount: 1,
      openHypothesesCount: 0,
      riskScore: 28,
      sendTargetAt: null,
      latestJobId: "job-1",
      alerts: [
        createAlert({
          cause_code: "vat_inconsistency",
          cause_label: "TVA incoherente",
          severity: "info",
          risk_score: 28,
        }),
      ],
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.label).toBe("Signal a traiter avant arbitrage");
  });

  it("keeps an actionable job id when alerts share one and latestJobId is missing", () => {
    const alerts = buildDirectionSyntheticAlerts({
      projectId: "project-1",
      projectName: "Affaire test",
      versionId: "version-1",
      amountHtCents: 500_000,
      marginBp: 2_500,
      discountBp: 0,
      approvalStatus: "approved",
      exceptionCount: 1,
      openHypothesesCount: 0,
      riskScore: 28,
      sendTargetAt: null,
      latestJobId: null,
      alerts: [
        createAlert({
          cause_code: "vat_inconsistency",
          cause_label: "TVA incoherente",
          severity: "info",
          risk_score: 28,
          takeoff_job_id: "job-fallback",
          metadata: {},
        }),
      ],
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      jobId: "job-fallback",
      latestJobId: null,
      label: "Signal a traiter avant arbitrage",
    });
  });
});
