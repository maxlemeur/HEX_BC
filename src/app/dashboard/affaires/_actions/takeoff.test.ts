import { beforeEach, describe, expect, it, vi } from "vitest";

const createTakeoffJobFromPlanSetMock = vi.hoisted(() => vi.fn());
const triggerTakeoffJobProcessingMock = vi.hoisted(() => vi.fn());
const duplicateEstimateVersionMock = vi.hoisted(() => vi.fn());
const deleteEstimateVersionMock = vi.hoisted(() => vi.fn());
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
    supabase: {
      from: vi.fn(() => ({
        delete: deleteEstimateVersionMock,
      })),
    },
  })),
}));

vi.mock("@/lib/takeoff/server", () => ({
  createTakeoffJobFromPlanSet: createTakeoffJobFromPlanSetMock,
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: triggerTakeoffJobProcessingMock,
}));

vi.mock("@/lib/takeoff/dispatch-state", () => ({
  persistTakeoffDispatchOutcome: persistTakeoffDispatchOutcomeMock,
}));

import { revalidatePath } from "next/cache";
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
    deleteEstimateVersionMock.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
  });

  it("validates input with zod (rejects bad UUIDs)", async () => {
    await expect(
      launchTakeoffFromPlanSet({
        projectId: "not-a-uuid",
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
        level: "B",
      }),
    ).rejects.toThrow();
  });

  it("calls createTakeoffJobFromPlanSet with correct args", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const result = await launchTakeoffFromPlanSet({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
      level: "B",
    });

    expect(createTakeoffJobFromPlanSetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      estimateVersionId: VERSION_ID,
      level: "B",
    });
    expect(result).toEqual({
      jobId: JOB_ID,
      dispatch: {
        status: "accepted",
        correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        persisted: true,
      },
    });
  });

  it("calls triggerTakeoffJobProcessing with created job id", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await launchTakeoffFromPlanSet({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
      level: "B",
    });

    expect(triggerTakeoffJobProcessingMock).toHaveBeenCalledWith({
      jobId: JOB_ID,
      trigger: "create",
    });
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

  it("calls revalidatePath for hub and takeoff pages", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await launchTakeoffFromPlanSet({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
      level: "B",
    });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`,
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}/takeoff`,
    );
  });

  it("passes through level C when requested", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await launchTakeoffFromPlanSet({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
      level: "C",
    });

    expect(createTakeoffJobFromPlanSetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      estimateVersionId: VERSION_ID,
      level: "C",
    });
  });

  it("rejects level A for plan-set launches", async () => {
    await expect(
      launchTakeoffFromPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
        level: "A" as "B",
      }),
    ).rejects.toThrow();
  });
});

describe("launchTakeoffFromSourceVersionPlanSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteEstimateVersionMock.mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
  });

  it("duplicates the source version before launching takeoff", async () => {
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const result = await launchTakeoffFromSourceVersionPlanSet({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      sourceVersionId: "55555555-5555-4555-8555-555555555555",
      level: "B",
    });

    expect(duplicateEstimateVersionMock).toHaveBeenCalledWith(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(result).toEqual({
      jobId: JOB_ID,
      versionId: VERSION_ID,
      dispatch: {
        status: "accepted",
        correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        persisted: true,
      },
    });
  });

  it("rolls back the duplicated draft when launch creation fails", async () => {
    const deleteEqMock = vi.fn().mockReturnThis();
    deleteEstimateVersionMock.mockReturnValue({
      eq: deleteEqMock,
    });
    duplicateEstimateVersionMock.mockResolvedValue({ version_id: VERSION_ID });
    createTakeoffJobFromPlanSetMock.mockRejectedValue(new Error("launch failed"));

    await expect(
      launchTakeoffFromSourceVersionPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        sourceVersionId: "55555555-5555-4555-8555-555555555555",
        level: "C",
      }),
    ).rejects.toThrow("launch failed");

    expect(deleteEstimateVersionMock).toHaveBeenCalledOnce();
    expect(deleteEqMock).toHaveBeenNthCalledWith(1, "id", VERSION_ID);
    expect(deleteEqMock).toHaveBeenNthCalledWith(2, "tenant_id", "tenant-1");
    expect(deleteEqMock).toHaveBeenNthCalledWith(3, "status", "draft");
    expect(deleteEqMock).toHaveBeenNthCalledWith(
      4,
      "parent_version_id",
      "55555555-5555-4555-8555-555555555555",
    );
  });

  it("rejects level A before duplicating a source version", async () => {
    await expect(
      launchTakeoffFromSourceVersionPlanSet({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        sourceVersionId: "55555555-5555-4555-8555-555555555555",
        level: "A" as "B",
      }),
    ).rejects.toThrow();

    expect(duplicateEstimateVersionMock).not.toHaveBeenCalled();
  });
});
