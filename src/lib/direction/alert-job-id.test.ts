import { describe, expect, it } from "vitest";

import { resolveAlertJobId } from "@/lib/takeoff/risk-radar";
import type { TakeoffRiskAlert } from "@/lib/takeoff/types";

function alert(fields: { takeoff_job_id?: unknown; metadata?: unknown }) {
  return { takeoff_job_id: null, metadata: {}, ...fields } as unknown as TakeoffRiskAlert;
}

describe("resolveAlertJobId", () => {
  it("prefers the alert's own takeoff_job_id column", () => {
    expect(resolveAlertJobId(alert({ takeoff_job_id: "job-column", metadata: { takeoff_job_id: "job-meta" } }))).toBe("job-column");
  });

  it("falls back to metadata.takeoff_job_id, then metadata.takeoffJobId", () => {
    expect(resolveAlertJobId(alert({ metadata: { takeoff_job_id: "job-snake", takeoffJobId: "job-camel" } }))).toBe("job-snake");
    expect(resolveAlertJobId(alert({ metadata: { takeoff_job_id: 42, takeoffJobId: "job-camel" } }))).toBe("job-camel");
  });

  it("returns null without a string job id anywhere", () => {
    expect(resolveAlertJobId(alert({ metadata: null }))).toBeNull();
    expect(resolveAlertJobId(alert({ metadata: "job-in-a-string" }))).toBeNull();
    expect(resolveAlertJobId(alert({ metadata: { takeoffJobId: 7 } }))).toBeNull();
  });
});
