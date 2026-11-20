import type { z } from "zod";

import type { TakeoffApiError as TakeoffApiErrorShape, TakeoffLevel } from "@/lib/takeoff/types";

type TakeoffApiErrorMetadata = Pick<
  TakeoffApiErrorShape,
  "retryable" | "jobId" | "level"
>;

export const TAKEOFF_READ_REQUEST_TIMEOUT_MS = 10_000;
export const TAKEOFF_WRITE_REQUEST_TIMEOUT_MS = 60_000;

export class TakeoffApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly jobId: string | null;
  readonly level: TakeoffLevel | string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null,
    metadata: TakeoffApiErrorMetadata = {}
  ) {
    super(message);
    this.name = "TakeoffApiError";
    this.status = status;
    this.details = details;
    this.code = code;
    this.retryable = metadata.retryable ?? false;
    this.jobId = metadata.jobId ?? null;
    this.level = metadata.level ?? null;
  }
}

export function isTakeoffApiError(error: unknown): error is TakeoffApiError {
  return error instanceof TakeoffApiError;
}

/** Reads a `{ ok, data }` envelope with plain `Error`s whose message is the server's, or `failure`. */
export async function readTakeoffEnvelope<T>(path: string, init: RequestInit, schema: z.ZodType<T>, failure: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  } catch (error) {
    // A network failure carries the browser's own (English) message: never shown as is.
    if (init.signal?.aborted) throw error;
    throw new Error(failure);
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(typeof body?.error?.message === "string" && body.error.message.trim() ? body.error.message : failure);
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) throw new Error(failure);
  return parsed.data;
}
