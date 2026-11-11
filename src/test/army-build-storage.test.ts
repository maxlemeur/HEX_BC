import { afterEach, describe, expect, it, vi } from "vitest";

// Exercise the actual Next configuration, including each journey-owned dev server.
// A build in .e2e is otherwise silently copied when the evidence is archived.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Army build storage", () => {
  it.each([
    ["production", "", ".build/tester-army/next", ".build/tester-army/tsconfig.json"],
    ["development", "chatgpt-unit", ".build/tester-army/next-chatgpt-unit", ".build/tester-army/tsconfig-chatgpt-unit.json"],
  ])("keeps %s compiler output outside evidence", async (mode, id, distDir, tsconfigPath) => {
    vi.stubEnv("E2E_ARMY", "1");
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("E2E_ARMY_DEV_SERVER_ID", id);
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    expect(config.distDir).toBe(distDir);
    expect(config.typescript?.tsconfigPath).toBe(tsconfigPath);
  });

  it("leaves ordinary Next builds on their default output", async () => {
    vi.stubEnv("E2E_ARMY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    expect(config.distDir).toBeUndefined();
  });
});
