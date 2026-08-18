import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("triggerTakeoffJobProcessing", () => {
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  });

  it("returns triggered=true when edge function responds 2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 202 });

    const result = await triggerTakeoffJobProcessing({
      jobId: JOB_ID,
      fetchFn: fetchFn as unknown as typeof fetch,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    expect(result.triggered).toBe(true);
    expect(result.statusCode).toBe(202);
    expect(result.outcome).toBe("accepted");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns triggered=false when edge function call fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await triggerTakeoffJobProcessing({
      jobId: JOB_ID,
      fetchFn: fetchFn as unknown as typeof fetch,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    expect(result.triggered).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.outcome).toBe("network_error");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff edge trigger request failed.",
      expect.objectContaining({
        jobId: JOB_ID,
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it("classifies a forced timeout instead of reporting a false launch", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      })
    );

    const result = await triggerTakeoffJobProcessing({
      jobId: JOB_ID,
      fetchFn: fetchFn as unknown as typeof fetch,
      correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      timeoutMs: 5,
    });

    expect(result).toMatchObject({
      triggered: false,
      statusCode: null,
      outcome: "timeout",
    });
    consoleErrorSpy.mockRestore();
  });
});
