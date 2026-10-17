import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lot 2, sous-lot 2.6 — charge de sauvegarde des réglages d'une v3 (conception D5, D6, D11, F12 ;
 * EUHIST, CAP et S2 du §5). Isolation justifiée au §4 de docs/testing/estimate-engine-v3-2.6.md :
 * intégrité de contrat (F12) et cas limites de saisie que le parcours `engine-v3-editor` ne peut
 * pas distinguer. Défaillances visées (identifiants du §2 de ce document) :
 *  V3S-01 (F26-01, F26-04) une intention en montant part avec un `discount_bp` dérivé du montant,
 *         ou le montant demandé est remplacé par le montant appliqué (plafond CAP) ;
 *  V3S-02 (F26-02) montant et taux partent ensemble, ou une saisie dans l'autre champ ne remplace
 *         pas l'intention ;
 *  V3S-03 (F26-03) changer un coefficient de vente réécrit le taux (EUHIST), un taux est arrondi à
 *         la saisie, ou vider le champ montant efface une intention en pourcentage ;
 *  V3S-04 (F26-05) un coefficient vidé ou invalide part à 0, ou reprend l'ancienne valeur sans
 *         message.
 *
 * Contrat du module pur que 2.6 crée (§1.2 du document) : `src/lib/estimates/v3-settings-payload.ts`,
 * réexporté par `src/hooks/useEstimateV3Settings.ts`. Recopié ici tant que le module n'existe pas :
 * le build de production des parcours Army vérifie aussi les tests, un import statique d'un module
 * absent le casserait. L'implémentation remplace ces types par
 * `import type { … } from "@/lib/estimates/v3-settings-payload"` et le chargement dynamique par un
 * import statique.
 */
type DiscountIntent =
  | { kind: "none" }
  | { kind: "amount"; amount_cents: number }
  | { kind: "rate"; rate_bp: number };

type Draft = {
  title: string;
  date_devis: string;
  exclusions: string;
  validite_jours: number;
  currency: "EUR" | "USD" | "GBP";
  contractor_role: "principal" | "subcontractor";
  sale_coefficient_fo: number;
  sale_coefficient_mo: number;
  discount: DiscountIntent;
  tax_rate_bp: number;
  rounding_mode: "none" | "down";
  rounding_step_cents: number;
};

type VersionRow = Omit<Draft, "discount"> & {
  discount_amount_cents: number | null;
  discount_bp: number;
};

type Field = "sale_coefficient_fo" | "sale_coefficient_mo" | "discount_amount" | "discount_rate";

type InputErrorCode =
  | "ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED"
  | "ESTIMATE_V3_SALE_COEFFICIENT_INVALID"
  | "ESTIMATE_V3_DISCOUNT_INVALID";

type InputResult = {
  draft: Draft;
  error: { field: Field; code: InputErrorCode; message: string } | null;
};

type Payload = {
  title: string | null;
  exclusions: string | null;
  date_devis: string;
  validite_jours: number;
  currency: Draft["currency"];
  contractor_role: Draft["contractor_role"];
  sale_coefficient_fo: number;
  sale_coefficient_mo: number;
  discount_amount_cents: number | null;
  discount_bp: number;
  tax_rate_bp: number;
  rounding_mode: Draft["rounding_mode"];
  rounding_step_cents: number;
  apply_tax_rate_to_lines?: true;
};

type V3SettingsPayloadApi = {
  readEstimateV3SettingsDraft: (version: VersionRow) => Draft;
  applyEstimateV3SettingsInput: (draft: Draft, field: Field, raw: string) => InputResult;
  buildEstimateV3SettingsPayload: (draft: Draft, options: { applyTaxRateToLines: boolean }) => Payload;
};

const MODULE_PATH = fileURLToPath(new URL("./v3-settings-payload.ts", import.meta.url));
let loadedApi: Promise<V3SettingsPayloadApi> | null = null;

function loadApi(): Promise<V3SettingsPayloadApi> {
  if (!existsSync(MODULE_PATH)) {
    return Promise.reject(new Error(
      "MODULE_ABSENT: src/lib/estimates/v3-settings-payload.ts (sous-lot 2.6, contrat du §1.2 de " +
      "docs/testing/estimate-engine-v3-2.6.md) n'existe pas encore."
    ));
  }
  // Specifier held in a variable: neither tsc nor the Army build resolve the future module.
  loadedApi ??= import(/* @vite-ignore */ MODULE_PATH) as Promise<V3SettingsPayloadApi>;
  return loadedApi;
}

