"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import {
  ESTIMATE_V3_SETTINGS_TEXT_FIELDS as TEXT_FIELDS,
  estimateDocumentV3SettingsTexts as textsOf,
  freshEstimateDocumentV3Settings as freshState,
  hasDirtyEstimateDocumentV3SettingsText as hasDirtyText,
  readEstimateDocumentV3SettingsBaseline as readBaseline,
  resyncEstimateDocumentV3Settings as resyncState,
  sameEstimateDocumentV3SettingsDraft as sameDraft,
  type EstimateDocumentV3SettingsState as EditorState,
  type EstimateV3MarginTierHint,
  type EstimateV3SavePayloadResult,
  type EstimateV3SettingsDirectPatch,
  type EstimateV3SettingsFieldErrors,
  type EstimateV3SettingsTextField,
  type EstimateV3SettingsTexts,
  type EstimateV3TaxPropagationRequest,
} from "@/lib/estimates/editor-document-v3-settings";
export type {
  EstimateV3MarginTierHint,
  EstimateV3SavePayloadResult,
  EstimateV3SettingsDirectPatch,
  EstimateV3SettingsFieldError,
  EstimateV3SettingsFieldErrors,
  EstimateV3SettingsTextField,
  EstimateV3SettingsTexts,
  EstimateV3TaxPropagationRequest,
} from "@/lib/estimates/editor-document-v3-settings";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import {
  EstimateV3SettingsError,
  applyEstimateV3SettingsInput,
  applyEstimateV3TaxRateInput,
  buildEstimateV3SettingsPayload,
  computeEstimateV3SettingsPreview,
  countEstimateV3LinesWithOtherTaxRate,
  resolveEstimateV3MarginTierHint,
  type EstimateV3PreviewLaborRole,
  type EstimateV3PreviewLine,
  type EstimateV3SettingsDraft,
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

export type UseEstimateV3SettingsInput = {
  /** Shared document owner; omitted only by standalone consumers. */
  document?: EstimateEditorDocument;
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
  /**
   * Revue de 2.6 (F26-27) : question de propagation posée par une sauvegarde qui ne passe pas par
   * « Enregistrer le paramétrage » (Ctrl+S, enregistrement à la fermeture du tiroir, navigation). Valide les textes
   * en attente ; rend vrai aussitôt si aucune question n'est due (ou si elle a déjà sa réponse), sinon ouvre le
   * dialogue (`onAsk` : rendre le tiroir visible) et rend vrai à la réponse, faux à la fermeture sans réponse. La
   * réponse n'appelle pas d'autre sauvegarde : celle qui attend reprend avec la décision.
   */
  askTaxPropagation: (onAsk?: () => void) => Promise<boolean>;
  /** Charge v3 de `saveEstimateVersion` ; refuse tant qu'une erreur de champ ou la question de propagation reste ouverte. */
  buildSavePayload: () => EstimateV3SavePayloadResult;
  /** Abandon des modifications : retour aux réglages enregistrés. */
  reset: () => void;
  /** Aperçu du moteur pur sur le brouillon et les lignes courantes ; jamais envoyé comme total. */
  preview: EstimateV3SettingsPreview | null;
  /** Repère du barème de l'entreprise pour le déboursé de l'aperçu, ou nul (pas de barème, pas d'aperçu). */
  marginTierHint: EstimateV3MarginTierHint | null;
};

const TAX_PROPAGATION_REQUIRED_MESSAGE =
  "Indiquez si le nouveau taux de TVA s'applique à toutes les lignes avant d'enregistrer le paramétrage.";

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
  const document = input.document;
  // The connected hook stores no second saved/draft: the document publishes the
  // same typed v3 state used by all read and save transitions.
  const [standaloneState, setStandaloneState] = useState<EditorState | null>(() =>
    document ? null : freshState(baseline));
  const subscribe = useCallback((notify: () => void) => document?.subscribe(notify) ?? (() => undefined), [document]);
  const getDocumentState = useCallback(() => document?.getV3Settings() ?? null, [document]);
  const documentState = useSyncExternalStore(subscribe, getDocumentState, getDocumentState);
  const documentGeneration = document?.getSnapshot().generation;
  const documentScope = useMemo(() => document && documentGeneration !== undefined
    ? { ...document.captureScope(), generation: documentGeneration }
    : undefined, [document, documentGeneration]);
  let current = documentState ?? standaloneState ?? freshState(baseline);
  if (!document && (current.baselineKey ?? null) !== (baseline.active ? baseline.key : null)) {
    // Standalone use keeps the same reconciliation policy as the document.
    current = resyncState(current, baseline);
    setStandaloneState(current);
  }
  // Valeurs les plus récentes pour les appels impératifs (sauvegarde appelée dans le même tour).
  const stateRef = useRef(current);
  stateRef.current = current;
  const itemsRef = useRef(input.items);
  itemsRef.current = input.items;
  // Sauvegarde en attente de la réponse à la question de propagation (`askTaxPropagation`).
  const answerRef = useRef<((answered: boolean) => void) | null>(null);
  const settleAnswer = useCallback((answered: boolean) => {
    const resolve = answerRef.current;
    answerRef.current = null;
    resolve?.(answered);
    return resolve !== null;
  }, []);
  const currentVersionId = current.versionId;
  useEffect(() => () => { settleAnswer(false); }, [document, documentGeneration, currentVersionId, settleAnswer]);
  const isCurrentDocument = useCallback(() => !document || Boolean(documentScope && document.isCurrent(documentScope)),
    [document, documentScope]);

  const update = useCallback((next: EditorState) => {
    if (document) {
      if (document.updateV3Settings(next, documentScope)) stateRef.current = document.getV3Settings();
      return;
    }
    stateRef.current = next;
    setStandaloneState(next);
  }, [document, documentScope]);
  const getLatestState = useCallback(() => document?.getV3Settings() ?? stateRef.current, [document]);

  const setText = useCallback((field: EstimateV3SettingsTextField, raw: string) => {
    update(applyText(getLatestState(), field, raw, "live"));
  }, [getLatestState, update]);

  const commitText = useCallback((field: EstimateV3SettingsTextField) => {
    const latest = getLatestState();
    update(applyText(latest, field, latest.texts[field], "commit"));
  }, [getLatestState, update]);

  const applyInput = useCallback((field: EstimateV3SettingsTextField, raw: string) => {
    update(applyText(getLatestState(), field, raw, "commit"));
  }, [getLatestState, update]);

  const updateDraft = useCallback((patch: EstimateV3SettingsDirectPatch) => {
    const latest = getLatestState();
    if (!latest.draft) return;
    update({ ...latest, draft: { ...latest.draft, ...patch } });
  }, [getLatestState, update]);

  const requestSave = useCallback((save: () => unknown) => {
    if (!isCurrentDocument()) return false;
    const committed = commitPendingTexts(getLatestState());
    update(committed);
    if (!committed.draft || firstErrorMessage(committed.errors) !== null) return false;
    const request = propagationNeedOf(committed, itemsRef.current);
    if (request && !decisionFor(committed, request)) {
      // Rien n'est envoyé avant la réponse (contrat §9.4.4 du doc 2.6).
      update({ ...committed, taxPropagation: request });
      return false;
    }
    void save();
    return true;
  }, [getLatestState, isCurrentDocument, update]);

  const confirmTaxPropagation = useCallback((applyToLines: boolean, save: () => unknown) => {
    if (!isCurrentDocument()) return;
    const latest = getLatestState();
    if (!latest.taxPropagation) return;
    update({
      ...latest,
      taxDecision: { rateBp: latest.taxPropagation.rateBp, applyToLines },
      taxPropagation: null,
    });
    // Une sauvegarde attend la réponse : elle reprend avec la décision, sans seconde sauvegarde.
    if (settleAnswer(true)) return;
    // La sauvegarde courante de l'éditeur, pas celle de l'ouverture du dialogue : la version a pu être relue.
    void save();
  }, [getLatestState, isCurrentDocument, settleAnswer, update]);

  const cancelTaxPropagation = useCallback(() => {
    if (!isCurrentDocument()) return;
    const latest = getLatestState();
    if (latest.taxPropagation) update({ ...latest, taxPropagation: null });
    settleAnswer(false);
  }, [getLatestState, isCurrentDocument, settleAnswer, update]);

  const askTaxPropagation = useCallback((onAsk?: () => void) => new Promise<boolean>((resolve) => {
    if (!isCurrentDocument()) { resolve(false); return; }
    const latest = getLatestState();
    const committed = commitPendingTexts(latest);
    if (committed !== latest) update(committed);
    // Une erreur de champ est refusée par `buildSavePayload`, après : aucune question tant qu'elle reste.
    const request = committed.draft && firstErrorMessage(committed.errors) === null
      ? propagationNeedOf(committed, itemsRef.current) : null;
    if (!request || decisionFor(committed, request)) {
      resolve(true);
      return;
    }
    settleAnswer(false);
    answerRef.current = resolve;
    update({ ...committed, taxPropagation: request });
    onAsk?.();
  }), [getLatestState, isCurrentDocument, settleAnswer, update]);

  const buildSavePayload = useCallback((): EstimateV3SavePayloadResult => {
    if (!isCurrentDocument()) {
      return { ok: false, reason: "unavailable", message: "La version active a changé pendant l'opération." };
    }
    const latest = getLatestState();
    const committed = commitPendingTexts(latest);
    if (committed !== latest) update(committed);
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
  }, [getLatestState, isCurrentDocument, update]);

  const reset = useCallback(() => {
    if (!isCurrentDocument()) return;
    settleAnswer(false);
    update(freshState(document ? readBaseline(document.getSnapshot().version) : baseline));
  }, [baseline, document, isCurrentDocument, settleAnswer, update]);

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
    askTaxPropagation,
    buildSavePayload,
    reset,
    preview,
    marginTierHint,
  };
}
