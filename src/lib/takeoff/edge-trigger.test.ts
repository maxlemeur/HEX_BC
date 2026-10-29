import { afterEach, expect, it, vi } from "vitest";

import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";

afterEach(() => vi.unstubAllEnvs());

it("does not dispatch an old request to the remote worker outside the local runtime", async () => {
  vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture");
  const fetchFn = vi.fn();
  const result = await triggerTakeoffJobProcessing({ jobId: "fixture-job", fetchFn, correlationId: "fixture-correlation" });
  expect(result).toMatchObject({ triggered: false, statusCode: null, outcome: "configuration_missing" });
  expect(fetchFn).not.toHaveBeenCalled();
});
