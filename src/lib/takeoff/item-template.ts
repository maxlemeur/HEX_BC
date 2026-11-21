/**
 * The item templates an administrator publishes (migration 20261121180813_takeoff_item_lists.sql): the definition's
 * contract (the database checks the same bounds), its conversion from and to the template the lists read, and what a
 * correction adds, removes and changes, by line identifier. A line keeps its identifier from version to version: an
 * item instantiated from it keeps its identity in every affaire.
 */
import { z } from "zod";

import type { PosteQualifiers } from "./poste-list";
import type { PosteTemplate } from "./plumbing-template";

export const ITEM_TEMPLATE_KEYS = ["plomberie"] as const;
export type ItemTemplateKey = (typeof ITEM_TEMPLATE_KEYS)[number];

const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Identifiant invalide : lettres minuscules, chiffres et tirets.");
const trimmed = (max: number, label: string) => z.string().trim()
  .min(1, `${label} : champ obligatoire.`).max(max, `${label} : ${max} caractères au plus.`);
const optionalText = (max: number, label: string) => z.string().trim().max(max, `${label} : ${max} caractères au plus.`)
  .nullable().transform((value) => value || null);
const qualifier = z.string().trim().min(1).max(120);

export const itemTemplateLineSchema = z.object({
  id: identifier,
  label: trimmed(300, "Désignation"),
  expectedUnit: optionalText(16, "Unité"),
  measurementBasis: optionalText(300, "Base de mesure"),
  qualifiers: z.object({
    network: qualifier.optional(), material: qualifier.optional(), diameter: qualifier.optional(),
    convention: qualifier.optional(), scope: qualifier.optional(),
  }).strict(),
  synonyms: z.array(z.string().trim().min(1).max(120)).max(20),
}).strict();

export const itemTemplateDefinitionSchema = z.object({
  contract: z.literal(1),
  title: trimmed(120, "Titre"),
  families: z.array(z.object({
    id: identifier,
    title: trimmed(120, "Famille"),
    lines: z.array(itemTemplateLineSchema),
  }).strict()).min(1).max(50),
}).strict().superRefine((definition, context) => {
  const families = new Set<string>();
  const lines = new Set<string>();
  let count = 0;
  definition.families.forEach((family, familyIndex) => {
    if (families.has(family.id)) {
      context.addIssue({ code: "custom", path: ["families", familyIndex, "id"], message: `Famille « ${family.id} » en double.` });
    }
    families.add(family.id);
    family.lines.forEach((line, lineIndex) => {
      count += 1;
      if (lines.has(line.id)) {
        context.addIssue({ code: "custom", path: ["families", familyIndex, "lines", lineIndex, "id"],
          message: `Poste « ${line.id} » en double : chaque poste garde un identifiant unique.` });
      }
      lines.add(line.id);
    });
  });
  if (count < 1 || count > 1000) {
    context.addIssue({ code: "custom", path: ["families"], message: "Le gabarit compte de 1 à 1 000 postes." });
  }
});

export type ItemTemplateDefinition = z.infer<typeof itemTemplateDefinitionSchema>;
export type ItemTemplateLine = ItemTemplateDefinition["families"][number]["lines"][number];

export function itemTemplateDefinitionFromTemplate(template: PosteTemplate): ItemTemplateDefinition {
  return {
    contract: 1,
    title: template.title,
    families: template.families.map((family) => ({
      id: family.id,
      title: family.title,
      lines: family.lines.map((line) => ({
        id: line.id,
        label: line.definition.label,
        expectedUnit: line.definition.expectedUnit,
        measurementBasis: line.definition.measurementBasis,
        qualifiers: { ...line.definition.qualifiers },
        synonyms: [...(line.definition.synonyms ?? [])],
      })),
    })),
  };
}

export function itemTemplateFromDefinition(input: {
  key: string; version: number; publicationId: string | null; definition: ItemTemplateDefinition;
}): PosteTemplate {
  return {
    id: input.key,
    title: input.definition.title,
    version: input.version,
    ...(input.publicationId ? { publicationId: input.publicationId } : {}),
    families: input.definition.families.map((family) => ({
      id: family.id,
      title: family.title,
      lines: family.lines.map((line) => ({
        id: line.id,
        definition: {
          label: line.label,
          expectedUnit: line.expectedUnit,
          measurementBasis: line.measurementBasis,
          qualifiers: Object.fromEntries(Object.entries(line.qualifiers).filter(([, value]) => value)) as PosteQualifiers,
          synonyms: [...line.synonyms],
        },
      })),
    })),
  };
}

type Located = { familyId: string; familyTitle: string; line: ItemTemplateLine };

function located(definition: ItemTemplateDefinition): Map<string, Located> {
  return new Map(definition.families.flatMap((family) => family.lines.map((line) => [line.id,
    { familyId: family.id, familyTitle: family.title, line }] as const)));
}

const lineFacts = (line: ItemTemplateLine) =>
  JSON.stringify([line.label, line.expectedUnit, line.measurementBasis, Object.entries(line.qualifiers).sort(), line.synonyms]);

/** What a correction does, line by line: the preview an administrator confirms before publishing. */
export function diffItemTemplateDefinitions(previous: ItemTemplateDefinition, next: ItemTemplateDefinition) {
  const before = located(previous);
  const after = located(next);
  const added = [...after.values()].filter(({ line }) => !before.has(line.id));
  const removed = [...before.values()].filter(({ line }) => !after.has(line.id));
  const changed = [...after.values()].flatMap(({ familyId, familyTitle, line }) => {
    const old = before.get(line.id);
    if (!old) return [];
    const familyChanged = old.familyId !== familyId;
    if (!familyChanged && lineFacts(old.line) === lineFacts(line)) return [];
    return [{ before: old.line, after: line, familyChanged, familyTitle }];
  });
  return { added, removed, changed };
}
