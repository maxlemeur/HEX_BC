"use client";

import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import { EstimateEditorDocument, normalizeEstimateEditorIdentity } from "@/lib/estimates/editor-document-state";
import { writeDocumentAutoSaveDraft } from "@/lib/estimates/editor-document-drafts";

/** One document authority, shared by reads, editing, synchronization and recovery. */
export function useEstimateEditorDocument(scope: {
  actorId: string | null;
  tenantId: string | null;
  versionId: string;
}) {
  const actorId = normalizeEstimateEditorIdentity(scope.actorId);
  const tenantId = normalizeEstimateEditorIdentity(scope.tenantId);
  const versionId = normalizeEstimateEditorIdentity(scope.versionId)!;
  const [document] = useState(() => new EstimateEditorDocument({ actorId, tenantId, versionId }));
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  useLayoutEffect(() => {
    const previous = document.captureScope();
    if (previous.actorId === actorId && previous.tenantId === tenantId && previous.versionId === versionId) return;
    // Persist before retiring the old identity. A later cleanup must never save
    // the next document's intentions under the previous version's storage key.
    const unsaved = document.getUnsavedUpdates();
    if (previous.versionId && (document.getSnapshot().version || unsaved.size > 0)) {
      writeDocumentAutoSaveDraft(previous, Array.from(unsaved, ([id, updates]) => ({ id, updates })));
    }
    document.changeScope({ actorId, tenantId, versionId });
  }, [document, actorId, tenantId, versionId]);

  const refs = useMemo(() => ({
    itemsRef: { get current() { return document.getSnapshot().items; } },
    versionRef: { get current() { return document.getSnapshot().version; } },
  }), [document]);
  const port = useMemo(() => {
    const token = { ...document.captureScope(), generation: snapshot.generation };
    return {
      scope: token,
      setItems: (value: Parameters<EstimateEditorDocument["setDraftItems"]>[0]) => {
        if (document.isCurrent(token)) document.setDraftItems(value);
      },
      setSettings: (value: Parameters<EstimateEditorDocument["setDraftSettings"]>[0]) => {
        if (document.isCurrent(token)) document.setDraftSettings(value);
      },
      setCategories: (value: Parameters<EstimateEditorDocument["setCategories"]>[0]) => {
        if (document.isCurrent(token)) document.setCategories(value);
      },
      setSupplyTypes: (value: Parameters<EstimateEditorDocument["setSupplyTypes"]>[0]) => {
        if (document.isCurrent(token)) document.setSupplyTypes(value);
      },
      setLaborRoles: (value: Parameters<EstimateEditorDocument["setLaborRoles"]>[0]) => {
        if (document.isCurrent(token)) document.setLaborRoles(value);
      },
      setVersion: (value: Parameters<EstimateEditorDocument["setConfirmedVersion"]>[0]) => {
        if (document.isCurrent(token)) document.setConfirmedVersion(value, token);
      },
    };
  // The generation deliberately changes these ports: an old asynchronous
  // controller callback must not modify a later visit to the same version.
  }, [document, snapshot.generation]);
  return { document, ...snapshot, ...refs, ...port };
}