/** Clés exactes d'une charge v3 : aucune clé v2 (marge, coefficient global, cascade) ni total client. */
const PAYLOAD_KEYS = [
  "contractor_role", "currency", "date_devis", "discount_amount_cents", "discount_bp", "exclusions",
  "rounding_mode", "rounding_step_cents", "sale_coefficient_fo", "sale_coefficient_mo", "tax_rate_bp",
  "title", "validite_jours",
];

// S1 du §5.2 : coefficients de la politique (1,30 / 1,20), sans remise, TVA 20 %, sans arrondi.
const S1_ROW: VersionRow = {
  title: "  Devis v3 S1  ", date_devis: "2026-10-17", exclusions: "", validite_jours: 30, currency: "EUR",
  contractor_role: "principal", sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2,
  discount_amount_cents: null, discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1,
};
const S1_PAYLOAD: Payload = {
  title: "Devis v3 S1", exclusions: null, date_devis: "2026-10-17", validite_jours: 30, currency: "EUR",
  contractor_role: "principal", sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2,
  discount_amount_cents: null, discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1,
};
// EUHIST du §5.3 : remise de 10 % saisie à c_FO 1.
const EUHIST_ROW: VersionRow = { ...S1_ROW, sale_coefficient_fo: 1, discount_bp: 1000 };

function accepted(result: InputResult): Draft {
  expect(result.error).toBeNull();
  return result.draft;
}

/** Construit la charge et vérifie à chaque fois les clés exactes et l'exclusivité des intentions (D6). */
function payloadOf(api: V3SettingsPayloadApi, draft: Draft): Payload {
  const payload = api.buildEstimateV3SettingsPayload(draft, { applyTaxRateToLines: false });
  expect(Object.keys(payload).sort()).toEqual(PAYLOAD_KEYS);
  const bothIntents = payload.discount_amount_cents !== null && payload.discount_bp !== 0
    ? { discount_amount_cents: payload.discount_amount_cents, discount_bp: payload.discount_bp }
    : null;
  expect(bothIntents).toBeNull();
  return payload;
}

function intentOf(payload: Payload) {
  return [payload.discount_amount_cents, payload.discount_bp];
}

function codeOf(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "NO_ERROR";
}

