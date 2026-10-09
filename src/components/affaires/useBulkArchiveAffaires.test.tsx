import { act,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { useBulkArchiveAffaires } from "./useBulkArchiveAffaires";

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("useBulkArchiveAffaires", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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