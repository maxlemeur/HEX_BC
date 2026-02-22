import { ApiError, badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import {
  bulkUpdateEstimateItems,
  createEstimateItem,
  deleteEstimateItem,
  reorderEstimateItems,
  updateEstimateItem,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
};

export type ExecuteEstimateBatchOptions = {
  concurrencyToken?: string;
  dryRun?: boolean;
  maxOperations?: number;
};

type RollbackAction = () => Promise<void>;
type BatchCreateOperation = Extract<BatchOperationInput, { op: "create" }>;
type BatchUpdateOperation = Extract<BatchOperationInput, { op: "update" }>;
type BatchReorderOperation = Extract<BatchOperationInput, { op: "reorder" }>;

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

function buildRollbackAction(
  versionId: string,
  operation: BatchOperationInput,
  operationResult: unknown
): RollbackAction | null {
  if (operation.op !== "create") return null;

  const createdId = resolveCreatedItemId(operationResult);
  if (!createdId) return null;

  return async () => {
    await deleteEstimateItem(versionId, {
      id: createdId,
    });
  };
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

  await bulkUpdateEstimateItems(versionId, [], concurrencyToken);

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
    };
  }

  const results: EstimateBatchOperationResult[] = [];
  const rollbackActions: RollbackAction[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (!operation) continue;

    try {
      const data = await executeOperation(versionId, operation);
      results.push({
        index,
        op: operation.op,
        status: "ok",
        data,
      });

      const rollbackAction = buildRollbackAction(versionId, operation, data);
      if (rollbackAction) {
        rollbackActions.push(rollbackAction);
      }
    } catch (error) {
      results.push(normalizeOperationError(index, operation.op, error));
      await rollbackBatchActions(rollbackActions);
      return {
        committed: false,
        results,
      };
    }
  }

  await logEstimateBatchAudit(versionId, operations);

  return {
    committed: true,
    results,
  };
}
