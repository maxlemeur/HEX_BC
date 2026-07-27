import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * UX-D — parité portail / PDF.
 *
 * Le portail ne transmettait ni `terms`, ni `exclusions`, ni `layout`, ni les
 * coordonnées émetteur à `EstimateDocument`, alors que la page d'impression
 * passe les quatre. Conséquence : le client cochait « J'accepte ce devis et
 * ses conditions » sur une page qui ne les affichait jamais, et pouvait voir
 * autre chose que le PDF reçu par email.
 *
 * Ce garde compare les DEUX surfaces plutôt que d'affirmer l'une : si une
 * cinquième prop apparaît un jour côté impression sans être reprise au portail,
 * la divergence redevient invisible.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const PORTAL = read("src/app/portal/[token]/page.tsx");
const PRINT = read("src/app/dashboard/estimates/[versionId]/print/page.tsx");
const PORTAL_CONTRACT = read(
  "src/lib/estimates/portal-document-contract.ts"
);

const CONTRACTUAL_PROPS = [
  "exclusions=",
  "issuerName=",
  "issuerRole=",
  "issuerPhone=",
  "issuerEmail=",
  "layout=",
  "terms=",
];

describe("portail — parité documentaire avec l'impression", () => {
  it.each(CONTRACTUAL_PROPS)(
    "transmet %s au document, comme la page d'impression",
    (prop) => {
      expect(PRINT).toContain(prop);
      expect(PORTAL).toContain(prop);
    }
  );

  it("lit la mise en page et les CGV du document STOCKÉ, pas d'un modèle vivant", () => {
    // La parité est garantie par construction : les deux surfaces dérivent du
    // même snapshot, plutôt que d'être deux chemins à tenir synchronisés.
    expect(PORTAL).toContain("estimate_documents");
    expect(PORTAL).toContain("terms_snapshot");
    expect(PORTAL).toContain("layout_options");
    expect(PORTAL).toContain("generated_by");
  });

  it("n'affiche pas de CGV brouillon au client", () => {
    expect(PORTAL).toContain("resolvePortalDocumentContract");
    expect(PORTAL_CONTRACT).toContain("canUseEstimateTermsSnapshot");
  });

  it("refuse la page si la copie contractuelle stockée est illisible", () => {
    expect(PORTAL).toMatch(/documentResult\.error[\s\S]*notFound\(\)/);
    expect(PORTAL).toMatch(/!documentContract\.ok[\s\S]*notFound\(\)/);
  });
});
