import { describe, expect, it } from "vitest";

import {
  buildTakeoffUploadPath,
  deriveDeterministicJobId,
  extractPayloadFingerprint,
  prepareTakeoffUploadSource,
} from "@/lib/takeoff/job-creation-input";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const CONTENT = Buffer.from("designation;quantity;unit\nTube cuivre 22;12,5;ml");
const SOURCE = {
  file: { name: "Métré R+1.csv", type: "text/csv", size: CONTENT.length },
  content: CONTENT,
  estimateVersionId: VERSION_ID,
  level: "A" as const,
  provider: "auto" as const,
};

describe("takeoff upload identity", () => {
  it("retains the receipt fingerprint created before provider selection existed", () => {
    expect(prepareTakeoffUploadSource(SOURCE)).toEqual({
      sourceFileType: "text/csv",
      payloadFingerprint: "c3a749910b629c7c43440a0b714a2db736f66badc5fa96c6c5cfde8fadb244d5",
    });
  });

  it("distinguishes explicit provider choice and content from the same job key", () => {
    const automatic = prepareTakeoffUploadSource(SOURCE).payloadFingerprint;
    const explicit = prepareTakeoffUploadSource({ ...SOURCE, provider: "gemini" }).payloadFingerprint;
    const changed = prepareTakeoffUploadSource({
      ...SOURCE,
      content: Buffer.from("designation;quantity;unit\nTube cuivre 22;13,5;ml"),
    }).payloadFingerprint;

    expect(new Set([automatic, explicit, changed]).size).toBe(3);
    expect(deriveDeterministicJobId(TENANT_ID, "same-key"))
      .not.toBe(deriveDeterministicJobId(VERSION_ID, "same-key"));
  });

  it("normalizes the PDF MIME type before comparing browser upload identities", () => {
    const pdf = { ...SOURCE, level: "B" as const, file: { name: "plan.pdf", type: "application/pdf", size: 48 } };
    expect(prepareTakeoffUploadSource({ ...pdf, file: { ...pdf.file, type: "application/octet-stream" } }))
      .toEqual(prepareTakeoffUploadSource(pdf));
  });

  it("gives concurrent attempts different owned paths while preserving their replay identity", () => {
    const payloadFingerprint = prepareTakeoffUploadSource(SOURCE).payloadFingerprint;
    const jobId = deriveDeterministicJobId(TENANT_ID, "same-key");
    const input = { tenantId: TENANT_ID, jobId, payloadFingerprint, sourceFileName: "../../Métré R+1.csv" };
    const first = buildTakeoffUploadPath({ ...input, attemptId: "attempt-1" });
    const second = buildTakeoffUploadPath({ ...input, attemptId: "attempt-2" });

    expect(first).not.toBe(second);
    expect(first.split("/")).toHaveLength(3);
    for (const path of [first, second, `${TENANT_ID}/${jobId}/${payloadFingerprint}/source.csv`, `${TENANT_ID}/${jobId}/${payloadFingerprint}`]) {
      expect(extractPayloadFingerprint(path)).toBe(payloadFingerprint);
    }
  });
});
