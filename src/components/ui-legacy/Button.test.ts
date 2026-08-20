import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui-legacy/Button";

describe("ui/Button", () => {
  afterEach(() => {
    cleanup();
  });

  it("applies variant and size classes", () => {
    render(createElement(Button, { variant: "danger", size: "lg" }, "Delete"));

    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "bg-error-light",
      "h-11"
    );
  });

  it("disables and marks busy when loading", () => {
    render(createElement(Button, { loading: true }, "Saving"));

    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    expect(button.querySelector(".animate-spin")).not.toBeNull();
  });
});
