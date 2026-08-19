import { processAffaireIntakeUpload } from "@/lib/affaires/intake-server";
import {
  drainEstimateEmailOutbox,
  type EmailOutboxDrainResult,
} from "@/lib/email/estimate-email-outbox";
import {
  drainProcurementStorageCleanupOutbox,
  type ProcurementStorageCleanupDrainResult,
} from "@/lib/procurement/storage-cleanup-outbox";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import type { DurableWorkflowRpcClient } from "@/lib/workflows/affaire-intake-lifecycle";

export const MAX_DURABLE_RECOVERY_ATTEMPTS = 5;

const DURABLE_RECOVERY_DEAD_ERROR_CODE = "DURABLE_RECOVERY_DEAD";
const DURABLE_RECOVERY_DEAD_MESSAGE =
  "La reprise durable a epuise son budget de tentatives.";

type DueWorkflow = {
  workflowKind: "takeoff" | "affaire_intake";
  workId: string;
  triggerKind: "create" | "retry" | "reconcile" | "process";
};

export type DurableRecoveryResult = {
  recoveredUnknownTakeoffJobs: number;
  dueCount: number;
  dispatchedCount: number;
  failedCount: number;
  skippedCount: number;
  deadCount: number;
  failures: Array<{ workId: string; message: string }>;
  procurementStorageCleanup: ProcurementStorageCleanupDrainResult;
  emailOutbox: EmailOutboxDrainResult;
};

type DurableRecoveryTableClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown
      ) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
    update: (payload: Record<string, unknown>) => {
      eq: (
        column: string,
        value: unknown
      ) => PromiseLike<{ error: unknown }>;
    };
  };
};

type DurableRecoveryDependencies = {
  client?: DurableWorkflowRpcClient;
  tableClient?: DurableRecoveryTableClient | null;
  now?: () => Date;
  limit?: number;
  maxIntakePerRun?: number;
  triggerTakeoff?: typeof triggerTakeoffJobProcessing;
  persistTakeoffDispatch?: typeof persistTakeoffDispatchOutcome;
  processIntake?: typeof processAffaireIntakeUpload;
  drainStorageCleanup?: typeof drainProcurementStorageCleanupOutbox;
  storageCleanupLimit?: number;
  getRetryCount?: (workId: string) => Promise<number>;
  incrementRetryCount?: (workId: string) => Promise<number>;
  markDead?: (workId: string) => Promise<void>;
  drainEmailOutbox?: typeof drainEstimateEmailOutbox;
};

function normalizeDueWorkflow(value: unknown): DueWorkflow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (
    (row.workflow_kind !== "takeoff" && row.workflow_kind !== "affaire_intake") ||
    typeof row.work_id !== "string" ||
    (row.trigger_kind !== "create" &&
      row.trigger_kind !== "retry" &&
      row.trigger_kind !== "reconcile" &&
      row.trigger_kind !== "process")
  ) {
    return null;
  }

  return {
    workflowKind: row.workflow_kind,
    workId: row.work_id,
    triggerKind: row.trigger_kind,
  };
}

function countRows(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function asTableClient(value: unknown): DurableRecoveryTableClient | null {
  if (!value || typeof value !== "object" || !("from" in value)) {
    return null;
  }
  if (typeof (value as { from: unknown }).from !== "function") {
    return null;
  }
  return value as DurableRecoveryTableClient;
}

function retryTable(workflow: DueWorkflow) {
  return workflow.workflowKind === "takeoff"
    ? "takeoff_jobs"
    : "affaire_intake_uploads";
}

function retryColumn(workflow: DueWorkflow) {
  return workflow.workflowKind === "takeoff" ? "retry_count" : "attempt_count";
}

function readNonNegativeInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function readCount(data: unknown, column: string) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return 0;
  }
  return readNonNegativeInt((data as Record<string, unknown>)[column]);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function defaultGetRetryCount(
  tableClient: DurableRecoveryTableClient | null,
  workflow: DueWorkflow
) {
  if (!tableClient) {
    return 0;
  }
  const column = retryColumn(workflow);
  const { data, error } = await tableClient
    .from(retryTable(workflow))
    .select(column)
    .eq("id", workflow.workId)
    .maybeSingle();
  if (error) {
    throw new Error("Impossible de lire le compteur de reprise durable.", {
      cause: error,
    });
  }
  return readCount(data, column);
}

