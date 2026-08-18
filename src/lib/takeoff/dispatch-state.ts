import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  TriggerTakeoffJobProcessingInput,
  TriggerTakeoffJobProcessingResult,
} from "@/lib/takeoff/edge-trigger";

type TakeoffDispatchTrigger = NonNullable<
  TriggerTakeoffJobProcessingInput["trigger"]
>;

export type PersistTakeoffDispatchOutcomeInput = {
  jobId: string;
  trigger: TakeoffDispatchTrigger;
  result: TriggerTakeoffJobProcessingResult;
};

export async function persistTakeoffDispatchOutcome(
  input: PersistTakeoffDispatchOutcomeInput
): Promise<boolean> {
  try {
    const client = createServiceRoleClient();
    const { data, error } = await client.rpc(
      "record_takeoff_dispatch_outcome" as never,
      {
        p_job_id: input.jobId,
        p_trigger: input.trigger,
        p_correlation_id: input.result.correlationId,
        p_outcome: input.result.outcome,
        p_status_code: input.result.statusCode,
      } as never
    );

    const rows = data as unknown;
    if (error || !Array.isArray(rows) || rows.length !== 1) {
      console.error("Takeoff dispatch outcome could not be persisted.", {
        jobId: input.jobId,
        correlationId: input.result.correlationId,
        error,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("Takeoff dispatch outcome persistence failed.", {
      jobId: input.jobId,
      correlationId: input.result.correlationId,
      error,
    });
    return false;
  }
}
