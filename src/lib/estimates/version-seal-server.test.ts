import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server-context", () => ({
  getAuthenticatedContext: vi.fn(),
  getVersionAccessOrThrow: vi.fn(),
}));
vi.mock("@/lib/estimates/version-lifecycle-repository", () => ({
  loadEstimateSealSource: vi.fn(),
  logEstimateVersionEvent: vi.fn(),
}));
vi.mock("@/lib/estimates/offer-document", () => ({
  loadVerifiedOfferDocument: vi.fn(),
}));
vi.mock("@/lib/estimates/version-seal-plan", () => ({
  evaluateHistoricalEstimateSeal: vi.fn(),
}));

import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import { getAuthenticatedContext, getVersionAccessOrThrow } from "@/lib/estimates/server-context";
import { loadEstimateSealSource, logEstimateVersionEvent } from "@/lib/estimates/version-lifecycle-repository";
import { evaluateHistoricalEstimateSeal } from "@/lib/estimates/version-seal-plan";
import { verifyEstimateSeal } from "@/lib/estimates/version-seal-server";

const VERSION_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    supabase: {}, tenantId: "tenant-1", userId: "user-1", tenantRole: "engineer",
  } as never);
  vi.mocked(loadEstimateSealSource).mockResolvedValue({
    version: { seal_payload_version: 5, calc_engine_version: 3 },
    items: [],
  } as never);
});

describe("document-bound seal verification boundary", () => {
  it("never falls back to historical hashes when a marker 5 document fails verification", async () => {
    const invalidDocument = new Error("Immutable PDF hash mismatch");
    vi.mocked(loadVerifiedOfferDocument).mockRejectedValue(invalidDocument);

    await expect(verifyEstimateSeal(VERSION_ID)).rejects.toBe(invalidDocument);
    expect(evaluateHistoricalEstimateSeal).not.toHaveBeenCalled();
    expect(logEstimateVersionEvent).not.toHaveBeenCalled();
  });

  it("does not load seal contents or write an event before version access is granted", async () => {
    const denied = new Error("Version inaccessible");
    vi.mocked(getVersionAccessOrThrow).mockRejectedValue(denied);

    await expect(verifyEstimateSeal(VERSION_ID)).rejects.toBe(denied);
    expect(loadEstimateSealSource).not.toHaveBeenCalled();
    expect(loadVerifiedOfferDocument).not.toHaveBeenCalled();
    expect(logEstimateVersionEvent).not.toHaveBeenCalled();
  });
});
