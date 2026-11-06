import { describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({ getAll: vi.fn(() => []), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
import { createServerClient } from "@supabase/ssr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

describe("session refresh in an import route excluded from the proxy", () => {
  it("writes renewed cookies only for a route handler that owns its response", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-fixture");
    try {
      const cookie = { name: "session", value: "renewed", options: { path: "/", httpOnly: true } };
      const client = vi.mocked(createServerClient);
      await createSupabaseServerClient();
      client.mock.lastCall![2].cookies.setAll!([cookie], {});
      expect(cookieStore.set).not.toHaveBeenCalled();
      await createSupabaseServerClient("route");
      client.mock.lastCall![2].cookies.setAll!([cookie], {});
      expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(cookie.name, cookie.value, cookie.options);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
