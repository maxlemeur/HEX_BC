import { processAffaireIntakeUpload } from "@/lib/affaires/intake-server";
import {
  drainProcurementStorageCleanupOutbox,
  type ProcurementStorageCleanupDrainResult,
} from "@/lib/procurement/storage-cleanup-outbox";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import type { DurableWorkflowRpcClient } from "@/lib/workflows/affaire-intake-lifecycle";

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
  failures: Array<{ workId: string; message: string }>;
  procurementStorageCleanup: ProcurementStorageCleanupDrainResult;
};

type DurableRecoveryDependencies = {
  client?: DurableWorkflowRpcClient;
  now?: () => Date;
  limit?: number;
  maxIntakePerRun?: number;
  triggerTakeoff?: typeof triggerTakeoffJobProcessing;
  persistTakeoffDispatch?: typeof persistTakeoffDispatchOutcome;
  processIntake?: typeof processAffaireIntakeUpload;
  drainStorageCleanup?: typeof drainProcurementStorageCleanupOutbox;
  storageCleanupLimit?: number;
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
  let intakeCount = 0;

  for (const workflow of due) {
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
        message: error instanceof Error ? error.message : "Erreur de reprise inconnue.",
      });
    }
  }

  return {
    recoveredUnknownTakeoffJobs: countRows(recoveredData),
    dueCount: due.length,
    dispatchedCount,
    failedCount: failures.length,
    skippedCount,
    failures,
    procurementStorageCleanup,
  };
}
