import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "@/components/ui-legacy/SearchableSelect";

describe("ui/SearchableSelect", () => {
  afterEach(() => {
    cleanup();
  });

  it("filters options and selects with keyboard", async () => {
    const onValueChange = vi.fn<(value: string) => void>();
    const user = userEvent.setup();

    render(
      createElement(SearchableSelect, {
        id: "user",
        options: [
          { value: "u1", label: "Alice Martin", keywords: ["alice@example.com"] },
          { value: "u2", label: "Bob Durand", keywords: ["bob@example.com"] },
        ],
        onValueChange,
      })
    );

    const input = screen.getByRole("combobox");

    await user.click(input);
    await user.type(input, "Ali");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onValueChange).toHaveBeenCalledWith("u1");
    expect(input).toHaveValue("Alice Martin");
  });

  it("closes listbox on escape", async () => {
    const user = userEvent.setup();

    render(
      createElement(SearchableSelect, {
        id: "user",
        options: [{ value: "u1", label: "Alice Martin" }],
      })
    );

    const input = screen.getByRole("combobox");

    await user.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
