import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTakeoffJob, fetchTakeoffJobCompare, fetchTakeoffRiskRadar, listTakeoffJobs } from "@/lib/takeoff/client";
import { JOB_ID, VERSION_ID, OTHER_ID } from "@/lib/takeoff/response-contracts.test-fixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("validated takeoff client responses", () => {
  it.each(["detail", "list", "compare", "radar"])("retains caller cancellation for %s", async (read) => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const signal = controller.signal;
    const request = read === "detail" ? fetchTakeoffJob(JOB_ID, { signal })
      : read === "list" ? listTakeoffJobs({}, { signal })
      : read === "compare" ? fetchTakeoffJobCompare(JOB_ID, { withJobId: OTHER_ID, signal })
      : fetchTakeoffRiskRadar(JOB_ID, { version_id: VERSION_ID }, { signal });
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
