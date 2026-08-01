import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useDeleteAffaire } from "./useDeleteAffaire";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("useDeleteAffaire", () => {
  it("warns that directly related data will also be removed", () => {
    const { result } = renderHook(() => useDeleteAffaire());

    act(() => {
      result.current.requestDelete(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "Affaire Alpha",
      );
    });

    expect(result.current.modalProps.message).toContain(
      "versions, chiffrages, métrés et historiques directement rattachés",
    );
    expect(result.current.modalProps.message).toContain(
      "documents associés ne seront plus accessibles",
    );
    expect(result.current.modalProps.message).toContain(
      "Cette action est irréversible",
    );
  });
});