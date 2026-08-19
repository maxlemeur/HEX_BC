import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installProcessErrorHooks } from "@/lib/observability/error-reporter";

describe("installProcessErrorHooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports then exits the process on uncaughtException instead of swallowing it", async () => {
    const target = new EventEmitter();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ERROR_REPORTING_DSN", "");
    const exit = vi.fn();

    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit });
    target.emit("uncaughtException", new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not register its hooks twice on the same target", () => {
    const target = new EventEmitter();

    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit: vi.fn() });
    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit: vi.fn() });

    expect(target.listenerCount("uncaughtException")).toBe(1);
    expect(target.listenerCount("unhandledRejection")).toBe(1);
  });
});
