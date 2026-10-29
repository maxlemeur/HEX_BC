import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateEditorData, EstimateVersionWithProject } from "@/lib/estimates/client";
import type { BufferedItemDerivation, BufferedUpdate } from "@/lib/estimates/bulk-buffer";
import {
  buildEstimateItemUpdatePayload,
  withStableEditorClientKeys,
  type EditorEstimateItem,
  type EstimateItemUpdatePayload,
  type EstimateVersionTotalsPatch,
} from "@/lib/estimates/editor-items";
import { reconcileCreatedItemWithLocalDraft } from "@/lib/estimates/editor-optimistic";
import type { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { mergeReloadedEditorSettings } from "@/lib/estimates/editor-settings-state";
import { isOlderEstimateVersionToken } from "@/lib/estimates/version-token";
import {
  freshEstimateDocumentV3Settings,
  readEstimateDocumentV3SettingsBaseline,
  resyncEstimateDocumentV3Settings,
  type EstimateDocumentV3SettingsState,
} from "@/lib/estimates/editor-document-v3-settings";

export type EstimateEditorDocumentScope = {
  actorId: string | null;
  tenantId: string | null;
  versionId: string;
};
export type Scope = EstimateEditorDocumentScope;
export type EstimateEditorDocumentScopeToken = Scope & { generation: number };
type Update<T> = T | ((previous: T) => T);
type ItemEntry = BufferedUpdate<EstimateItemUpdatePayload>;
type PreparedRead = ReturnType<typeof prepareEstimateEditorRead>;

export type EstimateEditorDocumentSave = {
  readonly id: number;
  readonly scope: EstimateEditorDocumentScopeToken;
  readonly entries: readonly ItemEntry[];
};

export type EstimateEditorItemsOperation = {
  readonly id: number;
  readonly scope: EstimateEditorDocumentScopeToken;
  readonly before: readonly EditorEstimateItem[];
  readonly optimistic: readonly EditorEstimateItem[];
};

export type EstimateEditorItemsReceipt = {
  version: { id: string; updated_at: string; content_revision?: number };
  totals?: EstimateVersionTotalsPatch;
  /** Omitted when the writer confirms the operation's structural delta. */
  updates?: readonly ItemEntry[];
};

export type EstimateEditorDocumentSnapshot = {
  version: EstimateVersionWithProject | null;
  /** The displayed draft, including previews and optimistic rows. */
  items: EditorEstimateItem[];
  /** Persisted rows, never the result of applying a local preview. */
  confirmedItems: EditorEstimateItem[];
  settings: EstimateSettingsState | null;
  savedSettings: EstimateSettingsState | null;
  categories: EstimateEditorData["categories"];
  supplyTypes: EstimateEditorData["supplyTypes"];
  laborRoles: EstimateEditorData["laborRoles"];
  v3Settings: EstimateDocumentV3SettingsState;
  pendingCount: number;
  inFlightCount: number;
  itemOperationCount: number;
  generation: number;
};

export function normalizeEstimateEditorIdentity(value: string | null) {
  return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : value;
}

const identityValue = normalizeEstimateEditorIdentity;

function sameIdentity(left: Scope, right: Scope) {
  return identityValue(left.actorId) === identityValue(right.actorId) &&
    identityValue(left.tenantId) === identityValue(right.tenantId) &&
    identityValue(left.versionId) === identityValue(right.versionId);
}

function valueOf<T>(update: Update<T>, previous: T): T {
  return typeof update === "function" ? (update as (value: T) => T)(previous) : update;
}

function sameValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  return typeof left === "object" && left !== null && typeof right === "object" && right !== null &&
    JSON.stringify(left) === JSON.stringify(right);
}

function cloneEntries(entries: Iterable<ItemEntry>): ItemEntry[] {
  return Array.from(entries, ({ id, updates }) => ({ id, updates: { ...updates } }));
}

/**
 * One document owns confirmed rows, displayed previews and persistable intentions.
 * Transport and React may observe it, but neither maintains another line baseline.
 */
