import { recoverIntakeAnalysisLaunch } from "@/lib/workflows/intake-launch-recovery";
import { processAffaireIntakeUpload } from "@/lib/affaires/intake-analysis-server";
import {
  drainEstimateEmailOutbox,
  type EmailOutboxDrainResult,
} from "@/lib/email/estimate-email-outbox";
import {
  drainProcurementStorageCleanupOutbox,
  type ProcurementStorageCleanupDrainResult,
} from "@/lib/procurement/storage-cleanup-outbox";
import { drainTakeoffCompletionEmails } from "@/lib/takeoff/completion-email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { DurableWorkflowRpcClient } from "@/lib/workflows/affaire-intake-lifecycle";

export const MAX_DURABLE_RECOVERY_ATTEMPTS = 5;

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
  takeoffCompletionEmail: { claimed: number; failed: boolean };
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
  processLaunch?: typeof recoverIntakeAnalysisLaunch;
  processIntake?: typeof processAffaireIntakeUpload;
  drainStorageCleanup?: typeof drainProcurementStorageCleanupOutbox;
  storageCleanupLimit?: number;
  getRetryCount?: (workId: string) => Promise<number>;
  incrementRetryCount?: (workId: string) => Promise<number>;
  markDead?: (workId: string) => Promise<void>;
  drainEmailOutbox?: typeof drainEstimateEmailOutbox;
  drainCompletionEmails?: typeof drainTakeoffCompletionEmails;
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

const RETRY_TABLE = "affaire_intake_uploads";
const RETRY_COLUMN = "attempt_count";

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
  const { data, error } = await tableClient
    .from(RETRY_TABLE)
    .select(RETRY_COLUMN)
    .eq("id", workflow.workId)
    .maybeSingle();
  if (error) {
    throw new Error("Impossible de lire le compteur de reprise durable.", {
      cause: error,
    });
  }
  return readCount(data, RETRY_COLUMN);
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
    .from(RETRY_TABLE)
    .update({ [RETRY_COLUMN]: next })
    .eq("id", workflow.workId);
  if (error) {
    throw new Error("Impossible d'enregistrer l'échec de reprise durable.", {
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
  const { error } = await tableClient
    .from(RETRY_TABLE)
    .update({
      status: "failed",
      next_retry_at: null,
      completed_at: nowIso,
      last_error: DURABLE_RECOVERY_DEAD_MESSAGE,
      processing_lease_token: null,
      processing_lease_expires_at: null,
    })
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

  // Preserve capacity for order documents even when a bulk affaire deletion queues many photos.
  const storageLimit = Math.max(1, Math.min(dependencies.storageCleanupLimit ?? 25, 100));
  const [orderStorage, requestStorage] = await Promise.all(
    (["devis", "material-requests"] as const).map(async (bucketId): Promise<ProcurementStorageCleanupDrainResult> => {
      try {
        return await drainStorageCleanup({ client: serviceRoleClient ?? undefined, limit: storageLimit, bucketId });
      } catch (error) {
        return {
          claimed: 0, removed: 0, failed: 0, skipped: true,
          errors: [error instanceof Error ? error.message : "Erreur de reprise Storage inconnue."],
        };
      }
    }),
  );
  const procurementStorageCleanup: ProcurementStorageCleanupDrainResult = {
    claimed: orderStorage.claimed + requestStorage.claimed,
    removed: orderStorage.removed + requestStorage.removed,
    failed: orderStorage.failed + requestStorage.failed,
    skipped: [orderStorage, requestStorage].some((result) =>
      result.skipped || (result.failed === 0 && result.errors.length > 0)),
    errors: [...orderStorage.errors, ...requestStorage.errors],
  };

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
      blocked: 0,
      skipped: true,
      errors: [
        error instanceof Error
          ? error.message
          : "Erreur de reprise outbox email inconnue.",
      ],
    };
  }

  const { data: recoveredData, error: recoveryError } = await client.rpc(
    "recover_stale_local_takeoff_jobs",
    {
      p_now: now().toISOString(),
      p_stale_after: "10 minutes",
    }
  );
  if (recoveryError) {
    throw new Error("Impossible de récupérer les jobs takeoff expires.", {
      cause: recoveryError,
    });
  }

  const { error: apiQueueError } = await client.rpc("recover_takeoff_payment_jobs", { p_now: now().toISOString() });
  if (apiQueueError && (apiQueueError as { code?: string }).code !== "PGRST202") {
    console.error("takeoff.api_queue.recovery_failed");
  }

  // A launch request whose units have all ended but which is still open is closed, with its one notice, from what was
  // recorded, without any AI call (migration 20261121231238_takeoff_plan_dispatcher.sql). Best effort: its failure never
  // stops the recovery of the rest.
  const { error: reconcileError } = await client.rpc("reconcile_takeoff_launch_requests", { p_limit: 20 });
  if (reconcileError) console.error("takeoff.launch_request.reconcile_failed");

  const takeoffCompletionEmail = { claimed: 0, failed: false };
  try {
    const drainCompletionEmails = dependencies.drainCompletionEmails
      ?? (serviceRoleClient ? drainTakeoffCompletionEmails : null);
    takeoffCompletionEmail.claimed = (await drainCompletionEmails?.()) ?? 0;
  } catch {
    takeoffCompletionEmail.failed = true;
    console.error("takeoff.completion_email.recovery_failed");
  }

  const { data: dueData, error: dueError } = await client.rpc(
    "list_due_affaire_intake_workflows",
    {
      p_now: now().toISOString(),
      p_limit: Math.max(1, Math.min(dependencies.limit ?? 20, 100)),
    }
  );
  if (dueError) {
    throw new Error("Impossible de lister les workflows arrives a échéance.", {
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

  // Give explicit launches a turn even when legacy uploads are queued.
  let launchCount = 0;
  const processLaunch = dependencies.processLaunch ?? (serviceRoleClient ? recoverIntakeAnalysisLaunch : null);
  if (processLaunch && maxIntakePerRun > 0) {
    try {
      if (await processLaunch()) {
        launchCount++;
        intakeCount++;
        dispatchedCount++;
      }
    } catch (error) {
      launchCount++;
      failures.push({ workId: "affaire_intake_launch", message: errorMessage(error, "Reprise de l’analyse interrompue.") });
    }
  }

  for (const workflow of due) {
    // A historic or malformed response must never requeue a legacy takeoff job.
    if (workflow.workflowKind === "takeoff") {
      skippedCount += 1;
      continue;
    }
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
    takeoffCompletionEmail,
    dueCount: due.length + launchCount,
    dispatchedCount,
    failedCount: failures.length,
    skippedCount,
    deadCount,
    failures,
    procurementStorageCleanup,
    emailOutbox,
  };
}
