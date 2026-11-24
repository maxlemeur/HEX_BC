import type { z } from "zod";

import type { TakeoffLevel } from "@/lib/takeoff/types";

export type StructuredCallFile = {
  data: string;
  mimeType: string;
  /** How finely the ChatGPT plan reads an image (the transcription reads it at `high`); the provider's default without it. */
  detail?: "low" | "high" | "auto";
};

export type StructuredCallContext = {
  jobId?: string;
  tenantId?: string;
  level?: TakeoffLevel;
  promptVersion?: string;
  model?: string;
};

export type StructuredCallOptions<T> = {
  /** Original PDF page and one-based tile ordinal in an opted-in takeoff schedule. */
  takeoffTile?: { page: number; ordinal: number };
  prompt: string;
  schema: z.ZodType<T>;
  files?: StructuredCallFile[];
  timeoutMs?: number;
  /** Caller cancellation signal, combined with `timeoutMs` on provider requests. */
  signal?: AbortSignal;
  context?: StructuredCallContext;
};

/** `outputTokens` excludes `reasoningTokens`; `totalTokens` counts both with the input. */
export type TokenUsage = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type StructuredCallResult<T> = {
  data: T;
  tokenCount: number;
  tokenUsage: TokenUsage;
  costCents: number;
  durationMs: number;
  model: string;
  promptVersion: string;
};

export type StructuredCall = <T>(options: StructuredCallOptions<T>) => Promise<StructuredCallResult<T>>;
