import { describe, expect, it } from "vitest";

import {
  diffItemTemplateDefinitions,
  itemTemplateDefinitionFromTemplate,
  itemTemplateDefinitionSchema,
  itemTemplateFromDefinition,
} from "./item-template";
import { PLUMBING_TEMPLATE, templatePosteDrafts } from "./plumbing-template";

describe("item template definitions", () => {
  const shipped = itemTemplateDefinitionFromTemplate(PLUMBING_TEMPLATE);

  it("round-trips the shipped template into the same items", () => {
    const parsed = itemTemplateDefinitionSchema.parse(JSON.parse(JSON.stringify(shipped)));
    const back = itemTemplateFromDefinition({ key: PLUMBING_TEMPLATE.id, version: 1, publicationId: null, definition: parsed });
    expect(templatePosteDrafts(back)).toEqual(templatePosteDrafts(PLUMBING_TEMPLATE));
  });

  it("refuses two lines sharing an identifier and an unknown qualifier", () => {
    const duplicated = structuredClone(shipped);
    duplicated.families[1].lines.push({ ...duplicated.families[1].lines[0] });
    expect(itemTemplateDefinitionSchema.safeParse(duplicated).success).toBe(false);
    const qualified = structuredClone(shipped) as unknown as { families: Array<{ lines: Array<Record<string, unknown>> }> };
    qualified.families[0].lines[0].qualifiers = { couleur: "rouge" };
    expect(itemTemplateDefinitionSchema.safeParse(qualified).success).toBe(false);
  });

  it("names what a correction adds, removes and changes, by line identifier", () => {
    const next = structuredClone(shipped);
    next.families[1].lines = next.families[1].lines.filter((line) => line.id !== "baignoire")
      .map((line) => line.id === "lavabo" ? { ...line, label: "Lavabo sur colonne" } : line);
    next.families[1].lines.push({ id: "lave-mains", label: "Lave-mains", expectedUnit: "u", measurementBasis: null,
      qualifiers: {}, synonyms: [] });
    const diff = diffItemTemplateDefinitions(shipped, next);
    expect(diff.added.map(({ line }) => line.id)).toEqual(["lave-mains"]);
    expect(diff.removed.map(({ line }) => line.id)).toEqual(["baignoire"]);
    expect(diff.changed.map(({ after }) => after.id)).toEqual(["lavabo"]);
  });

  it("keeps a line's identity when it moves to another family", () => {
    const next = structuredClone(shipped);
    const [moved] = next.families[1].lines.splice(0, 1);
    next.families[2].lines.unshift(moved);
    const diff = diffItemTemplateDefinitions(shipped, next);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([expect.objectContaining({ after: moved, familyChanged: true })]);
  });
});
