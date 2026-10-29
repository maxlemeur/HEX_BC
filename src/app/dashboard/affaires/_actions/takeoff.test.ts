import { beforeEach, describe, expect, it, vi } from "vitest";

const createTakeoffJobFromPlanSetMock = vi.hoisted(() => vi.fn());
const findTakeoffJobForPlanSetLaunchMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const assertConfirmedTakeoffPreparationMock = vi.hoisted(() => vi.fn());
const triggerTakeoffJobProcessingMock = vi.hoisted(() => vi.fn());
const duplicateEstimateVersionMock = vi.hoisted(() => vi.fn());
const recordCopyMock = vi.hoisted(() => vi.fn());
const findCopyReceiptMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const unexpectedMutationMock = vi.hoisted(() => vi.fn());
const persistTakeoffDispatchOutcomeMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(true)
);

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/estimates/server", () => ({
  duplicateEstimateVersion: duplicateEstimateVersionMock,
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(() => ({
    tenantId: "tenant-1",
    userId: "actor-1",
    supabase: { from: () => ({ delete: unexpectedMutationMock }) },
  })),
}));
vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ getTakeoffExecutionOwner: vi.fn().mockResolvedValue({ execution_provider: "chatgpt_local", execution_host_id: "fixture-host" }) }));

vi.mock("@/lib/takeoff/server", () => ({
  createTakeoffJobFromPlanSet: createTakeoffJobFromPlanSetMock,
  findTakeoffJobForPlanSetLaunch: findTakeoffJobForPlanSetLaunchMock,
}));
vi.mock("@/lib/takeoff/preparation-server", () => ({ assertConfirmedTakeoffPreparation: assertConfirmedTakeoffPreparationMock }));
vi.mock("@/lib/takeoff/preparation-copy-provenance-server", () => ({ recordTakeoffPreparationCopy: recordCopyMock, findTakeoffPreparationCopyReceipt: findCopyReceiptMock }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({
  rpc: unexpectedMutationMock,
  from: () => ({ delete: unexpectedMutationMock }),
}) }));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: triggerTakeoffJobProcessingMock,
}));

vi.mock("@/lib/takeoff/dispatch-state", () => ({
  persistTakeoffDispatchOutcome: persistTakeoffDispatchOutcomeMock,
}));
import {
  launchTakeoffFromPlanSet,
  launchTakeoffFromSourceVersionPlanSet,
} from "@/app/dashboard/affaires/_actions/takeoff";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_SET_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";

describe("launchTakeoffFromPlanSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a durable recovery state when the immediate trigger fails", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: false,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    await expect(
      launchTakeoffFromPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
        level: "B",
      })
    ).resolves.toMatchObject({
      jobId: JOB_ID,
      dispatch: {
        status: "queued_for_recovery",
        correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        persisted: true,
      },
    });
  });

  it("does not claim durable recovery when dispatch persistence also fails", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: false,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      statusCode: null,
      outcome: "timeout",
    });
    persistTakeoffDispatchOutcomeMock.mockResolvedValueOnce(false);

    await expect(
      launchTakeoffFromPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
        level: "B",
      })
    ).resolves.toMatchObject({
      jobId: JOB_ID,
      dispatch: {
        status: "persistence_unconfirmed",
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        persisted: false,
      },
    });
  });
});

describe("launchTakeoffFromSourceVersionPlanSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the normal copied draft and its receipt when launch creation fails", async () => {
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockRejectedValue(new Error("launch failed"));

    await expect(
      launchTakeoffFromSourceVersionPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        sourceVersionId: "55555555-5555-4555-8555-555555555555",
        level: "C",
        preparationRevision: 2,
      }),
    ).rejects.toThrow("launch failed");

    expect(recordCopyMock).toHaveBeenCalledOnce();
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });

  it("requires confirmed preparation before creating a business version", async () => {
    assertConfirmedTakeoffPreparationMock.mockRejectedValueOnce(new Error("Confirmez la préparation"));
    await expect(launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID, sourceVersionId: VERSION_ID, preparationRevision: 2, level: "B" }))
      .rejects.toThrow("Confirmez la préparation");
    expect(duplicateEstimateVersionMock).not.toHaveBeenCalled();
    expect(createTakeoffJobFromPlanSetMock).not.toHaveBeenCalled();
  });

  it("recovers an existing launch after a lost response without duplicating the version", async () => {
    findTakeoffJobForPlanSetLaunchMock.mockResolvedValueOnce({ id: JOB_ID, estimate_version_id: VERSION_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true, correlationId: "replayed" });
    const result = await launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID, sourceVersionId: VERSION_ID, preparationRevision: 2, level: "B" });
    expect(result).toMatchObject({ jobId: JOB_ID, versionId: VERSION_ID });
    expect(duplicateEstimateVersionMock).not.toHaveBeenCalled();
    expect(createTakeoffJobFromPlanSetMock).not.toHaveBeenCalled();
  });

  it("returns the existing job while preserving the extra copy from a concurrent launch", async () => {
    const winnerVersion = "77777777-7777-4777-8777-777777777777";
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID, estimate_version_id: winnerVersion });
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true, correlationId: "winner" });
    const result = await launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID, sourceVersionId: VERSION_ID, preparationRevision: 2, level: "B" });
    expect(result.versionId).toBe(winnerVersion);
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });

  it("records the returned normal copy before launch and never deletes it when dispatch fails", async () => {
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID, estimate_version_id: VERSION_ID });
    triggerTakeoffJobProcessingMock.mockRejectedValueOnce(new Error("dispatch interrupted"));
    await expect(launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID,
      sourceVersionId: "55555555-5555-4555-8555-555555555555", preparationRevision: 2, level: "B" })).rejects.toThrow("dispatch interrupted");
    expect(recordCopyMock).toHaveBeenCalledWith(expect.objectContaining({ sourceVersionId: "55555555-5555-4555-8555-555555555555", targetVersionId: VERSION_ID, projectId: PROJECT_ID, preparationRevision: 2 }));
    expect(recordCopyMock.mock.invocationCallOrder[0]).toBeLessThan(createTakeoffJobFromPlanSetMock.mock.invocationCallOrder[0]);
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });

  it("preserves a normal copy whose job persisted before the creation response was lost", async () => {
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockRejectedValueOnce(new Error("creation response lost"));
    await expect(launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID,
      sourceVersionId: "55555555-5555-4555-8555-555555555555", preparationRevision: 2, level: "B" })).rejects.toThrow("creation response lost");
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });

  it("preserves a draft when recording its creation receipt fails", async () => {
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    recordCopyMock.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID,
      sourceVersionId: "55555555-5555-4555-8555-555555555555", preparationRevision: 2, level: "B" })).rejects.toThrow("receipt unavailable");
    expect(createTakeoffJobFromPlanSetMock).not.toHaveBeenCalled();
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });

  it("resumes a receipt-persisted ordinary copy instead of creating another version", async () => {
    findCopyReceiptMock.mockResolvedValueOnce({ targetVersionId: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID, estimate_version_id: VERSION_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true, correlationId: "resumed-copy" });
    const result = await launchTakeoffFromSourceVersionPlanSet({ projectId: PROJECT_ID, planSetId: PLAN_SET_ID,
      sourceVersionId: "55555555-5555-4555-8555-555555555555", preparationRevision: 2, level: "B" });
    expect(result.versionId).toBe(VERSION_ID);
    expect(duplicateEstimateVersionMock).not.toHaveBeenCalled();
    expect(recordCopyMock).not.toHaveBeenCalled();
    expect(unexpectedMutationMock).not.toHaveBeenCalled();
  });
});
