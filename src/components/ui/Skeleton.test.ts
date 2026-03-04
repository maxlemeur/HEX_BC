import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { Skeleton } from "@/components/ui/Skeleton";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Skeleton", () => {
  it("renders default text variant", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Skeleton));
    });

    const div = renderer!.root.findByType("div");
    expect(div.props["aria-hidden"]).toBe("true");
    expect(div.props.className).toContain("animate-pulse");
    expect(div.props.className).toContain("bg-slate-200/50");
    expect(div.props.className).toContain("h-4");
    expect(div.props.className).toContain("w-full");
  });

  it("renders circle variant", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Skeleton, { variant: "circle" }));
    });

    const div = renderer!.root.findByType("div");
    expect(div.props.className).toContain("h-10");
    expect(div.props.className).toContain("w-10");
    expect(div.props.className).toContain("rounded-full");
  });

  it("renders multiple instances with count", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(createElement(Skeleton, { count: 3 }));
    });

    const items = renderer!.root.findAllByProps({ "aria-hidden": "true" });
    expect(items).toHaveLength(3);
  });

  it("applies custom width and height", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Skeleton, { width: 200, height: "2rem" })
      );
    });

    const div = renderer!.root.findByType("div");
    expect(div.props.style).toEqual(
      expect.objectContaining({ width: "200px", height: "2rem" })
    );
  });
});
