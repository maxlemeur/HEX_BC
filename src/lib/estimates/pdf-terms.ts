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

const ESTIMATE_DRAFT_TERMS_BODY = `1. OBJET ET DOCUMENTS CONTRACTUELS - Les présentes CGV encadrent les prestations réalisées entre professionnels. Le devis accepté, ses annexes et éventuels avenants constituent les conditions particulières et prévalent sur les CGV en cas de contradiction. Les documents du client ne s'appliquent qu'après acceptation écrite du prestataire.

2. VALIDITÉ ET ACCEPTATION - Le devis reste valable pendant la durée qui y est indiquée. Le contrat est formé à réception du devis daté et signé par une personne habilitée, avec la mention d'acceptation, et après encaissement de l'acompte prévu. Toute réserve portée à l'acceptation doit être expressément acceptée par le prestataire.

3. PRIX - Les prix et le régime de TVA sont ceux du devis. Sauf mention contraire, ils supposent des conditions normales d'accès et d'exécution. Toute variation de taxes, de périmètre, de quantités ou de contraintes inconnues lors du chiffrage peut donner lieu à un avenant préalable.

4. ACOMPTE ET PAIEMENT - L'acompte, l'échéancier et le délai de paiement figurent au devis. Aucun escompte n'est accordé sauf stipulation contraire. Tout retard entraîne, de plein droit, des pénalités au taux BCE majoré de 10 points, sans pouvoir être inférieur à trois fois le taux d'intérêt légal, ainsi que l'indemnité forfaitaire légale de 40 € pour frais de recouvrement.

5. DÉLAIS - Les délais sont estimatifs sauf engagement exprès. Ils courent après acceptation, acompte, autorisations, plans validés et mise à disposition du chantier. Ils sont prolongés en cas de modification, retard d'un tiers, intempérie, indisponibilité imprévisible, découverte technique ou événement hors du contrôle raisonnable du prestataire.

6. ACCÈS ET CONDITIONS DE CHANTIER - Le client assure, aux dates convenues, un accès libre et sécurisé, les alimentations nécessaires, les autorisations et informations utiles, ainsi que la coordination des autres intervenants. Il signale avant travaux les réseaux, matériaux dangereux, contraintes d'exploitation et prescriptions propres au site.

7. TRAVAUX SUPPLÉMENTAIRES - Toute prestation non prévue, modification demandée ou sujétion imprévisible fait l'objet d'un devis ou avenant précisant prix et incidence sur le planning. Sauf urgence de mise en sécurité, elle n'est exécutée qu'après accord écrit du client.

8. RÉCEPTION ET RÉSERVES - À l'achèvement, les parties organisent une réception contradictoire. Les réserves sont précises, motivées et consignées dans un procès-verbal. Le prestataire intervient dans un délai raisonnable convenu. L'utilisation de l'ouvrage sans réserve peut constituer un indice de réception, sous réserve des règles impératives applicables.

9. GARANTIES ET RESPONSABILITÉ - Les garanties légales et assurances obligatoires applicables demeurent acquises. Le client notifie rapidement tout désordre et permet sa constatation. Sous réserve des règles impératives, la responsabilité du prestataire couvre les dommages directs et prévisibles qui lui sont imputables et est plafonnée au montant HT encaissé au titre du devis concerné.

10. FORCE MAJEURE - Aucune partie n'est responsable d'un manquement causé par un événement de force majeure au sens du droit français. La partie concernée informe l'autre sans délai. L'exécution est suspendue pendant l'empêchement ; au-delà d'une durée à préciser, chacune peut mettre fin aux prestations restant à exécuter.

11. DONNÉES, PREUVE ET LITIGES - Les données de contact sont traitées pour préparer, exécuter et suivre la relation contractuelle, selon l'information de confidentialité du prestataire. Les écrits et signatures électroniques convenus sont admis comme preuve. Les parties recherchent d'abord une solution amiable ; à défaut, la juridiction compétente est déterminée selon les règles applicables, toute clause attributive devant être spécialement validée.`;

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
    id: "estimate-cgv-b2b-draft-v1",
    tenantId,
    title: "Projet de CGV - Travaux B2B",
    body: ESTIMATE_DRAFT_TERMS_BODY,
    version: 1,
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
