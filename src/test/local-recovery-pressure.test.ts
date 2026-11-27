import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { createOptionalServiceRoleClient, createServiceRoleClient } from "@/lib/supabase/service-role";
import { startLocalTakeoffLaunchConsumer } from "@/lib/takeoff/launch-request-consumer";
import { startLocalTakeoffRetryRecovery } from "@/lib/takeoff/local-retry-recovery";
import { startLocalIntakeRecovery } from "@/lib/workflows/intake-launch-recovery";
import type { Database } from "@/types/database";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ isLocalChatGptEnabled: () => true }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: async () => "fixture-host" }));
vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(), createServiceRoleClient: vi.fn(),
}));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("reduces worker requests during a ten-minute gateway outage and resumes polling after recovery", async () => {
  vi.useFakeTimers();
  vi.stubEnv("E2E_ARMY_BLOCK_WORKERS", "0");
  vi.spyOn(console, "error").mockImplementation(() => {});
  let unavailable = true;
  const requests: string[] = [];
  const client = createClient<Database>("http://127.0.0.1:54321", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const path = new URL(String(input)).pathname.split("/").at(-1)!;
      requests.push(path);
      if (unavailable) return Response.json({ message: "Gateway Timeout" }, { status: 504 });
      if (path === "takeoff_local_retry_floor") return Response.json(null);
      return Response.json([]);
    } },
  });
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(client);
  vi.mocked(createServiceRoleClient).mockReturnValue(client);
  // Preload the dynamically imported launch worker before advancing the virtual clock.
  await import("@/lib/takeoff/launch-request-server");
  startLocalTakeoffRetryRecovery();
  startLocalIntakeRecovery();
  startLocalTakeoffLaunchConsumer();
  const counts = () => Object.fromEntries([...new Set(requests)].map(path => [path, requests.filter(p => p === path).length]));
  await vi.advanceTimersByTimeAsync(600_000);
  const outage = counts();
  expect(outage.recover_takeoff_payment_jobs).toBe(7);
  expect(outage.claim_takeoff_launch_evaluations).toBe(5);
  expect(outage.affaire_intake_uploads).toBe(5);
  expect(requests.length).toBeLessThanOrEqual(49);
  expect(outage.record_local_takeoff_host_activity).toBe(11);
  unavailable = false;
  requests.length = 0;
  await vi.advanceTimersByTimeAsync(240_000);
  expect(counts().recover_takeoff_payment_jobs).toBeGreaterThan(6);
  expect(counts().affaire_intake_uploads).toBeGreaterThanOrEqual(2);
  expect(counts().claim_takeoff_launch_evaluations).toBeGreaterThanOrEqual(4);
});
