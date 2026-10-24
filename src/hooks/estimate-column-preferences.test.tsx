import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UserProvider, useUserContext } from "@/components/UserContext";
import type { UserProfile } from "@/lib/auth/server";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useEstimateColumnWidths } from "@/hooks/useEstimateColumnWidths";
import {
  DEFAULT_ESTIMATE_COLUMN_ORDER,
  ESTIMATE_V3_ONLY_COLUMN_IDS,
  useEstimateColumnOrder,
} from "@/hooks/useEstimateColumnOrder";

function profile(id: string): UserProfile {
  return { id, full_name: id, phone: null, job_title: null, work_email: null,
    role: "buyer", ui_mode: "expert", tenant_id: "tenant", tenant_role: "engineer" };
}

function preferences(id = "user-a") {
  return renderHook(() => ({
    visibility: useColumnVisibility(), widths: useEstimateColumnWidths(), order: useEstimateColumnOrder(),
    changeUser: useUserContext().setProfile,
  }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <UserProvider initialUserEmail="test@example.invalid" initialProfile={profile(id)}>{children}</UserProvider>
    ),
  });
}

describe("personal estimate column preferences", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("never adopts another account's legacy global preferences", () => {
    localStorage.setItem("est-col-vis", "full");
    localStorage.setItem("est-col-widths-v1", JSON.stringify({ designation: 500 }));
    const { result } = preferences();
    expect(result.current.visibility.preset).toBe("essential");
    expect(result.current.widths.widths).toEqual({});
  });

  it("restores visibility, order and widths on another estimate for the same user only", () => {
    const first = preferences();
    act(() => {
      first.result.current.visibility.toggleColumn("marque");
      first.result.current.widths.setColumnWidth("designation", 440);
      // A v1/v2 grid has no FO provision column: the move steps over it (TI-534).
      first.result.current.order.moveColumn("k_fo", -1, ESTIMATE_V3_ONLY_COLUMN_IDS);
    });
    first.unmount();

    const other = preferences("user-b");
    expect(other.result.current.visibility.visibleColumns.has("marque")).toBe(false);
    expect(other.result.current.widths.widths).toEqual({});
    expect(other.result.current.order.order).toEqual(DEFAULT_ESTIMATE_COLUMN_ORDER);
    other.unmount();

    const restored = preferences();
    expect(restored.result.current.visibility.visibleColumns.has("marque")).toBe(true);
    expect(restored.result.current.widths.widths.designation).toBe(440);
    expect(restored.result.current.order.order.indexOf("k_fo"))
      .toBeLessThan(restored.result.current.order.order.indexOf("supply_type"));
  });

  it("moves K FO past the FO provision on a v3 grid, where that column is shown", () => {
    const { result } = preferences();
    act(() => result.current.order.moveColumn("k_fo", -1));
    const order = result.current.order.order;
    expect(order.indexOf("k_fo")).toBe(order.indexOf("fo_provision") - 1);
    expect(order.indexOf("supply_type")).toBeLessThan(order.indexOf("k_fo"));
  });

  it("switches preferences immediately and rejects a callback from the previous account", () => {
    const { result } = preferences();
    act(() => result.current.widths.setColumnWidth("designation", 440));
    const oldSetWidth = result.current.widths.setColumnWidth;
    act(() => result.current.changeUser(profile("user-b")));
    expect(result.current.widths.widths).toEqual({});
    act(() => oldSetWidth("designation", 580));
    expect(result.current.widths.widths).toEqual({});
    expect(localStorage.getItem("est-col-widths-v1:user-b")).toBeNull();
    act(() => result.current.changeUser(profile("user-a")));
    expect(result.current.widths.widths.designation).toBe(440);
  });

  it("resets all preferences without changing the other user's choices", () => {
    const a = preferences();
    act(() => {
      a.result.current.visibility.setPreset("full");
      a.result.current.widths.setColumnWidth("quantity", 100);
      a.result.current.order.moveColumn("marque", -1);
    });
    const b = preferences("user-b");
    act(() => b.result.current.visibility.setPreset("standard"));
    act(() => {
      a.result.current.visibility.resetColumns();
      a.result.current.widths.resetColumnWidths();
      a.result.current.order.resetColumnOrder();
    });
    expect(a.result.current.visibility.hasManualOverride).toBe(false);
    expect(a.result.current.visibility.visibleColumns.size).toBe(0);
    expect(a.result.current.widths.widths).toEqual({});
    expect(a.result.current.order.order).toEqual(DEFAULT_ESTIMATE_COLUMN_ORDER);
    expect(b.result.current.visibility.preset).toBe("standard");
  });
});
