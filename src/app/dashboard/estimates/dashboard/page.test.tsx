import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import LegacyEstimateDashboardPage from "./page";

describe("LegacyEstimateDashboardPage", () => {
  it("redirects the legacy dashboard to performances", () => {
    LegacyEstimateDashboardPage();
    expect(redirectMock).toHaveBeenCalledWith("/dashboard/analytics");
  });
});
