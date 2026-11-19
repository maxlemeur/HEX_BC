import { describe, expect, it, vi } from "vitest";

// The lab state names the member's key (its label and connection identifier): like the key routes, it is never cached.

vi.mock("@/lib/takeoff/lab/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/lab/server")>()),
  requireTakeoffLabAccess: async () => ({ owner: { userId: "user-1", tenantId: "tenant-1" }, email: null }),
  readLabState: async () => ({ api_key: { status: "saved", provider: "openai", suffix: "AbCd", place_label: "Trousseau de ce Mac",
    connection_id: "8c3e2b1a-4d5f-4a6b-9c7d-0e1f2a3b4c5d" } }),
}));

const { GET } = await import("@/app/api/admin/takeoff/lab/route");

describe("GET /api/admin/takeoff/lab", () => {
  it("answers the lab state with no-store", async () => {
    const response = await GET();
    expect([response.status, (await response.json()).data.api_key.connection_id, response.headers.get("cache-control")])
      .toEqual([200, "8c3e2b1a-4d5f-4a6b-9c7d-0e1f2a3b4c5d", "no-store"]);
  });
});
