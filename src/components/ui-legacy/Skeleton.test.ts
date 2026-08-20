import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "@/components/ui-legacy/Skeleton";

describe("ui/Skeleton", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders default text variant", () => {
    const { container } = render(createElement(Skeleton));
    const skeleton = container.firstElementChild;

    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass(
      "animate-shimmer",
      "bg-slate-200/50",
      "h-4",
      "w-full"
    );
  });

  it("renders circle variant", () => {
    const { container } = render(createElement(Skeleton, { variant: "circle" }));

    expect(container.firstElementChild).toHaveClass(
      "h-10",
      "w-10",
      "rounded-full"
    );
  });

  it("renders multiple instances with count", () => {
    const { container } = render(createElement(Skeleton, { count: 3 }));

    expect(
      container.querySelectorAll('[aria-hidden="true"]')
    ).toHaveLength(3);
  });

  it("applies custom width and height", () => {
    const { container } = render(
      createElement(Skeleton, { width: 200, height: "2rem" })
    );

    expect(container.firstElementChild).toHaveStyle({
      width: "200px",
      height: "2rem",
    });
  });
});
