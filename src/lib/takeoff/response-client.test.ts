import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTakeoffJob, cancelTakeoffJob, createTakeoffJob, fetchTakeoffJob, fetchTakeoffJobCompare,
  fetchTakeoffDpgfComparison, fetchTakeoffLineEvidencePanel,
  fetchTakeoffRiskRadar, listTakeoffJobs, patchTakeoffItems, previewTakeoffConversion,
  reconcileTakeoffJob, resubmitTakeoffJob, retryTakeoffJob, saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision, updateTakeoffRiskAlertStatus,
} from "@/lib/takeoff/client";
import { buildTakeoffDiff } from "@/lib/takeoff/diff";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import { comparisonFixture, decisionFixture, evidencePanelFixture } from "@/lib/takeoff/read-contracts.test-fixtures";
import { buildTakeoffRiskRadarResponse } from "@/lib/takeoff/risk-radar";
import { appliedJobFixture, riskAlertFixture, takeoffItemFixture, JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, EVIDENCE_ID, PROJECT_ID, LOT_ID, ACTOR_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const radar = buildTakeoffRiskRadarResponse({ jobId: JOB_ID, versionId: VERSION_ID, projectId: PROJECT_ID,
  projectLabel: "Affaire", lotLabelById: new Map([[LOT_ID, "Plomberie"]]), alerts: [riskAlertFixture()] });
const cases: Array<{ name: string; run: () => Promise<unknown>; data: unknown }> = [
  { name: "DPGF comparison", run: () => fetchTakeoffDpgfComparison(JOB_ID, { version_id: VERSION_ID }), data: comparisonFixture() },
  { name: "line evidence", run: () => fetchTakeoffLineEvidencePanel(JOB_ID, LINE_ID, { version_id: VERSION_ID }), data: evidencePanelFixture() },
  { name: "radar", run: () => fetchTakeoffRiskRadar(JOB_ID, { version_id: VERSION_ID }), data: radar },
  { name: "risk status", run: () => updateTakeoffRiskAlertStatus(JOB_ID, EVIDENCE_ID, { version_id: VERSION_ID, status: "to_process" }), data: { alert: riskAlertFixture() } },
  { name: "manual links", run: () => saveTakeoffDpgfManualLink(JOB_ID, { version_id: VERSION_ID, estimate_item_id: LINE_ID, takeoff_item_ids: [OTHER_ID] }), data: { links: [{
    id: EVIDENCE_ID, tenant_id: ACTOR_ID, takeoff_job_id: JOB_ID, version_id: VERSION_ID, estimate_item_id: LINE_ID,
    takeoff_item_id: OTHER_ID, created_at: NOW, updated_at: NOW, linked_by: null,
  }] } },
  { name: "decision", run: () => saveTakeoffReviewDecision(JOB_ID, { version_id: VERSION_ID, estimate_item_id: LINE_ID, decision: "keep_dpgf", reason: "Quantité contrôlée" }), data: { decision: decisionFixture() } },
  { name: "apply", run: () => applyTakeoffJob(JOB_ID, { strategy: "append" }, VERSION_ID), data: { job: appliedJobFixture(), summary: {
    scope: "version", created_count: 1, updated_count: 0, ignored_count: 0, created_ids: [LINE_ID], item_links: [{ takeoff_item_id: OTHER_ID, estimate_item_id: LINE_ID }],
  } } },
  { name: "preview", run: () => previewTakeoffConversion(JOB_ID, { strategy: "append" }), data: { job_id: JOB_ID, strategy: "append", target_section_id: null,
    ...computeTakeoffMappingPreview({ items: [takeoffItemFixture()], rules: [] }),
  } },
  { name: "partial items", run: () => patchTakeoffItems(JOB_ID, { items: [
    { item_id: OTHER_ID, updated_at: NOW, fields: { quantity: 12.5 } }, { item_id: LINE_ID, updated_at: NOW, fields: { quantity: 2 } },
  ] }), data: { results: [{ item_id: OTHER_ID, success: true, item: takeoffItemFixture() }, { item_id: LINE_ID, success: false, error: "Conflit de concurrence" }], succeeded: 1, failed: 1 } },
  { name: "compare", run: () => fetchTakeoffJobCompare(JOB_ID, { withJobId: OTHER_ID }), data: { base_job_id: JOB_ID, other_job_id: OTHER_ID,
    ...buildTakeoffDiff({ baseItems: [takeoffItemFixture()], otherItems: [takeoffItemFixture({ id: LINE_ID, quantity: 13.5 })] }),
  } },
  { name: "detail", run: () => fetchTakeoffJob(JOB_ID), data: { job: appliedJobFixture(), result: null, items: { data: [takeoffItemFixture()], pagination: { limit: 50, offset: 0, total: 1 } } } },
  { name: "list", run: () => listTakeoffJobs(), data: { jobs: [appliedJobFixture()], counters: { total: 1, processing: 0, completed: 0, failed: 0, canceled: 0 }, pagination: { limit: 20, offset: 0, total: 1 } } },
  { name: "retry", run: () => retryTakeoffJob(JOB_ID), data: { job: { ...appliedJobFixture(), status: "pending" }, command: "retry", outcome: "applied" } },
  { name: "cancel", run: () => cancelTakeoffJob(JOB_ID), data: { job: { ...appliedJobFixture(), status: "canceled" }, command: "cancel", outcome: "applied" } },
  { name: "reconcile", run: () => reconcileTakeoffJob(JOB_ID), data: { job: appliedJobFixture(), command: "reconcile", outcome: "noop" } },
  { name: "resubmit", run: () => resubmitTakeoffJob(JOB_ID), data: { job: { ...appliedJobFixture(), status: "pending" }, command: "resubmit", outcome: "applied" } },
];

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("validated takeoff client responses", () => {
  it.each(cases)("preserves a legitimate $name response", async ({ run, data }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, data }));
    vi.stubGlobal("fetch", fetch);
    expect(await run()).toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(cases)("rejects malformed $name output without replaying the request", async ({ run }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { unexpected: "malformed" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(run()).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  for (const shape of ["string ok", "missing ok", "contradictory error", "false ok"] as const) {
    it.each(cases)(`rejects ${shape} success envelopes for $name even with valid data`, async ({ run, data }) => {
      const envelope = shape === "string ok" ? { ok: "yes", data }
        : shape === "missing ok" ? { data }
        : shape === "contradictory error" ? { ok: true, data, error: null }
        : { ok: false, data };
      const fetch = vi.fn().mockResolvedValue(Response.json(envelope));
      vi.stubGlobal("fetch", fetch);
      await expect(run()).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
  it.each(cases)("preserves a deterministic refusal for $name", async ({ run }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: false, error: { code: "FORBIDDEN", message: "Accès refusé" } }, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(run()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["detail", "list", "compare", "radar"])("retains caller cancellation for %s", async (read) => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const signal = controller.signal;
    const request = read === "detail" ? fetchTakeoffJob(JOB_ID, { signal })
      : read === "list" ? listTakeoffJobs({}, { signal })
      : read === "compare" ? fetchTakeoffJobCompare(JOB_ID, { withJobId: OTHER_ID, signal })
      : fetchTakeoffRiskRadar(JOB_ID, { version_id: VERSION_ID }, { signal });
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("validated takeoff XHR creation response", () => {
  function mockXhr(data: unknown, envelope?: unknown) {
    const send = vi.fn();
    class Xhr {
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify(envelope ?? { ok: true, data });
      onload: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send() { send(); this.onload?.(); }
    }
    vi.stubGlobal("XMLHttpRequest", Xhr);
    return send;
  }
  const input = { estimateVersionId: VERSION_ID, level: "A" as const, file: new File(["source"], "source.csv", { type: "text/csv" }) };
  const data = { id: JOB_ID, estimate_version_id: VERSION_ID, level: "A", status: "completed", source_file_name: "source.csv", created_at: NOW,
    dispatch: { status: "accepted", correlation_id: OTHER_ID, persisted: false } };
  it("retains an advanced idempotency replay and final dispatch data", async () => {
    const send = mockXhr(data);
    expect(await createTakeoffJob(input)).toEqual(data);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([{ estimate_version_id: OTHER_ID }, { level: "C" }, { status: "invalid" }, { dispatch: { ...data.dispatch, persisted: "yes" } }])("rejects malformed creation output without uploading again %#", async (patch) => {
    const send = mockXhr({ ...data, ...patch });
    await expect(createTakeoffJob(input)).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ok: "yes", data }, { data }, { ok: true, data, error: { message: "Contradiction" } }, { ok: false, data },
  ])("rejects inconsistent XHR envelopes with valid creation data %#", async (envelope) => {
    const send = mockXhr(data, envelope);
    await expect(createTakeoffJob(input)).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
