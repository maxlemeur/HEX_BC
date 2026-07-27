import { describe, expect, it } from "vitest";

import { resolvePortalDocumentContract } from "@/lib/estimates/portal-document-contract";

const VALID_TERMS = {
  templateId: "11111111-1111-4111-8111-111111111111",
  title: "CGV",
  body: "Conditions contractuelles",
  version: 3,
  legalReviewedAt: "2026-07-01T00:00:00.000Z",
  capturedAt: "2026-07-20T00:00:00.000Z",
};

describe("portal document contract", () => {
  it("keeps a legacy no-CGV portal available", () => {
    expect(resolvePortalDocumentContract(null, "production")).toMatchObject({
      ok: true,
      terms: null,
      issuerUserId: null,
    });
  });

  it("requires the exact usable snapshot when the stored layout includes CGV", () => {
    const missing = resolvePortalDocumentContract(
      {
        status: "ready",
        layout_options: { includeTerms: true },
        terms_snapshot: null,
      },
      "production"
    );
    const invalid = resolvePortalDocumentContract(
      {
        status: "ready",
        layout_options: { includeTerms: true },
        terms_snapshot: { ...VALID_TERMS, legalReviewedAt: null },
      },
      "production"
    );

    expect(missing).toEqual({
      ok: false,
      reason: "required_terms_snapshot_missing_or_invalid",
    });
    expect(invalid).toEqual({
      ok: false,
      reason: "required_terms_snapshot_missing_or_invalid",
    });
  });

  it("returns the stored CGV and immutable PDF generator identity", () => {
    expect(
      resolvePortalDocumentContract(
        {
          status: "ready",
          generated_by: "22222222-2222-4222-8222-222222222222",
          layout_options: { includeTerms: true },
          terms_snapshot: VALID_TERMS,
        },
        "production"
      )
    ).toMatchObject({
      ok: true,
      terms: VALID_TERMS,
      issuerUserId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("blocks a non-ready stored document before acceptance", () => {
    expect(
      resolvePortalDocumentContract({
        status: "failed",
        layout_options: { includeTerms: false },
      })
    ).toEqual({ ok: false, reason: "document_not_ready" });
  });
});
