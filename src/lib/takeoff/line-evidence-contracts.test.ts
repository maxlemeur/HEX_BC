import { describe, expect, it } from "vitest";

import { parseTakeoffLineEvidencePanelResponse } from "@/lib/takeoff/line-evidence-contracts";
import { evidencePanelFixture, IDENTITY, OTHER_ID } from "@/lib/takeoff/read-contracts.test-fixtures";

describe("line evidence panel response contract", () => {
  it("retains active evidence, replacement history, author and microsecond timestamp", () => {
    const panel = evidencePanelFixture();
    expect(parseTakeoffLineEvidencePanelResponse(panel, IDENTITY)).toEqual(panel);
  });

  it.each(["job_id", "version_id", "line_id"])("rejects wrong %s", (key) => {
    expect(() => parseTakeoffLineEvidencePanelResponse({ ...evidencePanelFixture(), [key]: OTHER_ID }, IDENTITY)).toThrow();
  });

  it.each([
    ["id", { evidence_id: "not-a-uuid" }],
    ["type", { type: "unknown" }],
    ["kind", { kind: "unknown" }],
    ["page", { source_page: -1 }],
    ["confidence", { confidence_score: -0.1 }],
    ["timestamp", { created_at: "not-a-date" }],
    ["status", { status: "replaced" }],
    ["replacement", { replaced_by_evidence_id: OTHER_ID }],
  ])("rejects malformed evidence %s", (_name, patch) => {
    const panel = evidencePanelFixture();
    expect(() => parseTakeoffLineEvidencePanelResponse({
      ...panel, evidences: [{ ...panel.evidences[0], ...patch }],
    }, IDENTITY)).toThrow();
  });

  it("rejects duplicate IDs across active evidence and history", () => {
    const panel = evidencePanelFixture();
    panel.history[0].evidence_id = panel.evidences[0].evidence_id;
    expect(() => parseTakeoffLineEvidencePanelResponse(panel, IDENTITY)).toThrow();
  });

  it("rejects an active entry listed in history", () => {
    const panel = evidencePanelFixture();
    panel.history = panel.evidences;
    panel.evidences = [];
    expect(() => parseTakeoffLineEvidencePanelResponse(panel, IDENTITY)).toThrow();
  });
});