describe("v3 settings save payload (lot 2, sous-lot 2.6)", () => {
  it("V3S-01 saves an amount intent with discount_bp 0, never a rate derived from the amount, and keeps the requested amount (F12, S2, CAP)", async () => {
    const api = await loadApi();
    const s1 = api.readEstimateV3SettingsDraft(S1_ROW);
    expect(api.buildEstimateV3SettingsPayload(s1, { applyTaxRateToLines: false })).toEqual(S1_PAYLOAD);

    // S2 : 1,01 € sur 69 054,56 € HT brut ; la sauvegarde v2 enverrait round(101 / 6 905 456 × 10 000).
    const s2 = accepted(api.applyEstimateV3SettingsInput(s1, "discount_amount", "1,01"));
    expect(s2.discount).toEqual({ kind: "amount", amount_cents: 101 });
    expect(payloadOf(api, s2)).toEqual({ ...S1_PAYLOAD, discount_amount_cents: 101, discount_bp: 0 });

    // Un montant saisi sur une intention en pourcentage la remplace : taux remis à 0, jamais redérivé.
    const fromRate = api.readEstimateV3SettingsDraft(EUHIST_ROW);
    const replaced = accepted(api.applyEstimateV3SettingsInput(fromRate, "discount_amount", "1 234,56"));
    expect(intentOf(payloadOf(api, replaced))).toEqual([123456, 0]);

    // CAP : 500 € demandés partent tels quels ; le plafond à l'assiette (400 €) est calculé, jamais écrit.
    const cap = accepted(api.applyEstimateV3SettingsInput(s1, "discount_amount", "500"));
    expect(intentOf(payloadOf(api, cap))).toEqual([50000, 0]);

    // Une version relue garde son intention exacte.
    const reloaded = api.readEstimateV3SettingsDraft({ ...S1_ROW, discount_amount_cents: 101 });
    expect(reloaded.discount).toEqual({ kind: "amount", amount_cents: 101 });
    expect(intentOf(payloadOf(api, reloaded))).toEqual([101, 0]);
  });

  it("V3S-02 never sends both intents: each entry replaces the other one, emptying the active field removes it", async () => {
    const api = await loadApi();
    const steps: Array<[Field, string, number | null, number]> = [
      ["discount_amount", "1,01", 101, 0],
      ["discount_rate", "10", null, 1000],
      ["discount_amount", "0", 0, 0],
      ["discount_amount", "", null, 0],
      ["discount_rate", "12,34 %", null, 1234],
      ["discount_amount", "2 000", 200000, 0],
      ["discount_rate", "5,5", null, 550],
      ["discount_rate", "", null, 0],
    ];
    let draft = api.readEstimateV3SettingsDraft(S1_ROW);
    for (const [field, raw, amountCents, rateBp] of steps) {
      draft = accepted(api.applyEstimateV3SettingsInput(draft, field, raw));
      expect({ field, raw, intent: intentOf(payloadOf(api, draft)) }).toEqual({ field, raw, intent: [amountCents, rateBp] });
    }
  });

  it("V3S-03 keeps the exact rate when a sale coefficient changes (EUHIST), refuses a rate it would have to round, and never clears a rate from the amount field", async () => {
    const api = await loadApi();
    const euhist = api.readEstimateV3SettingsDraft(EUHIST_ROW);
    expect(euhist.discount).toEqual({ kind: "rate", rate_bp: 1000 });

    const doubled = accepted(api.applyEstimateV3SettingsInput(euhist, "sale_coefficient_fo", "2"));
    expect(doubled.discount).toEqual({ kind: "rate", rate_bp: 1000 });
    expect(payloadOf(api, doubled)).toEqual({
      ...S1_PAYLOAD, sale_coefficient_fo: 2, discount_amount_cents: null, discount_bp: 1000,
    });

    let draft = accepted(api.applyEstimateV3SettingsInput(euhist, "discount_rate", "12,34"));
    draft = accepted(api.applyEstimateV3SettingsInput(draft, "sale_coefficient_mo", "1,25"));
    draft = accepted(api.applyEstimateV3SettingsInput(draft, "sale_coefficient_fo", "1,3"));
    expect(intentOf(payloadOf(api, draft))).toEqual([null, 1234]);

    for (const raw of ["12,345", "100,01", "-5", "dix", "1.250"]) {
      const result = api.applyEstimateV3SettingsInput(euhist, "discount_rate", raw);
      expect({ raw, code: result.error?.code, field: result.error?.field }).toEqual({
        raw, code: "ESTIMATE_V3_DISCOUNT_INVALID", field: "discount_rate",
      });
      expect(result.error?.message.trim()).not.toBe("");
      expect(result.draft).toEqual(euhist);
    }

    // Le champ montant d'une intention en pourcentage est vide : le quitter vide ne touche pas au taux.
    const blurred = accepted(api.applyEstimateV3SettingsInput(euhist, "discount_amount", ""));
    expect(intentOf(payloadOf(api, blurred))).toEqual([null, 1000]);
  });

  it("V3S-04 refuses an emptied or invalid sale coefficient with a message, never as 0 nor as a silent old value, and never builds a payload around one", async () => {
    const api = await loadApi();
    const s1 = api.readEstimateV3SettingsDraft(S1_ROW);
    const fields = [["sale_coefficient_fo", /FO/], ["sale_coefficient_mo", /MO/]] as const;

    for (const [field, label] of fields) {
      for (const raw of ["", "   "]) {
        const result = api.applyEstimateV3SettingsInput(s1, field, raw);
        expect({ field, raw, code: result.error?.code, errorField: result.error?.field }).toEqual({
          field, raw, code: "ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED", errorField: field,
        });
        expect(result.error?.message).toMatch(label);
        expect(result.draft).toEqual(s1);
      }
      for (const raw of ["0", "0,00001", "-1", "10,0001", "abc", "1.250", "1,23456", "1,3x"]) {
        const result = api.applyEstimateV3SettingsInput(s1, field, raw);
        expect({ field, raw, code: result.error?.code, errorField: result.error?.field }).toEqual({
          field, raw, code: "ESTIMATE_V3_SALE_COEFFICIENT_INVALID", errorField: field,
        });
        expect(result.error?.message).toMatch(label);
        expect(result.draft).toEqual(s1);
      }
      for (const [raw, value] of [["1,3", 1.3], ["2,6", 2.6], ["10", 10], ["0,0001", 0.0001], ["1,2345", 1.2345]] as const) {
        const draft = accepted(api.applyEstimateV3SettingsInput(s1, field, raw));
        expect({ raw, value: draft[field] }).toEqual({ raw, value });
        expect(payloadOf(api, draft)[field]).toBe(value);
      }
    }

    for (const [field] of fields) {
      for (const value of [0, -1, Number.NaN, 10.5, 1.23456]) {
        expect({ field, value, code: codeOf(() => api.buildEstimateV3SettingsPayload({ ...s1, [field]: value }, { applyTaxRateToLines: false })) })
          .toEqual({ field, value, code: "ESTIMATE_V3_SALE_COEFFICIENT_INVALID" });
      }
    }
  });
});