export class EstimateEditorDocument {
  private scope: Scope;
  private snapshot: EstimateEditorDocumentSnapshot;
  private projectedItems: EditorEstimateItem[] = [];
  private previews = new Map<string, Partial<EditorEstimateItem>>();
  private optimisticRows = new Map<string, EditorEstimateItem>();
  private removedRows = new Set<string>();
  private confirmedDeletedIds = new Set<string>();
  private pending = new Map<string, EstimateItemUpdatePayload>();
  private inFlight = new Map<number, EstimateEditorDocumentSave>();
  /** Derived lookup only; source rows and immutable save captures remain authoritative. */
  private expectedIndex: {
    items: EditorEstimateItem[];
    captures: readonly EstimateEditorDocumentSave[];
    byId: Map<string, Partial<EditorEstimateItem>>;
  } | null = null;
  private nextSaveId = 0;
  private nextItemsOperationId = 0;
  private editSequence = 0;
  private fieldRevisions = new Map<string, Map<string, number>>();
  private itemOperations = new Map<number, {
    operation: EstimateEditorItemsOperation;
    revisions: Map<string, Map<string, number>>;
    baseline: Map<string, EditorEstimateItem>;
  }>();
  private deriveItem?: BufferedItemDerivation<EditorEstimateItem>;
  private listeners = new Set<() => void>();
  private transactionDepth = 0;
  private publicationPending = false;

  constructor(scope: Scope) {
    this.scope = { ...scope };
    this.snapshot = this.emptySnapshot(0);
  }

  private emptySnapshot(generation: number): EstimateEditorDocumentSnapshot {
    return {
      version: null, items: [], confirmedItems: [], settings: null, savedSettings: null,
      categories: [], supplyTypes: [], laborRoles: [],
      v3Settings: freshEstimateDocumentV3Settings(readEstimateDocumentV3SettingsBaseline(null)),
      pendingCount: 0, inFlightCount: 0, itemOperationCount: 0, generation,
    };
  }

