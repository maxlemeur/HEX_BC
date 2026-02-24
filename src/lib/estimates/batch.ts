import { ApiError, badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import type {
  BatchOperationInput,
  ReorderEstimateItemsInput,
} from "@/lib/estimates/schemas";
import {
  bulkUpdateEstimateItems,
  createEstimateItem,
  deleteEstimateItem,
  listEstimateItems,
  reorderEstimateItems,
  updateEstimateItem,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const DEFAULT_MAX_BATCH_OPERATIONS = 100;
const MAX_BATCH_OPERATIONS_ENV_KEY = "ESTIMATE_BATCH_MAX_OPERATIONS";

export type EstimateBatchOperationResult =
  | {
      index: number;
      op: BatchOperationInput["op"];
      status: "ok";
      data: unknown;
    }
  | {
      index: number;
      op: BatchOperationInput["op"];
      status: "error";
      code: string;
      message: string;
      details?: unknown;
    };

export type ExecuteEstimateBatchResult = {
  results: EstimateBatchOperationResult[];
  committed: boolean;
  version: {
    id: string;
    updated_at: string;
  };
};

export type ExecuteEstimateBatchOptions = {
  concurrencyToken?: string;
  dryRun?: boolean;
  maxOperations?: number;
};

type EstimateBatchVersionToken = ExecuteEstimateBatchResult["version"];

type RollbackAction = () => Promise<void>;
type BatchCreateOperation = Extract<BatchOperationInput, { op: "create" }>;
type BatchUpdateOperation = Extract<BatchOperationInput, { op: "update" }>;
type BatchReorderOperation = Extract<BatchOperationInput, { op: "reorder" }>;
type EstimateItemSnapshot = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateItemInsertPayload = Database["public"]["Tables"]["estimate_items"]["Insert"];

type BatchAuditOperationPayload =
  | {
      op: "create";
      data: BatchCreateOperation["data"];
    }
  | {
      op: "update";
      id: string;
      data: BatchUpdateOperation["data"];
    }
  | {
      op: "delete";
      id: string;
    }
  | {
      op: "reorder";
      data: BatchReorderOperation["data"];
    };

function normalizeConcurrencyToken(token: string | undefined) {
  const normalized = token?.trim();
  if (!normalized || normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

export function resolveEstimateBatchMaxOperations(override?: number) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
    return Math.floor(override);
  }

  const parsed = Number.parseInt(
    process.env[MAX_BATCH_OPERATIONS_ENV_KEY] ?? "",
    10
  );
  if (Number.isFinite(parsed) && parsed >= 1) {
    return parsed;
  }

  return DEFAULT_MAX_BATCH_OPERATIONS;
}

function normalizeOperationError(
  index: number,
  op: BatchOperationInput["op"],
  error: unknown
): EstimateBatchOperationResult {
  if (error instanceof ApiError) {
    return {
      index,
      op,
      status: "error",
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      index,
      op,
      status: "error",
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    index,
    op,
    status: "error",
    code: "INTERNAL_ERROR",
    message: "Erreur inconnue.",
  };
}

function resolveCreatedItemId(result: unknown) {
  if (!result || typeof result !== "object") return undefined;
  const item = (result as { item?: unknown }).item;
  if (!item || typeof item !== "object") return undefined;
  const id = (item as { id?: unknown }).id;
  if (typeof id !== "string" || id.trim().length === 0) return undefined;
  return id;
}

function toEstimateItemInsertPayload(
  item: EstimateItemSnapshot
): EstimateItemInsertPayload {
  return {
    id: item.id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    tenant_id: item.tenant_id,
    version_id: item.version_id,
    parent_id: item.parent_id,
    item_type: item.item_type,
    position: item.position,
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unit_price_ht_cents: item.unit_price_ht_cents,
    tax_rate_bp: item.tax_rate_bp,
    k_fo: item.k_fo,
    h_mo: item.h_mo,
    h_mo_majoration: item.h_mo_majoration,
    k_mo: item.k_mo,
    h_mo_atelier: item.h_mo_atelier,
    k_mo_atelier: item.k_mo_atelier,
    labor_role_atelier_id: item.labor_role_atelier_id,
    h_mo_chantier: item.h_mo_chantier,
    k_mo_chantier: item.k_mo_chantier,
    labor_role_chantier_id: item.labor_role_chantier_id,
    pu_ht_cents: item.pu_ht_cents,
    labor_role_id: item.labor_role_id,
    category_id: item.category_id,
    supply_type_id: item.supply_type_id,
    selected_supplier_price_id: item.selected_supplier_price_id,
    line_total_ht_cents: item.line_total_ht_cents,
    line_tax_cents: item.line_tax_cents,
    line_total_ttc_cents: item.line_total_ttc_cents,
  };
}

function listSiblingIds(items: EstimateItemSnapshot[], parentId: string | null) {
  return items
    .filter((item) => (item.parent_id ?? null) === parentId)
    .sort((left, right) => left.position - right.position)
    .map((item) => item.id);
}

function collectDeletedItemsForRollback(
  items: EstimateItemSnapshot[],
  deletedId: string
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const childrenByParent = new Map<string, EstimateItemSnapshot[]>();

  items.forEach((item) => {
    const parentId = item.parent_id;
    if (!parentId) return;

    const children = childrenByParent.get(parentId);
    if (children) {
      children.push(item);
      return;
    }
    childrenByParent.set(parentId, [item]);
  });

  const deletedRoot = itemById.get(deletedId);
  if (!deletedRoot) {
    return [];
  }

  const deletedItems: EstimateItemSnapshot[] = [];
  const stack: EstimateItemSnapshot[] = [deletedRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    deletedItems.push(current);

    const children = childrenByParent
      .get(current.id)
      ?.slice()
      .sort((left, right) => left.position - right.position) ?? [];

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child) continue;
      stack.push(child);
    }
  }

  return deletedItems;
}

async function restoreDeletedItems(items: EstimateItemSnapshot[]) {
  if (items.length === 0) return;

  const supabase = await createSupabaseServerClient();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;

    const { error } = await supabase
      .from("estimate_items")
      .upsert(toEstimateItemInsertPayload(item), {
        onConflict: "id",
      });

    if (!error) continue;
    throw mapSupabaseError(
      error,
      "Impossible de restaurer les lignes supprimees pendant le rollback."
    );
  }
}

