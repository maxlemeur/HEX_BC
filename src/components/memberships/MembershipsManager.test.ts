import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useUserContextMock } = vi.hoisted(() => ({
  useUserContextMock: vi.fn(),
}));

vi.mock("@/components/UserContext", () => ({
  useUserContext: useUserContextMock,
}));

import { MembershipsManager } from "@/components/memberships/MembershipsManager";

function createMembershipPayload() {
  return {
    tenant: {
      id: "tenant-1",
      name: "Hydro",
      slug: "hydro",
      is_active: true,
    },
    current_user_id: "u-admin",
    current_membership_role: "admin",
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
        user_legacy_role: "admin",
      },
    ],
    candidates: [
      {
        id: "u-1",
        full_name: "Alice Martin",
        work_email: "alice@example.com",
        role: "buyer",
      },
      {
        id: "u-2",
        full_name: "Bob Durand",
        work_email: "bob@example.com",
        role: "site_manager",
      },
    ],
  };
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MembershipsManager", () => {
  beforeEach(() => {
    useUserContextMock.mockReturnValue({
      profile: {
        tenant_role: "admin",
      },
      tenantId: "tenant-1",
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: createMembershipPayload() }),
    }));

    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders searchable user select and role badges", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(MembershipsManager));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const combobox = renderer!.root.findByProps({ role: "combobox", id: "membership-user" });
    expect(combobox).toBeDefined();

    await act(async () => {
      combobox.props.onFocus();
      combobox.props.onChange({ target: { value: "Alice" } });
    });

    const options = renderer!.root.findAllByProps({ role: "option" });
    expect(options.length).toBeGreaterThan(0);

    const badges = renderer!.root.findAll(
      (node) => node.type === "span" && typeof node.props.className === "string" && node.props.className.includes("ui-badge")
    );
    expect(badges.length).toBeGreaterThan(0);
  });

  it("offers the director role in membership selectors", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(MembershipsManager));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const options = renderer!.root.findAllByType("option");
    const directorOptions = options.filter((option) => option.props.value === "director");

    expect(directorOptions).toHaveLength(2);
    expect(directorOptions.every((option) => option.children.includes("Directeur"))).toBe(
      true
    );
  });
});
