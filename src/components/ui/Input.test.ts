import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/Input";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Input", () => {
  it("links label, helper and error attributes", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Input, {
          id: "email",
          label: "Email",
          helperText: "Use your work email",
          error: "Required",
        })
      );
    });

    const label = renderer!.root.findByType("label");
    expect(label.props.htmlFor).toBe("email");

    const input = renderer!.root.findByType("input");
    expect(input.props["aria-invalid"]).toBe(true);
    expect(input.props["aria-describedby"]).toContain("email-error");

    const error = renderer!.root.findByProps({ id: "email-error" });
    expect(error.props.role).toBe("alert");
  });

  it("renders helper text when there is no error", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Input, {
          id: "name",
          helperText: "Optional",
        })
      );
    });

    const helper = renderer!.root.findByProps({ id: "name-helper" });
    expect(helper.children.join("")).toContain("Optional");
  });
});
