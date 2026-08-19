import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Regression guard for `src/test/vitest.setup.ts`: Vitest runs without
// `globals`, so Testing Library cannot install its own auto-cleanup and the
// setup file has to do it. When it is missing, roots rendered by a test stay
// mounted for the rest of the file and React can flush scheduler work after
// the jsdom environment is torn down, which surfaces as a flaky
// `ReferenceError: window is not defined` unhandled error.
//
// The two cases below are order-dependent on purpose: the second one only
// passes if the first one's tree was unmounted in between.
describe("jsdom test setup", () => {
  it("mounts a tree into the shared document", () => {
    render(<div data-testid="auto-cleanup-probe">monte</div>);

    expect(screen.getByTestId("auto-cleanup-probe")).toBeInTheDocument();
  });

  it("unmounts the previous test tree before the next test runs", () => {
    expect(
      document.body.querySelector("[data-testid='auto-cleanup-probe']")
    ).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });
});
