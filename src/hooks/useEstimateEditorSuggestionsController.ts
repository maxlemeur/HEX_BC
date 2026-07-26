"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  SuggestionCorrectionPayload,
  SuggestionLearningState,
} from "@/components/estimates/EstimateEditorTable";
import type { SuggestionRuleCreatePayload } from "@/components/estimates/EstimateSuggestionRulesManager";
import {
  buildBulkSuggestPreview,
  type BulkSuggestPreviewItem,
} from "@/lib/estimates/bulk-suggest";
import {
  bulkUpdateEstimateItems,
  createEstimateSuggestionRule,
  fetchEstimateSuggestionLearnings,
  sendEstimateSuggestionRuleFeedback,
  trackEstimateSuggestionCorrections,
  updateEstimateSuggestionRule,
  type SuggestionLearningState as SuggestionLearningClientState,
  type TrackEstimateSuggestionCorrection,
} from "@/lib/estimates/client";
import {
  buildEstimateItemUpdatePayload,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import type { Database } from "@/types/database";

type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type EstimateEditorBulkSuggestProgress = {
  processed: number;
  total: number;
  percentage: number;
};

export type EstimateEditorBulkSuggestUndoState = {
  versionId: string;
  previousItems: EstimateItem[];
  appliedItemIds: string[];
};

type EstimateEditorSuggestionsHydration = {
  versionId: string;
  rules: SuggestionRule[];
  learning?: SuggestionLearningClientState | null;
};

export type EstimateEditorSuggestionsControllerInput = {
  routeVersionId: string;
  currentUserId: string | null;
  previewItems: EditorEstimateItem[];
  categories: EstimateCategory[];
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  normalizeLine: (item: EditorEstimateItem) => EditorEstimateItem;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  applyVersionToken: (updatedAt: string) => void;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
};

export type EstimateEditorSuggestionsController = {
  state: {
    rules: SuggestionRule[];
    learningState: SuggestionLearningState;
    isSavingRules: boolean;
    rulesError: string | null;
    isDialogOpen: boolean;
    selectedItemIds: string[];
    dialogError: string | null;
    isApplying: boolean;
    progress: EstimateEditorBulkSuggestProgress | null;
    undoState: EstimateEditorBulkSuggestUndoState | null;
    isUndoing: boolean;
  };
  actions: {
    hydrate: (input: EstimateEditorSuggestionsHydration) => boolean;
    loadLearning: (versionId?: string) => Promise<SuggestionLearningState>;
    createRule: (payload: SuggestionRuleCreatePayload) => Promise<void>;
    updateRule: (
      id: string,
      updates: Partial<SuggestionRule>
    ) => Promise<void>;
    trackCorrections: (
      corrections: SuggestionCorrectionPayload[]
    ) => Promise<void>;
    openDialog: () => void;
    closeDialog: () => void;
    toggleItem: (itemId: string, checked: boolean) => void;
    toggleAll: (checked: boolean) => void;
    applySelected: () => Promise<void>;
    undoLastApply: () => Promise<void>;
    resetScope: (versionId?: string) => boolean;
  };
  meta: {
    preview: BulkSuggestPreviewItem[];
    eligibleCount: number;
    selectedPreview: BulkSuggestPreviewItem[];
    showProgress: boolean;
    appliedCount: number | null;
  };
};

const BULK_SUGGEST_PROGRESS_THRESHOLD = 50;
const SUGGESTION_LEARNING_FIELDS = new Set<
  TrackEstimateSuggestionCorrection["field_name"]
>([
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
]);

const EMPTY_SUGGESTION_LEARNING_STATE: SuggestionLearningState = {
  enabled: false,
  by_rule_id: {},
};
const EMPTY_SUGGESTION_RULES: SuggestionRule[] = [];
const EMPTY_SELECTED_ITEM_IDS: string[] = [];

type SuggestionRulesState = {
  routeVersionId: string;
  rules: SuggestionRule[];
  learningState: SuggestionLearningState;
  isSavingRules: boolean;
  rulesError: string | null;
};

type SuggestionInteractiveState = {
  routeVersionId: string;
  previewItemIds: string[];
  lineItemIds: string[];
  isDialogOpen: boolean;
  selectedItemIds: string[];
  dialogError: string | null;
  isApplying: boolean;
  progress: EstimateEditorBulkSuggestProgress | null;
  undoState: EstimateEditorBulkSuggestUndoState | null;
  isUndoing: boolean;
};

function createEmptyRulesState(routeVersionId: string): SuggestionRulesState {
  return {
    routeVersionId,
    rules: EMPTY_SUGGESTION_RULES,
    learningState: EMPTY_SUGGESTION_LEARNING_STATE,
    isSavingRules: false,
    rulesError: null,
  };
}

function createEmptyInteractiveState(
  routeVersionId: string
): SuggestionInteractiveState {
  return {
    routeVersionId,
    previewItemIds: EMPTY_SELECTED_ITEM_IDS,
    lineItemIds: EMPTY_SELECTED_ITEM_IDS,
    isDialogOpen: false,
    selectedItemIds: EMPTY_SELECTED_ITEM_IDS,
    dialogError: null,
    isApplying: false,
    progress: null,
    undoState: null,
    isUndoing: false,
  };
}

function haveSameItemIds(previous: string[], current: string[]) {
  if (previous.length !== current.length) return false;
  const currentIds = new Set(current);
  return previous.every((itemId) => currentIds.has(itemId));
}

function reconcileInteractiveItems(
  state: SuggestionInteractiveState,
  previewItemIds: string[],
  lineItemIds: string[]
) {
  const hasPreviewChanged = !haveSameItemIds(
    state.previewItemIds,
    previewItemIds
  );
  const haveLinesChanged = !haveSameItemIds(
    state.lineItemIds,
    lineItemIds
  );
  const hasInvalidUndoScope =
    state.undoState !== null &&
    state.undoState.versionId !== state.routeVersionId;

  if (!hasPreviewChanged && !haveLinesChanged && !hasInvalidUndoScope) {
    return state;
  }

  const eligibleIds = new Set(previewItemIds);
  const selectedItemIds = hasPreviewChanged
    ? state.selectedItemIds.filter((itemId) => eligibleIds.has(itemId))
    : state.selectedItemIds;
  const currentLineIds = new Set(lineItemIds);
  const previousItems =
    state.undoState?.previousItems.filter((item) =>
      currentLineIds.has(item.id)
    ) ?? [];
  const undoState =
    !state.undoState || hasInvalidUndoScope || previousItems.length === 0
      ? null
      : previousItems.length === state.undoState.previousItems.length
        ? state.undoState
        : {
            ...state.undoState,
            previousItems,
            appliedItemIds: previousItems.map((item) => item.id),
          };

  return {
    ...state,
    previewItemIds,
    lineItemIds,
    selectedItemIds,
    undoState,
  };
}

function sortSuggestionRules(rules: SuggestionRule[]) {
  return [...rules].sort((left, right) => left.position - right.position);
}

function toEditorLearningState(
  learning: SuggestionLearningClientState | null | undefined
): SuggestionLearningState {
  if (!learning) return EMPTY_SUGGESTION_LEARNING_STATE;

  const byRuleId: SuggestionLearningState["by_rule_id"] = {};
  Object.entries(learning.by_rule_id).forEach(([ruleId, value]) => {
    byRuleId[ruleId] = {
      rule_id: value.rule_id,
      learning_boost: Math.max(value.learning_boost, 0),
      overrides: value.overrides,
    };
  });

  return {
    enabled: learning.config.enabled,
    by_rule_id: byRuleId,
  };
}

function toTrackableCorrections(
  corrections: SuggestionCorrectionPayload[]
): TrackEstimateSuggestionCorrection[] {
  return corrections.flatMap((correction) => {
    const fieldName =
      correction.field_name as TrackEstimateSuggestionCorrection["field_name"];
    if (!SUGGESTION_LEARNING_FIELDS.has(fieldName)) return [];

    return [
      {
        rule_id: correction.rule_id,
        field_name: fieldName,
        original_value: correction.original_value,
        corrected_value: correction.corrected_value,
        item_title: correction.item_title,
      },
    ];
  });
}

function resolveActionError(
  error: unknown,
  fallback: string,
  resolveErrorMessage: (message: string) => string
) {
  return resolveErrorMessage(error instanceof Error ? error.message : fallback);
}

export function useEstimateEditorSuggestionsController({
  routeVersionId,
  currentUserId,
  previewItems,
  categories,
  isMutationBlocked,
  mutationBlockedMessage,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  normalizeLine,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  ensureGroupedActionCanProceed,
  applyVersionToken,
  handleVersionConflict,
}: EstimateEditorSuggestionsControllerInput): EstimateEditorSuggestionsController {
  const [rulesState, setRulesState] = useState<SuggestionRulesState>(() =>
    createEmptyRulesState(routeVersionId)
  );
  const [interactiveState, setInteractiveState] =
    useState<SuggestionInteractiveState>(() =>
      createEmptyInteractiveState(routeVersionId)
    );

  const isRulesScopeCurrent = rulesState.routeVersionId === routeVersionId;
  const rules = isRulesScopeCurrent
    ? rulesState.rules
    : EMPTY_SUGGESTION_RULES;
  const learningState = isRulesScopeCurrent
    ? rulesState.learningState
    : EMPTY_SUGGESTION_LEARNING_STATE;
  const isSavingRules =
    isRulesScopeCurrent && rulesState.isSavingRules;
  const rulesError = isRulesScopeCurrent ? rulesState.rulesError : null;

  const routeVersionIdRef = useRef(routeVersionId);
  const scopeGenerationRef = useRef(0);
  const learningRequestGenerationRef = useRef(0);
  const ruleOperationGenerationRef = useRef(0);
  const bulkOperationGenerationRef = useRef(0);
  const isSavingRulesRef = useRef(false);
  const isApplyingRef = useRef(false);
  const isUndoingRef = useRef(false);

  const preview = useMemo(
    () =>
      buildBulkSuggestPreview({
        items: previewItems,
        suggestionRules: rules,
        categories,
      }),
    [categories, previewItems, rules]
  );

  const previewItemIds = useMemo(
    () => preview.map((entry) => entry.itemId),
    [preview]
  );
  const lineItemIds = useMemo(
    () =>
      previewItems
        .filter((item) => item.item_type === "line")
        .map((item) => item.id),
    [previewItems]
  );
  const isInteractiveScopeCurrent =
    interactiveState.routeVersionId === routeVersionId;
  const currentInteractiveState = isInteractiveScopeCurrent
    ? reconcileInteractiveItems(
        interactiveState,
        previewItemIds,
        lineItemIds
      )
    : null;
  if (
    currentInteractiveState &&
    currentInteractiveState !== interactiveState
  ) {
    setInteractiveState(currentInteractiveState);
  }

  const isDialogOpen = currentInteractiveState?.isDialogOpen ?? false;
  const selectedItemIds =
    currentInteractiveState?.selectedItemIds ?? EMPTY_SELECTED_ITEM_IDS;
  const dialogError = currentInteractiveState?.dialogError ?? null;
  const isApplying = currentInteractiveState?.isApplying ?? false;
  const progress = currentInteractiveState?.progress ?? null;
  const undoState = currentInteractiveState?.undoState ?? null;
  const isUndoing = currentInteractiveState?.isUndoing ?? false;

  const selectedPreview = useMemo(() => {
    if (selectedItemIds.length === 0) return [];
    const selectedIds = new Set(selectedItemIds);
    return preview.filter((entry) => selectedIds.has(entry.itemId));
  }, [preview, selectedItemIds]);

  const showProgress =
    (progress?.total ?? selectedPreview.length) >
    BULK_SUGGEST_PROGRESS_THRESHOLD;

  const rulesRef = useRef(rules);
  const selectedItemIdsRef = useRef(selectedItemIds);
  const undoStateRef = useRef(undoState);
  const previewRef = useRef<BulkSuggestPreviewItem[]>(preview);

  useLayoutEffect(() => {
    rulesRef.current = rules;
  }, [rules]);

  useLayoutEffect(() => {
    selectedItemIdsRef.current = selectedItemIds;
  }, [selectedItemIds]);

  useLayoutEffect(() => {
    undoStateRef.current = undoState;
  }, [undoState]);

  useLayoutEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const invalidateRequestGenerations = useCallback(() => {
    scopeGenerationRef.current += 1;
    learningRequestGenerationRef.current += 1;
    ruleOperationGenerationRef.current += 1;
    bulkOperationGenerationRef.current += 1;
    isSavingRulesRef.current = false;
    isApplyingRef.current = false;
    isUndoingRef.current = false;
  }, []);

  useLayoutEffect(() => {
    routeVersionIdRef.current = routeVersionId;
    invalidateRequestGenerations();
  }, [invalidateRequestGenerations, routeVersionId]);

  const isScopeCurrent = useCallback(
    (versionId: string, generation: number) =>
      routeVersionIdRef.current === versionId &&
      scopeGenerationRef.current === generation,
    []
  );

  const resetScope = useCallback(
    (versionId = routeVersionIdRef.current) => {
      if (!versionId || routeVersionIdRef.current !== versionId) return false;
      invalidateRequestGenerations();
      setRulesState(createEmptyRulesState(versionId));
      setInteractiveState(createEmptyInteractiveState(versionId));
      return true;
    },
    [invalidateRequestGenerations]
  );

  const hydrate = useCallback(
    (input: EstimateEditorSuggestionsHydration) => {
      if (
        !input.versionId ||
        routeVersionIdRef.current !== input.versionId
      ) {
        return false;
      }

      invalidateRequestGenerations();
      setRulesState((previous) => ({
        routeVersionId: input.versionId,
        rules: sortSuggestionRules(input.rules),
        learningState:
          input.learning === undefined &&
          previous.routeVersionId === input.versionId
            ? previous.learningState
            : toEditorLearningState(input.learning),
        isSavingRules: false,
        rulesError: null,
      }));
      setInteractiveState(createEmptyInteractiveState(input.versionId));
      return true;
    },
    [invalidateRequestGenerations]
  );

  const loadLearning = useCallback(
    async (versionId = routeVersionIdRef.current) => {
      if (!versionId || routeVersionIdRef.current !== versionId) {
        return EMPTY_SUGGESTION_LEARNING_STATE;
      }

      const scopeGeneration = scopeGenerationRef.current;
      const requestGeneration = ++learningRequestGenerationRef.current;

      try {
        const learning = await fetchEstimateSuggestionLearnings(versionId);
        const nextLearningState = toEditorLearningState(learning);
        if (
          isScopeCurrent(versionId, scopeGeneration) &&
          learningRequestGenerationRef.current === requestGeneration
        ) {
          setRulesState((previous) => ({
            ...(previous.routeVersionId === versionId
              ? previous
              : createEmptyRulesState(versionId)),
            learningState: nextLearningState,
          }));
        }
        return nextLearningState;
      } catch {
        if (
          isScopeCurrent(versionId, scopeGeneration) &&
          learningRequestGenerationRef.current === requestGeneration
        ) {
          setRulesState((previous) => ({
            ...(previous.routeVersionId === versionId
              ? previous
              : createEmptyRulesState(versionId)),
            learningState: EMPTY_SUGGESTION_LEARNING_STATE,
          }));
        }
        return EMPTY_SUGGESTION_LEARNING_STATE;
      }
    },
    [isScopeCurrent]
  );

  const guardRuleMutation = useCallback(() => {
    const targetVersionId = routeVersionIdRef.current;
    let nextRulesError: string | null = null;
    if (isMutationBlocked) {
      nextRulesError = mutationBlockedMessage;
    } else if (!currentUserId) {
      nextRulesError = "Impossible de charger votre profil.";
    } else {
      const versionSnapshot = getVersionSnapshot();
      if (
        !targetVersionId ||
        !versionSnapshot ||
        versionSnapshot.id !== targetVersionId
      ) {
        nextRulesError = "Version introuvable.";
      }
    }

    setRulesState((previous) => ({
      ...(previous.routeVersionId === targetVersionId
        ? previous
        : createEmptyRulesState(targetVersionId)),
      rulesError: nextRulesError,
    }));
    if (nextRulesError || isSavingRulesRef.current) return null;

    return {
      targetVersionId,
      scopeGeneration: scopeGenerationRef.current,
    };
  }, [
    currentUserId,
    getVersionSnapshot,
    isMutationBlocked,
    mutationBlockedMessage,
  ]);

  const createRule = useCallback(
    async (payload: SuggestionRuleCreatePayload) => {
      const scope = guardRuleMutation();
      if (!scope) return;

      const operationGeneration = ++ruleOperationGenerationRef.current;
      isSavingRulesRef.current = true;
      setRulesState((previous) =>
        previous.routeVersionId === scope.targetVersionId
          ? { ...previous, isSavingRules: true }
          : previous
      );

      const nextPosition =
        rulesRef.current.reduce(
          (maximum, rule) => Math.max(maximum, rule.position),
          0
        ) + 1;
      const position =
        payload.position && payload.position > 0
          ? payload.position
          : nextPosition;

      try {
        const createdRule = await createEstimateSuggestionRule(
          scope.targetVersionId,
          {
            name: payload.name,
            match_type: "keyword",
            match_value: payload.match_value,
            unit: payload.unit,
            category_id: payload.category_id,
            k_fo: payload.k_fo,
            k_mo: payload.k_mo,
            labor_role_id: payload.labor_role_id,
            position,
            is_active: payload.is_active,
          }
        );

        if (
          !isScopeCurrent(
            scope.targetVersionId,
            scope.scopeGeneration
          ) ||
          ruleOperationGenerationRef.current !== operationGeneration
        ) {
          return;
        }

        setRulesState((previous) =>
          previous.routeVersionId === scope.targetVersionId
            ? {
                ...previous,
                rules: sortSuggestionRules([
                  ...previous.rules,
                  createdRule,
                ]),
              }
            : previous
        );
      } catch (error) {
        if (
          isScopeCurrent(scope.targetVersionId, scope.scopeGeneration) &&
          ruleOperationGenerationRef.current === operationGeneration
        ) {
          const message = resolveActionError(
            error,
            "Impossible de créer la règle.",
            resolveErrorMessage
          );
          setRulesState((previous) =>
            previous.routeVersionId === scope.targetVersionId
              ? { ...previous, rulesError: message }
              : previous
          );
        }
      } finally {
        if (
          isScopeCurrent(scope.targetVersionId, scope.scopeGeneration) &&
          ruleOperationGenerationRef.current === operationGeneration
        ) {
          isSavingRulesRef.current = false;
          setRulesState((previous) =>
            previous.routeVersionId === scope.targetVersionId
              ? { ...previous, isSavingRules: false }
              : previous
          );
        }
      }
    },
    [guardRuleMutation, isScopeCurrent, resolveErrorMessage]
  );

  const updateRule = useCallback(
    async (id: string, updates: Partial<SuggestionRule>) => {
      const scope = guardRuleMutation();
      if (!scope) return;

      const operationGeneration = ++ruleOperationGenerationRef.current;
      isSavingRulesRef.current = true;
      setRulesState((previous) =>
        previous.routeVersionId === scope.targetVersionId
          ? { ...previous, isSavingRules: true }
          : previous
      );

      try {
        const updatedRule = await updateEstimateSuggestionRule(
          scope.targetVersionId,
          id,
          updates
        );

        if (
          !isScopeCurrent(
            scope.targetVersionId,
            scope.scopeGeneration
          ) ||
          ruleOperationGenerationRef.current !== operationGeneration
        ) {
          return;
        }

        setRulesState((previous) =>
          previous.routeVersionId === scope.targetVersionId
            ? {
                ...previous,
                rules: sortSuggestionRules(
                  previous.rules.map((rule) =>
                    rule.id === id
                      ? (updatedRule ?? { ...rule, ...updates })
                      : rule
                  )
                ),
              }
            : previous
        );
      } catch (error) {
        if (
          isScopeCurrent(scope.targetVersionId, scope.scopeGeneration) &&
          ruleOperationGenerationRef.current === operationGeneration
        ) {
          const message = resolveActionError(
            error,
            "Impossible de mettre a jour la regle.",
            resolveErrorMessage
          );
          setRulesState((previous) =>
            previous.routeVersionId === scope.targetVersionId
              ? { ...previous, rulesError: message }
              : previous
          );
        }
      } finally {
        if (
          isScopeCurrent(scope.targetVersionId, scope.scopeGeneration) &&
          ruleOperationGenerationRef.current === operationGeneration
        ) {
          isSavingRulesRef.current = false;
          setRulesState((previous) =>
            previous.routeVersionId === scope.targetVersionId
              ? { ...previous, isSavingRules: false }
              : previous
          );
        }
      }
    },
    [guardRuleMutation, isScopeCurrent, resolveErrorMessage]
  );

  const trackCorrections = useCallback(
    async (corrections: SuggestionCorrectionPayload[]) => {
      const trackableCorrections = toTrackableCorrections(corrections);
      if (trackableCorrections.length === 0) return;

      const targetVersionId = routeVersionIdRef.current;
      const versionSnapshot = getVersionSnapshot();
      if (
        !targetVersionId ||
        !versionSnapshot ||
        versionSnapshot.id !== targetVersionId
      ) {
        return;
      }

      const scopeGeneration = scopeGenerationRef.current;
      const requestGeneration = ++learningRequestGenerationRef.current;
      const result = await trackEstimateSuggestionCorrections(
        targetVersionId,
        {
          corrections: trackableCorrections,
        }
      );

      if (
        isScopeCurrent(targetVersionId, scopeGeneration) &&
        learningRequestGenerationRef.current === requestGeneration
      ) {
        setRulesState((previous) => ({
          ...(previous.routeVersionId === targetVersionId
            ? previous
            : createEmptyRulesState(targetVersionId)),
          learningState: toEditorLearningState(result),
        }));
      }
    },
    [getVersionSnapshot, isScopeCurrent]
  );

  const openDialog = useCallback(() => {
    if (isMutationBlocked) {
      reportError(mutationBlockedMessage);
      return;
    }

    const targetVersionId = routeVersionIdRef.current;
    if (
      !targetVersionId ||
      getVersionSnapshot()?.id !== targetVersionId
    ) {
      reportError("Version introuvable.");
      return;
    }

    const currentPreview = previewRef.current;
    if (currentPreview.length === 0) return;

    reportError(null);
    setInteractiveState((previous) => ({
      ...(previous.routeVersionId === targetVersionId
        ? previous
        : createEmptyInteractiveState(targetVersionId)),
      isDialogOpen: true,
      selectedItemIds: currentPreview.map((entry) => entry.itemId),
      dialogError: null,
      progress: null,
    }));
  }, [
    getVersionSnapshot,
    isMutationBlocked,
    mutationBlockedMessage,
    reportError,
  ]);

  const closeDialog = useCallback(() => {
    if (isApplyingRef.current) return;
    const targetVersionId = routeVersionIdRef.current;
    setInteractiveState((previous) =>
      previous.routeVersionId === targetVersionId
        ? {
            ...previous,
            isDialogOpen: false,
            dialogError: null,
            progress: null,
          }
        : previous
    );
  }, []);

  const toggleItem = useCallback((itemId: string, checked: boolean) => {
    const targetVersionId = routeVersionIdRef.current;
    setInteractiveState((previous) => {
      const current =
        previous.routeVersionId === targetVersionId
          ? previous
          : createEmptyInteractiveState(targetVersionId);
      if (checked) {
        if (
          current.selectedItemIds.includes(itemId) ||
          !previewRef.current.some((entry) => entry.itemId === itemId)
        ) {
          return current;
        }
        return {
          ...current,
          selectedItemIds: [...current.selectedItemIds, itemId],
        };
      }
      return current.selectedItemIds.includes(itemId)
        ? {
            ...current,
            selectedItemIds: current.selectedItemIds.filter(
              (id) => id !== itemId
            ),
          }
        : current;
    });
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    const targetVersionId = routeVersionIdRef.current;
    setInteractiveState((previous) => ({
      ...(previous.routeVersionId === targetVersionId
        ? previous
        : createEmptyInteractiveState(targetVersionId)),
      selectedItemIds: checked
        ? previewRef.current.map((entry) => entry.itemId)
        : EMPTY_SELECTED_ITEM_IDS,
    }));
  }, []);

  const applySelected = useCallback(async () => {
    if (isApplyingRef.current || isUndoingRef.current) return;

    const targetVersionId = routeVersionIdRef.current;
    const scopeGeneration = scopeGenerationRef.current;
    const operationGeneration = ++bulkOperationGenerationRef.current;
    isApplyingRef.current = true;

    try {
      if (isMutationBlocked) {
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, dialogError: mutationBlockedMessage }
            : previous
        );
        return;
      }

      if (
        !(await ensureGroupedActionCanProceed(
          "appliquer les suggestions en lot"
        ))
      ) {
        return;
      }
      if (!isScopeCurrent(targetVersionId, scopeGeneration)) return;

      const versionSnapshot = getVersionSnapshot();
      if (
        !versionSnapshot ||
        versionSnapshot.id !== targetVersionId
      ) {
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, dialogError: "Version introuvable." }
            : previous
        );
        return;
      }

      const selectedIds = new Set(selectedItemIdsRef.current);
      const previewByItemId = new Map(
        previewRef.current
          .filter((entry) => selectedIds.has(entry.itemId))
          .map((entry) => [entry.itemId, entry])
      );
      if (previewByItemId.size === 0) {
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? {
                ...previous,
                dialogError: "Selectionnez au moins une suggestion.",
              }
            : previous
        );
        return;
      }

      const snapshot = getItemsSnapshot();
      const selectedLines = snapshot.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && previewByItemId.has(item.id)
      );
      if (selectedLines.length === 0) {
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? {
                ...previous,
                dialogError: "Aucune ligne eligible selectionnee.",
              }
            : previous
        );
        return;
      }

      const updatedLines = selectedLines.map((item) => {
        const suggestion = previewByItemId.get(item.id);
        return normalizeLine({
          ...item,
          ...(suggestion?.patch ?? {}),
        });
      });
      const updatesPayload = updatedLines.map((item) => ({
        id: item.id,
        updates: buildEstimateItemUpdatePayload(item),
      }));
      const updatedById = new Map(
        updatedLines.map((item) => [item.id, item])
      );
      const previousItems = selectedLines.map((item) => ({ ...item }));
      const shouldTrackProgress =
        updatesPayload.length > BULK_SUGGEST_PROGRESS_THRESHOLD;

      setInteractiveState((previous) =>
        previous.routeVersionId === targetVersionId
          ? {
              ...previous,
              dialogError: null,
              isApplying: true,
              progress: shouldTrackProgress
                ? {
                    processed: 0,
                    total: updatesPayload.length,
                    percentage: 0,
                  }
                : null,
            }
          : previous
      );
      setItems((previous) =>
        previous.map((item) => updatedById.get(item.id) ?? item)
      );

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          targetVersionId,
          versionSnapshot.updated_at,
          updatesPayload
        );
        if (
          !isScopeCurrent(targetVersionId, scopeGeneration) ||
          bulkOperationGenerationRef.current !== operationGeneration ||
          getVersionSnapshot()?.id !== targetVersionId
        ) {
          return;
        }

        if (shouldTrackProgress) {
          setInteractiveState((previous) =>
            previous.routeVersionId === targetVersionId
              ? {
                  ...previous,
                  progress: {
                    processed: updatesPayload.length,
                    total: updatesPayload.length,
                    percentage: 100,
                  },
                }
              : previous
          );
        }
        applyVersionToken(bulkResult.versionToken.updated_at);
        setTotalsOutOfSync(false);
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? {
                ...previous,
                undoState: {
                  versionId: targetVersionId,
                  previousItems,
                  appliedItemIds: previousItems.map((item) => item.id),
                },
                isDialogOpen: false,
                selectedItemIds: EMPTY_SELECTED_ITEM_IDS,
                dialogError: null,
              }
            : previous
        );

        const feedbackCountByRuleId = selectedLines.reduce<
          Record<string, number>
        >((counts, item) => {
          const ruleId = previewByItemId.get(item.id)?.ruleId;
          if (ruleId) counts[ruleId] = (counts[ruleId] ?? 0) + 1;
          return counts;
        }, {});
        const feedbackEntries = Object.entries(feedbackCountByRuleId);
        if (feedbackEntries.length > 0) {
          const feedbackResults = await Promise.allSettled(
            feedbackEntries.map(([ruleId, count]) =>
              sendEstimateSuggestionRuleFeedback(
                targetVersionId,
                ruleId,
                "accept",
                count
              )
            )
          );
          if (
            isScopeCurrent(targetVersionId, scopeGeneration) &&
            bulkOperationGenerationRef.current === operationGeneration
          ) {
            const failedFeedbackCount = feedbackResults.filter(
              (result) => result.status === "rejected"
            ).length;
            if (failedFeedbackCount > 0) {
              reportError(
                String(failedFeedbackCount) +
                  " compteur(s) de suggestions n'ont pas pu etre mis a jour."
              );
            }
          }
        }
      } catch (error) {
        if (
          !isScopeCurrent(targetVersionId, scopeGeneration) ||
          bulkOperationGenerationRef.current !== operationGeneration
        ) {
          return;
        }

        setItems(snapshot);
        if (handleVersionConflict(error, { persistDraft: true })) {
          setInteractiveState((previous) =>
            previous.routeVersionId === targetVersionId
              ? { ...previous, isDialogOpen: false }
              : previous
          );
        } else {
          const message = resolveActionError(
            error,
            "Impossible d'appliquer les suggestions en lot.",
            resolveErrorMessage
          );
          setInteractiveState((previous) =>
            previous.routeVersionId === targetVersionId
              ? { ...previous, dialogError: message }
              : previous
          );
        }
      }
    } finally {
      if (
        isScopeCurrent(targetVersionId, scopeGeneration) &&
        bulkOperationGenerationRef.current === operationGeneration
      ) {
        isApplyingRef.current = false;
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, isApplying: false, progress: null }
            : previous
        );
      }
    }
  }, [
    applyVersionToken,
    ensureGroupedActionCanProceed,
    getItemsSnapshot,
    getVersionSnapshot,
    handleVersionConflict,
    isMutationBlocked,
    isScopeCurrent,
    mutationBlockedMessage,
    normalizeLine,
    reportError,
    resolveErrorMessage,
    setItems,
    setTotalsOutOfSync,
  ]);

  const undoLastApply = useCallback(async () => {
    if (isUndoingRef.current || isApplyingRef.current) return;

    const targetVersionId = routeVersionIdRef.current;
    const scopeGeneration = scopeGenerationRef.current;
    const operationGeneration = ++bulkOperationGenerationRef.current;
    isUndoingRef.current = true;

    try {
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        return;
      }
      if (
        !(await ensureGroupedActionCanProceed(
          "annuler les suggestions en lot"
        ))
      ) {
        return;
      }
      if (!isScopeCurrent(targetVersionId, scopeGeneration)) return;

      const currentUndoState = undoStateRef.current;
      const versionSnapshot = getVersionSnapshot();
      if (
        !currentUndoState ||
        currentUndoState.versionId !== targetVersionId ||
        !versionSnapshot ||
        versionSnapshot.id !== targetVersionId
      ) {
        return;
      }

      const currentItemsSnapshot = getItemsSnapshot();
      const currentLineIds = new Set(
        currentItemsSnapshot
          .filter((item) => item.item_type === "line")
          .map((item) => item.id)
      );
      const previousItems = currentUndoState.previousItems.filter((item) =>
        currentLineIds.has(item.id)
      );
      if (previousItems.length === 0) {
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, undoState: null }
            : previous
        );
        return;
      }

      const previousById = new Map(
        previousItems.map((item) => [item.id, item])
      );
      setInteractiveState((previous) =>
        previous.routeVersionId === targetVersionId
          ? { ...previous, isUndoing: true }
          : previous
      );
      reportError(null);
      setItems((previous) =>
        previous.map((item) => previousById.get(item.id) ?? item)
      );

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          targetVersionId,
          versionSnapshot.updated_at,
          previousItems.map((item) => ({
            id: item.id,
            updates: buildEstimateItemUpdatePayload(item),
          }))
        );
        if (
          !isScopeCurrent(targetVersionId, scopeGeneration) ||
          bulkOperationGenerationRef.current !== operationGeneration ||
          getVersionSnapshot()?.id !== targetVersionId
        ) {
          return;
        }

        applyVersionToken(bulkResult.versionToken.updated_at);
        setTotalsOutOfSync(false);
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, undoState: null }
            : previous
        );
      } catch (error) {
        if (
          !isScopeCurrent(targetVersionId, scopeGeneration) ||
          bulkOperationGenerationRef.current !== operationGeneration
        ) {
          return;
        }

        setItems(currentItemsSnapshot);
        if (handleVersionConflict(error, { persistDraft: true })) {
          setInteractiveState((previous) =>
            previous.routeVersionId === targetVersionId
              ? { ...previous, undoState: null }
              : previous
          );
        } else {
          reportError(
            resolveActionError(
              error,
              "Impossible d'annuler les suggestions.",
              resolveErrorMessage
            )
          );
        }
      }
    } finally {
      if (
        isScopeCurrent(targetVersionId, scopeGeneration) &&
        bulkOperationGenerationRef.current === operationGeneration
      ) {
        isUndoingRef.current = false;
        setInteractiveState((previous) =>
          previous.routeVersionId === targetVersionId
            ? { ...previous, isUndoing: false }
            : previous
        );
      }
    }
  }, [
    applyVersionToken,
    ensureGroupedActionCanProceed,
    getItemsSnapshot,
    getVersionSnapshot,
    handleVersionConflict,
    isMutationBlocked,
    isScopeCurrent,
    mutationBlockedMessage,
    reportError,
    resolveErrorMessage,
    setItems,
    setTotalsOutOfSync,
  ]);

  return {
    state: {
      rules,
      learningState,
      isSavingRules,
      rulesError,
      isDialogOpen,
      selectedItemIds,
      dialogError,
      isApplying,
      progress,
      undoState,
      isUndoing,
    },
    actions: {
      hydrate,
      loadLearning,
      createRule,
      updateRule,
      trackCorrections,
      openDialog,
      closeDialog,
      toggleItem,
      toggleAll,
      applySelected,
      undoLastApply,
      resetScope,
    },
    meta: {
      preview,
      eligibleCount: preview.length,
      selectedPreview,
      showProgress,
      appliedCount: undoState?.appliedItemIds.length ?? null,
    },
  };
}
