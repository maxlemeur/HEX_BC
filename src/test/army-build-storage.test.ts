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

  // A journey's dev server deletes its distDir with its file, so no later server reuses webpack's persistent cache, and
  // writing then reloading its pack stopped the server for 16 to 27 s on CI runners (TI-724).
  it("gives a journey's dev server no persistent webpack cache and leaves every other build to Next", async () => {
    const webpackHook = async (mode: string, army: string, id: string) => {
      vi.stubEnv("E2E_ARMY", army);
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("E2E_ARMY_DEV_SERVER_ID", id);
      vi.resetModules();
      return (await import("../../next.config")).default.webpack;
    };
    const journey = await webpackHook("development", "1", "chatgpt-unit");
    expect(journey).toBeTypeOf("function");
    const compiled = journey!({ cache: { type: "filesystem" }, resolve: { alias: {} }, resolveLoader: {} }, { dev: true } as never);
    expect(compiled.cache).toBe(false);
    // Webpack derives the resolvers' cache from `cache`: they keep theirs, in Next's memory cache.
    expect(compiled.resolve).toEqual({ alias: {}, cache: true });
    expect(compiled.resolveLoader).toEqual({ cache: true });
    // Without a webpack hook, Next keeps its build worker and its own cache everywhere else.
    expect(await webpackHook("production", "1", "")).toBeUndefined();
    expect(await webpackHook("production", "1", "chatgpt-unit")).toBeUndefined();
    expect(await webpackHook("development", "1", "")).toBeUndefined();
    expect(await webpackHook("development", "", "chatgpt-unit")).toBeUndefined();
    expect(await webpackHook("development", "", "")).toBeUndefined();
  });

  it("leaves ordinary Next builds on their default output", async () => {
    vi.stubEnv("E2E_ARMY", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    expect(config.distDir).toBeUndefined();
  });
});
