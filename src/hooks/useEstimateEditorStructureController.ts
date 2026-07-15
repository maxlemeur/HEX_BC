"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import type {
  EstimateEditorHistoryCommand,
  EstimateEditorHistoryCommandContext,
} from "@/hooks/useEstimateEditorHistoryController";
import {
  deleteEstimateItem,
  duplicateEstimateSection,
  fetchEstimateEditorData,
  insertAssemblyIntoVersion,
  insertTemplateIntoVersion,
} from "@/lib/estimates/client";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { refreshVersionTokenAfterAssemblyInsert } from "@/lib/estimates/editor-version-refresh";
import {
  applyOptimisticTemplateInsertion,
  collectSubtreeItemIds,
  createTopLevelItemIdsTracker,
  resolveTopLevelItemIds,
} from "@/app/dashboard/estimates/[versionId]/edit/utils/item-tree";

type EstimateEditorStructureControllerInput = {
  routeVersionId: string;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  highlightItems?: (itemIds: readonly string[]) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  applyVersionToken: (updatedAt: string) => void;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  pushHistoryCommand: (command: EstimateEditorHistoryCommand) => void;
  reloadItems: () => Promise<void>;
};

export function useEstimateEditorStructureController({
  routeVersionId,
  isMutationBlocked,
  mutationBlockedMessage,
  getItemsSnapshot,
  getVersionSnapshot,
  setItems,
  setTotalsOutOfSync,
  highlightItems = () => undefined,
  reportError,
  resolveErrorMessage,
  applyVersionToken,
  handleVersionConflict,
  ensureGroupedActionCanProceed,
  pushHistoryCommand,
  reloadItems,
}: EstimateEditorStructureControllerInput) {
  const routeVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
  const nextMutationIdRef = useRef(0);
  const activeMutationIdRef = useRef<number | null>(null);
  const refreshGenerationRef = useRef(0);
  const mutationGuardRef = useRef({
    isBlocked: isMutationBlocked,
    message: mutationBlockedMessage,
  });

  useLayoutEffect(() => {
    mutationGuardRef.current = {
      isBlocked: isMutationBlocked,
      message: mutationBlockedMessage,
    };
  }, [isMutationBlocked, mutationBlockedMessage]);

  useLayoutEffect(() => {
    if (routeVersionIdRef.current === routeVersionId) return;
    routeVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    activeMutationIdRef.current = null;
    refreshGenerationRef.current += 1;
  }, [routeVersionId]);

  type StructureMutationScope = {
    id: number;
    routeGeneration: number;
    version: EstimateVersionRow;
  };

  const isCurrentMutation = useCallback(
    (scope: StructureMutationScope) =>
      activeMutationIdRef.current === scope.id &&
      routeGenerationRef.current === scope.routeGeneration &&
      routeVersionIdRef.current === scope.version.id &&
      getVersionSnapshot()?.id === scope.version.id,
    [getVersionSnapshot]
  );

  const finishMutation = useCallback((scope: StructureMutationScope) => {
    if (activeMutationIdRef.current === scope.id) {
      activeMutationIdRef.current = null;
    }
  }, []);

  const beginMutation = useCallback(
    async (actionLabel: string): Promise<StructureMutationScope | null> => {
      const initialGuard = mutationGuardRef.current;
      if (initialGuard.isBlocked) {
        reportError(initialGuard.message);
        return null;
      }
      if (activeMutationIdRef.current !== null) {
        reportError(
          "Une modification de structure est deja en cours. Patientez avant de reessayer."
        );
        return null;
      }

      const requestedRouteGeneration = routeGenerationRef.current;
      if (!(await ensureGroupedActionCanProceed(actionLabel))) return null;
      if (
        requestedRouteGeneration !== routeGenerationRef.current ||
        routeVersionIdRef.current !== routeVersionId
      ) {
        return null;
      }

      const currentGuard = mutationGuardRef.current;
      if (currentGuard.isBlocked) {
        reportError(currentGuard.message);
        return null;
      }
      if (activeMutationIdRef.current !== null) {
        reportError(
          "Une modification de structure est deja en cours. Patientez avant de reessayer."
        );
        return null;
      }

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot || versionSnapshot.id !== routeVersionId) {
        reportError("Version introuvable.");
        return null;
      }

      const scope = {
        id: nextMutationIdRef.current + 1,
        routeGeneration: routeGenerationRef.current,
        version: versionSnapshot,
      };
      nextMutationIdRef.current = scope.id;
      activeMutationIdRef.current = scope.id;
      reportError(null);
      return scope;
    },
    [
      ensureGroupedActionCanProceed,
      getVersionSnapshot,
      reportError,
      routeVersionId,
    ]
  );

  const beginHistoryMutation = useCallback(
    async (
      actionLabel: string,
      context?: EstimateEditorHistoryCommandContext
    ) => {
      if (context && !context.isCurrentScope()) return null;
      const scope = await beginMutation(actionLabel);
      if (!scope) {
        throw new Error("Modification de structure indisponible.");
      }
      if (context && !context.isCurrentScope()) {
        finishMutation(scope);
        return null;
      }
      return scope;
    },
    [beginMutation, finishMutation]
  );

  const isCurrentHistoryMutation = useCallback(
    (
      scope: StructureMutationScope,
      context?: EstimateEditorHistoryCommandContext
    ) =>
      isCurrentMutation(scope) &&
      (!context || context.isCurrentScope()),
    [isCurrentMutation]
  );

  const refreshVersionToken = useCallback(
    async (
      versionId: string,
      isCurrentScope: () => boolean,
      failureContext: string
    ) => {
      const refreshGeneration = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = refreshGeneration;
      await refreshVersionTokenAfterAssemblyInsert(versionId, {
        fetchEstimateEditorData,
        onVersionToken: (updatedAt) => {
          if (
            refreshGenerationRef.current !== refreshGeneration ||
            !isCurrentScope()
          ) {
            return;
          }
          const currentToken = getVersionSnapshot()?.updated_at ?? null;
          const currentTimestamp = currentToken ? Date.parse(currentToken) : NaN;
          const nextTimestamp = Date.parse(updatedAt);
          if (
            Number.isFinite(currentTimestamp) &&
            Number.isFinite(nextTimestamp) &&
            nextTimestamp < currentTimestamp
          ) {
            return;
          }
          applyVersionToken(updatedAt);
        },
        onError: (error) => {
          console.error(failureContext, error);
        },
      });
    },
    [applyVersionToken, getVersionSnapshot]
  );

  const insertAssembly = useCallback(
    async (assemblyId: string, afterItemId: string | null) => {
      const mutationScope = await beginMutation("inserer l'assemblage");
      if (!mutationScope) return;
      const targetVersionId = mutationScope.version.id;

      try {
        const snapshot = getItemsSnapshot();
        let insertedItems: EstimateItem[];
        try {
          insertedItems = await insertAssemblyIntoVersion(assemblyId, {
            versionId: targetVersionId,
            afterItemId,
          });
          if (insertedItems.length === 0 || !isCurrentMutation(mutationScope)) {
            return;
          }

          const insertedIds = new Set(insertedItems.map((item) => item.id));
          const insertedSection =
            insertedItems.find((item) => item.item_type === "section") ??
            insertedItems[0];
          const targetParentId = insertedSection.parent_id ?? null;
          const targetPosition = insertedSection.position;
          const shiftedExistingItems = snapshot.map((item) => {
            if (insertedIds.has(item.id)) return item;
            if ((item.parent_id ?? null) !== targetParentId) return item;
            return item.position < targetPosition
              ? item
              : { ...item, position: item.position + 1 };
          });
          setItems([...shiftedExistingItems, ...insertedItems]);
          setTotalsOutOfSync(false);
          highlightItems([...insertedIds]);
        } catch (error) {
          if (!isCurrentMutation(mutationScope)) return;
          if (!handleVersionConflict(error, { persistDraft: true })) {
            reportError(
              resolveErrorMessage(
                error instanceof Error
                  ? error.message
                  : "Impossible d'insérer l'ouvrage."
              )
            );
          }
          return;
        }

        await refreshVersionToken(
          targetVersionId,
          () => isCurrentMutation(mutationScope),
          "Impossible de rafraichir le jeton de version apres insertion d'ouvrage."
        );
        if (!isCurrentMutation(mutationScope)) return;

        let latestInsertedRoots = resolveTopLevelItemIds(insertedItems);
        pushHistoryCommand({
          label: "insert-assembly",
          undo: async (context) => {
            const historyScope = await beginHistoryMutation(
              "annuler l'insertion de l'assemblage",
              context
            );
            if (!historyScope) return;
            try {
              const undoSnapshot = getItemsSnapshot();
              const idsToRemove = new Set<string>();
              latestInsertedRoots.forEach((rootId) => {
                collectSubtreeItemIds(undoSnapshot, rootId).forEach((id) => {
                  idsToRemove.add(id);
                });
              });
              setItems((previous) =>
                previous.filter((item) => !idsToRemove.has(item.id))
              );
              try {
                for (const rootId of latestInsertedRoots) {
                  await deleteEstimateItem(historyScope.version.id, rootId);
                }
                if (!isCurrentHistoryMutation(historyScope, context)) return;
                setTotalsOutOfSync(false);
              } catch (error) {
                if (!isCurrentHistoryMutation(historyScope, context)) return;
                setItems(undoSnapshot);
                throw error;
              }
            } finally {
              finishMutation(historyScope);
            }
          },
          redo: async (context) => {
            const historyScope = await beginHistoryMutation(
              "retablir l'insertion de l'assemblage",
              context
            );
            if (!historyScope) return;
            try {
              const redoSnapshot = getItemsSnapshot();
              const recreated = await insertAssemblyIntoVersion(assemblyId, {
                versionId: historyScope.version.id,
                afterItemId,
              });
              if (
                recreated.length === 0 ||
                !isCurrentHistoryMutation(historyScope, context)
              ) {
                return;
              }
              latestInsertedRoots = resolveTopLevelItemIds(recreated);
              const recreatedIds = new Set(recreated.map((item) => item.id));
              const insertedSection =
                recreated.find((item) => item.item_type === "section") ??
                recreated[0];
              const targetParentId = insertedSection?.parent_id ?? null;
              const targetPosition = insertedSection?.position ?? 1;
              setItems([
                ...redoSnapshot.map((item) => {
                  if (recreatedIds.has(item.id)) return item;
                  if ((item.parent_id ?? null) !== targetParentId) return item;
                  return item.position < targetPosition
                    ? item
                    : { ...item, position: item.position + 1 };
                }),
                ...recreated,
              ]);
              setTotalsOutOfSync(false);
              await refreshVersionToken(
                historyScope.version.id,
                () => isCurrentHistoryMutation(historyScope, context),
                "Impossible de rafraichir le jeton de version apres reinsertion d'ouvrage."
              );
            } finally {
              finishMutation(historyScope);
            }
          },
        });
      } finally {
        finishMutation(mutationScope);
      }
    },
    [
      beginHistoryMutation,
      beginMutation,
      finishMutation,
      getItemsSnapshot,
      handleVersionConflict,
      isCurrentHistoryMutation,
      isCurrentMutation,
      pushHistoryCommand,
      highlightItems,
      refreshVersionToken,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
    ]
  );

  const insertTemplate = useCallback(
    async (templateId: string, afterItemId: string | null) => {
      const mutationScope = await beginMutation("inserer le template");
      if (!mutationScope) return;
      const targetVersionId = mutationScope.version.id;

      try {
        const snapshot = getItemsSnapshot();
        let insertedItems: EstimateItem[];
        let insertedRootsTracker = createTopLevelItemIdsTracker([]);
        try {
          insertedItems = await insertTemplateIntoVersion(templateId, {
            versionId: targetVersionId,
            afterItemId,
          });
          if (insertedItems.length === 0 || !isCurrentMutation(mutationScope)) {
            return;
          }
          insertedRootsTracker = createTopLevelItemIdsTracker(insertedItems);
          setItems(applyOptimisticTemplateInsertion(snapshot, insertedItems));
          setTotalsOutOfSync(false);
        } catch (error) {
          if (!isCurrentMutation(mutationScope)) return;
          if (!handleVersionConflict(error, { persistDraft: true })) {
            reportError(
              resolveErrorMessage(
                error instanceof Error
                  ? error.message
                  : "Impossible d'inserer le template."
              )
            );
          }
          return;
        }

        await refreshVersionToken(
          targetVersionId,
          () => isCurrentMutation(mutationScope),
          "Impossible de rafraichir le jeton de version apres insertion de template."
        );
        if (!isCurrentMutation(mutationScope)) return;

        pushHistoryCommand({
          label: "insert-template",
          undo: async (context) => {
            const historyScope = await beginHistoryMutation(
              "annuler l'insertion du template",
              context
            );
            if (!historyScope) return;
            try {
              const undoSnapshot = getItemsSnapshot();
              const idsToRemove = new Set<string>();
              insertedRootsTracker.getCurrent().forEach((rootId) => {
                collectSubtreeItemIds(undoSnapshot, rootId).forEach((id) => {
                  idsToRemove.add(id);
                });
              });
              setItems((previous) =>
                previous.filter((item) => !idsToRemove.has(item.id))
              );
              try {
                for (const rootId of insertedRootsTracker.getCurrent()) {
                  await deleteEstimateItem(historyScope.version.id, rootId);
                }
                if (!isCurrentHistoryMutation(historyScope, context)) return;
                setTotalsOutOfSync(false);
              } catch (error) {
                if (!isCurrentHistoryMutation(historyScope, context)) return;
                setItems(undoSnapshot);
                throw error;
              }
            } finally {
              finishMutation(historyScope);
            }
          },
          redo: async (context) => {
            const historyScope = await beginHistoryMutation(
              "retablir l'insertion du template",
              context
            );
            if (!historyScope) return;
            try {
              const redoSnapshot = getItemsSnapshot();
              const recreated = await insertTemplateIntoVersion(templateId, {
                versionId: historyScope.version.id,
                afterItemId,
              });
              if (
                recreated.length === 0 ||
                !isCurrentHistoryMutation(historyScope, context)
              ) {
                return;
              }
              insertedRootsTracker.replace(recreated);
              setItems(
                applyOptimisticTemplateInsertion(redoSnapshot, recreated)
              );
              setTotalsOutOfSync(false);
              await refreshVersionToken(
                historyScope.version.id,
                () => isCurrentHistoryMutation(historyScope, context),
                "Impossible de rafraichir le jeton de version apres reinsertion de template."
              );
            } finally {
              finishMutation(historyScope);
            }
          },
        });
      } finally {
        finishMutation(mutationScope);
      }
    },
    [
      beginHistoryMutation,
      beginMutation,
      finishMutation,
      getItemsSnapshot,
      handleVersionConflict,
      isCurrentHistoryMutation,
      isCurrentMutation,
      pushHistoryCommand,
      refreshVersionToken,
      reportError,
      resolveErrorMessage,
      setItems,
      setTotalsOutOfSync,
    ]
  );

  const duplicateSection = useCallback(
    async (sectionId: string) => {
      const mutationScope = await beginMutation("dupliquer la section");
      if (!mutationScope) return;
      const targetVersionId = mutationScope.version.id;

      try {
        try {
          const result = await duplicateEstimateSection(
            targetVersionId,
            sectionId
          );
          if (!isCurrentMutation(mutationScope)) return;
          await reloadItems();
          if (!isCurrentMutation(mutationScope)) return;
          setTotalsOutOfSync(false);
          if (result.versionToken?.updated_at) {
            applyVersionToken(result.versionToken.updated_at);
            return;
          }
          await refreshVersionToken(
            targetVersionId,
            () => isCurrentMutation(mutationScope),
            "Impossible de rafraichir le jeton de version apres duplication de section."
          );
        } catch (error) {
          if (!isCurrentMutation(mutationScope)) return;
          if (!handleVersionConflict(error, { persistDraft: true })) {
            reportError(
              resolveErrorMessage(
                error instanceof Error
                  ? error.message
                  : "Impossible de dupliquer la section."
              )
            );
          }
        }
      } finally {
        finishMutation(mutationScope);
      }
    },
    [
      applyVersionToken,
      beginMutation,
      finishMutation,
      handleVersionConflict,
      isCurrentMutation,
      refreshVersionToken,
      reloadItems,
      reportError,
      resolveErrorMessage,
      setTotalsOutOfSync,
    ]
  );

  const actions = useMemo(
    () => ({ insertAssembly, insertTemplate, duplicateSection }),
    [duplicateSection, insertAssembly, insertTemplate]
  );

  return { actions };
}
