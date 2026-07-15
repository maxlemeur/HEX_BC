import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui/Select";

describe("ui/Select", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders options and placeholder", () => {
    render(
      createElement(Select, {
        id: "role",
        placeholder: "Choose",
        options: [
          { value: "admin", label: "Admin" },
          { value: "viewer", label: "Viewer" },
        ],
      })
    );

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("option", { name: "Choose" })).toHaveValue("");
  });

  it("calls onValueChange on selection", async () => {
    const onValueChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(
      createElement(Select, {
        id: "role",
        options: [{ value: "admin", label: "Admin" }],
        onValueChange,
      })
    );

    await user.selectOptions(screen.getByRole("combobox"), "admin");

    expect(onValueChange).toHaveBeenCalledWith("admin");
  });
});
