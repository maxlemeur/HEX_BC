import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { resetHealthProbeCacheForTests } from "@/lib/health-probe";

describe("GET /api/health", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetHealthProbeCacheForTests();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("reports up when PostgREST answers with a real SQLSTATE (anon has no grant)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: "42501", message: "permission denied for table tenants" }),
          { status: 401 }
        )
    );

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ ok: true, db: "up" });
    expect(response.status).toBe(200);
  });

  it("reports down (503) on a rejected key instead of defaulting to up", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 })
    );

    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ ok: false, db: "down" });
    expect(response.status).toBe(503);
  });

  it("reports down when PostgREST cannot reach the database", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "PGRST001", message: "could not connect" }), {
          status: 503,
        })
    );

    const response = await GET();
    expect(response.status).toBe(503);
  });

  it("throttles upstream pings between consecutive calls", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 }));

    await GET();
    await GET();
    await GET();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
