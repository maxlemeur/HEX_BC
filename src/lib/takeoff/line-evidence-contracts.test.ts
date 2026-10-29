import { describe, expect, it } from "vitest";

import { parseTakeoffLineEvidencePanelResponse } from "@/lib/takeoff/line-evidence-contracts";
import { evidencePanelFixture, IDENTITY } from "@/lib/takeoff/read-contracts.test-fixtures";

describe("line evidence panel response contract", () => {
  it("retains active evidence, replacement history, author and microsecond timestamp", () => {
    const panel = evidencePanelFixture();
    expect(parseTakeoffLineEvidencePanelResponse(panel, IDENTITY)).toEqual(panel);
  });
});
