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
