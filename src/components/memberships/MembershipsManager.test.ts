import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("MembershipsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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
    const { container } = render(createElement(MembershipsManager));

    const combobox = await screen.findByRole("combobox", { name: "Utilisateur" });
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "Alice" } });

    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".ui-badge").length).toBeGreaterThan(0);
  });

  it("offers the director role in membership selectors", async () => {
    render(createElement(MembershipsManager));

    await screen.findByRole("combobox", { name: "Utilisateur" });
    const directorOptions = screen
      .getAllByRole("option")
      .filter((option) => (option as HTMLOptionElement).value === "director");

    expect(directorOptions).toHaveLength(2);
    expect(directorOptions.every((option) => option.textContent === "Directeur")).toBe(
      true
    );
  });
});
