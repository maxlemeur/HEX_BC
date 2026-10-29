import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  fetchTakeoffRiskRadar: vi.fn(), updateTakeoffRiskAlertStatus: vi.fn(),
  saveTakeoffDpgfManualLink: vi.fn(), saveTakeoffReviewDecision: vi.fn(),
  applyTakeoffJob: vi.fn(), previewTakeoffJobConversion: vi.fn(),
  batchUpdateTakeoffItems: vi.fn(), compareTakeoffJobs: vi.fn(),
  parseTakeoffRiskRadarQuery: (input: unknown) => takeoffRiskRadarQuerySchema.parse(input),
  parseCompareTakeoffJobsQuery: (input: unknown) => compareTakeoffJobsQuerySchema.parse(input),
}));

import { GET as getRadar } from "@/app/api/takeoff/jobs/[jobId]/risk-radar/route";
import { PATCH as patchRiskStatus } from "@/app/api/takeoff/jobs/[jobId]/risk-alerts/[alertId]/route";
import { PATCH as patchLink } from "@/app/api/takeoff/jobs/[jobId]/dpgf-link/route";
import { PATCH as patchDecision } from "@/app/api/takeoff/jobs/[jobId]/review-decision/route";
import { POST as postApply } from "@/app/api/takeoff/jobs/[jobId]/apply/route";
import { POST as postPreview } from "@/app/api/takeoff/jobs/[jobId]/preview-conversion/route";
import { PATCH as patchItems } from "@/app/api/takeoff/jobs/[jobId]/items/route";
import { GET as getComparison } from "@/app/api/takeoff/jobs/[jobId]/compare/route";
import { buildTakeoffDiff } from "@/lib/takeoff/diff";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import { decisionFixture } from "@/lib/takeoff/read-contracts.test-fixtures";
import {
  appliedJobFixture, takeoffItemFixture, riskAlertFixture,
  JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, EVIDENCE_ID, PROJECT_ID, LOT_ID, ACTOR_ID, NOW,
} from "@/lib/takeoff/response-contracts.test-fixtures";
import { buildTakeoffRiskRadarResponse } from "@/lib/takeoff/risk-radar";
import { compareTakeoffJobsQuerySchema, takeoffRiskRadarQuerySchema } from "@/lib/takeoff/schemas";
import {
  fetchTakeoffRiskRadar, updateTakeoffRiskAlertStatus,
  saveTakeoffDpgfManualLink, saveTakeoffReviewDecision,
  applyTakeoffJob, previewTakeoffJobConversion,
  batchUpdateTakeoffItems, compareTakeoffJobs,
} from "@/lib/takeoff/server";

function radar() {
  return buildTakeoffRiskRadarResponse({
    jobId: JOB_ID, versionId: VERSION_ID, projectId: PROJECT_ID, projectLabel: "Affaire test",
    alerts: [riskAlertFixture()], lotLabelById: new Map([[LOT_ID, "Plomberie"]]),
  });
}
function reviewedRisk() {
  return { alert: riskAlertFixture({ status: "assumed", review_note: "Vérifié", reviewed_at: NOW, reviewed_by: ACTOR_ID }) };
}
function links() {
  return { links: [{
    id: EVIDENCE_ID, tenant_id: ACTOR_ID, version_id: VERSION_ID, takeoff_job_id: JOB_ID,
    estimate_item_id: LINE_ID, takeoff_item_id: OTHER_ID, created_at: NOW, updated_at: NOW, linked_by: ACTOR_ID,
  }] };
}
function application() {
  return { job: appliedJobFixture(), summary: {
    scope: "version", created_count: 1, updated_count: 0, ignored_count: 0,
    created_ids: [LINE_ID], item_links: [{ takeoff_item_id: OTHER_ID, estimate_item_id: LINE_ID }],
  } };
}
function preview() {
  return { job_id: JOB_ID, strategy: "append", target_section_id: null,
    ...computeTakeoffMappingPreview({ items: [takeoffItemFixture()], rules: [] }),
  };
}
function partialPatch() {
  return { results: [
    { item_id: OTHER_ID, success: true, item: takeoffItemFixture() },
    { item_id: LINE_ID, success: false, error: "Conflit de concurrence" },
  ], succeeded: 1, failed: 1 };
}
function comparison() {
  return { base_job_id: JOB_ID, other_job_id: OTHER_ID, ...buildTakeoffDiff({
    baseItems: [takeoffItemFixture()], otherItems: [takeoffItemFixture({ id: LINE_ID, quantity: 13.5 })],
  }) };
}
const patchBody = { items: [OTHER_ID, LINE_ID].map((item_id) => ({ item_id, updated_at: NOW, fields: { quantity: 12.5 } })) };

