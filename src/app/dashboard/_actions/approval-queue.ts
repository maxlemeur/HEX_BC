"use server";

import { revalidatePath } from "next/cache";

import { markApprovalQueueItemState } from "@/lib/approvals/server";
import type { ReviewerState } from "@/lib/approvals/server";

export async function markApprovalQueueItemStateAction(input: {
  cycleId: string;
  state: ReviewerState;
}): Promise<{ ok: true }> {
  await markApprovalQueueItemState(input.cycleId, input.state);
  revalidatePath("/dashboard/approvals");
  revalidatePath("/dashboard/direction");
  return { ok: true };
}