async function loadPreOperationSnapshot(
  versionId: string,
  operation: BatchOperationInput
) {
  if (operation.op === "create") {
    return null;
  }

  const { items } = await listEstimateItems(versionId);
  return items as EstimateItemSnapshot[];
}

function buildRollbackAction(
  versionId: string,
  operation: BatchOperationInput,
  operationResult: unknown,
  itemsBeforeOperation: EstimateItemSnapshot[] | null
): RollbackAction | null {
  switch (operation.op) {
    case "create": {
      const createdId = resolveCreatedItemId(operationResult);
      if (!createdId) return null;

      return async () => {
        await deleteEstimateItem(versionId, {
          id: createdId,
        });
      };
    }
    case "update": {
      const previousItem = itemsBeforeOperation?.find(
        (item) => item.id === operation.id
      );
      if (!previousItem) return null;

      return async () => {
        await restoreDeletedItems([previousItem]);
      };
    }
    case "delete": {
      if (!itemsBeforeOperation) return null;

      const deletedItems = collectDeletedItemsForRollback(
        itemsBeforeOperation,
        operation.id
      );
      if (deletedItems.length === 0) return null;

      return async () => {
        await restoreDeletedItems(deletedItems);
      };
    }
    case "reorder": {
      if (!itemsBeforeOperation) return null;

      const parentId = operation.data.parent_id ?? null;
      const previousOrderedIds = listSiblingIds(itemsBeforeOperation, parentId);

      if (previousOrderedIds.length === 0) return null;

      const rollbackInput: ReorderEstimateItemsInput = {
        parent_id: parentId,
        ordered_ids: previousOrderedIds,
      };

      return async () => {
        await reorderEstimateItems(versionId, rollbackInput);
      };
    }
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

async function rollbackBatchActions(actions: RollbackAction[]) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    try {
      const action = actions[index];
      if (!action) continue;
      await action();
    } catch (error) {
      console.error("Estimate batch rollback failed", error);
    }
  }
}

