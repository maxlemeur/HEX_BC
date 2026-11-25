import { describe, expect, it } from "vitest";

import { shardTimingHistory } from "../../scripts/tester-army/shard-timings.mjs";

const intake = "e2e/army/local/chatgpt-local-intake.e2e.ts";
const unmeasured = "e2e/army/critical/new-journey.e2e.ts";
const takeoff = "e2e/army/takeoff/review.e2e.ts";
const decisions = "e2e/army/local/chatgpt-local-decisions.e2e.ts";
const lab = "e2e/army/local/takeoff-lab.e2e.ts";

describe("TesterArmy shard timing history", () => {
  it("seeds each selected file with integer milliseconds under its desktop target key", () => {
    const durations = { schemaVersion: 1, defaultSeconds: 20, seconds: { [intake]: 494.125, [takeoff]: 81 } };

    expect(shardTimingHistory([intake, unmeasured], durations)).toEqual({
      schemaVersion: "timings-1",
      files: {
        [`chromium-desktop::${intake}`]: 494_125,
        [`chromium-desktop::${unmeasured}`]: 20_000,
      },
    });
  });

  it("serializes the same history regardless of selection order", () => {
    const durations = { schemaVersion: 1, defaultSeconds: 20, seconds: { [takeoff]: 81 } };
    const forward = shardTimingHistory([unmeasured, takeoff], durations);
    const reverse = shardTimingHistory([takeoff, unmeasured], durations);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reverse));
    expect(forward?.files[`chromium-desktop::${takeoff}`]).toBe(81_000);
  });

  it("falls back to the default when a file has an invalid measurement", () => {
    const durations = { schemaVersion: 1, defaultSeconds: 20, seconds: { [intake]: Infinity } };

    expect(shardTimingHistory([intake], durations)?.files[`chromium-desktop::${intake}`]).toBe(20_000);
  });

  it("starts the isolated dev-server file first and leaves its companions tied in collection order", () => {
    const durations = {
      schemaVersion: 1, defaultSeconds: 20, neverTogether: [[intake, decisions]],
      seconds: { [intake]: 494, [lab]: 53 },
    };

    expect(shardTimingHistory([lab, intake, unmeasured], durations)?.files).toEqual({
      [`chromium-desktop::${unmeasured}`]: 0,
      [`chromium-desktop::${intake}`]: 494_000,
      [`chromium-desktop::${lab}`]: 0,
    });
  });

  it("leaves the native queue in use if an explicit list contains multiple isolated dev-server files", () => {
    const durations = { schemaVersion: 1, defaultSeconds: 20, neverTogether: [[intake, decisions]] };

    expect(shardTimingHistory([decisions, intake], durations)).toBeNull();
  });

  it("leaves native runner history in use when the shard durations are unusable", () => {
    expect(shardTimingHistory([intake], null)).toBeNull();
    expect(shardTimingHistory([intake], { schemaVersion: 2, defaultSeconds: 20 })).toBeNull();
    expect(shardTimingHistory([intake], { schemaVersion: 1, defaultSeconds: 0 })).toBeNull();
  });
});
