import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import AppProviders from "@/app/providers";
import { useToast } from "@/components/ui/Toast";

type ToastApi = ReturnType<typeof useToast>;

function ToastContextHarness({
  onReady,
}: {
  onReady: (toast: ToastApi) => void;
}) {
  const toast = useToast();

  useEffect(() => {
    onReady(toast);
  }, [onReady, toast]);

  return null;
}

describe("app/providers", () => {
  it("provides toast context to descendants", async () => {
    let toastApi: ToastApi | null = null;

    await act(async () => {
      create(
        createElement(
          AppProviders,
          null,
          createElement(ToastContextHarness, {
            onReady: (toast) => {
              toastApi = toast;
            },
          })
        )
      );
    });

    if (!toastApi) {
      throw new Error("Toast API unavailable");
    }

    const resolvedToastApi = toastApi as ToastApi;

    expect(typeof resolvedToastApi.success).toBe("function");
  });
});
