"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import {
  EstimateV3SettingsError,
  applyEstimateV3SettingsInput,
  applyEstimateV3TaxRateInput,
  buildEstimateV3SettingsPayload,
  computeEstimateV3SettingsPreview,
  countEstimateV3LinesWithOtherTaxRate,
  formatEstimateV3Coefficient,
  formatEstimateV3DiscountTexts,
  formatEstimateV3RatePercent,
  readEstimateV3SettingsDraft,
  resolveEstimateV3MarginTierHint,
  type EstimateV3PreviewLaborRole,
  type EstimateV3PreviewLine,
  type EstimateV3SettingsDraft,
  type EstimateV3SettingsField,
  type EstimateV3SettingsInputErrorCode,
  type EstimateV3SettingsPayload,
  type EstimateV3SettingsPreview,
  type VersionSettingsColumns,
} from "@/lib/estimates/v3-settings-payload";

/**
 * Lot 2, sous-lot 2.6 - état des réglages d'une v3 (§1.3 de docs/testing/estimate-engine-v3-2.6.md).
 * Actif si et seulement si la version est au moteur 3 : sur une v1/v2 le hook rend `null` et la
 * sauvegarde v2 (et sa réécriture du taux, P-04) reste celle de `useEstimateEditorState`.
 * Le cœur pur (`v3-settings-payload.ts`) est réexporté ici.
 */
export * from "@/lib/estimates/v3-settings-payload";

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

export type UseEstimateV3SettingsInput = {
  /** Ligne de version de l'éditeur (`calc_engine_version` obligatoire, colonnes de réglages). */
  version: (VersionSettingsColumns & { id: string }) | null | undefined;
  /** Lignes courantes de l'éditeur (sections ignorées). */
  items: readonly EstimateV3PreviewLine[];
  /** Rôles du propriétaire : leur `hourly_rate_cents` vaut pour la MO, l'atelier et le chantier, comme au serveur. */
  laborRoles: readonly EstimateV3PreviewLaborRole[];
  laborSplitEnabled: boolean;
  /** Barème **de l'entreprise** seulement (jamais le barème codé en dur) : repère non appliqué. */
  marginTiers?: readonly MarginTier[] | null;
};

export type EstimateV3SettingsController = {
  /** Brouillon des réglages ; nul si la version v3 est illisible (`unavailableMessage`). */
  draft: EstimateV3SettingsDraft | null;
  /** Réglages enregistrés (relus de la version). */
  saved: EstimateV3SettingsDraft | null;
  unavailableMessage: string | null;
  /** Texte affiché de chaque champ saisi (celui de l'utilisateur tant qu'il n'est pas validé). */
  texts: EstimateV3SettingsTexts;
  /** Erreur par champ : affichée sous le champ, elle bloque la sauvegarde tant qu'elle est là. */
  errors: EstimateV3SettingsFieldErrors;
  hasErrors: boolean;
  /** Brouillon ou texte non enregistré. */
  isDirty: boolean;
  /** Frappe : une saisie valide s'applique aussitôt (aperçu), une saisie invalide attend la sortie du champ. */
  setText: (field: EstimateV3SettingsTextField, raw: string) => void;
  /** Sortie du champ : valide le texte affiché, ou affiche le refus en gardant l'ancienne valeur. */
  commitText: (field: EstimateV3SettingsTextField) => void;
  /** Saisie complète d'un champ (frappe puis sortie). */
  applyInput: (field: EstimateV3SettingsTextField, raw: string) => void;
  updateDraft: (patch: EstimateV3SettingsDirectPatch) => void;
  /**
   * « Enregistrer le paramétrage » : valide les textes en attente, refuse s'il reste une erreur, ouvre la
   * question de propagation si le taux par défaut change et qu'une ligne porte un autre taux, sinon appelle
   * `save` (qui construit la charge par `buildSavePayload`). Rend vrai si `save` a été appelé.
   */
  requestSave: (save: () => unknown) => boolean;
  /** Question de propagation ouverte (`TaxRatePropagationDialog`), nulle sinon. */
  taxPropagation: EstimateV3TaxPropagationRequest | null;
  /**
   * Réponse à la question : « Oui » (vrai) applique le taux à toutes les lignes dans la même sauvegarde,
   * « Non » (faux) ne change que la version ; puis appelle `save`, la sauvegarde courante de l'éditeur.
   */
  confirmTaxPropagation: (applyToLines: boolean, save: () => unknown) => void;
  /** Fermeture sans réponse : rien n'est envoyé. */
  cancelTaxPropagation: () => void;
  /** Charge v3 de `saveEstimateVersion` ; refuse tant qu'une erreur de champ ou la question de propagation reste ouverte. */
  buildSavePayload: () => EstimateV3SavePayloadResult;
  /** Abandon des modifications : retour aux réglages enregistrés. */
  reset: () => void;
  /** Aperçu du moteur pur sur le brouillon et les lignes courantes ; jamais envoyé comme total. */
  preview: EstimateV3SettingsPreview | null;
  /** Repère du barème de l'entreprise pour le déboursé de l'aperçu, ou nul (pas de barème, pas d'aperçu). */
  marginTierHint: EstimateV3MarginTierHint | null;
};

