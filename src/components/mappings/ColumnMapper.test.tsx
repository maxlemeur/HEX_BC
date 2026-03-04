import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { ColumnMapper } from "@/components/mappings/ColumnMapper";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function extractText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (!node.children) return "";
  return node.children.map((child) => extractText(child as ReactTestInstance | string)).join("");
}

describe("ColumnMapper", () => {
  it("does not mutate mapping through conflict removal when disabled", async () => {
    const onChange = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(ColumnMapper, {
          sourceColumns: ["Code", "Description"],
          mapping: {
            Code: "hex_code",
            Description: "hex_code",
            LegacyColumn: "designation",
          },
          targetFields: [
            { value: "hex_code", label: "Reference article", required: true },
            { value: "designation", label: "Designation", required: true },
          ],
          disabled: true,
          onChange,
        })
      );
    });

    const retirerButton = renderer.root
      .findAllByType("button")
      .find((button: ReactTestInstance) => extractText(button) === "Retirer");

    expect(retirerButton).toBeDefined();
    if (!retirerButton) {
      throw new Error("Retirer button not found");
    }

    expect(retirerButton.props.disabled).toBe(true);

    await act(async () => {
      retirerButton.props.onClick();
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
