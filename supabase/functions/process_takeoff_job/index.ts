import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// @ts-expect-error Deno Edge imports require the explicit TypeScript extension.
import { isAuthorizedWorkerRelayRequest } from "./security.ts";

declare const Deno: {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

type WorkerOutcomeStatus =
  | "completed"
  | "submitted_to_provider"
  | "awaiting_provider_result"
  | "failed_retryable"
  | "failed_terminal"
  | "in_progress"
  | "noop_terminal"
  | "canceled";

type WorkerOutcome = {
  job_id: string;
  tenant_id: string | null;
  level: string | null;
  status: WorkerOutcomeStatus;
  trigger: "create" | "retry" | "manual" | "reconcile";
  retry_count: number;
  attempt: number;
  retryable: boolean;
  should_requeue: boolean;
  requeue_reason: "retry" | "reconcile" | null;
  next_run_in_seconds: number | null;
  next_run_at: string | null;
  duration_ms: number;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string;
};

type WorkerEnvelope = {
  ok: boolean;
  data?: WorkerOutcome;
  error?: {
    code?: string;
    message?: string;
  };
};

type ProcessTakeoffJobPayload = {
  job_id: string;
  correlation_id?: string;
  trigger?: "create" | "retry" | "manual" | "reconcile";
};

const REQUEST_TIMEOUT_MS = 240_000;
const SELF_INVOKE_TIMEOUT_MS = 7_500;

type RuntimeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  workerUrl: string;
  workerSecret: string;
};

type BaseRuntimeConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type BaseRuntimeConfigResolution =
  | {
      ok: true;
      config: BaseRuntimeConfig;
    }
  | {
      ok: false;
      missing: string[];
    };

type RuntimeConfigResolution =
  | {
      ok: true;
      config: RuntimeConfig;
    }
  | {
      ok: false;
      missing: string[];
    };

function readEnv(name: string) {
  const value = Deno.env.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function resolveBaseRuntimeConfig(): BaseRuntimeConfigResolution {
  const supabaseUrl = readEnv("SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  const missing = [
    !supabaseUrl ? "SUPABASE_URL" : null,
    !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
    };
  }

  return {
    ok: true,
    config: {
      supabaseUrl: (supabaseUrl ?? "").replace(/\/+$/, ""),
      serviceRoleKey: serviceRoleKey ?? "",
    },
  };
}

