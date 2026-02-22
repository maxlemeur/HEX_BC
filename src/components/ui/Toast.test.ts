import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui/Toast";

function ToastHarness() {
  const toast = useToast();

  return createElement(
    "button",
    {
      id: "trigger-toast",
      onClick: () => toast.success({ title: "Saved", description: "Done", durationMs: 100 }),
      type: "button",
    },
    "Trigger"
  );
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
});

describe("ui/Toast", () => {
  it("pushes and auto-dismisses toasts", async () => {
    vi.useFakeTimers();

    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(
          ToastProvider,
          null,
          createElement(ToastHarness)
        )
      );
    });

    const trigger = renderer!.root.findByProps({ id: "trigger-toast" });

    await act(async () => {
      trigger.props.onClick();
    });

    const titleNodes = renderer!.root.findAll(
      (node) => node.type === "p" && node.children.join("") === "Saved"
    );
    expect(titleNodes).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(120);
    });

    const remainingTitleNodes = renderer!.root.findAll(
      (node) => node.type === "p" && node.children.join("") === "Saved"
    );
    expect(remainingTitleNodes).toHaveLength(0);
  });
});
