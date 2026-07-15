import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/Badge";

describe("ui/Badge", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders variant and size data attributes", () => {
    render(createElement(Badge, { variant: "warning", size: "sm" }, "Warning"));

    const badge = screen.getByText("Warning");
    expect(badge).toHaveAttribute("data-variant", "warning");
    expect(badge).toHaveAttribute("data-size", "sm");
    expect(badge).toHaveClass("ui-badge");
  });
});
