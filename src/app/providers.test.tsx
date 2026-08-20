// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import AppProviders from "@/app/providers";
import { useToast } from "@/components/ui-legacy/Toast";

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
  afterEach(() => {
    cleanup();
  });

  it("provides toast context to descendants", async () => {
    const readyToastApis: ToastApi[] = [];

    render(
      <AppProviders>
        <ToastContextHarness
          onReady={(toast) => {
            readyToastApis.push(toast);
          }}
        />
      </AppProviders>
    );

    await waitFor(() => {
      expect(readyToastApis).toHaveLength(1);
    });

    expect(typeof readyToastApis[0]?.success).toBe("function");
  });
});
