import { randomUUID } from "node:crypto";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import type { TakeoffDispatchOutcome } from "@/lib/takeoff/types";

export type TriggerTakeoffJobProcessingInput = {
  jobId: string;
  correlationId?: string;
  trigger?: "create" | "retry" | "manual" | "reconcile";
};

export type TriggerTakeoffJobProcessingResult = {
  triggered: boolean;
  correlationId: string;
  statusCode: number | null;
  outcome: TakeoffDispatchOutcome;
};

export async function triggerTakeoffJobProcessing(
  input: TriggerTakeoffJobProcessingInput
): Promise<TriggerTakeoffJobProcessingResult> {
  const correlationId = input.correlationId ?? randomUUID();
  if (isLocalChatGptEnabled()) {
    const { dispatchLocalTakeoff } = await import("@/lib/takeoff/local-dispatch");
    return dispatchLocalTakeoff({ ...input, correlationId });
  }
  // Old requests must not be sent to the shared worker and its API provider.
  return { triggered: false, correlationId, statusCode: null, outcome: "configuration_missing" };
}
