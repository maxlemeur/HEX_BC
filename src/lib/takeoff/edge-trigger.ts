import { randomUUID } from "node:crypto";

export type TriggerTakeoffJobProcessingInput = {
  jobId: string;
  correlationId?: string;
  trigger?: "create" | "retry" | "manual" | "reconcile";
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type TriggerTakeoffJobProcessingResult = {
  triggered: boolean;
  correlationId: string;
  statusCode: number | null;
};

const DEFAULT_EDGE_TRIGGER_TIMEOUT_MS = 1_500;

function resolveEdgeFunctionConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    if (process.env.NODE_ENV === "test") {
      return {
        functionUrl: "http://localhost:54321/functions/v1/process_takeoff_job",
        serviceRoleKey: "test-service-role",
      };
    }

    return null;
  }

  return {
    functionUrl: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/process_takeoff_job`,
    serviceRoleKey,
  };
}

export async function triggerTakeoffJobProcessing(
  input: TriggerTakeoffJobProcessingInput
): Promise<TriggerTakeoffJobProcessingResult> {
  const correlationId = input.correlationId ?? randomUUID();
  const config = resolveEdgeFunctionConfig();

  if (!config) {
    console.error("Takeoff edge trigger skipped: missing Supabase service-role configuration.", {
      jobId: input.jobId,
      correlationId,
    });

    return {
      triggered: false,
      correlationId,
      statusCode: null,
    };
  }

  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_EDGE_TRIGGER_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(config.functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
      },
      body: JSON.stringify({
        job_id: input.jobId,
        trigger: input.trigger ?? "create",
        correlation_id: correlationId,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("Takeoff edge trigger failed.", {
        jobId: input.jobId,
        correlationId,
        status: response.status,
      });
    }

    return {
      triggered: response.ok,
      correlationId,
      statusCode: response.status,
    };
  } catch (error) {
    console.error("Takeoff edge trigger request failed.", {
      jobId: input.jobId,
      correlationId,
      error,
    });

    return {
      triggered: false,
      correlationId,
      statusCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
