"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { getConfirmedTakeoffExecutionOwner, requireDetailedTakeoffProcessing } from "@/lib/ai/chatgpt-takeoff";
import { duplicateEstimateVersion } from "@/lib/estimates/version-variant-server";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { takeoffLaunchRequestRequiredError } from "@/lib/takeoff/job-creation-server";
import { createTakeoffJobFromPlanSet, findTakeoffJobForPlanSetLaunch } from "@/lib/takeoff/server";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { runSafeTakeoffAction } from "@/lib/takeoff/action-errors-server";
import { findTakeoffPreparationCopyReceipt, recordTakeoffPreparationCopy } from "@/lib/takeoff/preparation-copy-provenance-server";
import type { TakeoffJobCreateResponse } from "@/lib/takeoff/job-creation-input";
import {
  assumeTakeoffLaunchRequest, isTakeoffLaunchActive, launchTakeoffRelaunch, readAffaireTakeoffLaunchState,
} from "@/lib/takeoff/launch-request-server";
import { readAffaireTakeoffZone } from "@/lib/takeoff/affaire-takeoff-zone-server";

// Identifiers are compared as text by the replay of a launch (its copy receipt is JSON): one spelling, lower case.
const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

const launchTakeoffFromPlanSetSchema = z.object({
  projectId: uuidSchema,
  planSetId: uuidSchema,
  versionId: uuidSchema,
  level: z.enum(["B", "C"]).optional(),
  provider: z.enum(["auto", "chatgpt", "gemini"]).optional(),
  preparationRevision: z.number().int().positive().optional(),
  sourceVersionId: uuidSchema.optional(),
});

export type LaunchTakeoffFromPlanSetInput = z.input<
  typeof launchTakeoffFromPlanSetSchema
>;

const launchTakeoffFromSourceVersionPlanSetSchema = z.object({
  projectId: uuidSchema,
  planSetId: uuidSchema,
  sourceVersionId: uuidSchema,
  level: z.enum(["B", "C"]).optional(),
  provider: z.enum(["auto", "chatgpt", "gemini"]).optional(),
  preparationRevision: z.number().int().positive().optional(),
});

export type LaunchTakeoffFromSourceVersionPlanSetInput = z.input<
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
  // Once the automatic start is on (both cut-offs), an analysis of an affaire is a launch request, without a version: a
  // launch on a version would create a job that the « one admitted request per affaire » rule does not count. It is
  // refused (the database refuses its job too), a replay of a launch made before still answers with its job. Off,
  // nothing changes.
  if (await isTakeoffLaunchActive()) {
    const existing = await findTakeoffJobForPlanSetLaunch({ ...parsed, estimateVersionId: parsed.versionId });
    if (existing) return dispatchCreatedTakeoffJob(existing, parsed.projectId);
    throw takeoffLaunchRequestRequiredError();
  }
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
  if (job.status && job.status !== "pending") {
    return { jobId: job.id, versionId: job.estimate_version_id, dispatch: undefined, existingStatus: job.status };
  }
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
    existingStatus: undefined,
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
  // Before the preparation is read and a draft is copied.
  if (await isTakeoffLaunchActive()) throw takeoffLaunchRequestRequiredError();
  const processing = requireDetailedTakeoffProcessing(parsed);
  // Reject an incomplete preparation before creating a new business version.
  const context = await getAuthenticatedContext();
  const snapshot = await assertConfirmedTakeoffPreparation({
    context, projectId: parsed.projectId, estimateVersionId: parsed.sourceVersionId,
    preparationRevision: parsed.preparationRevision ?? null, planSetId: parsed.planSetId,
    ...processing,
  });
  // Check the local provider before creating a new business version.
  await getConfirmedTakeoffExecutionOwner(context.supabase, context, snapshot);
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
    ...processing, preparationRevision: parsed.preparationRevision, sourceVersionId: parsed.sourceVersionId,
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

// The automatic start of the takeoff (launch requests). The affaire's page and its dialogues call these; reading the
// state never spends anything, only these gestures do.

const takeoffLaunchStateSchema = z.object({ projectId: uuidSchema });
/** The request, the revision of its mandate and the action its options showed: a gesture is refused when either moved. */
const assumeTakeoffLaunchSchema = z.object({ projectId: uuidSchema, requestId: uuidSchema, seenRevision: z.number().int().nonnegative(),
  action: z.enum(["take_on", "resume"]) });
const relaunchTakeoffSchema = z.object({
  projectId: uuidSchema,
  planSetId: uuidSchema,
  preparationRevision: z.number().int().positive(),
  /** One key per click, kept by the dialogue across a double click, a timeout and a reload of the answer. */
  intentKey: uuidSchema,
  /** The analysis it replaces: a relaunch always names it; null for the affaire's first analysis. */
  predecessorJobId: uuidSchema.nullable(),
});

export async function readTakeoffLaunchStateAction(input: z.input<typeof takeoffLaunchStateSchema>) {
  return runSafeTakeoffAction(async () => {
    const { projectId } = takeoffLaunchStateSchema.parse(input);
    return readAffaireTakeoffLaunchState(await getAuthenticatedContext(), projectId);
  }, "Impossible de lire le métré de l'affaire. Rechargez la page.");
}

/** The takeoff's zone on the affaire's page, read again while it is shown: reading never spends nor writes. */
export async function readAffaireTakeoffZoneAction(input: z.input<typeof takeoffLaunchStateSchema>) {
  return runSafeTakeoffAction(async () => {
    const { projectId } = takeoffLaunchStateSchema.parse(input);
    return readAffaireTakeoffZone(await getAuthenticatedContext(), projectId);
  }, "Impossible de lire le métré de l'affaire. Rechargez la page.");
}

/** « Reprendre avec mon forfait » / « Prendre en charge avec mon forfait », on the Mac where the member is connected. */
export async function assumeTakeoffLaunchRequestAction(input: z.input<typeof assumeTakeoffLaunchSchema>) {
  return runSafeTakeoffAction(async () => {
    const parsed = assumeTakeoffLaunchSchema.parse(input);
    const result = await assumeTakeoffLaunchRequest({ context: await getAuthenticatedContext(), ...parsed,
      host: (await headers()).get("host") });
    revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
    return result;
  }, "Impossible de prendre en charge le métré. Rechargez l'affaire avant de réessayer.");
}

/** A relaunch from the takeoff's options: a new request and a new job, on the subscription of the member who clicks. */
export async function relaunchTakeoffAction(input: z.input<typeof relaunchTakeoffSchema>) {
  return runSafeTakeoffAction(async () => {
    const parsed = relaunchTakeoffSchema.parse(input);
    const result = await launchTakeoffRelaunch({ context: await getAuthenticatedContext(), ...parsed, host: (await headers()).get("host") });
    revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
    revalidatePath(`/dashboard/affaires/${parsed.projectId}/takeoff`);
    return result;
  }, "Impossible de relancer le métré. Consultez l'activité du métré avant de réessayer.");
}
