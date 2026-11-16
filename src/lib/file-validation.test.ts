import { describe, expect, it } from "vitest";

import { formatFileSize } from "@/lib/file-validation";

describe("formatFileSize", () => {
  it.each([
    [0, "0 o"],
    [1023, "1023 o"],
    [1024, "1.0 Ko"],
    [1536, "1.5 Ko"],
    [1024 * 1024 - 1, "1024.0 Ko"],
    [1024 * 1024, "1.0 Mo"],
    [10 * 1024 * 1024, "10.0 Mo"],
    [Number.NaN, "-"],
    [Number.POSITIVE_INFINITY, "-"],
  ])("formats %d bytes as %j", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
