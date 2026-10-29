import { describe, expect, it } from "vitest";
import {
  parseTakeoffJobActionResponse, parseTakeoffJobCreateResponse, parseTakeoffJobDetailResponse, parseTakeoffJobListResponse,
} from "@/lib/takeoff/job-response-contracts";
import { appliedJobFixture, takeoffItemFixture, JOB_ID, VERSION_ID, OTHER_ID, LINE_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const dispatch = { status: "accepted", correlation_id: OTHER_ID, persisted: false };
function creation() {
  return { id: JOB_ID, estimate_version_id: VERSION_ID, status: "applied", level: "A", source_file_name: "plans.pdf", created_at: NOW, dispatch };
}
function detail() {
  return { job: appliedJobFixture(), result: {
    id: LINE_ID, extracted_json: { items: [] }, warnings: [], tables: [], provider_meta: { source: "provider" }, raw_response: null,
    confidence: 0.9, token_count: 100, cost_cents: 1, duration_ms: 1000, created_at: NOW, updated_at: NOW,
  }, items: { data: [takeoffItemFixture()], pagination: { limit: 50, offset: 0, total: 1 } } };
}
function listing() {
  return { jobs: [appliedJobFixture()], counters: { total: 1, processing: 0, completed: 0, failed: 0, canceled: 0 },
    pagination: { limit: 20, offset: 0, total: 1 } };
}

describe("takeoff job transport response contracts", () => {
  it.each(["pending", "processing", "completed", "failed", "canceled", "applied"])("accepts creation idempotency replay at persisted status %s", (status) => {
    const data = { ...creation(), status };
    expect(parseTakeoffJobCreateResponse(data, { versionId: VERSION_ID.toUpperCase(), level: "A" })).toEqual(data);
  });
  it("retains old creation responses without dispatch and all declared levels", () => {
    const data = { ...creation(), dispatch: undefined };
    for (const level of ["A", "B", "C"] as const) expect(parseTakeoffJobCreateResponse({ ...data, level }, { versionId: VERSION_ID, level }).level).toBe(level);
  });
  it.each([
    { estimate_version_id: OTHER_ID }, { level: "B" }, { status: "unknown" }, { created_at: "invalid" },
    { dispatch: { ...dispatch, correlation_id: "invalid" } },
    { dispatch: { ...dispatch, status: "queued_for_recovery", persisted: false } },
    { dispatch: { ...dispatch, status: "persistence_unconfirmed", persisted: true } },
  ])("rejects inconsistent creation output %#", (patch) => {
    expect(() => parseTakeoffJobCreateResponse({ ...creation(), ...patch }, { versionId: VERSION_ID, level: "A" })).toThrow();
  });
  it("retains real detail fields, nullable results and pages beyond the last item", () => {
    expect(parseTakeoffJobDetailResponse(detail(), { jobId: JOB_ID })).toEqual(detail());
    const emptyPage = { job: appliedJobFixture(), result: null, items: { data: [], pagination: { limit: 50, offset: 5, total: 1 } } };
    expect(parseTakeoffJobDetailResponse(emptyPage, { jobId: JOB_ID, itemsOffset: 5 })).toEqual(emptyPage);
  });
  it.each([
    { job: { ...appliedJobFixture(), id: OTHER_ID } },
    { result: { ...detail().result, confidence: 2 } }, { result: { ...detail().result, raw_response: undefined } },
    { items: { ...detail().items, data: [takeoffItemFixture(), takeoffItemFixture()] } },
    { items: { ...detail().items, pagination: { limit: 50, offset: 2, total: 1 } } },
  ])("rejects invalid detail data or requested page affinity %#", (patch) => {
    expect(() => parseTakeoffJobDetailResponse({ ...detail(), ...patch }, { jobId: JOB_ID })).toThrow();
  });
  it("does not require pending and applied jobs in the four named status buckets", () => {
    expect(parseTakeoffJobListResponse(listing())).toEqual(listing());
    const filtered = { ...listing(), counters: { ...listing().counters, total: 3, failed: 2 } };
    expect(parseTakeoffJobListResponse(filtered, { status: "applied", versionId: VERSION_ID, level: "A" })).toEqual(filtered);
  });
  it.each([
    { counters: { ...listing().counters, failed: 2 } },
    { jobs: [appliedJobFixture(), appliedJobFixture()] },
    { pagination: { limit: 20, offset: 0, total: 2 } },
    { pagination: { limit: 10, offset: 0, total: 1 } },
  ])("rejects inconsistent job lists %#", (patch) => {
    expect(() => parseTakeoffJobListResponse({ ...listing(), ...patch })).toThrow();
  });
  it.each([{ status: "failed" as const }, { level: "C" as const }, { versionId: OTHER_ID }, { offset: 1 }])("checks available list query identities %#", (query) => {
    expect(() => parseTakeoffJobListResponse(listing(), query)).toThrow();
  });
  it.each(["retry", "cancel", "resubmit", "reconcile"] as const)("accepts %s with the producer state and optional dispatch", (command) => {
    const job = { ...appliedJobFixture(), status: command === "cancel" ? "canceled" : command === "reconcile" ? "processing" : "pending" };
    const data = { job, command, outcome: "applied", ...(command !== "cancel" ? { dispatch } : {}) };
    expect(parseTakeoffJobActionResponse(data, { jobId: JOB_ID.toUpperCase(), command })).toEqual(data);
  });
  it("retains reconcile no-ops at terminal states and legacy job-only action receipts", () => {
    const noop = { job: appliedJobFixture(), command: "reconcile", outcome: "noop" };
    expect(parseTakeoffJobActionResponse(noop, { jobId: JOB_ID, command: "reconcile" })).toEqual(noop);
    const legacy = { job: { ...appliedJobFixture(), status: "pending" } };
    expect(parseTakeoffJobActionResponse(legacy, { jobId: JOB_ID, command: "retry" })).toEqual(legacy);
  });
  it.each([
    { job: { ...appliedJobFixture(), status: "pending", id: OTHER_ID } }, { command: "cancel" }, { outcome: "noop" },
    { job: { ...appliedJobFixture(), status: "completed" } },
  ])("rejects unrelated action receipts %#", (patch) => {
    expect(() => parseTakeoffJobActionResponse({ job: { ...appliedJobFixture(), status: "pending" }, command: "retry", outcome: "applied", ...patch }, { jobId: JOB_ID, command: "retry" })).toThrow();
  });
  it("rejects a reconcile no-op announcing a dispatch", () => {
    expect(() => parseTakeoffJobActionResponse({ job: appliedJobFixture(), command: "reconcile", outcome: "noop", dispatch }, { jobId: JOB_ID, command: "reconcile" })).toThrow();
  });
});
