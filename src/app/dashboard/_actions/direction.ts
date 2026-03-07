"use server";

import { revalidatePath } from "next/cache";

import {
  assignDirectionProjectOwner,
  updateDirectionAlertStatus,
} from "@/lib/direction/server";
import type { TakeoffRiskStatus } from "@/lib/takeoff/types";

export async function assignDirectionProjectOwnerAction(input: {
  projectId: string;
  ownerUserId: string;
}): Promise<{ ok: true }> {
  await assignDirectionProjectOwner(input.projectId, input.ownerUserId);
  revalidatePath("/dashboard/direction");
  revalidatePath(`/dashboard/affaires/${input.projectId}`);
  revalidatePath("/dashboard/approvals");
  return { ok: true };
}

export async function updateDirectionAlertStatusAction(input: {
  projectId: string;
  versionId: string;
  jobId: string;
  alertIds: string[];
  status: TakeoffRiskStatus;
  reviewNote?: string | null;
}): Promise<{ ok: true }> {
  await updateDirectionAlertStatus({
    jobId: input.jobId,
    versionId: input.versionId,
    alertIds: input.alertIds,
    status: input.status,
    reviewNote: input.reviewNote ?? null,
  });
  revalidatePath("/dashboard/direction");
  revalidatePath("/dashboard/approvals");
  revalidatePath(`/dashboard/affaires/${input.projectId}`);
  return { ok: true };
}
