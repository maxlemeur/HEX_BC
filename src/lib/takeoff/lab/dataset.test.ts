// Failure case written before the fix (Codex review of PR #143, P2): when a dataset document
// changes under the same id after an essai, the verdict screen showed the new PDF beside the
// essai's old answer. A document read for an essai's evidence must match the SHA-256 the essai
// recorded, and be refused otherwise. Read on a real committed fixture, hashed for real.
import { describe, expect, it } from "vitest";

import { readLabDocument } from "@/lib/takeoff/lab/dataset";

const FIXTURE = "fixture-army-chatgpt-plan";

describe("readLabDocument", () => {
  it("serves the document when it still has the SHA-256 the essai recorded", async () => {
    const current = await readLabDocument(FIXTURE);
    await expect(readLabDocument(FIXTURE, { expectedSha256: current.sha256 })).resolves.toMatchObject({ sha256: current.sha256 });
  });

  it("refuses the document when its SHA-256 differs from the one the essai recorded", async () => {
    await expect(readLabDocument(FIXTURE, { expectedSha256: "0".repeat(64) }))
      .rejects.toMatchObject({ status: 409, code: "TAKEOFF_LAB_DOCUMENT_CHANGED" });
  });
});
