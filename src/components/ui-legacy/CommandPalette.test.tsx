import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { closePalette } = vi.hoisted(() => ({
  closePalette: vi.fn(),
}));

vi.mock("@/hooks/useCommandPalette", () => ({
  useCommandPalette: () => ({
    open: true,
    setOpen: closePalette,
    query: "",
    setQuery: vi.fn(),
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    groups: [],
    flatItems: [],
    execute: vi.fn(),
    handlePaletteKeyDown: vi.fn(),
  }),
}));

import { CommandPalette } from "@/components/ui-legacy/CommandPalette";

describe("ui/CommandPalette", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("closes from the explicit header button", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    await user.click(
      screen.getByRole("button", { name: "Fermer la recherche rapide" })
    );

    expect(closePalette).toHaveBeenCalledTimes(1);
  });
});
