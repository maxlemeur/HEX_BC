import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
          model: "gemini-3.1-pro-preview",
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
    expect(result.costCents).toBeGreaterThanOrEqual(0);
    expect(result.model).toBe("gemini-3.1-pro-preview");
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
          model: "gemini-3.1-pro-preview",
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

  it("uses Batch delivery when requested", async () => {
    const invoke = vi.fn();
    const invokeBatch = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        items: [{ designation: "Cable U1000", quantity: 42, unit: "ml" }],
      }),
      usage: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
      batchJobName: "batches/test-1",
      batchState: "JOB_STATE_SUCCEEDED",
    });

    const result = await callGeminiStructured(
      {
        prompt: "Extract takeoff lines",
        schema: TestSchema,
        deliveryMode: "batch",
        context: {
          model: "gemini-3-flash-preview",
        },
      },
      {
        invoke,
        invokeBatch,
      }
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(invokeBatch).toHaveBeenCalledTimes(1);
    expect(result.data.items[0]?.designation).toBe("Cable U1000");
    expect(result.providerBatchId).toBe("batches/test-1");
    expect(result.providerBatchStateRaw).toBe("JOB_STATE_SUCCEEDED");
  });

  it("reads batch inline results from nested dest.inlinedResponses payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            name: "batches/test-3",
            metadata: {
              state: "JOB_STATE_SUBMITTED",
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            done: true,
            metadata: {
              state: "JOB_STATE_SUCCEEDED",
            },
            response: {
              dest: {
                inlinedResponses: [
                  {
                    response: {
                      candidates: [
                        {
                          content: {
                            parts: [
                              {
                                text: JSON.stringify({
                                  items: [
                                    {
                                      designation: "Tube cuivre",
                                      quantity: 12,
                                      unit: "ml",
                                    },
                                  ],
                                }),
                              },
                            ],
                          },
                          finishReason: "STOP",
                        },
                      ],
                      usageMetadata: {
                        promptTokenCount: 100,
                        candidatesTokenCount: 40,
                        totalTokenCount: 140,
                      },
                    },
                  },
                ],
              },
            },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGeminiStructured(
      {
        prompt: "Extract",
        schema: TestSchema,
        deliveryMode: "batch",
        context: {
          model: "gemini-3-flash-preview",
        },
      },
      {
        apiKey: "test-key",
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data.items).toEqual([
      {
        designation: "Tube cuivre",
        quantity: 12,
        unit: "ml",
      },
    ]);
    expect(result.providerBatchId).toBe("batches/test-3");
    expect(result.providerBatchStateRaw).toBe("JOB_STATE_SUCCEEDED");
  });

  it("does not retry batch mode after a batch has been submitted", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const invokeBatch = vi.fn().mockImplementation(async (input) => {
      await input.onBatchLifecycleEvent?.({
        provider: "gemini",
        providerBatchId: "batches/test-2",
        providerBatchStateRaw: "JOB_STATE_SUBMITTED",
        observedAt: "2026-03-09T10:00:00.000Z",
        isTerminal: false,
      });

      throw {
        code: "ETIMEDOUT",
        message: "timed out",
      };
    });

    await expect(
      callGeminiStructured(
        {
          prompt: "Extract takeoff lines",
          schema: TestSchema,
          deliveryMode: "batch",
        },
        {
          invokeBatch,
          sleep,
        }
      )
    ).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });

    expect(invokeBatch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("aborts batch HTTP calls when the timeout budget is exhausted", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          },
          { once: true }
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = callGeminiStructured(
      {
        prompt: "Extract",
        schema: TestSchema,
        deliveryMode: "batch",
        timeoutMs: 2_000,
        maxRetries: 0,
      },
      {
        apiKey: "test-key",
      }
    );
    const pendingExpectation = expect(pending).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await pendingExpectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("sends Gemini 3 thinking config inside generationConfig", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [{ designation: "Tube cuivre", quantity: 12, unit: "ml" }],
                    }),
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            totalTokenCount: 1200,
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await callGeminiStructured(
      {
        prompt: "Extract",
        schema: TestSchema,
        thinkingLevel: "medium",
        context: {
          model: "gemini-3-flash-preview",
        },
      },
      {
        apiKey: "test-key",
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String(requestInit?.body ?? "{}"));

    expect(payload.thinkingConfig).toBeUndefined();
    expect(payload.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "MEDIUM",
    });
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
