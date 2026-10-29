import { describe, expect, it } from "vitest";

import {
  canUseEstimateTermsSnapshot,
  createDevelopmentEstimateTermsTemplate,
  createEstimateTermsSnapshot,
  parseEstimateTermsSnapshot,
} from "@/lib/estimates/pdf-terms";

describe("estimate PDF terms", () => {
  const template = {
    id: "template-1",
    tenantId: "tenant-1",
    title: "Conditions generales de vente",
    body: "Paiement a 30 jours.",
    version: 3,
    policy: "required" as const,
    legalReviewedAt: "2026-07-18T12:00:00.000Z",
  };

  it("exposes the non-contractual draft only in development", () => {
    const draft = createDevelopmentEstimateTermsTemplate(
      "tenant-1",
      "development",
    );
    if (!draft) throw new Error("Expected a development draft.");

    const snapshot = createEstimateTermsSnapshot(
      draft,
      "2026-07-19T08:00:00.000Z",
    );

    expect(draft).toMatchObject({
      id: "estimate-cgv-b2b-draft-v3",
      title: "Projet de CGV - Travaux B2B",
      version: 3,
      legalReviewedAt: null,
      isDraft: true,
    });
    expect(snapshot).toMatchObject({
      legalReviewedAt: null,
      isDraft: true,
    });
    expect(parseEstimateTermsSnapshot(snapshot)).toEqual(snapshot);
    expect(
      createDevelopmentEstimateTermsTemplate("tenant-1", "production"),
    ).toBeNull();
    expect(canUseEstimateTermsSnapshot(snapshot, "development")).toBe(true);
    expect(canUseEstimateTermsSnapshot(snapshot, "production")).toBe(false);
    expect(
      canUseEstimateTermsSnapshot(
        createEstimateTermsSnapshot(template),
        "production",
      ),
    ).toBe(true);
  });
});
