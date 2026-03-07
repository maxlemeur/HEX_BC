import { beforeEach, describe, expect, it, vi } from "vitest";

const createTakeoffJobFromPlanSetMock = vi.hoisted(() => vi.fn());
const triggerTakeoffJobProcessingMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/takeoff/server", () => ({
  createTakeoffJobFromPlanSet: createTakeoffJobFromPlanSetMock,
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: triggerTakeoffJobProcessingMock,
}));

import { revalidatePath } from "next/cache";
import { launchTakeoffFromPlanSet } from "@/app/dashboard/affaires/_actions/takeoff";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_SET_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";

describe("launchTakeoffFromPlanSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates input with zod (rejects bad UUIDs)", async () => {
    await expect(
      launchTakeoffFromPlanSet({
        projectId: "not-a-uuid",
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
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
    });

    expect(createTakeoffJobFromPlanSetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      estimateVersionId: VERSION_ID,
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
    });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}`,
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      `/dashboard/affaires/${PROJECT_ID}/takeoff`,
    );
  });
});