async function fetchVaultSecret(baseConfig: BaseRuntimeConfig, secretName: string) {
  try {
    const response = await fetch(`${baseConfig.supabaseUrl}/rest/v1/rpc/get_takeoff_secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${baseConfig.serviceRoleKey}`,
        apikey: baseConfig.serviceRoleKey,
      },
      body: JSON.stringify({
        secret_name: secretName,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const value = await response.text();
    if (!value || value === "null") {
      return null;
    }

    const parsed = JSON.parse(value);
    return typeof parsed === "string" && parsed.trim().length > 0 ? parsed.trim() : null;
  } catch {
    return null;
  }
}

async function resolveRuntimeConfig(): Promise<RuntimeConfigResolution> {
  const base = resolveBaseRuntimeConfig();
  if (!base.ok) {
    return base;
  }

  const workerUrl =
    readEnv("TAKEOFF_WORKER_URL") ??
    (await fetchVaultSecret(base.config, "TAKEOFF_WORKER_URL"));
  const workerSecret =
    readEnv("TAKEOFF_WORKER_SECRET") ??
    (await fetchVaultSecret(base.config, "TAKEOFF_WORKER_SECRET"));

  const missing = [
    !workerUrl ? "TAKEOFF_WORKER_URL" : null,
    !workerSecret ? "TAKEOFF_WORKER_SECRET" : null,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
    };
  }

  return {
    ok: true,
    config: {
      supabaseUrl: base.config.supabaseUrl,
      serviceRoleKey: base.config.serviceRoleKey,
      workerUrl: workerUrl ?? "",
      workerSecret: workerSecret ?? "",
    },
  };
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function parsePayload(request: Request): Promise<Required<ProcessTakeoffJobPayload>> {
  if (request.method !== "POST") {
    throw new Error("METHOD_NOT_ALLOWED");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("INVALID_PAYLOAD");
  }

  const data = payload as ProcessTakeoffJobPayload;
  if (!data.job_id || typeof data.job_id !== "string" || !isUuidLike(data.job_id)) {
    throw new Error("INVALID_JOB_ID");
  }

  const trigger = data.trigger ?? "manual";
  if (
    trigger !== "create" &&
    trigger !== "retry" &&
    trigger !== "manual" &&
    trigger !== "reconcile"
  ) {
    throw new Error("INVALID_TRIGGER");
  }

  const correlationId =
    typeof data.correlation_id === "string" && data.correlation_id.trim().length > 0
      ? data.correlation_id.trim()
      : crypto.randomUUID();

  return {
    job_id: data.job_id,
    correlation_id: correlationId,
    trigger,
  };
}

async function invokeInternalWorker(
  config: RuntimeConfig,
  payload: Required<ProcessTakeoffJobPayload>
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(config.workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-takeoff-worker-secret": config.workerSecret,
        "x-correlation-id": payload.correlation_id,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let envelope: WorkerEnvelope | null = null;
    try {
      envelope = (await response.json()) as WorkerEnvelope;
    } catch {
      envelope = null;
    }

    if (!response.ok || !envelope?.ok || !envelope.data) {
      throw new Error(
        `WORKER_REQUEST_FAILED:${response.status}:${envelope?.error?.code ?? "UNKNOWN"}`
      );
    }

    return envelope.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function selfInvokeRequeue(
  config: RuntimeConfig,
  payload: Required<ProcessTakeoffJobPayload>
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SELF_INVOKE_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.supabaseUrl}/functions/v1/process_takeoff_job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error("Unable to self-invoke process_takeoff_job for retry.", {
        job_id: payload.job_id,
        correlation_id: payload.correlation_id,
        status: response.status,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("Requeue self-invocation failed.", {
      job_id: payload.job_id,
      correlation_id: payload.correlation_id,
      error,
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request: Request) => {
  try {
    const runtimeConfig = await resolveRuntimeConfig();
    if (!runtimeConfig.ok) {
      console.error("process_takeoff_job startup configuration invalid.", {
        missing: runtimeConfig.missing,
      });

      return jsonResponse(500, {
        ok: false,
        error: {
          code: "MISSING_ENV",
          message: `Missing required environment variable(s): ${runtimeConfig.missing.join(
            ", "
          )}`,
        },
      });
    }

    const config = runtimeConfig.config;
    if (!isAuthorizedWorkerRelayRequest(request, config.serviceRoleKey)) {
      return jsonResponse(401, {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Service-role relay credentials are required.",
        },
      });
    }

    const payload = await parsePayload(request);
    const outcome = await invokeInternalWorker(config, payload);

    console.log("takeoff edge worker outcome", {
      job_id: outcome.job_id,
      tenant_id: outcome.tenant_id,
      level: outcome.level,
      attempt: outcome.attempt,
      duration_ms: outcome.duration_ms,
      status: outcome.status,
      correlation_id: outcome.correlation_id,
    });

    if (outcome.should_requeue) {
      if (outcome.next_run_in_seconds && outcome.next_run_in_seconds > 0) {
        await sleep(outcome.next_run_in_seconds * 1000);
      }

      const scheduled = await selfInvokeRequeue(config, {
        job_id: outcome.job_id,
        trigger: outcome.requeue_reason ?? "retry",
        correlation_id: outcome.correlation_id,
      });

      return jsonResponse(202, {
        ok: true,
        data: {
          ...outcome,
          retry_scheduled: scheduled,
        },
      });
    }

    return jsonResponse(200, {
      ok: true,
      data: outcome,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (message === "METHOD_NOT_ALLOWED") {
      return jsonResponse(405, {
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
        },
      });
    }

    if (
      message === "INVALID_JSON" ||
      message === "INVALID_PAYLOAD" ||
      message === "INVALID_JOB_ID" ||
      message === "INVALID_TRIGGER"
    ) {
      return jsonResponse(400, {
        ok: false,
        error: {
          code: message,
          message: "Invalid process_takeoff_job payload.",
        },
      });
    }

    console.error("process_takeoff_job failed", {
      error,
    });

    return jsonResponse(500, {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    });
  }
});
