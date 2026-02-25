import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import { TakeoffError } from "@/lib/takeoff/errors";

const TestSchema = z
  .object({
    items: z.array(
      z.object({
        designation: z.string(),
        quantity: z.number(),
        unit: z.string(),
      })
    ),
  })
  .strict();

describe("callGeminiStructured", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("returns structured data and metadata on success", async () => {
    const logger = vi.fn();
    const result = await callGeminiStructured(
      {
        prompt: "Extract takeoff lines",
        schema: TestSchema,
        context: {
          jobId: "job-1",
          tenantId: "tenant-1",
          level: "A",
          promptVersion: "takeoff-a-v1",
          model: "gemini-2.5-pro",
        },
      },
      {
        invoke: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            items: [{ designation: "Cable U1000", quantity: 42, unit: "ml" }],
          }),
          usage: {
            promptTokenCount: 50_000,
            candidatesTokenCount: 50_000,
            totalTokenCount: 100_000,
          },
        }),
        logger,
      }
    );

    expect(result.data.items).toHaveLength(1);
    expect(result.tokenCount).toBe(100_000);
    expect(result.tokenUsage).toEqual({
      inputTokens: 50_000,
      reasoningTokens: 0,
      outputTokens: 50_000,
      totalTokens: 100_000,
    });
    expect(result.costCents).toBeGreaterThan(0);
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.promptVersion).toBe("takeoff-a-v1");
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job-1",
        tenant_id: "tenant-1",
        level: "A",
        input_token_count: 50_000,
        reasoning_token_count: 0,
        output_token_count: 50_000,
        token_count: 100_000,
        status: "success",
      })
    );
  });

  it("captures reasoning token usage when provided by Gemini", async () => {
    const result = await callGeminiStructured(
      {
        prompt: "Extract with reasoning",
        schema: TestSchema,
        context: {
          level: "C",
          model: "gemini-2.5-pro",
        },
      },
      {
        invoke: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            items: [{ designation: "Gaine", quantity: 2, unit: "ml" }],
          }),
          usage: {
            promptTokenCount: 200,
            thoughtsTokenCount: 50,
            candidatesTokenCount: 100,
          },
        }),
      }
    );

    expect(result.tokenUsage).toEqual({
      inputTokens: 200,
      reasoningTokens: 50,
      outputTokens: 100,
      totalTokens: 350,
    });
    expect(result.tokenCount).toBe(350);
  });

  it("honors explicit timeout values above 180 seconds", async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        items: [{ designation: "Tube cuivre", quantity: 12, unit: "ml" }],
      }),
      usage: {
        totalTokenCount: 1200,
      },
    });

    await callGeminiStructured(
      {
        prompt: "Extract",
        schema: TestSchema,
        timeoutMs: 300_000,
      },
      {
        invoke,
      }
    );

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 300_000,
      })
    );
  });

  it("retries with exponential backoff then succeeds", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
        message: "Too Many Requests",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          items: [{ designation: "Tube cuivre", quantity: 12, unit: "ml" }],
        }),
        usage: {
          totalTokenCount: 1200,
        },
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn();

    const result = await callGeminiStructured(
      {
        prompt: "Extract",
        schema: TestSchema,
      },
      {
        invoke,
        sleep,
        logger,
      }
    );

    expect(result.data.items[0]?.designation).toBe("Tube cuivre");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(logger).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "retry",
        error_code: "AI_RATE_LIMIT",
        attempt: 1,
      })
    );
    expect(logger).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "success",
        attempt: 2,
      })
    );
  });

  it("fails after max retries are exhausted", async () => {
    const invoke = vi.fn().mockRejectedValue({
      status: 503,
      message: "Service unavailable",
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn();

    await expect(
      callGeminiStructured(
        {
          prompt: "Extract",
          schema: TestSchema,
        },
        {
          invoke,
          sleep,
          logger,
        }
      )
    ).rejects.toMatchObject({
      code: "AI_PROVIDER",
    });

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(sleep).toHaveBeenNthCalledWith(3, 1000);
    expect(logger).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        attempt: 4,
        error_code: "AI_PROVIDER",
      })
    );
  });

  it("maps timeout and schema parsing errors to normalized takeoff errors", async () => {
    const logger = vi.fn();

    await expect(
      callGeminiStructured(
        {
          prompt: "Extract",
          schema: TestSchema,
          maxRetries: 0,
        },
        {
          invoke: vi.fn().mockRejectedValue({
            code: "ETIMEDOUT",
            message: "timed out",
          }),
          logger,
        }
      )
    ).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      retryable: true,
    });

    await expect(
      callGeminiStructured(
        {
          prompt: "Extract",
          schema: TestSchema,
          maxRetries: 0,
        },
        {
          invoke: vi.fn().mockResolvedValue({
            text: "not-json",
            usage: {},
          }),
          logger,
        }
      )
    ).rejects.toMatchObject({
      code: "AI_SCHEMA",
      retryable: false,
    });
  });

  it("throws when GEMINI_API_KEY is missing on server", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      callGeminiStructured({
        prompt: "Extract",
        schema: TestSchema,
      })
    ).rejects.toBeInstanceOf(TakeoffError);
  });
});
