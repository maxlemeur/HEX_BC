"use client";

import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import type { EditorEstimateItem, EstimateItemUpdatePayload, EstimateVersionTotalsPatch } from "@/lib/estimates/editor-items";

type ItemsReceipt = Parameters<EstimateEditorDocument["acceptItemsReceipt"]>[1];

type ItemsOperation =
  | { cancelled: true }
  | { document: EstimateEditorDocument; operation: ReturnType<EstimateEditorDocument["beginItemsOperation"]> }
  | { snapshot: EditorEstimateItem[] };

/** The document owns rollback; standalone controller consumers keep their original local behavior. */
export function useEstimateEditorItemsOperation(input: {
  document?: EstimateEditorDocument;
  getItemsSnapshot: () => EditorEstimateItem[];
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  applyVersionToken?: (updatedAt: string, totals?: EstimateVersionTotalsPatch, contentRevision?: number) => void;
  markItemsSynced?: (updates: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>) => void;
}) {
  const { document, getItemsSnapshot, setItems, applyVersionToken, markItemsSynced } = input;
  const subscribe = useCallback((notify: () => void) => document?.subscribe(notify) ?? (() => undefined), [document]);
  const getGeneration = useCallback(() => document?.getSnapshot().generation ?? 0, [document]);
  const generation = useSyncExternalStore(subscribe, getGeneration, getGeneration);
  const scope = useMemo(() => document ? { ...document.captureScope(), generation } : null, [document, generation]);
  const isItemsDocumentCurrent = useCallback(() => !document || Boolean(scope && document.isCurrent(scope)), [document, scope]);
  const beginItemsOperation = useCallback((update: SetStateAction<EditorEstimateItem[]>): ItemsOperation => {
    if (!isItemsDocumentCurrent()) return { cancelled: true };
    if (document) return { document, operation: document.beginItemsOperation(update) };
    const snapshot = getItemsSnapshot();
    setItems(update);
    return { snapshot };
  }, [document, getItemsSnapshot, isItemsDocumentCurrent, setItems]);
  const isItemsOperationCurrent = useCallback((operation: ItemsOperation) =>
    !("cancelled" in operation) && (!("document" in operation) || operation.document.isCurrent(operation.operation.scope)), []);
  const rollbackItems = useCallback((operation: ItemsOperation) => {
    if ("cancelled" in operation) return false;
    if ("document" in operation) return operation.document.rollbackItems(operation.operation);
    setItems(operation.snapshot);
    return true;
  }, [setItems]);
  const acceptItemsOperation = useCallback((operation: ItemsOperation) =>
    !("cancelled" in operation) && (!("document" in operation) || operation.document.acceptItemsOperation(operation.operation)), []);
  const releaseItemsOperation = useCallback((operation: ItemsOperation) => {
    if ("document" in operation) operation.document.releaseItemsOperation(operation.operation);
  }, []);
  const acceptItemsReceipt = useCallback((operation: ItemsOperation, receipt: ItemsReceipt) => {
    if ("cancelled" in operation) return false;
    if ("document" in operation) return operation.document.acceptItemsReceipt(operation.operation, receipt);
    applyVersionToken?.(receipt.version.updated_at, receipt.totals, receipt.version.content_revision);
    if (receipt.updates) markItemsSynced?.(receipt.updates);
    return true;
  }, [applyVersionToken, markItemsSynced]);
  const acceptDeletedItems = useCallback((operation: ItemsOperation, receipt: {
    version: ItemsReceipt["version"]; deletedIds: readonly string[];
  }) => {
    if ("cancelled" in operation) return false;
    if ("document" in operation) return operation.document.confirmDeletedItems(
      receipt.deletedIds, operation.operation.scope, receipt.version
    );
    applyVersionToken?.(receipt.version.updated_at, undefined, receipt.version.content_revision);
    return true;
  }, [applyVersionToken]);
  return { beginItemsOperation, isItemsOperationCurrent, isItemsDocumentCurrent, rollbackItems, acceptItemsOperation, releaseItemsOperation, acceptItemsReceipt, acceptDeletedItems };
}
