import { describe, expect, it } from "vitest";

import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";

describe("normalizeDocumentIssuerDisplay", () => {
  it("derives a readable first and last name when full_name contains an email", () => {
    expect(
      normalizeDocumentIssuerDisplay({
        issuerName: "maxime.michel@hydroexpress.fr",
        issuerRole: "Charge d'affaires",
        issuerEmail: "maxime.michel@hydroexpress.fr",
      })
    ).toEqual({
      displayName: "Maxime MICHEL",
      displayRole: "Charge d'affaires",
      displayEmail: "maxime.michel@hydroexpress.fr",
    });
  });
});
