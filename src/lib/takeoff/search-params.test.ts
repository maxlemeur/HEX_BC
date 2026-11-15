import { describe, expect, it } from "vitest";

import { coerceNumericSearchParam } from "@/lib/takeoff/schemas";

describe("coerceNumericSearchParam", () => {
  it.each([
    [undefined, undefined],
    [null, undefined],
    ["", undefined],
    ["   ", undefined],
    [" 25 ", 25],
    ["2.5", 2.5],
    [7, 7],
    ["abc", "abc"],
    ["Infinity", "Infinity"],
    [true, true],
  ])("coerces %j to %j", (input, expected) => {
    expect(coerceNumericSearchParam(input)).toBe(expected);
  });
});
