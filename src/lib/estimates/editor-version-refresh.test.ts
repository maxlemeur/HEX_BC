import { describe, expect, it, vi } from "vitest";

import { refreshVersionTokenAfterAssemblyInsert } from "@/lib/estimates/editor-version-refresh";

const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const UPDATED_AT = "2026-02-22T12:00:00.000Z";

describe("refreshVersionTokenAfterAssemblyInsert", () => {
  it("applies refreshed version token when the refresh succeeds", async () => {
    const fetchEstimateEditorData = vi.fn().mockResolvedValue({
      version: {
        updated_at: UPDATED_AT,
      },
    });
    const onVersionToken = vi.fn();
    const onError = vi.fn();

    await refreshVersionTokenAfterAssemblyInsert(VERSION_ID, {
      fetchEstimateEditorData,
      onVersionToken,
      onError,
    });

    expect(fetchEstimateEditorData).toHaveBeenCalledWith(VERSION_ID);
    expect(onVersionToken).toHaveBeenCalledWith(UPDATED_AT);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not throw when refresh fails and reports the refresh error separately", async () => {
    const refreshError = new Error("refresh unavailable");
    const fetchEstimateEditorData = vi.fn().mockRejectedValue(refreshError);
    const onVersionToken = vi.fn();
    const onError = vi.fn();

    await expect(
      refreshVersionTokenAfterAssemblyInsert(VERSION_ID, {
        fetchEstimateEditorData,
        onVersionToken,
        onError,
      })
    ).resolves.toBeUndefined();

    expect(onVersionToken).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(refreshError);
  });
});