async function defaultIncrementRetryCount(
  tableClient: DurableRecoveryTableClient | null,
  workflow: DueWorkflow
) {
  const next = (await defaultGetRetryCount(tableClient, workflow)) + 1;
  if (!tableClient) {
    return next;
  }
  const { error } = await tableClient
    .from(retryTable(workflow))
    .update({ [retryColumn(workflow)]: next })
    .eq("id", workflow.workId);
  if (error) {
    throw new Error("Impossible d'enregistrer l'echec de reprise durable.", {
      cause: error,
    });
  }
  return next;
}

async function defaultMarkDead(
  tableClient: DurableRecoveryTableClient | null,
  workflow: DueWorkflow,
  now: Date
) {
  if (!tableClient) {
    return;
  }
  const nowIso = now.toISOString();
  const payload =
    workflow.workflowKind === "takeoff"
      ? {
          status: "failed",
          next_retry_at: null,
          completed_at: nowIso,
          last_error_at: nowIso,
          error_code: DURABLE_RECOVERY_DEAD_ERROR_CODE,
          error_message: DURABLE_RECOVERY_DEAD_MESSAGE,
        }
      : {
          status: "failed",
          next_retry_at: null,
          completed_at: nowIso,
          last_error: DURABLE_RECOVERY_DEAD_MESSAGE,
          processing_lease_token: null,
          processing_lease_expires_at: null,
        };
  const { error } = await tableClient
    .from(retryTable(workflow))
    .update(payload)
    .eq("id", workflow.workId);
  if (error) {
    throw new Error("Impossible de marquer le workflow durable comme mort.", {
      cause: error,
    });
  }
}

