import { describe, expect, it } from "vitest";

import {
  REQUIRED_MUTATING_ROUTE_FILES,
  assertRequiredRouteTests,
  findRoutesWithoutColocatedTests,
} from "./routes-without-tests";

describe("API routes without colocated tests", () => {
  it("warns about route.ts files that lack route.test.ts", () => {
    const missing = findRoutesWithoutColocatedTests();
    if (missing.length > 0) {
      console.warn(
        `Routes without colocated route.test.ts (${missing.length}):\n${missing
          .map((routeFile) => `- ${routeFile}`)
          .join("\n")}`
      );
    }

    expect(Array.isArray(missing)).toBe(true);
  });

  it("requires colocated tests for mutating directory routes from this remediation", () => {
    expect(REQUIRED_MUTATING_ROUTE_FILES).toEqual([
      "src/app/api/products/route.ts",
      "src/app/api/suppliers/route.ts",
    ]);
    expect(assertRequiredRouteTests()).toEqual([]);
  });
});
