import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redirectMock,
  getUserContextMock,
  isTakeoffEnabledMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  getUserContextMock: vi.fn(),
  isTakeoffEnabledMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth/server", () => ({
  getUserContext: getUserContextMock,
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: isTakeoffEnabledMock,
}));

import AdminTakeoffMappingRulesPage from "@/app/dashboard/admin/takeoff/mapping-rules/page";
import { renderAdminTakeoffMappingRulesPage } from "@/app/dashboard/admin/takeoff/mapping-rules/page-content";

const REDIRECT_ERROR = new Error("NEXT_REDIRECT");

describe("AdminTakeoffMappingRulesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw REDIRECT_ERROR;
    });
    isTakeoffEnabledMock.mockResolvedValue(true);
  });

  it("renders MappingRulesManager for tenant admins when takeoff is enabled", async () => {
    const mappingRulesManagerMock = vi.fn(() => null);

    getUserContextMock.mockResolvedValue({
      userEmail: "admin@test.com",
      tenantId: "tenant-123",
      profile: {
        tenant_role: "admin",
      },
    });

    const pageElement = (await renderAdminTakeoffMappingRulesPage({
      loadManager: async () => mappingRulesManagerMock,
    })) as ReactElement<{ tenantId: string }>;

    expect(isTakeoffEnabledMock).toHaveBeenCalledWith("tenant-123");
    expect(pageElement.type).toBe(mappingRulesManagerMock);
    expect(pageElement.props.tenantId).toBe("tenant-123");
  });

  it("redirects non-admin users to profile", async () => {
    getUserContextMock.mockResolvedValue({
      userEmail: "viewer@test.com",
      tenantId: "tenant-123",
      profile: {
        tenant_role: "viewer",
      },
    });

    await expect(AdminTakeoffMappingRulesPage()).rejects.toBe(REDIRECT_ERROR);

    expect(redirectMock).toHaveBeenCalledWith("/dashboard/profile");
    expect(isTakeoffEnabledMock).not.toHaveBeenCalled();
  });

  it("redirects admins to dashboard when takeoff module is disabled", async () => {
    const loadManagerMock = vi.fn(async () => vi.fn(() => null));

    getUserContextMock.mockResolvedValue({
      userEmail: "admin@test.com",
      tenantId: "tenant-123",
      profile: {
        tenant_role: "admin",
      },
    });
    isTakeoffEnabledMock.mockResolvedValue(false);

    await expect(
      renderAdminTakeoffMappingRulesPage({
        loadManager: loadManagerMock,
      })
    ).rejects.toBe(REDIRECT_ERROR);

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    expect(loadManagerMock).not.toHaveBeenCalled();
  });
});
