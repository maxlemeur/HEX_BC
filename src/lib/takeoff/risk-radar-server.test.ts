import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));
vi.mock("@/lib/takeoff/version-access-server", () => ({ assertTakeoffJobAccessibleForVersion: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-context-server", () => ({ loadTakeoffDpgfComparisonContext: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-server", () => ({ fetchAllTakeoffDpgfComparisonRows: vi.fn() }));
vi.mock("@/lib/affaires/intake-server", () => ({ fetchAffaireIntakeWorkspace: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ getStalePriceDaysForTenant: vi.fn() }));
vi.mock("@/lib/estimates/fixed-discount-evidence-server", () => ({ loadCanonicalFixedDiscountEvidence: vi.fn() }));
vi.mock("@/lib/estimates/rules-engine", () => ({ evaluateRules: vi.fn() }));

import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import { evaluateRules } from "@/lib/estimates/rules-engine";
import { getStalePriceDaysForTenant } from "@/lib/feature-flags";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchAllTakeoffDpgfComparisonRows } from "@/lib/takeoff/dpgf-comparison-server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import {
  fetchTakeoffActiveRiskAlerts,
  fetchTakeoffRiskRadar,
  updateTakeoffRiskAlertStatus,
} from "@/lib/takeoff/risk-radar-server";
import { assertTakeoffJobAccessibleForVersion } from "@/lib/takeoff/version-access-server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const ALERT = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-10-28T14:00:00.000Z";
type Row = Record<string, unknown>;

function makeDatabase() {
  const tables: Record<string, Row[]> = {
    estimate_versions: [{
      id: VERSION, tenant_id: TENANT, project_id: PROJECT, status: "draft",
      updated_at: NOW, content_revision: 1, calc_engine_version: 3,
      calc_snapshot_content_revision: null, calc_snapshot_context: null,
      discount_amount_cents: 500, margin_bp: 500, margin_multiplier: null,
      discount_bp: 0, total_ht_cents: 10000, tax_rate_bp: 2000,
      estimate_projects: { id: PROJECT, user_id: USER, name: "Chantier", client_name: null },
    }],
    estimate_risk_alerts: [], estimate_item_outlier_dismissals: [], estimate_rules: [],
  };
  const writes: Array<{ table: string; rows: Row[] }> = [];
  // The restrictive policy « Operators can update estimate risk alerts » silently filters a non-operator's updates.
  const access = { canUpdate: true };
  let insertedCount = 0;
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    let pendingInsert: Row[] | null = null;
    let mode: "all" | "one" = "all";
    let start = 0;
    let end = Infinity;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      order: () => query,
      range: (from: number, to: number) => { start = from; end = to; return query; },
      maybeSingle: () => { mode = "one"; return query; },
      single: () => { mode = "one"; return query; },
      update: (payload: Row) => { patch = payload; return query; },
      insert: (rows: Row[]) => { pendingInsert = rows; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        if (pendingInsert) {
          const inserted = pendingInsert.map((row) => {
            insertedCount += 1;
            return { ...row, id: `inserted-${insertedCount}`, created_at: NOW };
          });
          tables[table].push(...inserted);
          writes.push({ table, rows: inserted });
          // A response capped at max_rows (1 000, supabase/config.toml), as a read is.
          return Promise.resolve({ data: inserted.slice(0, 1000), error: null }).then(resolve);
        }
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))
          .filter(() => !patch || access.canUpdate);
        if (patch) {
          for (const row of rows) Object.assign(row, patch);
          writes.push({ table, rows: rows.map((row) => ({ ...row })) });
        }
        return Promise.resolve({
          data: mode === "one" ? rows[0] ?? null : rows.slice(start, Math.min(end + 1, start + 1000)),
          count: rows.length, error: null,
        }).then(resolve);
      },
    };
    return query;
  }
  const supabase = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(() => builder("risk_items")),
  };
  return { tables, writes, supabase, access };
}

function storedAlert(overrides: Row = {}): Row {
  return {
    id: ALERT, tenant_id: TENANT, version_id: VERSION, takeoff_job_id: JOB,
    project_id: PROJECT, scope_type: "project", scope_ref: PROJECT, scope_id: PROJECT,
    scope_label: "Chantier", cause_code: "insufficient_margin", severity: "warning",
    status: "assumed", risk_score: 35, margin_bucket: "thin", line_id: null, lot_id: null,
    reason_labels: [], provenance: [], metadata: {}, is_active: true,
    review_note: "Accepté", reviewed_by: USER, reviewed_at: "2026-10-20T14:00:00.000Z",
    created_at: NOW, updated_at: NOW, ...overrides,
  };
}

