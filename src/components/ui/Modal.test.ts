import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { Modal } from "@/components/ui/Modal";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ui/Modal", () => {
  it("renders dialog when open and closes on overlay click", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(
          Modal.Root,
          { open: true, onOpenChange } as never,
          createElement(Modal.Content, null, createElement(Modal.Title, null, "Title"))
        )
      );
    });

    const dialog = renderer!.root.findByProps({ role: "dialog" });
    expect(dialog.props["aria-modal"]).toBe("true");

    const overlay = renderer!.root.findByProps({ "data-ui-modal-overlay": "true" });
    await act(async () => {
      overlay.props.onMouseDown();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(
          Modal.Root,
          { open: true, onOpenChange } as never,
          createElement(Modal.Content, null, createElement(Modal.Title, null, "Title"))
        )
      );
    });

    const dialog = renderer!.root.findByProps({ role: "dialog" });

    await act(async () => {
      dialog.props.onKeyDown({ key: "Escape", preventDefault: () => undefined });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
