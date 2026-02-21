import { afterEach, describe, expect, it, vi } from "vitest";

import { bulkUpdateEstimateItems } from "@/lib/estimates/client";

const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "88888888-8888-4888-8888-888888888888";

describe("bulkUpdateEstimateItems client regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call the bulk endpoint when there are no updates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await bulkUpdateEstimateItems(VERSION_ID, []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the bulk endpoint when updates are present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: null,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await bulkUpdateEstimateItems(VERSION_ID, [
      {
        id: ITEM_ID,
        updates: {
          title: "Ligne test",
        },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/estimates/${VERSION_ID}/items/bulk`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      })
    );
  });
});
