import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/lib/takeoff/launch-intent-key";

// The browser entry of an unanswered launch command is named by this digest of the tenant, the member and the affaire:
// it must be SHA-256 itself, on every length the padding treats apart (55, 56 and 64 bytes) and on non-ASCII text.
describe("sha256Hex", () => {
  it.each(["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "tenant|membre|affaire é ü"])(
    "equals SHA-256 for %j", (text) => {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    });
});
