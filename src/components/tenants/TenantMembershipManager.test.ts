import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useUserContextMock } = vi.hoisted(() => ({
  useUserContextMock: vi.fn(),
}));

vi.mock("@/components/UserContext", () => ({
  useUserContext: useUserContextMock,
}));

import { TenantMembershipManager } from "@/components/tenants/TenantMembershipManager";

function createTenantMembershipPayload() {
  return {
    tenant: {
      id: "tenant-1",
      name: "Hydro",
      slug: "hydro",
      is_active: true,
    },
    current_user_id: "u-admin",
    memberships: [
      {
        id: "m-1",
        user_id: "u-admin",
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        user_full_name: "Admin User",
        user_work_email: "admin@example.com",
        user_job_title: "Director",
      },
    ],
  };
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TenantMembershipManager", () => {
  beforeEach(() => {
    useUserContextMock.mockReturnValue({
      profile: {
        tenant_role: "admin",
      },
      tenantId: "tenant-1",
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: createTenantMembershipPayload() }),
    }));

    vi.stubGlobal("fetch", fetchMock);
  });

  it("offers the director role in tenant membership selectors", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(TenantMembershipManager));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const options = renderer!.root.findAllByType("option");
    const directorOptions = options.filter((option) => option.props.value === "director");

    expect(directorOptions).toHaveLength(1);
    expect(directorOptions[0]?.children).toContain("Directeur");
  });
});
