import { describe, expect, it } from "vitest";

import {
  canUseEstimateTermsSnapshot,
  createDevelopmentEstimateTermsTemplate,
  parseEstimateTermsClauses,
  splitEstimateTermsClauses,
  createEstimateTermsSnapshot,
  parseEstimateTermsSnapshot,
  toEstimatePdfTermsConfiguration,
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

  it("creates and parses an immutable snapshot", () => {
    const snapshot = createEstimateTermsSnapshot(
      template,
      "2026-07-18T13:00:00.000Z",
    );

    expect(parseEstimateTermsSnapshot(snapshot)).toEqual(snapshot);
  });

  it("rejects incomplete snapshots", () => {
    expect(parseEstimateTermsSnapshot({ title: "CGV" })).toBeNull();
  });

  it("exposes only presentation metadata to clients", () => {
    expect(toEstimatePdfTermsConfiguration(template)).toEqual({
      available: true,
      policy: "required",
      title: template.title,
      version: 3,
    });
  });

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

  it("splits the compact draft into two balanced columns", () => {
    const draft = createDevelopmentEstimateTermsTemplate(
      "tenant-1",
      "development",
    );
    const clauses = parseEstimateTermsClauses(draft?.body ?? "");
    const columns = splitEstimateTermsClauses(clauses);
    expect(clauses).toHaveLength(8);
    expect(columns.map((column) => column.length)).toEqual([4, 4]);
    expect(draft?.body).toContain(
      "Sauf mention contraire au devis, les prix sont exprimés hors taxes",
    );
    expect(draft?.body).toContain(
      "Aucun acompte n'est dû s'il n'est pas expressément prévu au devis",
    );
    expect(draft?.body).not.toContain("VALIDITÉ");
    expect(draft?.body).not.toContain("ACCÈS ET CONDITIONS DE CHANTIER");
    expect(draft?.body).not.toContain("Les données de contact");
  });
});

describe("clause TVA et autoliquidation (EST-E27)", () => {
  // La clause 2 affirmait « la TVA est facturée au taux applicable », ce qui est
  // faux en sous-traitance de travaux immobiliers. Sur un document contractuel,
  // c'est une clause qui contredit la loi.
  //
  // Une seule formulation couvre les deux régimes, plutôt que deux gabarits à
  // tenir synchronisés — c'est la divergence que ce dépôt paie assez cher.
  const body = createDevelopmentEstimateTermsTemplate("tenant-1", "development")
    ?.body;

  it("mentionne l'autoliquidation et son fondement", () => {
    expect(body).toContain("Autoliquidation");
    expect(body).toContain("283, 2 nonies");
    expect(body).toContain("due par le preneur");
  });

  it("reste exacte en régime normal", () => {
    expect(body).toContain("la TVA est facturée au taux applicable");
  });
});