const routes = [
  {
    name: "risk radar", method: "GET", path: `risk-radar?version_id=${VERSION_ID}`, handler: getRadar,
    producer: vi.mocked(fetchTakeoffRiskRadar), valid: radar,
    inconsistent: () => ({ ...radar(), version_id: OTHER_ID }),
  },
  {
    name: "risk status", method: "PATCH", path: `risk-alerts/${EVIDENCE_ID}`, handler: patchRiskStatus,
    producer: vi.mocked(updateTakeoffRiskAlertStatus), valid: reviewedRisk,
    body: { version_id: VERSION_ID, status: "assumed", review_note: "Vérifié" },
    inconsistent: () => ({ alert: { ...reviewedRisk().alert, alert_id: OTHER_ID } }),
  },
  {
    name: "manual links", method: "PATCH", path: "dpgf-link", handler: patchLink,
    producer: vi.mocked(saveTakeoffDpgfManualLink), valid: links,
    body: { version_id: VERSION_ID, estimate_item_id: LINE_ID, takeoff_item_ids: [OTHER_ID] },
    inconsistent: () => ({ links: [{ ...links().links[0], takeoff_item_id: LINE_ID }] }),
  },
  {
    name: "review decision", method: "PATCH", path: "review-decision", handler: patchDecision,
    producer: vi.mocked(saveTakeoffReviewDecision), valid: () => ({ decision: decisionFixture() }),
    body: { version_id: VERSION_ID, estimate_item_id: LINE_ID, decision: "keep_dpgf", reason: "Quantité contrôlée" },
    inconsistent: () => ({ decision: { ...decisionFixture(), takeoff_job_id: OTHER_ID } }),
  },
  {
    name: "apply", method: "POST", path: "apply", handler: postApply,
    producer: vi.mocked(applyTakeoffJob), valid: application, body: { strategy: "append" },
    inconsistent: () => ({ ...application(), job: { ...appliedJobFixture(), id: OTHER_ID } }),
  },
  {
    name: "conversion preview", method: "POST", path: "preview-conversion", handler: postPreview,
    producer: vi.mocked(previewTakeoffJobConversion), valid: preview, body: { strategy: "append" },
    inconsistent: () => ({ ...preview(), summary: { ...preview().summary, included_count: 0 } }),
  },
  {
    name: "item batch patch", method: "PATCH", path: "items", handler: patchItems,
    producer: vi.mocked(batchUpdateTakeoffItems), valid: partialPatch, body: patchBody,
    inconsistent: () => ({ ...partialPatch(), results: partialPatch().results.reverse() }),
  },
  {
    name: "job comparison", method: "GET", path: `compare?with=${OTHER_ID}`, handler: getComparison,
    producer: vi.mocked(compareTakeoffJobs), valid: comparison,
    inconsistent: () => ({ ...comparison(), summary: { ...comparison().summary, changed: 0 } }),
  },
];

function invoke(route: typeof routes[number]) {
  const request = new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/${route.path}`, {
    method: route.method,
    ...(route.body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(route.body) } : {}),
  });
  return route.handler(request, { params: Promise.resolve({ jobId: JOB_ID, alertId: EVIDENCE_ID }) });
}

describe.each(routes)("takeoff $name route output", (route) => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    route.producer.mockResolvedValue(route.valid() as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the complete domain receipt", async () => {
    const response = await invoke(route);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: route.valid() });
    expect(route.producer).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed producer success as HTTP 500, not request validation", async () => {
    route.producer.mockResolvedValue({ unexpected: "malformed" } as never);
    const response = await invoke(route);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(route.producer).toHaveBeenCalledTimes(1);
  });

  it("rejects unrelated identities or inconsistent counters in an otherwise valid receipt", async () => {
    route.producer.mockResolvedValue(route.inconsistent() as never);
    const response = await invoke(route);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });

  it("preserves the domain conflict and its retryability", async () => {
    route.producer.mockRejectedValue(new TakeoffError({
      status: 409, code: TakeoffErrorCode.CONFLICT, message: "Révision modifiée", retryable: false, jobId: JOB_ID,
    }));
    const response = await invoke(route);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "CONFLICT", message: "Révision modifiée", retryable: false } });
    expect(route.producer).toHaveBeenCalledTimes(1);
  });
});

describe("takeoff partial item receipt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("retains duplicate requested IDs and the sequential partial outcome", async () => {
    const data = partialPatch();
    data.results[1].item_id = OTHER_ID;
    vi.mocked(batchUpdateTakeoffItems).mockResolvedValue(data as never);
    const response = await patchItems(new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/items`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [patchBody.items[0], patchBody.items[0]] }),
    }), { params: Promise.resolve({ jobId: JOB_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
  });

  it("rejects counters claiming success for a failed item", async () => {
    vi.mocked(batchUpdateTakeoffItems).mockResolvedValue({ ...partialPatch(), succeeded: 2, failed: 0 } as never);
    const route = routes.find((entry) => entry.name === "item batch patch")!;
    expect((await invoke(route)).status).toBe(500);
  });
});
