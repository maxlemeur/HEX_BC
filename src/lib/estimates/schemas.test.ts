import { describe, expect, it } from "vitest";

import { batchOperationsSchema, bulkUpdateEstimateItemsRequestSchema, createEstimateSchema, createEstimateItemSchema, createEstimateVariantSchema, createEstimateAssemblySchema, importEstimateSectionsSchema, instantiateEstimateFromTemplateSchema, createMarginTierSchema, moveEstimateItemSchema, patchEstimateVersionSchema, promoteEstimateVariantSchema, suggestionRuleFeedbackSchema, trackSuggestionCorrectionsSchema, updateEstimateAssemblySchema, updateEstimateItemSchema, updateMarginTierSchema, wizardStep2Schema } from "@/lib/estimates/schemas";

const ITEM_ID_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_ID_2 = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

describe("createEstimateSchema", () => {

  it("accepts an empty cascade steps array", () => {
    const parsed = createEstimateSchema.parse({
      project: {
        name: "Projet A",
      },
      version: {
        discount_mode: "cascade",
        discount_steps: [],
      },
    });

    expect(parsed.version).toMatchObject({
      discount_mode: "cascade",
      discount_steps: [],
    });
  });

  it("rejects discount steps without cascade mode", () => {
    const parsed = createEstimateSchema.safeParse({
      project: {
        name: "Projet A",
      },
      version: {
        discount_steps: [200],
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("discount_steps doit être vide en mode simple")
      )
    ).toBe(true);
  });

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

  it("rejects unsupported estimate currencies", () => {
    const parsed = createEstimateSchema.safeParse({
      project: {
        name: "Projet A",
      },
      version: {
        currency: "CHF",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts project_id without requiring project payload", () => {
    const parsed = createEstimateSchema.parse({
      project_id: ITEM_ID_1,
      version: {
        title: "Version depuis projet existant",
      },
    });

    expect(parsed.project_id).toBe(ITEM_ID_1);
    expect(parsed.project).toBeUndefined();
  });

  it("rejects payload when project and project_id are both missing", () => {
    const parsed = createEstimateSchema.safeParse({
      version: {
        title: "Invalide",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts linked_dpgf_source mode when project_id is provided", () => {
    const parsed = createEstimateSchema.parse({
      project_id: ITEM_ID_1,
      creationMode: "linkedDpgfSource",
    });

    expect(parsed.creation_mode).toBe("linked_dpgf_source");
  });

  it("rejects linked_dpgf_source mode without project_id", () => {
    const parsed = createEstimateSchema.safeParse({
      project: {
        name: "Projet A",
      },
      creation_mode: "linked_dpgf_source",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("creation_mode=linked_dpgf_source requiert project_id")
      )
    ).toBe(true);
  });
});

describe("instantiateEstimateFromTemplateSchema", () => {
  it("accepts project_id without project_name", () => {
    const parsed = instantiateEstimateFromTemplateSchema.parse({
      project_id: ITEM_ID_2,
      version_title: "Template V2",
    });

    expect(parsed).toMatchObject({
      project_id: ITEM_ID_2,
      project_name: undefined,
      version_title: "Template V2",
    });
  });

  it("rejects payload when neither project_name nor project_id is provided", () => {
    const parsed = instantiateEstimateFromTemplateSchema.safeParse({
      version_title: "Template",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("createEstimateItemSchema", () => {
  it("normalizes AID values to uppercase and trims spaces", () => {
    const parsed = createEstimateItemSchema.parse({
      item_type: "line",
      aid: "  aa.bb.0123  ",
    });

    expect(parsed.aid).toBe("AA.BB.0123");
  });

  it("converts blank AID values to null", () => {
    const parsed = createEstimateItemSchema.parse({
      item_type: "line",
      aid: "   ",
    });

    expect(parsed.aid).toBeNull();
  });

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

  // EST-031 (Split MO Atelier / Chantier) est une fonctionnalite ACTIVE, pilotee
  // par le flag tenant `EST_031_LABOR_SPLIT` : ticket docs/user_story/tickets/
  // EST-031.md, requise pour repondre aux DPGF clients (PRD-ANALYSIS.md), et
  // EST-E26 etape 5 cable le vrai flag dans l'editeur. Ces colonnes doivent
  // donc rester ecrivables — les refuser fermait le seul chemin de persistance
  // de la ventilation, sans qu'aucune decision de depreciation existe.
  it("accepte les champs de MO eclatee (EST-031)", () => {
    const parsed = createEstimateItemSchema.safeParse({
      item_type: "line",
      h_mo_atelier: 1,
      labor_role_atelier_id: ITEM_ID_1,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepte null pour effacer une ventilation MO", () => {
    const parsed = createEstimateItemSchema.safeParse({
      item_type: "line",
      h_mo_atelier: null,
      k_mo_atelier: null,
      labor_role_atelier_id: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("refuse une ventilation MO negative", () => {
    const parsed = createEstimateItemSchema.safeParse({
      item_type: "line",
      h_mo_atelier: -1,
    });

    expect(parsed.success).toBe(false);
  });

});

describe("patchEstimateVersionSchema", () => {
  it("rejects payloads that only carry updated_at", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      updated_at: UPDATED_AT,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ à mettre à jour")
      )
    ).toBe(true);
  });

  it("keeps nullable text fields as null when blanks are sent", () => {
    const parsed = patchEstimateVersionSchema.parse({
      title: "   ",
      exclusions: "   ",
      updated_at: UPDATED_AT,
    });

    expect(parsed.title).toBeNull();
    expect(parsed.exclusions).toBeNull();
  });

  it("rejects exclusions longer than 5000 characters", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      exclusions: "x".repeat(5001),
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects negative integer totals", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      total_ht_cents: -1,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Doit être >= 0")
      )
    ).toBe(true);
  });

  it("rejects simple mode with non-empty discount steps", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      discount_mode: "simple",
      discount_steps: [150],
      updated_at: UPDATED_AT,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("discount_steps doit être vide en mode simple")
      )
    ).toBe(true);
  });

  it("rejects unsupported currency values", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      currency: "JPY",
      updated_at: UPDATED_AT,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts max_section_depth between 1 and 4", () => {
    expect(
      patchEstimateVersionSchema.safeParse({
        max_section_depth: 1,
        updated_at: UPDATED_AT,
      }).success
    ).toBe(true);
    expect(
      patchEstimateVersionSchema.safeParse({
        max_section_depth: 4,
        updated_at: UPDATED_AT,
      }).success
    ).toBe(true);
  });

  it("rejects max_section_depth outside bounds", () => {
    expect(
      patchEstimateVersionSchema.safeParse({
        max_section_depth: 0,
        updated_at: UPDATED_AT,
      }).success
    ).toBe(false);
    expect(
      patchEstimateVersionSchema.safeParse({
        max_section_depth: 5,
        updated_at: UPDATED_AT,
      }).success
    ).toBe(false);
  });
});

describe("wizardStep2Schema", () => {
  const basePayload = {
    dateDevis: "2026-02-21",
    validiteJours: 30,
    marginMode: "fixed" as const,
    taxRateBp: 2000,
    roundingMode: "none" as const,
  };

  it("rejects unsupported currencies", () => {
    expect(
      wizardStep2Schema.safeParse({
        ...basePayload,
        currency: "CAD",
      }).success
    ).toBe(false);
  });
});

describe("updateEstimateItemSchema", () => {

  it("accepte la mise a jour d'une ventilation MO chantier (EST-031)", () => {
    const parsed = updateEstimateItemSchema.safeParse({
      id: ITEM_ID_1,
      h_mo_chantier: 1,
      labor_role_chantier_id: ITEM_ID_2,
    });

    expect(parsed.success).toBe(true);
  });
});

describe("bulkUpdateEstimateItemsRequestSchema", () => {
  it("accepts bare updates arrays and wraps them in updates", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse([
      {
        id: ITEM_ID_1,
        title: "Ligne 1",
      },
    ]);

    expect(parsed).toEqual({
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
      ],
    });
  });

  it("normalizes AID values in update payloads", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse([
      {
        id: ITEM_ID_1,
        aid: "  ab.cd.9999  ",
      },
    ]);

    expect(parsed.updates[0]?.aid).toBe("AB.CD.9999");
  });

  it("normalizes updated_at when provided in object payloads", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse({
      updated_at: ` ${UPDATED_AT} `,
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
      ],
    });

    expect(parsed.updated_at).toBe(UPDATED_AT);
  });

  it("accepts empty updates when version_patch is provided", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse({
      updates: [],
      version_patch: {
        total_ht_cents: 12500,
        total_tax_cents: 2500,
        total_ttc_cents: 15000,
      },
    });

    expect(parsed.updates).toEqual([]);
    expect(parsed.version_patch).toEqual({
      total_ht_cents: 12500,
      total_tax_cents: 2500,
      total_ttc_cents: 15000,
    });
  });

  it("rejects an empty version_patch object", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [],
      version_patch: {},
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("version_patch ne peut pas être vide")
      )
    ).toBe(true);
  });

  it("rejects fully empty bulk payloads", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("updates ne peut pas être vide")
      )
    ).toBe(true);
  });

  it("rejects duplicated update ids", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
        {
          id: ITEM_ID_1,
          title: "Ligne 2",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some(
        (issue) =>
          issue.path.join(".") === "updates.1.id" &&
          issue.message.includes("identifiants uniques")
      )
    ).toBe(true);
  });

  it("rejects updates that only contain id", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [
        {
          id: ITEM_ID_2,
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ de mise à jour fourni")
      )
    ).toBe(true);
  });

  it("rejects item_type in bulk updates", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [
        {
          id: ITEM_ID_1,
          item_type: "section",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("batchOperationsSchema", () => {

  it("rejects empty operations arrays", () => {
    const parsed = batchOperationsSchema.safeParse({
      operations: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("operations ne peut pas être vide")
      )
    ).toBe(true);
  });

  it("rejects update operations with empty data payload", () => {
    const parsed = batchOperationsSchema.safeParse({
      operations: [
        {
          op: "update",
          id: ITEM_ID_1,
          data: {},
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ de mise à jour fourni")
      )
    ).toBe(true);
  });
});

describe("moveEstimateItemSchema", () => {

  it("rejects invalid source/target ordering constraints", () => {
    const parsed = moveEstimateItemSchema.safeParse({
      item_id: ITEM_ID_1,
      from_parent_id: null,
      to_parent_id: null,
      ordered_source_ids: [ITEM_ID_1],
      ordered_target_ids: [ITEM_ID_2],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("ordered_source_ids ne doit pas contenir item_id")
      )
    ).toBe(true);
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("ordered_target_ids doit contenir item_id")
      )
    ).toBe(true);
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("doivent être différents")
      )
    ).toBe(true);
  });
});

describe("suggestionRuleFeedbackSchema", () => {

  it("rejects unsupported feedback values", () => {
    const parsed = suggestionRuleFeedbackSchema.safeParse({
      feedback: "maybe",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects non-positive or non-integer count values", () => {
    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: 0,
      }).success
    ).toBe(false);

    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: -2,
      }).success
    ).toBe(false);

    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: 1.5,
      }).success
    ).toBe(false);
  });
});

