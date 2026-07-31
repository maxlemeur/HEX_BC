import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBulkDeleteAffaires } from "./useBulkDeleteAffaires";

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("useBulkDeleteAffaires", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms the exact target count and forwards partial results", async () => {
    const onCompleted = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            requestedCount: 2,
            deletedIds: [PROJECT_A],
            failures: [
              {
                projectId: PROJECT_B,
                reason: "not_eligible",
                message: "Affaire non eligible.",
              },
            ],
          },
        }),
        { status: 200 }
      )
    );
    const { result } = renderHook(() =>
      useBulkDeleteAffaires({ onCompleted })
    );

    act(() => {
      result.current.requestDelete([PROJECT_A, PROJECT_B, PROJECT_A]);
    });

    expect(result.current.modalProps.title).toBe("Supprimer 2 affaires");
    expect(result.current.modalProps.message).toContain(
      "2 affaires selectionnees"
    );

    await act(async () => {
      await result.current.modalProps.onConfirm();
    });

    expect(fetch).toHaveBeenCalledWith("/api/affaires/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectIds: [PROJECT_A, PROJECT_B] }),
    });
    expect(onCompleted).toHaveBeenCalledWith({
      requestedCount: 2,
      deletedIds: [PROJECT_A],
      failures: [
        {
          projectId: PROJECT_B,
          reason: "not_eligible",
          message: "Affaire non eligible.",
        },
      ],
    });
    expect(result.current.modalProps.open).toBe(false);
  });

  it("keeps the confirmation open and surfaces transport errors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: { message: "Service indisponible." },
        }),
        { status: 503 }
      )
    );
    const { result } = renderHook(() =>
      useBulkDeleteAffaires({ onCompleted: vi.fn() })
    );

    act(() => {
      result.current.requestDelete([PROJECT_A]);
    });
    await act(async () => {
      await result.current.modalProps.onConfirm();
    });

    await waitFor(() => {
      expect(result.current.modalProps.errorMessage).toBe(
        "Service indisponible."
      );
    });
    expect(result.current.modalProps.open).toBe(true);
  });
});
