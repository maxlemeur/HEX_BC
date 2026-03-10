"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createTakeoffJobFromPlanSet } from "@/lib/takeoff/server";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";

const launchTakeoffFromPlanSetSchema = z.object({
  projectId: z.string().uuid(),
  planSetId: z.string().uuid(),
  versionId: z.string().uuid(),
  level: z.enum(["A", "B", "C"]).default("B"),
});

export type LaunchTakeoffFromPlanSetInput = z.infer<
  typeof launchTakeoffFromPlanSetSchema
>;

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

  await triggerTakeoffJobProcessing({ jobId: job.id, trigger: "create" });

  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
  revalidatePath(`/dashboard/affaires/${parsed.projectId}/takeoff`);

  return { jobId: job.id };
}
