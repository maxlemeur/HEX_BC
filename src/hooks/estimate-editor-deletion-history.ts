import type { Dispatch, SetStateAction } from "react";

import type { EstimateEditorHistoryCommandContext } from "@/hooks/useEstimateEditorHistoryController";
import type { EditorEstimateItem, EstimateItem } from "@/lib/estimates/editor-items";

export class EstimateDeletionRecoveryError extends Error {
  constructor(
    message: string,
    readonly itemId: string | null,
    readonly canRetry: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "EstimateDeletionRecoveryError";
  }
}

export type RecreatedEstimateDeletionItems = {
  idMap: Map<string, string>;
  createdItems: EstimateItem[];
};

export type EstimateDeletionRecreationOptions = {
  isCurrentScope?: () => boolean;
  onProgress?: (progress: RecreatedEstimateDeletionItems) => void;
};

type DeletionRestorerOptions = {
  versionId: string;
  snapshots: EstimateItem[];
  siblingOrderByParent: Map<string | null, string[]>;
  itemId: string | null;
  plural: boolean;
  isCurrentVersion: () => boolean;
  recreateItemsFromSnapshots: (
    versionId: string,
    snapshots: EstimateItem[],
    options?: EstimateDeletionRecreationOptions
  ) => Promise<RecreatedEstimateDeletionItems>;
  applySiblingOrder: (
    versionId: string,
    remainingParents: Map<string | null, string[]>,
    idMap?: Map<string, string>,
    isCurrentScope?: () => boolean
  ) => Promise<void | boolean>;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  onRestored: (idMap: Map<string, string>) => void;
};

/** A failed order resumes after the acknowledged creates, never by repeating them. */
export function createEstimateDeletionRestorer(options: DeletionRestorerOptions) {
  const copyParents = () => new Map<string | null, string[]>(Array.from(
    options.siblingOrderByParent,
    ([parentId, ids]) => [parentId, [...ids]]
  ));
  let remainingParents = copyParents();
  let recreated: RecreatedEstimateDeletionItems = { idMap: new Map(), createdItems: [] };
  let creationStarted = false;
  let creationConfirmed = false;
  let creationFailure: EstimateDeletionRecoveryError | null = null;

  const remember = (progress: RecreatedEstimateDeletionItems) => {
    recreated = { idMap: new Map(progress.idMap), createdItems: [...progress.createdItems] };
  };
  const publish = () => {
    if (recreated.createdItems.length === 0) return;
    const acknowledgedItems = [...recreated.createdItems];
    const acknowledgedIds = new Set(acknowledgedItems.map((item) => item.id));
    options.setItems((previous) => [
      ...previous.filter((item) => !acknowledgedIds.has(item.id)),
      ...acknowledgedItems,
    ]);
    options.onRestored(new Map(recreated.idMap));
  };
  const restoredItemId = () => (options.itemId ? recreated.idMap.get(options.itemId) : null)
    ?? recreated.createdItems[0]?.id ?? null;
  const unconfirmed = (cause?: unknown) => new EstimateDeletionRecoveryError(
    "La restauration n’a pas pu être confirmée. Rechargez le devis pour vérifier les lignes.",
    restoredItemId(),
    false,
    { cause }
  );

  return {
    async undo(context?: EstimateEditorHistoryCommandContext) {
      const isCurrentScope = () => options.isCurrentVersion() && (!context || context.isCurrentScope());
      if (!isCurrentScope()) return;
      if (creationFailure) throw creationFailure;

      if (!creationConfirmed) {
        // No second attempt may send creates after any ambiguous first attempt.
        if (creationStarted) throw unconfirmed();
        creationStarted = true;
        try {
          remember(await options.recreateItemsFromSnapshots(options.versionId, options.snapshots, {
            isCurrentScope,
            onProgress: (progress) => {
              remember(progress);
              if (isCurrentScope()) options.onRestored(new Map(recreated.idMap));
            },
          }));
          if (!isCurrentScope()) return;
          if (recreated.createdItems.length !== options.snapshots.length ||
              recreated.idMap.size !== options.snapshots.length) throw unconfirmed();
          creationConfirmed = true;
          publish();
        } catch (error) {
          creationFailure = unconfirmed(error);
          if (!isCurrentScope()) return;
          // A subtree is several POSTs: retain the rows already acknowledged,
          // even when a later response cannot confirm the complete restoration.
          publish();
          throw creationFailure;
        }
      }

      try {
        if ((await options.applySiblingOrder(options.versionId, remainingParents, recreated.idMap, isCurrentScope)) === false) return false;
        if (!isCurrentScope()) return;
        if (remainingParents.size !== 0) throw new Error("La remise en ordre est incomplète.");
      } catch (error) {
        if (!isCurrentScope()) return;
        throw new EstimateDeletionRecoveryError(
          options.plural ? "Lignes restaurées, positions à vérifier." : "Ligne restaurée, position à vérifier.",
          restoredItemId(),
          true,
          { cause: error }
        );
      }
    },
    reset() {
      remainingParents = copyParents();
      recreated = { idMap: new Map(), createdItems: [] };
      creationStarted = false;
      creationConfirmed = false;
      creationFailure = null;
    },
  };
}
