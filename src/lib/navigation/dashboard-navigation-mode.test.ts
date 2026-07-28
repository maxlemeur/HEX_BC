import { describe, expect, it } from "vitest";

import { isDashboardNavItemActive } from "./dashboard-nav-active";
import {
  getDashboardNavigationMode,
  isProductionWorkspaceRoute,
} from "./dashboard-navigation-mode";

describe("getDashboardNavigationMode", () => {
  it.each([
    "/dashboard",
    "/dashboard/affaires",
    "/dashboard/orders",
    "/dashboard/approvals",
    "/dashboard/referentiel",
    "/dashboard/admin",
    "/dashboard/estimates/version-1/edit",
    "/dashboard/affaires/project-1/takeoff/job-1/review",
  ])("uses the universal topbar navigation on %s", (pathname) => {
    expect(getDashboardNavigationMode(pathname)).toBe("workspace");
  });
});

describe("isProductionWorkspaceRoute", () => {
  it.each([
    "/dashboard/estimates/version-1/edit",
    "/dashboard/estimates/version-1/takeoff",
    "/dashboard/estimates/version-1/takeoff/job-1/review",
    "/dashboard/affaires/project-1/takeoff",
    "/dashboard/affaires/project-1/takeoff/job-1/review",
  ])("identifies dense production routes at %s", (pathname) => {
    expect(isProductionWorkspaceRoute(pathname)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/dashboard/affaires",
    "/dashboard/affaires/project-1",
    "/dashboard/orders",
    "/dashboard/admin",
  ])("keeps standard pages outside the production layout at %s", (pathname) => {
    expect(isProductionWorkspaceRoute(pathname)).toBe(false);
  });
});
describe("isDashboardNavItemActive", () => {
  it("keeps estimate editing in the Affaires workspace", () => {
    const pathname = "/dashboard/estimates/version-1/edit";

    expect(
      isDashboardNavItemActive(pathname, "/dashboard/affaires")
    ).toBe(true);
    expect(
      isDashboardNavItemActive(pathname, "/dashboard/affaires/project-1/takeoff")
    ).toBe(false);
  });

  it("selects the takeoff destination without also selecting Affaires", () => {
    const pathname = "/dashboard/affaires/project-1/takeoff/job-1/review";

    expect(
      isDashboardNavItemActive(pathname, "/dashboard/affaires/project-1/takeoff")
    ).toBe(true);
    expect(
      isDashboardNavItemActive(pathname, "/dashboard/affaires")
    ).toBe(false);
  });

  it("maps secondary catalogue routes to the Référentiel destination", () => {
    expect(
      isDashboardNavItemActive(
        "/dashboard/suppliers/supplier-1",
        "/dashboard/referentiel"
      )
    ).toBe(true);
  });
});