type Baseline =
  | { active: false }
  | { active: true; versionId: string; key: string; draft: EstimateV3SettingsDraft; error: null }
  | { active: true; versionId: string; key: string; draft: null; error: string };

type EditorState = {
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

const TEXT_FIELDS: readonly EstimateV3SettingsTextField[] = [
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

const TAX_PROPAGATION_REQUIRED_MESSAGE =
  "Indiquez si le nouveau taux de TVA s'applique à toutes les lignes avant d'enregistrer le paramétrage.";

function isEngineV3Version(version: object): boolean {
  try {
    return usesSaleCoefficients(requireEstimateEngineVersion(version));
  } catch {
    // Moteur absent ou hors domaine : les chemins historiques le refusent déjà par leur nom.
    return false;
  }
}

function readBaseline(version: UseEstimateV3SettingsInput["version"]): Baseline {
  if (!version || !isEngineV3Version(version)) return { active: false };
  try {
    const draft = readEstimateV3SettingsDraft(version);
    return { active: true, versionId: version.id, key: `${version.id}:${JSON.stringify(draft)}`, draft, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Réglages de la version illisibles.";
    return { active: true, versionId: version.id, key: `${version.id}:error:${message}`, draft: null, error: message };
  }
}

function textsOf(draft: EstimateV3SettingsDraft | null): EstimateV3SettingsTexts {
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

function sameDraft(left: EstimateV3SettingsDraft | null, right: EstimateV3SettingsDraft | null) {
  return JSON.stringify(comparableDraft(left)) === JSON.stringify(comparableDraft(right));
}

function freshState(baseline: Baseline): EditorState {
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
    texts: textsOf(baseline.draft),
    errors: {},
    taxDecision: null,
    taxPropagation: null,
  };
}

function hasDirtyText(state: EditorState) {
  const canonical = textsOf(state.draft);
  return TEXT_FIELDS.some((field) => state.texts[field] !== canonical[field]);
}

/**
 * Nouvelle version relue (sauvegarde, rechargement, sauvegarde de lignes) : sans modification en cours, le
 * brouillon suit la version ; avec des modifications, elles restent et seule la référence enregistrée change.
 */
function resyncState(state: EditorState, baseline: Baseline): EditorState {
  if (!baseline.active || state.versionId !== baseline.versionId || !state.draft || !baseline.draft) {
    return freshState(baseline);
  }
  const untouched = sameDraft(state.draft, state.saved) && !hasDirtyText(state) && !state.taxPropagation;
  if (untouched || sameDraft(state.draft, baseline.draft)) return freshState(baseline);
  return { ...state, baselineKey: baseline.key, saved: baseline.draft };
}

function withoutErrors(errors: EstimateV3SettingsFieldErrors, fields: readonly EstimateV3SettingsTextField[]) {
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

/** Saisie d'un champ : « live » pendant la frappe (aucun message), « commit » à la sortie du champ. */
function applyText(
  state: EditorState,
  field: EstimateV3SettingsTextField,
  raw: string,
  mode: "live" | "commit"
): EditorState {
  if (!state.draft) return state;
  const result = field === "tax_rate"
    ? applyEstimateV3TaxRateInput(state.draft, raw)
    : applyEstimateV3SettingsInput(state.draft, field, raw);
  if (result.error) {
    return {
      ...state,
      texts: { ...state.texts, [field]: raw },
      errors: mode === "commit"
        ? { ...state.errors, [field]: { code: result.error.code, message: result.error.message } }
        : withoutErrors(state.errors, [field]),
    };
  }
  const draft = result.draft;
  const canonical = textsOf(draft);
  const isDiscount = field === "discount_amount" || field === "discount_rate";
  // Une remise valide remplace l'intention de l'autre champ : son texte et son erreur suivent le brouillon.
  const touched: readonly EstimateV3SettingsTextField[] = isDiscount ? ["discount_amount", "discount_rate"] : [field];
  const texts = { ...state.texts };
  for (const key of touched) texts[key] = canonical[key];
  if (mode === "live") texts[field] = raw;
  return { ...state, draft, texts, errors: withoutErrors(state.errors, touched) };
}

/** Valide chaque texte en attente (différent de la valeur du brouillon), comme une sortie de champ. */
function commitPendingTexts(state: EditorState): EditorState {
  let next = state;
  for (const field of TEXT_FIELDS) {
    if (next.texts[field] !== textsOf(next.draft)[field]) next = applyText(next, field, next.texts[field], "commit");
  }
  return next;
}

function firstErrorMessage(errors: EstimateV3SettingsFieldErrors) {
  return TEXT_FIELDS.map((field) => errors[field]?.message).find((message) => message !== undefined) ?? null;
}

function propagationNeedOf(
  state: EditorState,
  items: readonly EstimateV3PreviewLine[]
): EstimateV3TaxPropagationRequest | null {
  if (!state.draft || !state.saved || state.draft.tax_rate_bp === state.saved.tax_rate_bp) return null;
  const lineCount = countEstimateV3LinesWithOtherTaxRate(items, state.draft.tax_rate_bp, state.saved.tax_rate_bp);
  return lineCount > 0 ? { rateBp: state.draft.tax_rate_bp, lineCount } : null;
}

function decisionFor(state: EditorState, request: EstimateV3TaxPropagationRequest) {
  return state.taxDecision && state.taxDecision.rateBp === request.rateBp ? state.taxDecision : null;
}

export function useEstimateV3Settings(input: UseEstimateV3SettingsInput): EstimateV3SettingsController | null {
  const baseline = useMemo(() => readBaseline(input.version), [input.version]);
  const [state, setState] = useState<EditorState>(() => freshState(baseline));
  let current = state;
  if ((current.baselineKey ?? null) !== (baseline.active ? baseline.key : null)) {
    // Réglages relus : ajustement pendant le rendu (pas d'effet), une seule fois par version relue.
    current = resyncState(current, baseline);
    setState(current);
  }
  // Valeurs les plus récentes pour les appels impératifs (sauvegarde appelée dans le même tour).
  const stateRef = useRef(current);
  stateRef.current = current;
  const itemsRef = useRef(input.items);
  itemsRef.current = input.items;

  const update = useCallback((next: EditorState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setText = useCallback((field: EstimateV3SettingsTextField, raw: string) => {
    update(applyText(stateRef.current, field, raw, "live"));
  }, [update]);

  const commitText = useCallback((field: EstimateV3SettingsTextField) => {
    const latest = stateRef.current;
    update(applyText(latest, field, latest.texts[field], "commit"));
  }, [update]);

  const applyInput = useCallback((field: EstimateV3SettingsTextField, raw: string) => {
    update(applyText(stateRef.current, field, raw, "commit"));
  }, [update]);

  const updateDraft = useCallback((patch: EstimateV3SettingsDirectPatch) => {
    const latest = stateRef.current;
    if (!latest.draft) return;
    update({ ...latest, draft: { ...latest.draft, ...patch } });
  }, [update]);

  const requestSave = useCallback((save: () => unknown) => {
    const committed = commitPendingTexts(stateRef.current);
    update(committed);
    if (!committed.draft || firstErrorMessage(committed.errors) !== null) return false;
    const request = propagationNeedOf(committed, itemsRef.current);
    if (request && !decisionFor(committed, request)) {
      // Rien n'est envoyé avant la réponse (contrat §4.4 du parcours).
      update({ ...committed, taxPropagation: request });
      return false;
    }
    void save();
    return true;
  }, [update]);

  const confirmTaxPropagation = useCallback((applyToLines: boolean, save: () => unknown) => {
    const latest = stateRef.current;
    if (!latest.taxPropagation) return;
    update({
      ...latest,
      taxDecision: { rateBp: latest.taxPropagation.rateBp, applyToLines },
      taxPropagation: null,
    });
    // La sauvegarde courante de l'éditeur, pas celle de l'ouverture du dialogue : la version a pu être relue.
    void save();
  }, [update]);

  const cancelTaxPropagation = useCallback(() => {
    const latest = stateRef.current;
    if (latest.taxPropagation) update({ ...latest, taxPropagation: null });
  }, [update]);

  const buildSavePayload = useCallback((): EstimateV3SavePayloadResult => {
    const committed = commitPendingTexts(stateRef.current);
    if (committed !== stateRef.current) update(committed);
    if (!committed.draft) {
      return { ok: false, reason: "unavailable", message: committed.unavailableMessage ?? "Réglages v3 indisponibles." };
    }
    const fieldError = firstErrorMessage(committed.errors);
    if (fieldError !== null) return { ok: false, reason: "field_errors", message: fieldError };
    const request = propagationNeedOf(committed, itemsRef.current);
    const decision = request ? decisionFor(committed, request) : null;
    if (request && !decision) {
      return { ok: false, reason: "tax_propagation_required", message: TAX_PROPAGATION_REQUIRED_MESSAGE };
    }
    try {
      return {
        ok: true,
        payload: buildEstimateV3SettingsPayload(committed.draft, { applyTaxRateToLines: decision?.applyToLines === true }),
      };
    } catch (error) {
      if (error instanceof EstimateV3SettingsError) return { ok: false, reason: "field_errors", message: error.message };
      throw error;
    }
  }, [update]);

  const reset = useCallback(() => {
    update(freshState(baseline));
  }, [baseline, update]);

  const { draft } = current;
  const preview = useMemo(
    () => (draft
      ? computeEstimateV3SettingsPreview({
        draft,
        lines: input.items,
        laborRoles: input.laborRoles,
        laborSplitEnabled: input.laborSplitEnabled,
      })
      : null),
    [draft, input.items, input.laborRoles, input.laborSplitEnabled]
  );
  const costSubtotalCents = preview?.breakdown?.totals.cost_subtotal_cents ?? null;
  const marginTierHint = useMemo(() => {
    if (costSubtotalCents === null) return null;
    const hint = resolveEstimateV3MarginTierHint(input.marginTiers, costSubtotalCents);
    return hint ? { multiplier: hint.multiplier, costSubtotalCents } : null;
  }, [costSubtotalCents, input.marginTiers]);

  if (!baseline.active) return null;
  return {
    draft,
    saved: current.saved,
    unavailableMessage: current.unavailableMessage,
    texts: current.texts,
    errors: current.errors,
    hasErrors: firstErrorMessage(current.errors) !== null,
    isDirty: !sameDraft(current.draft, current.saved) || hasDirtyText(current),
    setText,
    commitText,
    applyInput,
    updateDraft,
    requestSave,
    taxPropagation: current.taxPropagation,
    confirmTaxPropagation,
    cancelTaxPropagation,
    buildSavePayload,
    reset,
    preview,
    marginTierHint,
  };
}
