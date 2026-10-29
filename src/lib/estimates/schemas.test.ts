import { describe, expect, it } from "vitest";

import { createEstimateSchema, createEstimateItemSchema, patchEstimateVersionSchema, updateEstimateAssemblySchema } from "@/lib/estimates/schemas";

const ITEM_ID_1 = "11111111-1111-4111-8111-111111111111";

describe("createEstimateSchema", () => {

  it("preserves the contractor role used by the canonical calculation", () => {
    const parsed = createEstimateSchema.parse({
      project: {
        name: "Projet sous-traitant",
      },
      version: {
        contractor_role: "subcontractor",
      },
    });

    expect(parsed.version?.contractor_role).toBe("subcontractor");
  });
});

describe("createEstimateItemSchema", () => {
  it("accepts optional source provenance fields", () => {
    const parsed = createEstimateItemSchema.parse({
      item_type: "line",
      source_provider: "takeoff",
      source_job_id: ITEM_ID_1,
      source_file_name: "quantif-niveau-a.csv",
      source_page: 7,
    });

    expect(parsed).toMatchObject({
      source_provider: "takeoff",
      source_job_id: ITEM_ID_1,
      source_file_name: "quantif-niveau-a.csv",
      source_page: 7,
    });
  });
});

describe("estimate assembly schemas", () => {
  it("preserves omitted fields on partial update payloads", () => {
    const parsed = updateEstimateAssemblySchema.parse({
      name: "Mur v2",
    });

    expect(parsed).toEqual({
      name: "Mur v2",
    });
    expect("description" in parsed).toBe(false);
    expect("items" in parsed).toBe(false);
  });
});

describe("patchEstimateVersionSchema — regime de TVA (EST-E27)", () => {
  // Sans entree dans le schema, Zod SUPPRIME silencieusement le champ : le
  // chiffreur choisit « sous-traitance », la sauvegarde part sans erreur, et le
  // regime est revenu a « principal » au rechargement. C'est le mecanisme exact
  // qui a fait perdre la MO eclatee pendant 41 commits.
  it("laisse passer le role contractuel", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      expected_content_revision: 1,
      contractor_role: "subcontractor",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contractor_role).toBe("subcontractor");
  });
});
