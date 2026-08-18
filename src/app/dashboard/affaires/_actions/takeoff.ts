"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { duplicateEstimateVersion } from "@/lib/estimates/server";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { createTakeoffJobFromPlanSet } from "@/lib/takeoff/server";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";

const launchTakeoffFromPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  versionId: z.string().uuid(),
  level: z.enum(["B", "C"]).default("B"),
});

export type LaunchTakeoffFromPlanSetInput = z.infer<
  typeof launchTakeoffFromPlanSetSchema
>;

const launchTakeoffFromSourceVersionPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  level: z.enum(["B", "C"]).default("B"),
});

export type LaunchTakeoffFromSourceVersionPlanSetInput = z.infer<
  typeof launchTakeoffFromSourceVersionPlanSetSchema
>;

export type TakeoffLaunchDispatch = {
  status: "accepted" | "queued_for_recovery" | "persistence_unconfirmed";
  correlationId: string;
  persisted: boolean;
};

async function rollbackDuplicatedEstimateVersion(input: {
  duplicatedVersionId: string;
  sourceVersionId: string;
}) {
  const { supabase, tenantId } = await getAuthenticatedContext();
  const { error } = await supabase
    .from("estimate_versions")
    .delete()
    .eq("id", input.duplicatedVersionId)
    .eq("tenant_id", tenantId)
    .eq("status", "draft")
    .eq("parent_version_id", input.sourceVersionId);

  if (error) {
    console.error("Failed to rollback duplicated estimate version after takeoff launch.", {
      duplicatedVersionId: input.duplicatedVersionId,
      sourceVersionId: input.sourceVersionId,
      error,
    });
  }
}

export async function launchTakeoffFromPlanSet(
  input: LaunchTakeoffFromPlanSetInput,
) {
  const parsed = launchTakeoffFromPlanSetSchema.parse(input);
  const job = await createTakeoffJobFromPlanSet({
    projectId: parsed.projectId,
    planSetId: parsed.planSetId,
    estimateVersionId: parsed.versionId,
    level: parsed.level,
  });

  const triggerResult = await triggerTakeoffJobProcessing({
    jobId: job.id,
    trigger: "create",
  });
  const dispatchPersisted = await persistTakeoffDispatchOutcome({
    jobId: job.id,
    trigger: "create",
    result: triggerResult,
  });

  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
  revalidatePath(`/dashboard/affaires/${parsed.projectId}/takeoff`);

  return {
    jobId: job.id,
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
  let duplicatedVersionId: string | null = null;

  try {
    const duplicatedVersion = await duplicateEstimateVersion(parsed.sourceVersionId);
    duplicatedVersionId = duplicatedVersion.version_id;

    const launchResult = await launchTakeoffFromPlanSet({
      projectId: parsed.projectId,
      planSetId: parsed.planSetId,
      versionId: duplicatedVersionId,
      level: parsed.level,
    });

    return {
      ...launchResult,
      versionId: duplicatedVersionId,
    };
  } catch (error) {
    if (duplicatedVersionId) {
      await rollbackDuplicatedEstimateVersion({
        duplicatedVersionId,
        sourceVersionId: parsed.sourceVersionId,
      });
    }

    throw error;
  }
}