let db: ReturnType<typeof makeDatabase>;
let auth: Awaited<ReturnType<typeof getAuthenticatedTakeoffContext>>;

beforeEach(() => {
  vi.clearAllMocks();
  db = makeDatabase();
  auth = { supabase: db.supabase, tenantId: TENANT, userId: USER, tenantRole: "engineer" } as never;
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(auth);
  vi.mocked(assertTakeoffJobAccessibleForVersion).mockResolvedValue({} as never);
  vi.mocked(loadTakeoffDpgfComparisonContext).mockResolvedValue({
    ...auth, projectId: PROJECT, estimateItems: [],
    comparisonInput: { versionId: VERSION, jobId: JOB },
  } as never);
  vi.mocked(fetchAllTakeoffDpgfComparisonRows).mockResolvedValue({ rows: [] } as never);
  vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({ missingPieces: [] } as never);
  vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);
  vi.mocked(loadCanonicalFixedDiscountEvidence).mockResolvedValue(null);
  vi.mocked(evaluateRules).mockResolvedValue({ violations: [], blockingViolations: [], warningViolations: [], unavailableSignals: [] });
});

describe("risk radar operations", () => {
  it("synchronizes a radar GET from one comparison context and carries canonical discount evidence", async () => {
    const evidence = { marker: "canonical-discount" };
    vi.mocked(loadCanonicalFixedDiscountEvidence).mockResolvedValue(evidence as never);
    vi.mocked(fetchAffaireIntakeWorkspace).mockRejectedValue(new Error("Intake unavailable"));

    const radar = await fetchTakeoffRiskRadar(JOB, { version_id: VERSION });

    expect(loadTakeoffDpgfComparisonContext).toHaveBeenCalledTimes(1);
    const context = await vi.mocked(loadTakeoffDpgfComparisonContext).mock.results[0].value;
    expect(fetchAllTakeoffDpgfComparisonRows).toHaveBeenCalledExactlyOnceWith({ context });
    expect(loadCanonicalFixedDiscountEvidence).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, projectUserId: USER, authorizedVersion: expect.objectContaining({ id: VERSION, discount_amount_cents: 500 }),
    }));
    expect(evaluateRules).toHaveBeenCalledWith(expect.objectContaining({ fixedDiscountEvidence: evidence }));
    expect(radar.items).toEqual([expect.objectContaining({ cause_code: "insufficient_margin", status: "to_process" })]);
    expect(db.tables.estimate_risk_alerts).toEqual([expect.objectContaining({
      tenant_id: TENANT, version_id: VERSION, takeoff_job_id: JOB, is_active: true,
    })]);
    expect(db.supabase.rpc).toHaveBeenCalledWith("read_estimate_version_items", { p_tenant_id: TENANT, p_version_id: VERSION }, { count: "exact", get: true });
  });

  it("answers a large radar GET with every alert of its projection: reviewed ones keep their decision, inactive ones return, stale ones leave", async () => {
    // 1 201 lines without a proof: more alerts than one PostgREST response carries (max_rows 1 000).
    const lines = Array.from({ length: 1201 }, (_, index) => `line-${String(index).padStart(4, "0")}`);
    vi.mocked(fetchAllTakeoffDpgfComparisonRows).mockResolvedValue({
      rows: lines.map((line_id) => ({ line_id, line_label: `Ligne ${line_id}`, proofs: [] })),
    } as never);
    const lineAlert = (id: string, lineId: string, overrides: Row = {}) => storedAlert({
      id, scope_type: "line", scope_ref: lineId, scope_id: lineId, scope_label: `Ligne ${lineId}`,
      line_id: lineId, cause_code: "missing_proof", ...overrides,
    });
    db.tables.estimate_risk_alerts = [
      lineAlert("reviewed", lines[0], { status: "false_positive", review_note: "Preuve papier au dossier" }),
      lineAlert("stale", "deleted-line", { status: "to_process", review_note: null, reviewed_at: null, reviewed_by: null }),
      lineAlert("inactive", lines[1], { is_active: false, status: "to_process", review_note: null, reviewed_at: null, reviewed_by: null }),
    ];

    const radar = await fetchTakeoffRiskRadar(JOB, { version_id: VERSION });

    const ids = radar.items.map((alert) => alert.alert_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(radar.items.filter((alert) => alert.cause_code === "missing_proof").map((alert) => alert.line_id).sort()).toEqual(lines);
    expect(radar.items.filter((alert) => alert.cause_code === "insufficient_margin")).toHaveLength(1);
    expect(radar.items.find((alert) => alert.line_id === lines[0])).toMatchObject({
      alert_id: "reviewed", status: "false_positive", review_note: "Preuve papier au dossier",
    });
    // An inactive alert whose cause is detected again comes back under its own identity.
    expect(radar.items.find((alert) => alert.line_id === lines[1])).toMatchObject({ alert_id: "inactive", status: "to_process" });
    expect(ids).not.toContain("stale");
    expect(radar.summary).toMatchObject({ to_process_count: 1201, false_positive_count: 1 });
    expect(db.tables.estimate_risk_alerts.find((row) => row.id === "stale")).toMatchObject({ is_active: false });
    expect(db.tables.estimate_risk_alerts.filter((row) => row.is_active === true)).toHaveLength(1202);
  });

  it("shows a non-operator project owner the stored projection when the policy filters the radar's updates", async () => {
    db.access.canUpdate = false;
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ ...auth, tenantRole: "viewer" });
    vi.mocked(fetchAllTakeoffDpgfComparisonRows).mockResolvedValue({
      rows: [{ line_id: "line-new", line_label: "Ligne nouvelle", proofs: [] }],
    } as never);
    db.tables.estimate_risk_alerts = [
      storedAlert(),
      storedAlert({
        id: "stale", scope_type: "line", scope_ref: "deleted-line", scope_id: "deleted-line", line_id: "deleted-line",
        cause_code: "missing_proof", status: "to_process", review_note: null, reviewed_at: null, reviewed_by: null,
      }),
    ];

    const radar = await fetchTakeoffRiskRadar(JOB, { version_id: VERSION });

    // What the stored projection holds: the reviewed alert, the alert it could not close, and its own new alert.
    expect(radar.items).toHaveLength(3);
    expect(radar.items.find((alert) => alert.alert_id === ALERT)).toMatchObject({ cause_code: "insufficient_margin", status: "assumed" });
    expect(radar.items.find((alert) => alert.alert_id === "stale")).toMatchObject({ line_id: "deleted-line", status: "to_process" });
    expect(radar.items.find((alert) => alert.line_id === "line-new")).toMatchObject({ cause_code: "missing_proof", status: "to_process" });
    expect(radar.summary).toMatchObject({ to_process_count: 2, assumed_count: 1 });
  });

  it("reads active alerts within tenant/version/job without recalculating the projection", async () => {
    db.tables.estimate_risk_alerts = [
      storedAlert(), storedAlert({ id: "inactive", is_active: false }),
      storedAlert({ id: "other-tenant", tenant_id: "other" }),
      storedAlert({ id: "other-job", takeoff_job_id: "other" }),
      storedAlert({ id: "other-version", version_id: "other" }),
    ];
    const alerts = await fetchTakeoffActiveRiskAlerts(JOB, { version_id: VERSION });
    expect(alerts.map((alert) => alert.alert_id)).toEqual([ALERT]);
    expect(assertTakeoffJobAccessibleForVersion).toHaveBeenCalledWith({ supabase: db.supabase, tenantId: TENANT, versionId: VERSION, jobId: JOB });
    expect(db.writes).toEqual([]);
    expect(loadTakeoffDpgfComparisonContext).not.toHaveBeenCalled();
    expect(evaluateRules).not.toHaveBeenCalled();
  });

  it("checks the operator role before parsing or touching the alert", async () => {
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ ...auth, tenantRole: "viewer" });
    await expect(updateTakeoffRiskAlertStatus("invalid", "invalid", { version_id: VERSION, status: "assumed" })).rejects.toMatchObject({ status: 403 });
    expect(db.supabase.from).not.toHaveBeenCalled();
    expect(assertTakeoffJobAccessibleForVersion).not.toHaveBeenCalled();
  });

  it.each(["assumed", "false_positive"] as const)("rejects a missing or blank human note for %s before any writes", async (status) => {
    for (const review_note of [undefined, null, "  "]) {
      await expect(updateTakeoffRiskAlertStatus(JOB, ALERT, { version_id: VERSION, status, review_note })).rejects.toMatchObject({ status: 422 });
    }
    expect(db.writes).toEqual([]);
    expect(assertTakeoffJobAccessibleForVersion).not.toHaveBeenCalled();
  });

  it.each([
    { tenant_id: "other" }, { version_id: "other" },
    { takeoff_job_id: "other" }, { is_active: false },
  ])("does not update an alert outside the accessible active scope %j", async (overrides) => {
    db.tables.estimate_risk_alerts = [storedAlert(overrides)];
    await expect(updateTakeoffRiskAlertStatus(JOB, ALERT, { version_id: VERSION, status: "to_process" })).rejects.toMatchObject({ status: 404 });
    expect(db.writes).toEqual([]);
  });
});
