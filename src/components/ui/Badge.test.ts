import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/Badge";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Badge", () => {
  it("renders variant and size data attributes", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Badge, { variant: "warning", size: "sm" }, "Warning")
      );
    });

    const badge = renderer!.root.findByType("span");
    expect(badge.props["data-variant"]).toBe("warning");
    expect(badge.props["data-size"]).toBe("sm");
    expect(badge.props.className).toContain("ui-badge");
  });
});
