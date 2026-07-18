import { describe, expect, it } from "vitest";

import { normalizeAffaireProjectId } from "@/lib/affaires/route-segments";

describe("normalizeAffaireProjectId", () => {
  it("keeps a valid project identifier", () => {
    expect(normalizeAffaireProjectId("project-123")).toBe("project-123");
  });

  it.each(["new", "NEW", " new "])(
    "rejects the reserved affaire segment %s",
    (value) => {
      expect(normalizeAffaireProjectId(value)).toBeNull();
    }
  );

  it.each([null, undefined, "", "project/child", "project?tab=plans", "project#plans"])(
    "rejects an invalid persisted identifier %s",
    (value) => {
      expect(normalizeAffaireProjectId(value)).toBeNull();
    }
  );
});
