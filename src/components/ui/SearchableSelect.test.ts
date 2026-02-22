import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { SearchableSelect } from "@/components/ui/SearchableSelect";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/SearchableSelect", () => {
  it("filters options and selects with keyboard", async () => {
    const onValueChange = vi.fn<(value: string) => void>();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(SearchableSelect, {
          id: "user",
          options: [
            { value: "u1", label: "Alice Martin", keywords: ["alice@example.com"] },
            { value: "u2", label: "Bob Durand", keywords: ["bob@example.com"] },
          ],
          onValueChange,
        })
      );
    });

    const input = renderer!.root.findByProps({ role: "combobox" });

    await act(async () => {
      input.props.onFocus();
      input.props.onChange({ target: { value: "Ali" } });
    });

    await act(async () => {
      input.props.onKeyDown({ key: "ArrowDown", preventDefault: () => undefined });
    });

    await act(async () => {
      input.props.onKeyDown({ key: "Enter", preventDefault: () => undefined });
    });

    expect(onValueChange).toHaveBeenCalledWith("u1");
  });

  it("closes listbox on escape", async () => {
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(SearchableSelect, {
          id: "user",
          options: [{ value: "u1", label: "Alice Martin" }],
        })
      );
    });

    const input = renderer!.root.findByProps({ role: "combobox" });

    await act(async () => {
      input.props.onFocus();
    });
    expect(renderer!.root.findAllByProps({ role: "listbox" })).toHaveLength(1);

    await act(async () => {
      input.props.onKeyDown({ key: "Escape", preventDefault: () => undefined });
    });
    expect(renderer!.root.findAllByProps({ role: "listbox" })).toHaveLength(0);
  });
});
