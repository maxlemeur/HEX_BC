import { describe, expect, it, vi } from "vitest";

const { fromMock, redirectMock, tokenSingleMock, tokenUpdateEqMock } = vi.hoisted(
  () => ({
    fromMock: vi.fn(),
    redirectMock: vi.fn((location: string) => {
      throw new Error(`redirect:${location}`);
    }),
    tokenSingleMock: vi.fn(),
    tokenUpdateEqMock: vi.fn().mockResolvedValue({ error: null }),
  })
);

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  redirect: redirectMock,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: fromMock.mockImplementation((table: string) => {
      if (table !== "portal_tokens") {
        throw new Error(`Unexpected table read after expired token: ${table}`);
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: tokenSingleMock,
          })),
        })),
        update: vi.fn(() => ({
          eq: tokenUpdateEqMock,
        })),
      };
    }),
  }),
}));

import PortalPage from "./page";

describe("portal capability read boundary", () => {
  it.each(["pending", "accepted", "rejected"] as const)(
    "redirects an expired %s capability before loading estimate data",
    async (status) => {
      vi.clearAllMocks();
      tokenUpdateEqMock.mockResolvedValue({ error: null });
      tokenSingleMock.mockResolvedValueOnce({
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          tenant_id: "22222222-2222-4222-8222-222222222222",
          version_id: "33333333-3333-4333-8333-333333333333",
          status,
          expires_at: "2020-01-01T00:00:00.000Z",
          email: "client@example.com",
        },
        error: null,
      });

      await expect(
        PortalPage({
          params: Promise.resolve({
            token: "44444444-4444-4444-8444-444444444444",
          }),
        })
      ).rejects.toThrow(
        "redirect:/portal/44444444-4444-4444-8444-444444444444/expired"
      );

      if (status === "pending") {
        expect(tokenUpdateEqMock).toHaveBeenCalledWith(
          "id",
          "11111111-1111-4111-8111-111111111111"
        );
      } else {
        expect(tokenUpdateEqMock).not.toHaveBeenCalled();
      }
      expect(fromMock).toHaveBeenCalledTimes(status === "pending" ? 2 : 1);
      expect(fromMock).toHaveBeenNthCalledWith(1, "portal_tokens");
      expect(redirectMock).toHaveBeenCalledOnce();
    }
  );

  it("redirects a sibling-invalidated token with a future date before estimate reads", async () => {
    vi.clearAllMocks();
    tokenSingleMock.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        tenant_id: "22222222-2222-4222-8222-222222222222",
        version_id: "33333333-3333-4333-8333-333333333333",
        status: "expired",
        expires_at: "2099-01-01T00:00:00.000Z",
        email: "client@example.com",
      },
      error: null,
    });

    await expect(
      PortalPage({
        params: Promise.resolve({
          token: "44444444-4444-4444-8444-444444444444",
        }),
      })
    ).rejects.toThrow(
      "redirect:/portal/44444444-4444-4444-8444-444444444444/expired"
    );

    expect(fromMock).toHaveBeenCalledOnce();
    expect(fromMock).toHaveBeenCalledWith("portal_tokens");
    expect(tokenUpdateEqMock).not.toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledOnce();
  });
});
