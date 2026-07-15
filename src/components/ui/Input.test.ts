import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "@/components/ui/Input";

describe("ui/Input", () => {
  afterEach(() => {
    cleanup();
  });

  it("links label, helper and error attributes", () => {
    render(
      createElement(Input, {
        id: "email",
        label: "Email",
        helperText: "Use your work email",
        error: "Required",
      })
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining("email-error"));

    expect(screen.getByRole("alert")).toHaveAttribute("id", "email-error");
  });

  it("renders helper text when there is no error", () => {
    render(createElement(Input, { id: "name", helperText: "Optional" }));

    expect(screen.getByText("Optional")).toHaveAttribute("id", "name-helper");
  });
});
