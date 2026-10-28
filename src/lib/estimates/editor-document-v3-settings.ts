import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import {
  formatEstimateV3Coefficient,
  formatEstimateV3DiscountTexts,
  formatEstimateV3RatePercent,
  readEstimateV3SettingsDraft,
  type EstimateV3SettingsDraft,
  type EstimateV3SettingsField,
  type EstimateV3SettingsInputErrorCode,
  type EstimateV3SettingsPayload,
  type VersionSettingsColumns,
} from "@/lib/estimates/v3-settings-payload";

export type EstimateDocumentV3SettingsVersion = (VersionSettingsColumns & { id: string }) | null | undefined;

/** Champs saisis en texte : les quatre du contrat pur et le taux par défaut des nouvelles lignes. */
export type EstimateV3SettingsTextField = EstimateV3SettingsField | "tax_rate";

export type EstimateV3SettingsFieldError = {
  code: EstimateV3SettingsInputErrorCode | "ESTIMATE_V3_TAX_RATE_INVALID";
  message: string;
};

export type EstimateV3SettingsTexts = Record<EstimateV3SettingsTextField, string>;
export type EstimateV3SettingsFieldErrors = Partial<Record<EstimateV3SettingsTextField, EstimateV3SettingsFieldError>>;

/** Champs du brouillon saisis directement (texte, date, listes) : ni coefficient, ni remise, ni taux. */
export type EstimateV3SettingsDirectPatch = Partial<Pick<EstimateV3SettingsDraft,
  "title" | "date_devis" | "exclusions" | "validite_jours" | "currency" | "contractor_role" | "rounding_mode" | "rounding_step_cents">>;

/** Question de propagation ouverte par `requestSave` : taux demandé et lignes qui portent un autre taux. */
export type EstimateV3TaxPropagationRequest = { rateBp: number; lineCount: number };

export type EstimateV3SavePayloadResult =
  | { ok: true; payload: EstimateV3SettingsPayload }
  | { ok: false; reason: "unavailable" | "field_errors" | "tax_propagation_required"; message: string };

export type EstimateV3MarginTierHint = { multiplier: number; costSubtotalCents: number };

export type EstimateDocumentV3SettingsBaseline =
  | { active: false }
  | { active: true; versionId: string; key: string; draft: EstimateV3SettingsDraft; error: null }
  | { active: true; versionId: string; key: string; draft: null; error: string };

export type EstimateDocumentV3SettingsState = {
  baselineKey: string | null;
  versionId: string | null;
  saved: EstimateV3SettingsDraft | null;
  draft: EstimateV3SettingsDraft | null;
  unavailableMessage: string | null;
  texts: EstimateV3SettingsTexts;
  errors: EstimateV3SettingsFieldErrors;
  /** Réponse à la question de propagation, valable pour ce taux seulement. */
  taxDecision: { rateBp: number; applyToLines: boolean } | null;
  taxPropagation: EstimateV3TaxPropagationRequest | null;
};

export const ESTIMATE_V3_SETTINGS_TEXT_FIELDS: readonly EstimateV3SettingsTextField[] = [
  "sale_coefficient_fo",
  "sale_coefficient_mo",
  "tax_rate",
  "discount_amount",
  "discount_rate",
];

const EMPTY_TEXTS: EstimateV3SettingsTexts = {
  sale_coefficient_fo: "",
  sale_coefficient_mo: "",
  tax_rate: "",
  discount_amount: "",
  discount_rate: "",
};

function isEngineV3Version(version: object): boolean {
  try {
    return usesSaleCoefficients(requireEstimateEngineVersion(version));
  } catch {
    // Moteur absent ou hors domaine : les chemins historiques le refusent déjà par leur nom.
    return false;
  }
}

export function readEstimateDocumentV3SettingsBaseline(version: EstimateDocumentV3SettingsVersion): EstimateDocumentV3SettingsBaseline {
  if (!version || !isEngineV3Version(version)) return { active: false };
  try {
    const draft = readEstimateV3SettingsDraft(version);
    return { active: true, versionId: version.id, key: `${version.id}:${JSON.stringify(draft)}`, draft, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Réglages de la version illisibles.";
    return { active: true, versionId: version.id, key: `${version.id}:error:${message}`, draft: null, error: message };
  }
}

export function estimateDocumentV3SettingsTexts(draft: EstimateV3SettingsDraft | null): EstimateV3SettingsTexts {
  if (!draft) return EMPTY_TEXTS;
  const discount = formatEstimateV3DiscountTexts(draft.discount);
  return {
    sale_coefficient_fo: formatEstimateV3Coefficient(draft.sale_coefficient_fo),
    sale_coefficient_mo: formatEstimateV3Coefficient(draft.sale_coefficient_mo),
    tax_rate: formatEstimateV3RatePercent(draft.tax_rate_bp),
    discount_amount: discount.amount,
    discount_rate: discount.rate,
  };
}

/** Comparaison au sens de la charge : titre et exclusions partent rognés (convention v2). */
function comparableDraft(draft: EstimateV3SettingsDraft | null) {
  return draft ? { ...draft, title: draft.title.trim(), exclusions: draft.exclusions.trim() } : null;
}

export function sameEstimateDocumentV3SettingsDraft(left: EstimateV3SettingsDraft | null, right: EstimateV3SettingsDraft | null) {
  return JSON.stringify(comparableDraft(left)) === JSON.stringify(comparableDraft(right));
}

export function freshEstimateDocumentV3Settings(baseline: EstimateDocumentV3SettingsBaseline): EstimateDocumentV3SettingsState {
  if (!baseline.active) {
    return {
      baselineKey: null, versionId: null, saved: null, draft: null, unavailableMessage: null,
      texts: EMPTY_TEXTS, errors: {}, taxDecision: null, taxPropagation: null,
    };
  }
  return {
    baselineKey: baseline.key,
    versionId: baseline.versionId,
    saved: baseline.draft,
    draft: baseline.draft,
    unavailableMessage: baseline.error,
    texts: estimateDocumentV3SettingsTexts(baseline.draft),
    errors: {},
    taxDecision: null,
    taxPropagation: null,
  };
}

export function hasDirtyEstimateDocumentV3SettingsText(state: EstimateDocumentV3SettingsState) {
  const canonical = estimateDocumentV3SettingsTexts(state.draft);
  return ESTIMATE_V3_SETTINGS_TEXT_FIELDS.some((field) => state.texts[field] !== canonical[field]);
}

/**
 * Nouvelle version relue (sauvegarde, rechargement, sauvegarde de lignes) : sans modification en cours, le
 * brouillon suit la version ; avec des modifications, elles restent et seule la référence enregistrée change.
 */
export function resyncEstimateDocumentV3Settings(state: EstimateDocumentV3SettingsState, baseline: EstimateDocumentV3SettingsBaseline): EstimateDocumentV3SettingsState {
  // A line receipt may advance the revision without changing any settings.
  // It must not consume an invalid text or an unanswered VAT decision.
  if (state.baselineKey === (baseline.active ? baseline.key : null)) return state;
  if (!baseline.active || state.versionId !== baseline.versionId || !state.draft || !baseline.draft) {
    return freshEstimateDocumentV3Settings(baseline);
  }
  const untouched = sameEstimateDocumentV3SettingsDraft(state.draft, state.saved) && !hasDirtyEstimateDocumentV3SettingsText(state) && !state.taxPropagation;
  if (untouched || sameEstimateDocumentV3SettingsDraft(state.draft, baseline.draft)) return freshEstimateDocumentV3Settings(baseline);
  return { ...state, baselineKey: baseline.key, saved: baseline.draft };
}
