import { describe, expect, it } from "vitest";

import { FIXTURE_A_ENGINE } from "./estimate-calculations.golden/fixtures";

describe("estimate-calculations goldens", () => {
  it("keeps regime fixtures reachable from the original entry file", () => {
    expect(FIXTURE_A_ENGINE.discountCents).toBe(5_000);
  });
});
