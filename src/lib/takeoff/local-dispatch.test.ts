import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/takeoff/async-worker", () => ({ processTakeoffJobAttempt: vi.fn() }));
import { headers } from "next/headers";
import { after } from "next/server";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("CI", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "127.0.0.1:3000" }) as never);
  vi.mocked(processTakeoffJobAttempt).mockResolvedValue({ should_requeue: false } as never);
});
it("follows worker retry and reconciliation outcomes locally without an Edge invocation", async () => {
  vi.mocked(processTakeoffJobAttempt)
    .mockResolvedValueOnce({ should_requeue: true, requeue_reason: "reconcile", next_run_in_seconds: 0 } as never)
    .mockResolvedValueOnce({ should_requeue: true, requeue_reason: "retry", next_run_in_seconds: 0 } as never);
  const fetchFn = vi.fn();
  await triggerTakeoffJobProcessing({ jobId: "fixture-job", fetchFn });
  await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)();
  expect(vi.mocked(processTakeoffJobAttempt).mock.calls.map(([, options]) => options.trigger)).toEqual(["create", "reconcile", "retry"]);
  expect(fetchFn).not.toHaveBeenCalled();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("runs the existing lease-protected worker on this Mac after responding, without an edge request", async () => {
  const fetchFn = vi.fn();
  const result = await triggerTakeoffJobProcessing({ jobId: "fixture-job", trigger: "retry", correlationId: "fixture-correlation", fetchFn });
  expect(result).toMatchObject({ triggered: true, statusCode: 202, outcome: "accepted" });
  expect(fetchFn).not.toHaveBeenCalled(); expect(processTakeoffJobAttempt).not.toHaveBeenCalled();
  await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)();
  expect(processTakeoffJobAttempt).toHaveBeenCalledWith("fixture-job", { trigger: "retry", correlationId: "fixture-correlation" });
});
it("rejects a foreign host before scheduling or calling any provider", async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "evil.test" }) as never);
  const fetchFn = vi.fn();
  await expect(triggerTakeoffJobProcessing({ jobId: "fixture-job", fetchFn })).rejects.toThrow();
  expect(after).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
});
