import type { Json } from "@/types/database";

import type {
  EstimatePdfTermsConfiguration,
  EstimateTermsPolicy,
} from "@/lib/estimates/pdf-layout";

export type EstimateTermsTemplate = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  version: number;
  policy: EstimateTermsPolicy;
  legalReviewedAt: string | null;
  isDraft?: boolean;
};

export type EstimateTermsSnapshot = {
  templateId: string;
  title: string;
  body: string;
  version: number;
  legalReviewedAt: string | null;
  capturedAt: string;
  isDraft?: boolean;
};

export type EstimateTermsClause = {
  heading: string | null;
  text: string;
};

export const ESTIMATE_DRAFT_TERMS_NOTICE =
  "Maquette de travail à faire valider par un conseil juridique avant toute utilisation contractuelle.";

const ESTIMATE_DRAFT_TERMS_BODY = `1. FORMATION ET DOCUMENTS CONTRACTUELS - Le contrat est formé par l'acceptation écrite du devis par une personne habilitée. Le devis, ses précisions et exclusions particulières, ses annexes et ses avenants constituent les conditions particulières et prévalent sur les présentes CGV en cas de contradiction. Les documents du client ne s'appliquent qu'après acceptation écrite du prestataire.

2. PRIX, FACTURATION ET PAIEMENT - Sauf mention contraire au devis, les prix sont exprimés hors taxes et la TVA est facturée au taux applicable. Les modalités et délais de paiement sont ceux du devis et des factures. Aucun acompte n'est dû s'il n'est pas expressément prévu au devis. Aucun escompte n'est accordé sauf stipulation contraire. Tout retard entraîne de plein droit des pénalités au taux BCE majoré de 10 points, sans pouvoir être inférieur à trois fois le taux d'intérêt légal, ainsi que l'indemnité forfaitaire légale de 40 € pour frais de recouvrement.

3. DÉLAIS, SUSPENSION ET EMPÊCHEMENTS - Les dates et délais sont ceux du devis. Ils courent lorsque le client a fourni les informations, autorisations et conditions nécessaires à l'exécution, ainsi que tout autre préalable expressément prévu au devis. Ils sont prolongés en cas de modification, retard d'un tiers, intempérie, sujétion imprévisible ou événement hors du contrôle raisonnable du prestataire. Après mise en demeure restée sans effet, le prestataire peut suspendre l'exécution en cas d'impayé ou d'empêchement imputable au client.

4. PÉRIMÈTRE ET TRAVAUX SUPPLÉMENTAIRES - Le prix couvre uniquement les prestations expressément décrites au devis. Toute demande, modification ou sujétion extérieure à ce périmètre fait l'objet d'un devis ou d'un avenant précisant son prix et son incidence sur le planning. Sauf urgence de mise en sécurité, elle n'est exécutée qu'après accord écrit du client.

5. RÉCEPTION ET RÉSERVES - À l'achèvement, les parties organisent une réception contradictoire. Les réserves sont précises, motivées et consignées dans un procès-verbal. Le prestataire intervient dans le délai raisonnable convenu. L'utilisation de l'ouvrage sans réserve peut constituer un indice de réception, sous réserve des règles impératives applicables.

6. GARANTIES, ASSURANCES ET RESPONSABILITÉ - Les garanties légales et assurances obligatoires applicables demeurent acquises. Le client signale rapidement tout désordre et permet sa constatation. Sous réserve des règles impératives, la responsabilité du prestataire ne couvre que les dommages directs et prévisibles qui lui sont imputables.

7. FORCE MAJEURE - Aucune partie n'est responsable d'un manquement causé par un événement de force majeure au sens du droit français. La partie concernée informe l'autre sans délai et l'exécution est suspendue pendant l'empêchement. Si celui-ci se prolonge, les parties conviennent par écrit des suites du contrat ou appliquent les règles légales de résolution.

8. PREUVE, DROIT APPLICABLE ET LITIGES - Les écrits et signatures électroniques convenus sont admis comme preuve. Le contrat est soumis au droit français. Les parties recherchent d'abord une solution amiable ; à défaut, la juridiction compétente est déterminée selon les règles applicables, toute clause attributive devant faire l'objet d'une validation juridique spécifique.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function createEstimateTermsSnapshot(
  template: EstimateTermsTemplate,
  capturedAt = new Date().toISOString(),
): EstimateTermsSnapshot {
  if (!template.isDraft && !nonBlankString(template.legalReviewedAt)) {
    throw new Error(
      "A reviewed estimate terms template requires a review date.",
    );
  }

  return {
    templateId: template.id,
    title: template.title,
    body: template.body,
    version: template.version,
    legalReviewedAt: template.legalReviewedAt,
    capturedAt,
    ...(template.isDraft ? { isDraft: true } : {}),
  };
}

export function parseEstimateTermsSnapshot(
  value: Json | null | undefined,
): EstimateTermsSnapshot | null {
  if (!isRecord(value)) return null;
  const templateId = nonBlankString(value.templateId);
  const title = nonBlankString(value.title);
  const body = nonBlankString(value.body);
  const isDraft = value.isDraft === true;
  const legalReviewedAt = nonBlankString(value.legalReviewedAt);
  const capturedAt = nonBlankString(value.capturedAt);
  const version =
    typeof value.version === "number" && Number.isInteger(value.version)
      ? value.version
      : null;

  if (
    !templateId ||
    !title ||
    !body ||
    (!isDraft && !legalReviewedAt) ||
    !capturedAt ||
    version === null ||
    version < 1
  ) {
    return null;
  }

  return {
    templateId,
    title,
    body,
    version,
    legalReviewedAt,
    capturedAt,
    ...(isDraft ? { isDraft: true } : {}),
  };
}

export function canUseEstimateTermsSnapshot(
  snapshot: EstimateTermsSnapshot,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  return !snapshot.isDraft || nodeEnv === "development";
}

export function parseEstimateTermsClauses(body: string): EstimateTermsClause[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const separatorIndex = paragraph.indexOf(" - ");
      if (separatorIndex < 0) {
        return { heading: null, text: paragraph };
      }

      return {
        heading: paragraph.slice(0, separatorIndex).trim(),
        text: paragraph.slice(separatorIndex + 3).trim(),
      };
    });
}

export function splitEstimateTermsClauses(
  clauses: EstimateTermsClause[],
): [EstimateTermsClause[], EstimateTermsClause[]] {
  const columnBreak = Math.ceil(clauses.length / 2);
  return [clauses.slice(0, columnBreak), clauses.slice(columnBreak)];
}

export function createDevelopmentEstimateTermsTemplate(
  tenantId: string,
  nodeEnv = process.env.NODE_ENV,
): EstimateTermsTemplate | null {
  if (nodeEnv !== "development") return null;

  return {
    id: "estimate-cgv-b2b-draft-v2",
    tenantId,
    title: "Projet de CGV - Travaux B2B",
    body: ESTIMATE_DRAFT_TERMS_BODY,
    version: 2,
    policy: "default",
    legalReviewedAt: null,
    isDraft: true,
  };
}

export function toEstimatePdfTermsConfiguration(
  template: EstimateTermsTemplate | null,
): EstimatePdfTermsConfiguration {
  if (!template) {
    return {
      available: false,
      policy: "optional",
      title: null,
      version: null,
    };
  }

  return {
    available: true,
    policy: template.policy,
    title: template.title,
    version: template.version,
  };
}
