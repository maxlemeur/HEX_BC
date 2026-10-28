import { describe, expect, it } from "vitest";

import {
  buildStaleSupplierPriceItemIds,
  buildTakeoffRiskAlertStatusUpdate,
  buildTakeoffRiskRadarProjectionPlan,
  normalizeExistingRiskAlertRecords,
  prepareTakeoffRiskCandidates,
  resolveApplicableMinMarginThresholdBp,
  type EstimateRiskItemRow,
  type EstimateRiskVersionContext,
  type ExistingRiskAlertRecord,
} from "@/lib/takeoff/risk-radar-preparation";
import type { TakeoffRiskCandidate } from "@/lib/takeoff/risk-radar";

const NOW = "2026-10-28T14:00:00.000Z";
const REVIEWED_AT = "2026-10-20T14:00:00.000Z";
const scope = { tenantId: "tenant", projectId: "project", versionId: "version", jobId: "job" };

function candidate(overrides: Partial<TakeoffRiskCandidate> = {}): TakeoffRiskCandidate {
  return {
    scope_type: "line", scope_ref: "line", scope_id: "line", scope_label: "Cloison",
    line_id: "line", lot_id: "lot", cause_code: "missing_proof", severity: "warning",
    risk_score: 40, margin_bucket: "healthy", reason_labels: ["Preuve absente"],
    provenance: [], metadata: {}, ...overrides,
  };
}

function existing(overrides: Partial<ExistingRiskAlertRecord> = {}): ExistingRiskAlertRecord {
  return {
    ...candidate(), alert_id: "alert", cause_label: "Preuve absente", status: "assumed",
    is_active: true, review_note: "Accepté après contrôle du plan",
    reviewed_at: REVIEWED_AT, reviewed_by: "reviewer",
    created_at: REVIEWED_AT, updated_at: REVIEWED_AT, ...overrides,
  };
}

function item(overrides: Partial<EstimateRiskItemRow> = {}): EstimateRiskItemRow {
  return {
    id: "line", parent_id: null, item_type: "line", pricing_status: "priced",
    title: "Cloison", description: null, quantity: 100, category_id: null,
    selected_supplier_price_id: "price", unit_price_ht_cents: 1000, tax_rate_bp: 2000,
    h_mo: null, labor_role_id: null, h_mo_atelier: null, labor_role_atelier_id: null,
    k_mo_atelier: null, h_mo_chantier: null, labor_role_chantier_id: null,
    k_mo_chantier: null, ...overrides,
  };
}

function version(marginBp: number | null): EstimateRiskVersionContext {
  return {
    id: scope.versionId, tenant_id: scope.tenantId, project_id: scope.projectId,
    status: "draft", updated_at: NOW, content_revision: 1, calc_engine_version: 3,
    calc_snapshot_content_revision: null, calc_snapshot_context: null,
    discount_amount_cents: null, project_user_id: "owner", margin_bp: marginBp,
    margin_multiplier: null, discount_bp: 0, total_ht_cents: 100000, tax_rate_bp: 2000,
    project_name: "Chantier", client_name: null,
  };
}

describe("risk radar projection plan", () => {
  it("reactivates the same identity without losing the human review or first detection", () => {
    const reviewed = existing({ is_active: false });
    const plan = buildTakeoffRiskRadarProjectionPlan({
      ...scope, now: NOW, existingAlerts: [reviewed],
      candidates: [candidate({ scope_label: "Cloison corrigée", risk_score: 70 })],
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.staleAlertIds).toEqual([]);
    expect(plan.updates).toEqual([{
      id: "alert",
      payload: expect.objectContaining({
        is_active: true, scope_label: "Cloison corrigée", risk_score: 70,
        status: "assumed", review_note: reviewed.review_note, reviewed_at: REVIEWED_AT,
        reviewed_by: "reviewer", last_detected_at: NOW, updated_at: NOW,
      }),
    }]);
    expect(plan.updates[0].payload).not.toHaveProperty("first_detected_at");
    expect(reviewed.is_active).toBe(false);
  });

  it("uses scope type, reference and cause rather than scope_id to identify alerts", () => {
    const plan = buildTakeoffRiskRadarProjectionPlan({
      ...scope, now: NOW, existingAlerts: [existing()],
      candidates: [
        candidate({ scope_type: "lot" }),
        candidate({ scope_ref: "another-line" }),
        candidate({ cause_code: "atypical_price" }),
      ],
    });
    expect(plan.updates).toEqual([]);
    expect(plan.staleAlertIds).toEqual(["alert"]);
    expect(plan.inserts).toHaveLength(3);
    for (const created of plan.inserts) {
      expect(created).toMatchObject({
        tenant_id: scope.tenantId, project_id: scope.projectId, version_id: scope.versionId,
        takeoff_job_id: scope.jobId, status: "to_process", is_active: true,
        review_note: null, reviewed_at: null, reviewed_by: null,
        first_detected_at: NOW, last_detected_at: NOW, updated_at: NOW,
      });
    }
  });

  it("deactivates disappeared active alerts and leaves already inactive alerts untouched", () => {
    const plan = buildTakeoffRiskRadarProjectionPlan({
      ...scope, now: NOW, candidates: [], existingAlerts: [existing(), existing({
        alert_id: "old-inactive", scope_ref: "old", is_active: false,
      })],
    });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.staleAlertIds).toEqual(["alert"]);
    expect(plan.stalePayload).toEqual({ is_active: false, last_detected_at: NOW, updated_at: NOW });
  });

  it("retains the first valid stored row of each identity in repository order", () => {
    const rows = normalizeExistingRiskAlertRecords([
      { ...existing(), id: "latest", review_note: "Dernière décision" },
      { ...existing(), id: "older", status: "to_process" },
      { ...existing(), id: "other", scope_ref: "other" },
      { ...existing(), id: "invalid", scope_type: "unknown" },
    ]);
    expect(rows.map((row) => row.alert_id)).toEqual(["latest", "other"]);
    expect(rows[0].review_note).toBe("Dernière décision");
  });
});