  getSnapshot = () => this.snapshot;
  getV3Settings = () => this.snapshot.v3Settings;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  transaction = (work: () => void) => {
    this.transactionDepth += 1;
    try { work(); }
    finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.publicationPending) this.publish();
    }
  };

  private publish() {
    this.publicationPending = true;
    if (this.transactionDepth > 0) return;
    this.publicationPending = false;
    this.listeners.forEach((listener) => listener());
  }

  private update(patch: Partial<EstimateEditorDocumentSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch,
      pendingCount: this.pending.size, inFlightCount: this.inFlight.size,
      itemOperationCount: this.itemOperations.size };
    this.publish();
  }

  captureScope = (): EstimateEditorDocumentScopeToken => ({ ...this.scope, generation: this.snapshot.generation });
  isCurrent = (scope: EstimateEditorDocumentScopeToken) =>
    sameIdentity(this.scope, scope) && this.snapshot.generation === scope.generation;

  changeScope = (scope: Scope) => {
    if (sameIdentity(this.scope, scope)) return false;
    this.scope = { ...scope };
    this.projectedItems = [];
    this.previews.clear();
    this.optimisticRows.clear();
    this.removedRows.clear();
    this.confirmedDeletedIds.clear();
    this.pending.clear();
    this.inFlight.clear();
    this.itemOperations.clear();
    this.fieldRevisions.clear();
    this.deriveItem = undefined;
    this.snapshot = this.emptySnapshot(this.snapshot.generation + 1);
    this.publish();
    return true;
  };

  private acceptsVersion(version: EstimateVersionWithProject | null, scope?: EstimateEditorDocumentScopeToken) {
    return (!scope || this.isCurrent(scope)) && (!version || (
      identityValue(version.id) === identityValue(this.scope.versionId) &&
      (!this.scope.tenantId || identityValue(version.tenant_id) === identityValue(this.scope.tenantId)) &&
      (!this.snapshot.version || !isOlderEstimateVersionToken(version.updated_at, this.snapshot.version.updated_at))
    ));
  }

  setConfirmedVersion = (update: Update<EstimateVersionWithProject | null>, scope?: EstimateEditorDocumentScopeToken) => {
    if (scope && !this.isCurrent(scope)) return false;
    const version = valueOf(update, this.snapshot.version);
    if (!this.acceptsVersion(version, scope)) return false;
    this.update({ version, v3Settings: resyncEstimateDocumentV3Settings(this.snapshot.v3Settings,
      readEstimateDocumentV3SettingsBaseline(version)) });
    return true;
  };

  setDraftSettings = (update: Update<EstimateSettingsState | null>) => {
    this.update({ settings: valueOf(update, this.snapshot.settings) });
  };

  setConfirmedSettings = (update: Update<EstimateSettingsState | null>) => {
    this.update({ savedSettings: valueOf(update, this.snapshot.savedSettings) });
  };

  setCategories = (update: Update<EstimateEditorData["categories"]>) => {
    this.update({ categories: valueOf(update, this.snapshot.categories) });
  };

  setSupplyTypes = (update: Update<EstimateEditorData["supplyTypes"]>) => {
    this.update({ supplyTypes: valueOf(update, this.snapshot.supplyTypes) });
  };

  setLaborRoles = (update: Update<EstimateEditorData["laborRoles"]>) => {
    this.update({ laborRoles: valueOf(update, this.snapshot.laborRoles) });
  };

  discardSettings = () => {
    this.update({ settings: this.snapshot.savedSettings,
      v3Settings: freshEstimateDocumentV3Settings(readEstimateDocumentV3SettingsBaseline(this.snapshot.version)) });
  };

  updateV3Settings = (
    update: Update<EstimateDocumentV3SettingsState>, scope?: EstimateEditorDocumentScopeToken
  ) => {
    if (scope && !this.isCurrent(scope)) return false;
    this.update({ v3Settings: valueOf(update, this.snapshot.v3Settings) });
    return true;
  };

  private expectedItems() {
    const items = this.snapshot.confirmedItems;
    const captures = Array.from(this.inFlight.values());
    const cached = this.expectedIndex;
    if (cached?.items === items && cached.captures.length === captures.length &&
        cached.captures.every((capture, index) => capture === captures[index])) return cached.byId;
    const byId = new Map<string, Partial<EditorEstimateItem>>(items.map((item) => [item.id, item]));
    for (const capture of captures) {
      capture.entries.forEach(({ id, updates }) => byId.set(id, { ...byId.get(id), ...updates }));
    }
    this.expectedIndex = { items, captures, byId };
    return byId;
  }

  private expectedItem(itemId: string): Partial<EditorEstimateItem> | undefined {
    return this.expectedItems().get(itemId);
  }

  private displayedItems() {
    const inFlightById = new Map<string, EstimateItemUpdatePayload>();
    for (const capture of this.inFlight.values()) {
      capture.entries.forEach(({ id, updates }) => {
        inFlightById.set(id, { ...inFlightById.get(id), ...updates });
      });
    }
    const baseIds = new Set(this.projectedItems.map((item) => item.id));
    const rows = [...this.projectedItems,
      ...Array.from(this.optimisticRows.values()).filter((item) => !baseIds.has(item.id))];
    return rows.filter((item) => !this.removedRows.has(item.id)).map((item) => {
      const sent = inFlightById.get(item.id);
      const pending = this.pending.get(item.id);
      const preview = this.previews.get(item.id);
      if (!sent && !pending && !preview) return item;
      const merged = { ...item, ...sent, ...pending, ...preview } as EditorEstimateItem;
      return this.deriveItem ? this.deriveItem(item, merged) : merged;
    });
  }

  /** Compatibility port for existing optimistic consumers; this never confirms data. */
  setDraftItems = (update: Update<EditorEstimateItem[]>) => {
    const previous = this.snapshot.items;
    const next = valueOf(update, previous);
    if (next === previous) return;
    const previousById = new Map(previous.map((item) => [item.id, item]));
    const baseById = new Map(this.projectedItems.map((item) => [item.id, item]));
    const nextIds = new Set(next.map((item) => item.id));
    const revision = ++this.editSequence;
    const mark = (id: string, key: string) => {
      const fields = this.fieldRevisions.get(id) ?? new Map<string, number>();
      fields.set(key, revision);
      this.fieldRevisions.set(id, fields);
    };
    previous.forEach((item) => {
      if (nextIds.has(item.id)) return;
      mark(item.id, "@row");
      if (baseById.has(item.id)) this.removedRows.add(item.id);
      this.optimisticRows.delete(item.id);
      this.previews.delete(item.id);
    });
    next.forEach((item) => {
      if (item === previousById.get(item.id)) return;
      this.removedRows.delete(item.id);
      if (!previousById.has(item.id)) mark(item.id, "@row");
      if (!baseById.has(item.id)) {
        this.optimisticRows.set(item.id, { ...item });
        return;
      }
      const old = previousById.get(item.id) ?? baseById.get(item.id)!;
      const preview = { ...this.previews.get(item.id) } as Record<string, unknown>;
      const before = old as unknown as Record<string, unknown>;
      const after = item as unknown as Record<string, unknown>;
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!sameValue(before[key], after[key])) {
          preview[key] = after[key];
          mark(item.id, key);
        }
      }
      if (Object.keys(preview).length) this.previews.set(item.id, preview as Partial<EditorEstimateItem>);
    });
    this.update({ items: this.displayedItems() });
  };

  /** Capture the exact optimistic change so failure can undo that change alone. */
  beginItemsOperation = (update: Update<EditorEstimateItem[]>): EstimateEditorItemsOperation => {
    const before = this.snapshot.items;
    const baseline = new Map(this.projectedItems.map((item) => [item.id, item]));
    let operation!: EstimateEditorItemsOperation;
    this.transaction(() => {
      this.setDraftItems(update);
      operation = Object.freeze({ id: ++this.nextItemsOperationId, scope: Object.freeze(this.captureScope()),
        before: Object.freeze(before.map((item) => Object.freeze({ ...item }))),
        optimistic: Object.freeze(this.snapshot.items.map((item) => Object.freeze({ ...item }))) });
      const revisions = new Map(Array.from(this.fieldRevisions, ([id, fields]) => [id, new Map(fields)]));
      this.itemOperations.set(operation.id, { operation, revisions, baseline });
      this.update({});
    });
    return operation;
  };

  rollbackItems = (operation: EstimateEditorItemsOperation) => {
    const tracked = this.itemOperations.get(operation.id);
    if (!this.isCurrent(operation.scope) || tracked?.operation !== operation) return false;
    const before = new Map(operation.before.map((item) => [item.id, item]));
    const optimistic = new Map(operation.optimistic.map((item) => [item.id, item]));
    const current = new Map(this.snapshot.items.map((item) => [item.id, item]));
    const retiredPreviewFields = new Map<string, string[]>();
    const stillOwned = (id: string, key: string) =>
      tracked.revisions.get(id)?.get(key) === this.fieldRevisions.get(id)?.get(key);
    for (const id of new Set([...before.keys(), ...optimistic.keys()])) {
      const original = before.get(id);
      const changed = optimistic.get(id);
      if (!original && changed && stillOwned(id, "@row")) {
        current.delete(id);
      } else if (original && !changed && stillOwned(id, "@row")) {
        this.removedRows.delete(id);
        const latestBase = this.projectedItems.find((item) => item.id === id);
        if (!current.has(id) && (latestBase || original._optimistic || original._pendingCreate)) {
          const oldBase = tracked.baseline.get(id);
          const restored = { ...(latestBase ?? original) } as unknown as Record<string, unknown>;
          // Restore local values that preceded the deletion, not old untouched server fields.
          for (const [key, value] of Object.entries(original)) {
            if (!oldBase || !sameValue(value, (oldBase as unknown as Record<string, unknown>)[key])) restored[key] = value;
          }
          current.set(id, restored as unknown as EditorEstimateItem);
        }
      } else if (original && changed && current.has(id)) {
        const restored = { ...current.get(id)! } as unknown as Record<string, unknown>;
        const oldFields = original as unknown as Record<string, unknown>;
        const changedFields = changed as unknown as Record<string, unknown>;
        const previousBase = tracked.baseline.get(id) as unknown as Record<string, unknown> | undefined;
        const latestBase = this.projectedItems.find((item) => item.id === id) as unknown as Record<string, unknown> | undefined;
        for (const key of new Set([...Object.keys(oldFields), ...Object.keys(changedFields)])) {
          if (!sameValue(oldFields[key], changedFields[key]) && stillOwned(id, key)) {
            const followsServer = previousBase && latestBase && sameValue(oldFields[key], previousBase[key]);
            restored[key] = followsServer ? latestBase[key] : oldFields[key];
            if (followsServer) retiredPreviewFields.set(id, [...retiredPreviewFields.get(id) ?? [], key]);
          }
        }
        current.set(id, restored as unknown as EditorEstimateItem);
      }
    }
    this.transaction(() => {
      this.itemOperations.delete(operation.id);
      this.setDraftItems(Array.from(current.values()));
      // Removing an operation's preview must expose future reads too, rather
      // than leaving the currently read value pinned as a new local preview.
      retiredPreviewFields.forEach((keys, id) => {
        const preview = { ...this.previews.get(id) } as Record<string, unknown>;
        keys.forEach((key) => { delete preview[key]; });
        if (Object.keys(preview).length) this.previews.set(id, preview as Partial<EditorEstimateItem>);
        else this.previews.delete(id);
      });
      this.update({ items: this.displayedItems() });
    });
    return true;
  };

  /** The receipt's revision gates every part of confirmation, including its rows. */
  acceptItemsReceipt = (operation: EstimateEditorItemsOperation, receipt: EstimateEditorItemsReceipt) => {
    if (!this.isCurrent(operation.scope) || this.itemOperations.get(operation.id)?.operation !== operation) return false;
    const current = this.snapshot.version;
    if (!current || identityValue(receipt.version.id) !== identityValue(current.id)) return false;
    if (isOlderEstimateVersionToken(receipt.version.updated_at, current.updated_at)) {
      this.rollbackItems(operation);
      return false;
    }
    this.transaction(() => {
      this.setConfirmedVersion({ ...current, ...(receipt.totals ?? {}), updated_at: receipt.version.updated_at,
        ...(receipt.version.content_revision === undefined ? {} : { content_revision: receipt.version.content_revision }) }, operation.scope);
      if (receipt.updates === undefined) this.acceptItemsOperation(operation);
      else {
        this.acknowledgeItems(receipt.updates);
        this.releaseItemsOperation(operation);
      }
    });
    return true;
  };

  /** A local preview/queued edit is now owned by the journal, not a structural request. */
  releaseItemsOperation = (operation: EstimateEditorItemsOperation) => {
    if (!this.isCurrent(operation.scope) || this.itemOperations.get(operation.id)?.operation !== operation) return false;
    this.itemOperations.delete(operation.id);
    this.update({});
    return true;
  };

  acceptCreatedItem = (
    tempId: string | null, serverItem: EditorEstimateItem, scope?: EstimateEditorDocumentScopeToken,
    displayedItem?: EditorEstimateItem, versionToken?: EstimateEditorItemsReceipt["version"]
  ) => {
    if ((scope && !this.isCurrent(scope)) ||
        identityValue(serverItem.version_id) !== identityValue(this.scope.versionId) ||
        (this.scope.tenantId && identityValue(serverItem.tenant_id) !== identityValue(this.scope.tenantId))) return false;
    const currentVersion = this.snapshot.version;
    if (versionToken && (!currentVersion || identityValue(versionToken.id) !== identityValue(currentVersion.id))) return false;
    const staleReceipt = Boolean(versionToken && currentVersion &&
      isOlderEstimateVersionToken(versionToken.updated_at, currentVersion.updated_at));
    const temporary = tempId === null ? undefined : this.snapshot.items.find((item) => item.id === tempId);
    if (tempId !== null && !temporary) return false;
    const existing = this.snapshot.confirmedItems.find((item) => item.id === serverItem.id);
    const removeTemporary = () => {
      if (tempId === null) return;
      this.pending.delete(tempId);
      this.previews.delete(tempId);
      this.optimisticRows.delete(tempId);
      this.removedRows.delete(tempId);
      this.fieldRevisions.delete(tempId);
    };
    // A complete newer read also proves absence: an old create cannot resurrect it.
    if (staleReceipt && !existing) {
      if (tempId !== null) {
        removeTemporary();
        this.update({ items: this.displayedItems() });
      }
      return false;
    }
    this.transaction(() => {
      if (versionToken && currentVersion && !staleReceipt) {
        this.setConfirmedVersion({ ...currentVersion, ...versionToken }, scope);
      }
      const clientKey = temporary?._clientKey ?? tempId ?? serverItem.id;
      const displayed = displayedItem ?? (temporary && tempId !== null
        ? reconcileCreatedItemWithLocalDraft(serverItem,
            buildEstimateItemUpdatePayload(temporary), this.pending.get(tempId), clientKey)
        : serverItem);
      const keepNewer = existing && (staleReceipt || isOlderEstimateVersionToken(serverItem.updated_at, existing.updated_at));
      const confirmedRow = keepNewer ? existing : serverItem;
      const projectedRow = keepNewer
        ? this.projectedItems.find((item) => item.id === serverItem.id) ?? confirmedRow
        : serverItem;
      const confirmed = { ...projectedRow, _clientKey: clientKey, _optimistic: false, _pendingCreate: false };
      const receiptBaseline = { ...serverItem, _clientKey: clientKey } as unknown as Record<string, unknown>;
      const existingPending = this.pending.get(serverItem.id);
      const protectedFields = new Set([
        ...Object.keys(existingPending ?? {}), ...Object.keys(this.previews.get(serverItem.id) ?? {}),
      ]);
      for (const capture of this.inFlight.values()) {
        capture.entries.filter((entry) => entry.id === serverItem.id).forEach((entry) =>
          Object.keys(entry.updates).forEach((key) => protectedFields.add(key)));
      }
      // Keep intentions made on the real UUID ahead of the older temporary row.
      const patch = Object.fromEntries(Object.entries(displayed).filter(([key, value]) =>
        !["id", "tenant_id", "version_id", "created_at", "updated_at", "_pendingCreate", "_optimistic", "_tempId"].includes(key) &&
        !protectedFields.has(key) && !sameValue(value, receiptBaseline[key])));
      const queued = tempId === null ? undefined : this.pending.get(tempId);
      removeTemporary();
      if (queued) {
        const transferred = Object.fromEntries(Object.entries(queued).filter(([key]) => !protectedFields.has(key)));
        if (Object.keys(transferred).length) this.pending.set(serverItem.id, { ...transferred, ...existingPending });
      }
      if (Object.keys(patch).length) this.previews.set(serverItem.id, {
        ...patch, ...this.previews.get(serverItem.id),
      } as Partial<EditorEstimateItem>);
      this.confirmedDeletedIds.delete(serverItem.id);
      this.projectedItems = [...this.projectedItems.filter((item) => item.id !== tempId && item.id !== serverItem.id), confirmed];
      this.snapshot = { ...this.snapshot,
        confirmedItems: [...this.snapshot.confirmedItems.filter((item) => item.id !== serverItem.id), { ...confirmedRow }] };
      this.prune();
      this.update({ items: this.displayedItems() });
    });
    return !staleReceipt;
  };

  /** A supplied array is a complete server read; otherwise confirm only this operation's delta. */
  acceptItemsOperation = (operation: EstimateEditorItemsOperation, confirmed?: readonly EditorEstimateItem[]) => {
    const tracked = this.itemOperations.get(operation.id);
    if (!this.isCurrent(operation.scope) || tracked?.operation !== operation) return false;
    const before = new Map(operation.before.map((item) => [item.id, item]));
    const optimistic = new Map(operation.optimistic.map((item) => [item.id, item]));
    let rows = this.snapshot.confirmedItems;
    const delta: ItemEntry[] = [];
    for (const [id, original] of before) {
      const changed = optimistic.get(id);
      if (!changed) {
        rows = rows.filter((item) => item.id !== id);
        this.confirmedDeletedIds.add(id);
        this.pending.delete(id);
        if (tracked.revisions.get(id)?.get("@row") === this.fieldRevisions.get(id)?.get("@row")) this.removedRows.delete(id);
        this.previews.delete(id);
        this.optimisticRows.delete(id);
        this.fieldRevisions.delete(id);
        continue;
      }
      const oldFields = original as unknown as Record<string, unknown>;
      const nextFields = changed as unknown as Record<string, unknown>;
      const patch = Object.fromEntries(Object.entries(nextFields).filter(([key, value]) => !sameValue(oldFields[key], value)));
      if (Object.keys(patch).length) delta.push({ id, updates: patch as EstimateItemUpdatePayload });
      const preview = { ...this.previews.get(id) } as Record<string, unknown>;
      Object.keys(patch).forEach((key) => {
        if (tracked.revisions.get(id)?.get(key) === this.fieldRevisions.get(id)?.get(key)) delete preview[key];
      });
      if (Object.keys(preview).length) this.previews.set(id, preview as Partial<EditorEstimateItem>);
      else this.previews.delete(id);
    }
    for (const [id, item] of optimistic) {
      // A temporary row can only be confirmed with the real row returned by the writer.
      if (!before.has(id) && !id.startsWith("tmp:") && !item._pendingCreate) {
        rows = [...rows.filter((row) => row.id !== id), item];
        this.optimisticRows.delete(id);
      }
    }
    this.transaction(() => {
      this.itemOperations.delete(operation.id);
      this.snapshot = { ...this.snapshot, confirmedItems: rows };
      this.projectedItems = this.projectedItems.filter((item) => rows.some((row) => row.id === item.id));
      this.acknowledge(delta);
      if (confirmed) this.acceptItems(confirmed);
      else {
        const existing = new Set(this.projectedItems.map((item) => item.id));
        this.projectedItems = [...this.projectedItems, ...rows.filter((item) => !existing.has(item.id))];
        this.update({ items: this.displayedItems() });
      }
    });
    return true;
  };

  /** A defensive copy is intentional: recovery code must use updatePending to mutate. */
  getPendingUpdates = (): ReadonlyMap<string, EstimateItemUpdatePayload> =>
    new Map(Array.from(this.pending, ([id, updates]) => [id, { ...updates }]));

  /** Includes submitted but unacknowledged work for durable local recovery. */
  getUnsavedUpdates = (): ReadonlyMap<string, EstimateItemUpdatePayload> => {
    const entries = new Map<string, EstimateItemUpdatePayload>();
    for (const capture of this.inFlight.values()) {
      capture.entries.forEach(({ id, updates }) => {
        if (!this.confirmedDeletedIds.has(id)) entries.set(id, { ...entries.get(id), ...updates });
      });
    }
    this.pending.forEach((updates, id) => entries.set(id, { ...entries.get(id), ...updates }));
    return entries;
  };

  enqueueItem = (id: string, payload: EstimateItemUpdatePayload) => {
    if (this.confirmedDeletedIds.has(id)) return false;
    const before = this.pending.get(id);
    const next = { ...before } as Record<string, unknown>;
    const expected = this.expectedItem(id) as Record<string, unknown> | undefined;
    const preview = { ...this.previews.get(id) } as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      if (expected && key in expected && Object.is(expected[key] ?? null, value ?? null)) delete next[key];
      else next[key] = value;
      if (sameValue(preview[key], value)) delete preview[key];
    }
    if (Object.keys(next).length) this.pending.set(id, next as EstimateItemUpdatePayload);
    else this.pending.delete(id);
    if (Object.keys(preview).length) this.previews.set(id, preview as Partial<EditorEstimateItem>);
    else this.previews.delete(id);
    const changed = !sameValue(before ?? null, this.pending.get(id) ?? null);
    this.update({ items: this.displayedItems() });
    return changed;
  };

  clearPending = () => {
    this.pending.clear();
    this.update({ items: this.displayedItems() });
  };

  deletePending = (ids: readonly string[]) => {
    ids.forEach((id) => { this.pending.delete(id); this.previews.delete(id); });
    this.update({ items: this.displayedItems() });
  };

  /** Deletion receipts retire both the persisted row and every local intention for that row. */
  confirmDeletedItems = (
    ids: readonly string[], scope?: EstimateEditorDocumentScopeToken,
    versionToken?: EstimateEditorItemsReceipt["version"]
  ) => {
    if (scope && !this.isCurrent(scope)) return false;
    const current = this.snapshot.version;
    if (versionToken && (!current || identityValue(versionToken.id) !== identityValue(current.id) ||
        isOlderEstimateVersionToken(versionToken.updated_at, current.updated_at))) return false;
    this.transaction(() => {
      if (versionToken && current) this.setConfirmedVersion({ ...current, updated_at: versionToken.updated_at,
        ...(versionToken.content_revision === undefined ? {} : { content_revision: versionToken.content_revision }) }, scope);
      const deleted = new Set(ids);
      ids.forEach((id) => {
        this.confirmedDeletedIds.add(id);
        this.pending.delete(id);
        this.previews.delete(id);
        this.optimisticRows.delete(id);
        this.removedRows.delete(id);
        this.fieldRevisions.delete(id);
      });
      this.projectedItems = this.projectedItems.filter((item) => !deleted.has(item.id));
      this.update({ confirmedItems: this.snapshot.confirmedItems.filter((item) => !deleted.has(item.id)),
        items: this.displayedItems() });
    });
    return true;
  };

  replacePending = (entries: Iterable<ItemEntry>) => {
    this.pending = new Map(cloneEntries(entries).map(({ id, updates }) => [id, updates]));
    this.update({ items: this.displayedItems() });
  };

  updatePending = (mutate: (updates: Map<string, EstimateItemUpdatePayload>) => void) => {
    const next = new Map(Array.from(this.pending, ([id, updates]) => [id, { ...updates }]));
    mutate(next);
    this.pending = new Map(Array.from(next, ([id, updates]) => [id, { ...updates }]));
    this.update({ items: this.displayedItems() });
  };

  private prune() {
    let changed = false;
    const expectedById = this.expectedItems();
    for (const [id, payload] of this.pending) {
      const expected = expectedById.get(id) as Record<string, unknown> | undefined;
      if (!expected) continue;
      const next = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
        !(key in expected && Object.is(expected[key] ?? null, value ?? null))));
      if (Object.keys(next).length === Object.keys(payload).length) continue;
      changed = true;
      if (Object.keys(next).length) this.pending.set(id, next as EstimateItemUpdatePayload);
      else this.pending.delete(id);
    }
    return changed;
  }

  prunePending = () => {
    const changed = this.prune();
    if (changed) this.update({ items: this.displayedItems() });
    return changed;
  };

  acceptItems = (
    serverItems: readonly EditorEstimateItem[], derive?: BufferedItemDerivation<EditorEstimateItem>,
    scope?: EstimateEditorDocumentScopeToken
  ) => {
    if (scope && !this.isCurrent(scope)) return this.snapshot.items;
    this.deriveItem = derive ?? this.deriveItem;
    this.projectedItems = withStableEditorClientKeys(serverItems, this.snapshot.items);
    const ids = new Set(serverItems.map((item) => item.id));
    ids.forEach((id) => { this.optimisticRows.delete(id); this.confirmedDeletedIds.delete(id); });
    this.snapshot = { ...this.snapshot, confirmedItems: serverItems.map((item) => ({ ...item })) };
    this.prune();
    this.update({ items: this.displayedItems() });
    return this.snapshot.items;
  };

  private acknowledge(entries: readonly ItemEntry[]) {
    const updatesById = new Map(entries.map(({ id, updates }) => [id, updates]));
    const apply = (items: EditorEstimateItem[]) => items.map((item) => {
      const updates = updatesById.get(item.id);
      return updates ? { ...item, ...updates } as EditorEstimateItem : item;
    });
    this.snapshot = { ...this.snapshot, confirmedItems: apply(this.snapshot.confirmedItems) };
    this.projectedItems = apply(this.projectedItems);
    entries.forEach(({ id, updates }) => {
      const preview = { ...this.previews.get(id) } as Record<string, unknown>;
      Object.entries(updates).forEach(([key, value]) => {
        if (sameValue(preview[key], value)) delete preview[key];
      });
      if (Object.keys(preview).length) this.previews.set(id, preview as Partial<EditorEstimateItem>);
      else this.previews.delete(id);
    });
    this.prune();
  }

  acknowledgeItems = (entries: readonly ItemEntry[]) => {
    this.acknowledge(entries);
    this.update({ items: this.displayedItems() });
  };

  captureSave = (): EstimateEditorDocumentSave => {
    const capture = Object.freeze({ id: ++this.nextSaveId, scope: Object.freeze(this.captureScope()),
      entries: Object.freeze(cloneEntries(Array.from(this.pending, ([id, updates]) => ({ id, updates })))
        .map(({ id, updates }) => Object.freeze({ id, updates: Object.freeze(updates) }))) });
    this.pending.clear();
    this.inFlight.set(capture.id, capture);
    this.update({ items: this.displayedItems() });
    return capture;
  };

  acceptSave = (capture: EstimateEditorDocumentSave, versionToken?: string) => {
    if (!this.isCurrent(capture.scope) || this.inFlight.get(capture.id) !== capture) return false;
    this.inFlight.delete(capture.id);
    if (!versionToken || !this.snapshot.version ||
        !isOlderEstimateVersionToken(versionToken, this.snapshot.version.updated_at)) this.acknowledge(capture.entries);
    else this.prune();
    this.update({ items: this.displayedItems() });
    return true;
  };

  rejectSave = (capture: EstimateEditorDocumentSave) => {
    if (!this.isCurrent(capture.scope) || this.inFlight.get(capture.id) !== capture) return false;
    this.inFlight.delete(capture.id);
    capture.entries.forEach(({ id, updates }) => {
      if (!this.confirmedDeletedIds.has(id)) this.pending.set(id, { ...updates, ...this.pending.get(id) });
    });
    this.prune();
    this.update({ items: this.displayedItems() });
    return true;
  };

  discardItemDraft = () => {
    this.pending.clear();
    this.inFlight.clear();
    this.itemOperations.clear();
    this.previews.clear();
    this.optimisticRows.clear();
    this.removedRows.clear();
    this.update({ items: this.displayedItems() });
  };

  acceptRead = (
    prepared: PreparedRead, derive?: BufferedItemDerivation<EditorEstimateItem>,
    scope?: EstimateEditorDocumentScopeToken
  ) => {
    const { version } = prepared.confirmed;
    if (!this.acceptsVersion(version, scope)) return false;
    this.transaction(() => {
      const settings = mergeReloadedEditorSettings(this.snapshot.settings, this.snapshot.savedSettings, prepared.draft.settings);
      this.deriveItem = derive ?? this.deriveItem;
      this.projectedItems = withStableEditorClientKeys(prepared.draft.items, this.snapshot.items);
      const ids = new Set(prepared.confirmed.items.map((item) => item.id));
      ids.forEach((id) => { this.optimisticRows.delete(id); this.confirmedDeletedIds.delete(id); });
      this.snapshot = { ...this.snapshot, version,
        confirmedItems: prepared.confirmed.items.map((item) => ({ ...item })), settings,
        savedSettings: prepared.draft.settings,
        categories: prepared.confirmed.categories, supplyTypes: prepared.confirmed.supplyTypes,
        laborRoles: prepared.confirmed.laborRoles,
        v3Settings: resyncEstimateDocumentV3Settings(this.snapshot.v3Settings,
          readEstimateDocumentV3SettingsBaseline(version)) };
      this.prune();
      this.update({ items: this.displayedItems() });
    });
    return true;
  };
}
