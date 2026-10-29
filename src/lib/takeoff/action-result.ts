export type TakeoffActionFailure = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

export type SafeTakeoffActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: TakeoffActionFailure };

export class TakeoffActionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(failure: TakeoffActionFailure) {
    super(failure.message);
    this.name = "TakeoffActionError";
    this.status = failure.status;
    this.code = failure.code;
    this.retryable = failure.retryable;
  }
}

/** Throw locally after transport, so production Server Actions preserve safe text. */
export function unwrapTakeoffActionResult<T>(result: SafeTakeoffActionResult<T>): T {
  if (!result.ok) throw new TakeoffActionError(result.error);
  return result.data;
}
