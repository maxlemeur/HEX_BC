import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserProvider } from "@/components/UserContext";
import { useUiMode } from "@/hooks/useUiMode";

const { updateProfileUiModeMock } = vi.hoisted(() => ({
  updateProfileUiModeMock: vi.fn(),
}));

vi.mock("@/app/dashboard/_actions/profile", () => ({
  updateProfileUiMode: updateProfileUiModeMock,
}));

describe("useUiMode", () => {
  beforeEach(() => {
    localStorage.clear();
    updateProfileUiModeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to local storage when rendered without UserProvider", () => {
    const { result } = renderHook(() => useUiMode());

    expect(result.current.mode).toBe("simplified");
    expect(result.current.isSimplified).toBe(true);

    act(() => {
      result.current.setMode("expert");
    });

    expect(result.current.mode).toBe("expert");
    expect(result.current.isExpert).toBe(true);
    expect(localStorage.getItem("timax-ui-mode")).toBe("expert");
    expect(updateProfileUiModeMock).not.toHaveBeenCalled();
  });

  it("persists profile mode through the provider when a user exists", () => {
    updateProfileUiModeMock.mockResolvedValue({ mode: "expert" });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <UserProvider
        initialUserEmail="user@example.com"
        initialProfile={{
          id: "profile-1",
          full_name: "Ada Lovelace",
          phone: null,
          job_title: null,
          work_email: "user@example.com",
          role: "admin",
          tenant_id: "tenant-1",
          tenant_role: "admin",
          ui_mode: "simplified",
        }}
      >
        {children}
      </UserProvider>
    );

    const { result } = renderHook(() => useUiMode(), { wrapper });

    act(() => {
      result.current.setMode("expert");
    });

    expect(result.current.mode).toBe("expert");
    expect(localStorage.getItem("timax-ui-mode:profile-1")).toBe("expert");
    expect(updateProfileUiModeMock).toHaveBeenCalledWith({ mode: "expert" });
  });
});
