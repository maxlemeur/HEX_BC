import type { PosteDefinition, PosteDraft, PosteSection } from "./poste-list";

type TemplateLine = Readonly<{ id: string; definition: Omit<PosteDefinition, "sections"> }>;
type TemplateFamily = Readonly<{ id: string; title: string; lines: readonly TemplateLine[] }>;

export type PosteTemplate = Readonly<{
  id: string;
  title: string;
  version: number;
  /** The tenant's published version this is (migration A); absent for the definition shipped with the application. */
  publicationId?: string;
  families: readonly TemplateFamily[];
}>;

const PIPE_BASIS = "Longueur suivant l’axe du réseau";
const INSULATION_BASIS = "Longueur de canalisation à calorifuger";
const COUNT_BASIS = "Comptage des éléments distincts";

function pipe(
  id: string, label: string, network: string, material: string, diameter: string, synonyms: readonly string[],
  measurementBasis = PIPE_BASIS,
): TemplateLine {
  return {
    id,
    definition: { label, expectedUnit: "m", measurementBasis, qualifiers: { network, material, diameter }, synonyms },
  };
}

function fixture(id: string, label: string, synonyms: readonly string[]): TemplateLine {
  return { id, definition: { label, expectedUnit: "u", measurementBasis: COUNT_BASIS, qualifiers: {}, synonyms } };
}

function valve(id: string, network: string, diameter: string): TemplateLine {
  return {
    id,
    definition: {
      label: `Vanne d’arrêt ${network} en laiton ${diameter}`, expectedUnit: "u", measurementBasis: COUNT_BASIS,
      qualifiers: { network, material: "Laiton", diameter }, synonyms: ["Vanne d’isolement", "Robinet d’arrêt"],
    },
  };
}

/**
 * Première nomenclature générique à corriger par le métreur : la définition livrée avec l'application, lue par une
 * entreprise qui n'a encore publié aucune version (item-template-server.ts). Les identifiants de familles et de postes
 * ne changent jamais : un poste instancié garde le sien d'une version à l'autre.
 */
export const PLUMBING_TEMPLATE: PosteTemplate = {
  id: "plomberie",
  title: "Plomberie",
  version: 1,
  families: [
    { id: "reseaux", title: "Réseaux", lines: [
      pipe("ef-multicouche-20", "Distribution eau froide multicouche Ø 20 mm", "EF", "Multicouche", "Ø 20 mm", ["Eau froide sanitaire"]),
      pipe("ef-multicouche-26", "Distribution eau froide multicouche Ø 26 mm", "EF", "Multicouche", "Ø 26 mm", ["Eau froide sanitaire"]),
      pipe("ecs-multicouche-20", "Distribution eau chaude multicouche Ø 20 mm", "ECS", "Multicouche", "Ø 20 mm", ["Eau chaude sanitaire"]),
      pipe("ecs-multicouche-26", "Distribution eau chaude multicouche Ø 26 mm", "ECS", "Multicouche", "Ø 26 mm", ["Eau chaude sanitaire"]),
      pipe("becs-multicouche-16", "Bouclage eau chaude multicouche Ø 16 mm", "Bouclage ECS", "Multicouche", "Ø 16 mm", ["Retour eau chaude"]),
      pipe("eu-pvc-40", "Évacuation eaux usées PVC Ø 40 mm", "EU", "PVC", "Ø 40 mm", ["Eaux ménagères"]),
      pipe("eu-pvc-50", "Évacuation eaux usées PVC Ø 50 mm", "EU", "PVC", "Ø 50 mm", ["Eaux ménagères"]),
      pipe("ev-pvc-100", "Évacuation eaux vannes PVC Ø 100 mm", "EV", "PVC", "Ø 100 mm", ["Évacuation WC"]),
    ] },
    { id: "sanitaires", title: "Appareils sanitaires", lines: [
      fixture("lavabo", "Lavabo", ["Vasque", "Lave-mains"]),
      fixture("evier", "Évier", ["Évier de cuisine"]),
      fixture("wc", "WC", ["Cuvette", "Toilettes"]),
      fixture("receveur", "Receveur de douche", ["Bac à douche"]),
      fixture("baignoire", "Baignoire", ["Bain"]),
    ] },
    { id: "robinetterie", title: "Robinetterie", lines: [
      valve("vanne-ef-dn15", "EF", "DN 15"),
      valve("vanne-ef-dn20", "EF", "DN 20"),
      valve("vanne-ecs-dn15", "ECS", "DN 15"),
      valve("vanne-ecs-dn20", "ECS", "DN 20"),
      fixture("mitigeur-lavabo", "Mitigeur de lavabo", ["Robinet mélangeur de lavabo"]),
      fixture("mitigeur-evier", "Mitigeur d’évier", ["Robinet mélangeur d’évier"]),
      fixture("mitigeur-douche", "Mitigeur de douche", ["Robinet mélangeur de douche"]),
    ] },
    { id: "calorifuge", title: "Calorifuge", lines: [
      pipe("isolant-ecs-pe-20", "Calorifuge en mousse PE pour ECS Ø 20 mm", "ECS", "Mousse de polyéthylène", "Ø tube 20 mm", ["Isolation ECS"], INSULATION_BASIS),
      pipe("isolant-ecs-pe-26", "Calorifuge en mousse PE pour ECS Ø 26 mm", "ECS", "Mousse de polyéthylène", "Ø tube 26 mm", ["Isolation ECS"], INSULATION_BASIS),
      pipe("isolant-becs-pe-16", "Calorifuge en mousse PE pour bouclage ECS Ø 16 mm", "Bouclage ECS", "Mousse de polyéthylène", "Ø tube 16 mm", ["Isolation retour ECS"], INSULATION_BASIS),
    ] },
  ],
};

export function templatePosteDrafts(template: PosteTemplate): PosteDraft[] {
  const root: PosteSection = { id: template.id, title: template.title, order: 0 };
  return template.families.flatMap((family, order) => family.lines.map((line): PosteDraft => ({
    ...line.definition,
    sections: [root, { id: family.id, title: family.title, order }],
    referenceQuantity: null,
    origin: {
      kind: "template", templateId: template.id, version: template.version,
      ...(template.publicationId ? { publicationId: template.publicationId } : {}), familyId: family.id, lineId: line.id,
    },
  })));
}