async function executeOperation(versionId: string, operation: BatchOperationInput) {
  switch (operation.op) {
    case "create":
      return createEstimateItem(versionId, operation.data);
    case "update":
      return updateEstimateItem(versionId, {
        id: operation.id,
        ...operation.data,
      });
    case "delete":
      return deleteEstimateItem(versionId, {
        id: operation.id,
      });
    case "reorder":
      return reorderEstimateItems(versionId, operation.data);
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

function toBatchAuditOperationPayload(
  operation: BatchOperationInput
): BatchAuditOperationPayload {
  switch (operation.op) {
    case "create":
      return {
        op: "create",
        data: operation.data,
      };
    case "update":
      return {
        op: "update",
        id: operation.id,
        data: operation.data,
      };
    case "delete":
      return {
        op: "delete",
        id: operation.id,
      };
    case "reorder":
      return {
        op: "reorder",
        data: operation.data,
      };
    default: {
      const exhaustiveCheck: never = operation;
      return exhaustiveCheck;
    }
  }
}

async function logEstimateBatchAudit(
  versionId: string,
  operations: BatchOperationInput[]
) {
  const supabase = await createSupabaseServerClient();
  const operationsPayload = operations.map((operation) =>
    toBatchAuditOperationPayload(operation)
  );

  const { error } = await supabase.rpc("log_estimate_batch_audit", {
    target_version_id: versionId,
    operations_payload: operationsPayload,
  });

  if (!error) return;
  throw mapSupabaseError(error, "Impossible d'ecrire l'audit du batch.");
}

async function resolveLatestBatchVersionToken(
  versionId: string,
  fallback: EstimateBatchVersionToken
): Promise<EstimateBatchVersionToken> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("estimate_versions")
      .select("id, updated_at")
      .eq("id", versionId)
      .single();

    if (error || !data) {
      return fallback;
    }

    return {
      id: data.id,
      updated_at: data.updated_at,
    };
  } catch {
    return fallback;
  }
}

export async function executeEstimateBatch(
  versionId: string,
  operations: BatchOperationInput[],
  options: ExecuteEstimateBatchOptions
): Promise<ExecuteEstimateBatchResult> {
  if (operations.length === 0) {
    throw badRequest("operations ne peut pas etre vide.");
  }

  const maxOperations = resolveEstimateBatchMaxOperations(options.maxOperations);
  if (operations.length > maxOperations) {
    throw badRequest(
      `operations ne peut pas contenir plus de ${maxOperations} operations.`,
      {
        max_operations: maxOperations,
        received_operations: operations.length,
      },
      "BATCH_LIMIT_EXCEEDED"
    );
  }

  const concurrencyToken = normalizeConcurrencyToken(options.concurrencyToken);
  if (!concurrencyToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }

  const tokenPrecheckResult = await bulkUpdateEstimateItems(
    versionId,
    [],
    concurrencyToken
  );
  const versionToken: EstimateBatchVersionToken = {
    id: tokenPrecheckResult.version.id,
    updated_at: tokenPrecheckResult.version.updated_at,
  };

  if (options.dryRun === true) {
    return {
      committed: false,
      results: operations.map((operation, index) => ({
        index,
        op: operation.op,
        status: "ok",
        data: {
          dry_run: true,
        },
      })),
      version: versionToken,
    };
  }

  const results: EstimateBatchOperationResult[] = [];
  const rollbackActions: RollbackAction[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!operation) continue;

    try {
      const itemsBeforeOperation = await loadPreOperationSnapshot(
        versionId,
        operation
      );
      const data = await executeOperation(versionId, operation);
      results.push({
        index,
        op: operation.op,
        status: "ok",
        data,
      });

      const rollbackAction = buildRollbackAction(
        versionId,
        operation,
        data,
        itemsBeforeOperation
      );
      if (rollbackAction) {
        rollbackActions.push(rollbackAction);
      }
    } catch (error) {
      results.push(normalizeOperationError(index, operation.op, error));
      await rollbackBatchActions(rollbackActions);
      return {
        committed: false,
        results,
        version: await resolveLatestBatchVersionToken(versionId, versionToken),
      };
    }
  }

  try {
    await logEstimateBatchAudit(versionId, operations);
  } catch (error) {
    console.error("Estimate batch audit failed", error);
  }

  return {
    committed: true,
    results,
    version: await resolveLatestBatchVersionToken(versionId, versionToken),
  };
}
