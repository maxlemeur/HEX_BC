import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBulkArchiveAffaires } from "./useBulkArchiveAffaires";

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("useBulkArchiveAffaires", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms the exact target count and preserves history in its copy", async () => {
    const onCompleted = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            requestedCount: 2,
            archivedIds: [PROJECT_A],
            failures: [
              {
                projectId: PROJECT_B,
                reason: "not_eligible",
                message: "Affaire non eligible.",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() =>
      useBulkArchiveAffaires({ onCompleted }),
    );

    act(() => {
      result.current.requestArchive([PROJECT_A, PROJECT_B, PROJECT_A]);
    });

    expect(result.current.modalProps.title).toBe("Archiver 2 affaires");
    expect(result.current.modalProps.message).toContain(
      "leur historique restera conserve",
    );

    await act(async () => {
      await result.current.modalProps.onConfirm();
    });

    expect(fetch).toHaveBeenCalledWith("/api/affaires/bulk-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectIds: [PROJECT_A, PROJECT_B] }),
    });
    expect(onCompleted).toHaveBeenCalledWith({
      requestedCount: 2,
      archivedIds: [PROJECT_A],
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
        { status: 503 },
      ),
    );
    const { result } = renderHook(() =>
      useBulkArchiveAffaires({ onCompleted: vi.fn() }),
    );

    act(() => {
      result.current.requestArchive([PROJECT_A]);
    });
    await act(async () => {
      await result.current.modalProps.onConfirm();
    });

    await waitFor(() => {
      expect(result.current.modalProps.errorMessage).toBe(
        "Service indisponible.",
      );
    });
    expect(result.current.modalProps.open).toBe(true);
  });
});