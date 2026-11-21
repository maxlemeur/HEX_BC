import { describe, expect, it } from "vitest";
import { readDefaultOnTakeoffFlag } from "@/lib/takeoff/default-on-flags";

describe("takeoff default-on configuration", () => {
  it.each([[undefined, true], ["0", false], ["1", true]])("reads %s as %s", (value, enabled) => {
    expect(readDefaultOnTakeoffFlag("MERGEONE_TAKEOFF_VECTORS", value)).toBe(enabled);
  });

  it.each(["", "false", " 1", "2"])("reports an invalid value %j without logging it", (value) => {
    expect(() => readDefaultOnTakeoffFlag("MERGEONE_TAKEOFF_RULES", value)).toThrow("MERGEONE_TAKEOFF_RULES");
  });
});
