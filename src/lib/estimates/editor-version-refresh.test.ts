import { describe, expect, it, vi } from "vitest";

import { refreshVersionTokenAfterAssemblyInsert } from "@/lib/estimates/editor-version-refresh";

const VERSION_ID = "77777777-7777-4777-8777-777777777777";

describe("refreshVersionTokenAfterAssemblyInsert", () => {

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
