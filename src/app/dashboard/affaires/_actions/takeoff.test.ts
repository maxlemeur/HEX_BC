import { beforeEach, describe, expect, it, vi } from "vitest";

const createTakeoffJobFromPlanSetMock = vi.hoisted(() => vi.fn());
const triggerTakeoffJobProcessingMock = vi.hoisted(() => vi.fn());
const duplicateEstimateVersionMock = vi.hoisted(() => vi.fn());
const deleteEstimateVersionMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/estimates/server", () => ({
  duplicateEstimateVersion: duplicateEstimateVersionMock,
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
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true });

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
    expect(result).toEqual({ jobId: JOB_ID });
  });

  it("calls triggerTakeoffJobProcessing with created job id", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true });

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

  it("calls revalidatePath for hub and takeoff pages", async () => {
    createTakeoffJobFromPlanSetMock.mockResolvedValue({ id: JOB_ID });
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true });

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
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true });

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
    triggerTakeoffJobProcessingMock.mockResolvedValue({ triggered: true });

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
