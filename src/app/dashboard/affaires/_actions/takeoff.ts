"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { duplicateEstimateVersion } from "@/lib/estimates/server";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { createTakeoffJobFromPlanSet, findTakeoffJobForPlanSetLaunch } from "@/lib/takeoff/server";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { runSafeTakeoffAction } from "@/lib/takeoff/action-errors-server";
import { findTakeoffPreparationCopyReceipt, recordTakeoffPreparationCopy } from "@/lib/takeoff/preparation-copy-provenance-server";
import type { TakeoffJobCreateResponse } from "@/lib/takeoff/job-creation-input";

const launchTakeoffFromPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  versionId: z.string().uuid(),
  level: z.enum(["B", "C"]).default("B"),
  provider: z.enum(["auto", "chatgpt", "gemini"]).optional(),
  preparationRevision: z.number().int().positive().optional(),
  sourceVersionId: z.string().uuid().optional(),
});

export type LaunchTakeoffFromPlanSetInput = z.infer<
  typeof launchTakeoffFromPlanSetSchema
>;

const launchTakeoffFromSourceVersionPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  level: z.enum(["B", "C"]).default("B"),
  provider: z.enum(["auto", "chatgpt", "gemini"]).optional(),
  preparationRevision: z.number().int().positive().optional(),
});

export type LaunchTakeoffFromSourceVersionPlanSetInput = z.infer<
  typeof launchTakeoffFromSourceVersionPlanSetSchema
>;

export type TakeoffLaunchDispatch = {
  status: "accepted" | "queued_for_recovery" | "persistence_unconfirmed";
  correlationId: string;
  persisted: boolean;
};

export async function launchTakeoffFromPlanSet(
  input: LaunchTakeoffFromPlanSetInput,
) {
  const parsed = launchTakeoffFromPlanSetSchema.parse(input);
  const job = await createTakeoffJobFromPlanSet({
    projectId: parsed.projectId,
    planSetId: parsed.planSetId,
    estimateVersionId: parsed.versionId,
    level: parsed.level,
    preparationRevision: parsed.preparationRevision,
    sourceVersionId: parsed.sourceVersionId,
    ...(parsed.provider ? { provider: parsed.provider } : {}),
  });

  return dispatchCreatedTakeoffJob(job, parsed.projectId);
}

async function dispatchCreatedTakeoffJob(job: TakeoffJobCreateResponse, projectId: string) {
  const triggerResult = await triggerTakeoffJobProcessing({
    jobId: job.id,
    trigger: "create",
  });
  const dispatchPersisted = await persistTakeoffDispatchOutcome({
    jobId: job.id,
    trigger: "create",
    result: triggerResult,
  });

  revalidatePath(`/dashboard/affaires/${projectId}`);
  revalidatePath(`/dashboard/affaires/${projectId}/takeoff`);

  return {
    jobId: job.id,
    versionId: job.estimate_version_id,
    dispatch: {
      status: triggerResult.triggered
        ? "accepted"
        : dispatchPersisted
          ? "queued_for_recovery"
          : "persistence_unconfirmed",
      correlationId: triggerResult.correlationId,
      persisted: dispatchPersisted,
    } satisfies TakeoffLaunchDispatch,
  };
}

export async function launchTakeoffFromSourceVersionPlanSet(
  input: LaunchTakeoffFromSourceVersionPlanSetInput,
) {
  const parsed = launchTakeoffFromSourceVersionPlanSetSchema.parse(input);
  const existing = await findTakeoffJobForPlanSetLaunch({
    ...parsed, estimateVersionId: parsed.sourceVersionId,
  });
  if (existing) return dispatchCreatedTakeoffJob(existing, parsed.projectId);
  // Reject an incomplete preparation before creating a new business version.
  const context = await getAuthenticatedContext();
  await assertConfirmedTakeoffPreparation({
    context, projectId: parsed.projectId, estimateVersionId: parsed.sourceVersionId,
    preparationRevision: parsed.preparationRevision ?? null, planSetId: parsed.planSetId,
    level: parsed.level, provider: parsed.provider ?? "auto",
  });
  const copyScope = {
    context, projectId: parsed.projectId, sourceVersionId: parsed.sourceVersionId, preparationRevision: parsed.preparationRevision!,
  };
  const resumableCopy = await findTakeoffPreparationCopyReceipt(copyScope);
  let targetVersionId: string;
  if (resumableCopy) {
    targetVersionId = resumableCopy.targetVersionId;
  } else {
    targetVersionId = (await duplicateEstimateVersion(parsed.sourceVersionId)).version_id;
    await recordTakeoffPreparationCopy({ ...copyScope, targetVersionId });
  }
  const job = await createTakeoffJobFromPlanSet({
    projectId: parsed.projectId, planSetId: parsed.planSetId, estimateVersionId: targetVersionId,
    level: parsed.level, preparationRevision: parsed.preparationRevision, sourceVersionId: parsed.sourceVersionId,
    ...(parsed.provider ? { provider: parsed.provider } : {}),
  });
  const launchResult = await dispatchCreatedTakeoffJob(job, parsed.projectId);
  return { ...launchResult, versionId: launchResult.versionId ?? targetVersionId };
}

export async function launchPreparedTakeoffFromPlanSetAction(input: LaunchTakeoffFromPlanSetInput) {
  return runSafeTakeoffAction(() => launchTakeoffFromPlanSet(input),
    "Impossible de confirmer le lancement. Consultez l'activité du métré avant de réessayer.");
}

export async function launchPreparedTakeoffFromSourceVersionPlanSetAction(input: LaunchTakeoffFromSourceVersionPlanSetInput) {
  return runSafeTakeoffAction(() => launchTakeoffFromSourceVersionPlanSet(input),
    "Impossible de confirmer le lancement. Consultez l'activité du métré avant de réessayer.");
}