describe("suggestion learning schemas", () => {

  it("rejects unknown tracked fields", () => {
    expect(
      trackSuggestionCorrectionsSchema.safeParse({
        corrections: [
          {
            rule_id: ITEM_ID_1,
            field_name: "quantity",
            original_value: "1",
            corrected_value: "2",
            item_title: "x",
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe("estimate assembly schemas", () => {
  it("accepts a members-only assembly and normalizes member aliases", () => {
    const parsed = createEstimateAssemblySchema.parse({
      name: "Pack salle de bains",
      members: [
        {
          childAssemblyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          quantity: 2.5,
          position: 1,
        },
      ],
    });

    expect(parsed.items).toEqual([]);
    expect(parsed.members).toEqual([
      {
        child_assembly_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        quantity: 2.5,
        position: 1,
      },
    ]);
  });

  it("rejects duplicate members and positions shared with direct lines", () => {
    const childAssemblyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const duplicate = createEstimateAssemblySchema.safeParse({
      name: "Composition invalide",
      items: [{ title: "Ligne", position: 1 }],
      members: [
        { childAssemblyId, quantity: 1, position: 1 },
        { childAssemblyId, quantity: 2, position: 2 },
      ],
    });

    expect(duplicate.success).toBe(false);
    if (duplicate.success) return;
    expect(
      duplicate.error.issues.some((issue) =>
        issue.message.includes("sous-ouvrage")
      )
    ).toBe(true);
    expect(
      duplicate.error.issues.some((issue) =>
        issue.message.includes("tous les contenus")
      )
    ).toBe(true);
  });


  it("rejects assemblies with no lines or more than 50 lines", () => {
    expect(
      createEstimateAssemblySchema.safeParse({
        name: "Vide",
        items: [],
      }).success
    ).toBe(false);

    expect(
      createEstimateAssemblySchema.safeParse({
        name: "Trop long",
        items: Array.from({ length: 51 }, (_, index) => ({
          title: `Ligne ${index + 1}`,
          position: index + 1,
        })),
      }).success
    ).toBe(false);
  });

  it("rejects duplicated positions", () => {
    const parsed = createEstimateAssemblySchema.safeParse({
      name: "Doublons",
      items: [
        { title: "Ligne A", position: 1 },
        { title: "Ligne B", position: 1 },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("positions des lignes")
      )
    ).toBe(true);
  });

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

describe("estimate import schemas", () => {

  it("rejects duplicate section ids", () => {
    const parsed = importEstimateSectionsSchema.safeParse({
      sourceVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sectionIds: [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      mode: "append",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("identifiants uniques")
      )
    ).toBe(true);
  });
});

describe("estimate variant schemas", () => {

  it("rejects unexpected fields", () => {
    expect(
      createEstimateVariantSchema.safeParse({ force: true }).success
    ).toBe(false);
    expect(
      promoteEstimateVariantSchema.safeParse({ foo: "bar" }).success
    ).toBe(false);
  });
});

describe("createMarginTierSchema", () => {

  it("rejects negative threshold", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: -1,
      multiplier: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer threshold", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 1000.5,
      multiplier: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects multiplier > 100", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects multiplier < 0", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects NaN multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("accepts boundary 0 for multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts boundary 100 for multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 100,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateMarginTierSchema", () => {
  it("rejects empty payload", () => {
    const result = updateMarginTierSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects multiplier > 100", () => {
    const result = updateMarginTierSchema.safeParse({ multiplier: 100.1 });
    expect(result.success).toBe(false);
  });
});

describe("patchEstimateVersionSchema — regime de TVA (EST-E27)", () => {
  // Sans entree dans le schema, Zod SUPPRIME silencieusement le champ : le
  // chiffreur choisit « sous-traitance », la sauvegarde part sans erreur, et le
  // regime est revenu a « principal » au rechargement. C'est le mecanisme exact
  // qui a fait perdre la MO eclatee pendant 41 commits.
  it("laisse passer le role contractuel", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      contractor_role: "subcontractor",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contractor_role).toBe("subcontractor");
  });

  it("accepte aussi le regime normal", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      contractor_role: "principal",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse une valeur hors de la contrainte CHECK de la colonne", () => {
    expect(
      patchEstimateVersionSchema.safeParse({ contractor_role: "autre" }).success
    ).toBe(false);
  });
});
