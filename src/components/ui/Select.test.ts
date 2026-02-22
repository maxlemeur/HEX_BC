import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui/Select";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Select", () => {
  it("renders options and placeholder", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Select, {
          id: "role",
          placeholder: "Choose",
          options: [
            { value: "admin", label: "Admin" },
            { value: "viewer", label: "Viewer" },
          ],
        })
      );
    });

    const options = renderer!.root.findAllByType("option");
    expect(options).toHaveLength(3);
    expect(options[0]?.children.join("")).toBe("Choose");
  });

  it("calls onValueChange on selection", async () => {
    const onValueChange = vi.fn<(value: string) => void>();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(Select, {
          id: "role",
          options: [{ value: "admin", label: "Admin" }],
          onValueChange,
        })
      );
    });

    const select = renderer!.root.findByType("select");

    await act(async () => {
      select.props.onChange({ target: { value: "admin" } });
    });

    expect(onValueChange).toHaveBeenCalledWith("admin");
  });
});
