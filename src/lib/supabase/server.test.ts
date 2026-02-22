import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadServerModule() {
  vi.resetModules();

  const createServerClient = vi.fn();
  const getAll = vi.fn(() => [{ name: "sb-access-token", value: "token" }]);
  const cookies = vi.fn().mockResolvedValue({
    getAll,
  });

  vi.doMock("@supabase/ssr", () => ({
    createServerClient,
  }));
  vi.doMock("next/headers", () => ({
    cookies,
  }));

  const module = await import("@/lib/supabase/server");

  return {
    module,
    createServerClient,
    cookies,
    getAll,
  };
}

describe("createSupabaseServerClient", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    const { module } = await loadServerModule();

    await expect(module.createSupabaseServerClient()).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const { module } = await loadServerModule();

    await expect(module.createSupabaseServerClient()).rejects.toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  });

  it("creates the server client with cookie adapters", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { module, createServerClient, cookies, getAll } = await loadServerModule();
    const client = { id: "client" };
    createServerClient.mockReturnValue(client);

    const result = await module.createSupabaseServerClient();

    expect(result).toBe(client);
    expect(cookies).toHaveBeenCalledTimes(1);
    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.any(Object)
    );

    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: {
        getAll: () => unknown;
        setAll: (values: unknown[]) => void;
      };
    };

    expect(options.cookies.getAll()).toEqual([{ name: "sb-access-token", value: "token" }]);
    expect(getAll).toHaveBeenCalled();
    expect(() => options.cookies.setAll([{ name: "any", value: "value" }])).not.toThrow();
  });
});
