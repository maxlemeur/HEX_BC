/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BLOB_DOWNLOAD_REVOKE_DELAY_MS,
  downloadBlob,
} from "@/lib/browser-download";

const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
);
const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
);

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(URL, name, descriptor);
    return;
  }

  delete (URL as unknown as Record<string, unknown>)[name];
}

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    restoreUrlMethod("createObjectURL", originalCreateObjectUrlDescriptor);
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrlDescriptor);
    document.body.replaceChildren();
  });

  it("starts the download before revoking the Blob URL", () => {
    const createObjectUrl = vi.fn(() => "blob:estimate-export");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(new Blob(["xlsx-binary"]), "devis-test.xlsx");

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();

    vi.advanceTimersByTime(BLOB_DOWNLOAD_REVOKE_DELAY_MS - 1);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:estimate-export");
  });
});
