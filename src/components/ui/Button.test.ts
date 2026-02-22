import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/Button";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Button", () => {
  it("applies variant and size classes", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Button, { variant: "danger", size: "lg" }, "Delete")
      );
    });

    const button = renderer!.root.findByType("button");
    expect(button.props.className).toContain("border-danger/30");
    expect(button.props.className).toContain("h-[52px]");
  });

  it("disables and marks busy when loading", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Button, { loading: true }, "Saving")
      );
    });

    const button = renderer!.root.findByType("button");
    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-busy"]).toBe(true);

    const spinner = renderer!.root.find(
      (node) => node.type === "span" && typeof node.props.className === "string" && node.props.className.includes("animate-spin")
    );
    expect(spinner).toBeDefined();
  });
});