export async function recoverDurableWorkflows(
  dependencies: DurableRecoveryDependencies = {}
): Promise<DurableRecoveryResult> {
  const serviceRoleClient = dependencies.client
    ? null
    : createServiceRoleClient();
  const client =
    dependencies.client ??
    (serviceRoleClient as unknown as DurableWorkflowRpcClient);
  const now = dependencies.now ?? (() => new Date());
  const triggerTakeoff =
    dependencies.triggerTakeoff ?? triggerTakeoffJobProcessing;
  const persistTakeoffDispatch =
    dependencies.persistTakeoffDispatch ?? persistTakeoffDispatchOutcome;
  const processIntake = dependencies.processIntake ?? processAffaireIntakeUpload;
  const drainStorageCleanup =
    dependencies.drainStorageCleanup ?? drainProcurementStorageCleanupOutbox;
  const maxIntakePerRun = Math.max(0, dependencies.maxIntakePerRun ?? 2);
  const tableClient =
    dependencies.tableClient !== undefined
      ? dependencies.tableClient
      : (asTableClient(serviceRoleClient) ?? asTableClient(client));

  async function readRetryCount(workflow: DueWorkflow) {
    if (dependencies.getRetryCount) {
      return dependencies.getRetryCount(workflow.workId);
    }
    return defaultGetRetryCount(tableClient, workflow);
  }

  async function recordRetryFailure(workflow: DueWorkflow) {
    if (dependencies.incrementRetryCount) {
      return dependencies.incrementRetryCount(workflow.workId);
    }
    return defaultIncrementRetryCount(tableClient, workflow);
  }

  async function persistDead(workflow: DueWorkflow) {
    if (dependencies.markDead) {
      await dependencies.markDead(workflow.workId);
      return;
    }
    await defaultMarkDead(tableClient, workflow, now());
  }

  let procurementStorageCleanup: ProcurementStorageCleanupDrainResult;
  try {
    procurementStorageCleanup = await drainStorageCleanup({
      client: serviceRoleClient ?? undefined,
      limit: Math.max(
        1,
        Math.min(dependencies.storageCleanupLimit ?? 25, 100)
      ),
    });
  } catch (error) {
    procurementStorageCleanup = {
      claimed: 0,
      removed: 0,
      failed: 0,
      skipped: false,
      errors: [
        error instanceof Error
          ? error.message
          : "Erreur de reprise Storage inconnue.",
      ],
    };
  }

  const drainEmailOutbox =
    dependencies.drainEmailOutbox ?? drainEstimateEmailOutbox;
  let emailOutbox: EmailOutboxDrainResult;
  try {
    emailOutbox = await drainEmailOutbox();
  } catch (error) {
    emailOutbox = {
      claimed: 0,
      sent: 0,
      failed: 0,
      dead: 0,
      skipped: true,
      errors: [
        error instanceof Error
          ? error.message
          : "Erreur de reprise outbox email inconnue.",
      ],
    };
  }

  const { data: recoveredData, error: recoveryError } = await client.rpc(
    "recover_stale_takeoff_jobs",
    {
      p_now: now().toISOString(),
      p_stale_after: "10 minutes",
    }
  );
  if (recoveryError) {
    throw new Error("Impossible de recuperer les jobs takeoff expires.", {
      cause: recoveryError,
    });
  }

  const { data: dueData, error: dueError } = await client.rpc(
    "list_due_durable_workflows",
    {
      p_now: now().toISOString(),
      p_limit: Math.max(1, Math.min(dependencies.limit ?? 20, 100)),
    }
  );
  if (dueError) {
    throw new Error("Impossible de lister les workflows arrives a echeance.", {
      cause: dueError,
    });
  }

  const due = Array.isArray(dueData)
    ? dueData
        .map(normalizeDueWorkflow)
        .filter((row): row is DueWorkflow => row !== null)
    : [];
  const failures: DurableRecoveryResult["failures"] = [];
  let dispatchedCount = 0;
  let skippedCount = 0;
  let deadCount = 0;
  let intakeCount = 0;

  for (const workflow of due) {
    let retryCount = 0;
    try {
      retryCount = await readRetryCount(workflow);
    } catch (error) {
      failures.push({
        workId: workflow.workId,
        message: errorMessage(
          error,
          "Impossible de lire le compteur de reprise durable."
        ),
      });
      continue;
    }

    if (retryCount >= MAX_DURABLE_RECOVERY_ATTEMPTS) {
      try {
        await persistDead(workflow);
      } catch {
        // Still withhold dispatch so a poisoned item cannot loop forever.
      }
      deadCount += 1;
      continue;
    }

    try {
      if (workflow.workflowKind === "takeoff") {
        if (workflow.triggerKind === "process") {
          throw new Error("Trigger takeoff durable invalide.");
        }
        const result = await triggerTakeoff({
          jobId: workflow.workId,
          trigger: workflow.triggerKind,
        });
        await persistTakeoffDispatch({
          jobId: workflow.workId,
          trigger: workflow.triggerKind,
          result,
        });
        if (!result.triggered) {
          throw new Error(
            `Le relay takeoff a refuse le dispatch (${result.statusCode ?? "sans statut"}).`
          );
        }
        dispatchedCount += 1;
        continue;
      }

      if (intakeCount >= maxIntakePerRun) {
        skippedCount += 1;
        continue;
      }
      intakeCount += 1;
      await processIntake(workflow.workId);
      dispatchedCount += 1;
    } catch (error) {
      failures.push({
        workId: workflow.workId,
        message: errorMessage(error, "Erreur de reprise inconnue."),
      });
      try {
        const nextCount = await recordRetryFailure(workflow);
        if (nextCount >= MAX_DURABLE_RECOVERY_ATTEMPTS) {
          await persistDead(workflow);
          deadCount += 1;
        }
      } catch {
        // The dispatch failure is already recorded; a store error must not throw.
      }
    }
  }

  return {
    recoveredUnknownTakeoffJobs: countRows(recoveredData),
    dueCount: due.length,
    dispatchedCount,
    failedCount: failures.length,
    skippedCount,
    deadCount,
    failures,
    procurementStorageCleanup,
    emailOutbox,
  };
}
