import { describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`redirect ${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/server", () => ({ getUserContext: vi.fn() }));

import { getUserContext } from "@/lib/auth/server";

import AdminConsultationMessagePage from "./page";

/**
 * Failure mode, written before the page (TI-691, the company's template): a member who is not an admin of the
 * active tenant reaches the page that writes it. The page decides on the server, before rendering anything; the API
 * and the database functions refuse again.
 */

function as(role: "admin" | "engineer" | "viewer" | "director" | null, tenantId: string | null = "tenant-1") {
  vi.mocked(getUserContext).mockResolvedValue({
    userEmail: "membre@example.test",
    tenantId,
    profile: role ? { id: "user-1", tenant_role: role } : null,
  } as never);
}

describe("the company's consultation message page", () => {
  it.each(["engineer", "viewer", "director", null] as const)("sends %s back to the profile, on the server", async (role) => {
    as(role);
    await expect(AdminConsultationMessagePage()).rejects.toThrow("redirect /dashboard/profile");
  });

  it("sends an admin without an active tenant back too", async () => {
    as("admin", null);
    await expect(AdminConsultationMessagePage()).rejects.toThrow("redirect /dashboard/profile");
  });

  it("renders for an admin of the active tenant", async () => {
    as("admin");
    redirectMock.mockClear();
    expect(await AdminConsultationMessagePage()).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