describe("risk radar status update", () => {
  it.each(["assumed", "false_positive"] as const)("records reviewer and explicit time for %s", (status) => {
    expect(buildTakeoffRiskAlertStatusUpdate({
      payload: { version_id: scope.versionId, status, review_note: "  Contrôlé sur le plan  " },
      userId: "reviewer", now: NOW,
    })).toEqual({ status, review_note: "Contrôlé sur le plan", reviewed_at: NOW, reviewed_by: "reviewer", updated_at: NOW });
  });

  it("clears all review fields on return to to_process, including any supplied note", () => {
    expect(buildTakeoffRiskAlertStatusUpdate({
      payload: { version_id: scope.versionId, status: "to_process", review_note: "Ancienne décision" },
      userId: "reviewer", now: NOW,
    })).toEqual({ status: "to_process", review_note: null, reviewed_at: null, reviewed_by: null, updated_at: NOW });
  });
});

describe("risk source preparation", () => {
  it("uses an explicit date and only selected line prices for freshness", () => {
    expect(buildStaleSupplierPriceItemIds({
      items: [item(), item({ id: "boundary", selected_supplier_price_id: "boundary" }), item({
        id: "section", item_type: "section",
      }), item({ id: "unknown", selected_supplier_price_id: "unknown" })],
      prices: [
        { id: "price", updated_at: null, created_at: "2026-07-29T14:00:00.000Z" },
        { id: "boundary", updated_at: "2026-07-30T14:00:00.000Z", created_at: null },
      ],
      stalePriceDays: 90, now: new Date(NOW),
    })).toEqual(new Set(["line"]));
  });

  it("selects the highest applicable margin rule, retaining the current client/project scope", () => {
    expect(resolveApplicableMinMarginThresholdBp({
      rules: [
        { scope_type: "global", scope_id: null, threshold_value: 1000 },
        { scope_type: "category", scope_id: "cat", threshold_value: 1500 },
        { scope_type: "client", scope_id: scope.projectId, threshold_value: 2000 },
        { scope_type: "category", scope_id: "other", threshold_value: 9000 },
        { scope_type: "client", scope_id: "other", threshold_value: 8000 },
        { scope_type: "global", scope_id: null, threshold_value: NaN },
      ],
      projectId: scope.projectId, categoryIds: new Set(["cat"]),
    })).toBe(2000);
  });

  it.each([
    [500, null, false, true],
    [1000, null, false, false],
    [null, null, false, false],
    [500, 1500, false, false],
    [500, 1500, true, true],
  ] as const)("preserves margin fallback and rule evidence for margin %s / threshold %s / violation %s", (marginBp, threshold, violation, expected) => {
    const result = prepareTakeoffRiskCandidates({
      comparisonRows: [], estimateItems: [], versionContext: version(marginBp),
      projectId: scope.projectId, dismissedOutlierFlagsByItemId: {},
      staleSupplierPriceItemIds: new Set(), applicableMarginThresholdBp: threshold,
      hasMinMarginViolation: violation, missingPieces: [],
    });
    expect(result.candidates.some((entry) => entry.cause_code === "insufficient_margin")).toBe(expected);
  });
});
