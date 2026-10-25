import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanFileCard } from "@/components/takeoff/PlanFileCard";
import type { PlanFileListItem } from "@/lib/takeoff/types";

function planFile(overrides: Partial<PlanFileListItem>): PlanFileListItem {
  return {
    id: "file-r-plus-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tenant_id: "tenant-1",
    plan_set_id: "set-1",
    file_path: "tenant-1/set-1/file-r-plus-1/Plan-R-1.pdf",
    file_name: "Plan-R-1.pdf",
    file_type: "application/pdf",
    file_size_bytes: 2048,
    page_count: 1,
    file_hash: null,
    metadata: {},
    created_by: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("PlanFileCard", () => {
  it("tells R+1 and R-1 apart although both are stored as Plan-R-1.pdf", async () => {
    const onDelete = vi.fn();
    render(
      <>
        <PlanFileCard
          file={planFile({ metadata: { original_file_name: "Plan R+1.pdf" } })}
          onDelete={onDelete}
        />
        <PlanFileCard
          file={planFile({
            id: "file-r-minus-1",
            file_path: "tenant-1/set-1/file-r-minus-1/Plan-R-1.pdf",
            metadata: { original_file_name: "Plan R-1.pdf" },
          })}
          onDelete={onDelete}
        />
      </>
    );

    expect(screen.getByText("Plan R+1.pdf")).toBeTruthy();
    expect(screen.getByText("Plan R-1.pdf")).toBeTruthy();
    expect(screen.queryByText("Plan-R-1.pdf")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Supprimer Plan R+1.pdf" }));
    expect(onDelete).toHaveBeenCalledWith("file-r-plus-1");
  });

  it("shows the stored name of a file registered without an original name", () => {
    render(<PlanFileCard file={planFile({})} onDelete={vi.fn()} />);

    expect(screen.getByText("Plan-R-1.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Supprimer Plan-R-1.pdf" })).toBeTruthy();
  });
});
