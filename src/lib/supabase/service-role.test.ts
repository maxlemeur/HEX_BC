import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function loadModule() {
  vi.resetModules();
  return import("./service-role");
}

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  }

  if (ORIGINAL_SERVICE_ROLE_KEY === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE_ROLE_KEY;
  }
});

describe("service role client helpers", () => {
  it("returns null when the service role config is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const serviceRole = await loadModule();

    expect(serviceRole.hasServiceRoleConfig()).toBe(false);
    expect(serviceRole.createOptionalServiceRoleClient()).toBeNull();
  });

  it("creates a client when the service role config is available", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const serviceRole = await loadModule();

    expect(serviceRole.hasServiceRoleConfig()).toBe(true);
    expect(serviceRole.createOptionalServiceRoleClient()).not.toBeNull();
  });
});
