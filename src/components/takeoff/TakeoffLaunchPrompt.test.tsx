import { describe,expect,it,vi } from "vitest";

import { shouldShowTakeoffPrompt } from "@/components/takeoff/TakeoffLaunchPrompt";

const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";

describe("shouldShowTakeoffPrompt", () => {
  const BASE = {
    takeoffEnabled: true,
    planFileCount: 3,
    defaultPlanSetId: PLAN_SET_ID,
    defaultPlanSetUpdatedAt: "2026-03-10T09:00:00.000Z",
    latestJob: null,
    targetVersionId: VERSION_ID,
    hasLaunchableVersionTarget: true,
    permanentlyDismissed: false,
    temporarilyDismissed: false,
  };

  it("returns true when the same plan set changed after the last job", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        defaultPlanSetUpdatedAt: "2026-03-10T11:00:00.000Z",
        latestJob: {
          status: "completed",
          planSetId: PLAN_SET_ID,
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns true when the latest job targets another plan set", () => {
    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: {
          status: "completed",
          planSetId: "other-set",
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("returns true when the latest job used another source version", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        targetVersionId: "99999999-9999-4999-8999-999999999999",
        latestJob: {
          status: "completed",
          planSetId: PLAN_SET_ID,
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);

    vi.useRealTimers();
  });
});
