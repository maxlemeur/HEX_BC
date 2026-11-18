import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  boundCountedCall, boundModelTest, boundTextOnlyCall, costOfOpenAiUsage, formatUsd, formatUsdCeiling, LAB_API_KEY_CEILING_NANO_USD,
  LAB_MIN_USEFUL_OUTPUT_TOKENS, labMaxOutputTokens, maxOutputWithin, OPENAI_PRICE_TABLE, OPENAI_SCHEMA_TOKENS_ALLOWANCE, openAiQualifiedModel,
} from "@/lib/ai/access/openai-pricing";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

// The money of a paid call, in US dollars, before and after it. Failure modes:
// - a bound that is not an upper bound: input guessed instead of counted, the
//   cache write rate (1,25× input) forgotten, a fixed output budget whatever the
//   input costs (review of the first round: 0,722 $ for one Sol page, 1,203 $
//   for 300 000 input tokens);
// - a model without a price, or a tier other than Standard, passing as known;
// - cached, written or reasoning tokens billed twice or not at all;
// - a positive cost shown as « 0,00 $ US », or a long prompt billed at the short-context rate.

const usage = (fields: Partial<{ input: number; cachedInput: number; cacheWrite: number; cacheWrite12h: number; output: number; reasoning: number }>) => ({
  input: 0, cachedInput: 0, cacheWrite: 0, cacheWrite12h: 0, output: 0, reasoning: 0, total: 0, ...fields,
});

describe("OpenAI price table", () => {
  it("is dated, pins the Standard tier and qualifies only priced models", () => {
    expect(OPENAI_PRICE_TABLE).toMatchObject({ verifiedOn: "2026-11-18", serviceTier: "default" });
    expect(Object.keys(OPENAI_PRICE_TABLE.models).sort()).toEqual(["gpt-6.1-sol", "gpt-6.1-terra"]);
    expect(openAiQualifiedModel("gpt-6.1-terra")).toMatchObject({ inputNanoPerToken: 1_000, cachedInputNanoPerToken: 50, outputNanoPerToken: 5_000,
      cacheWrite30mNanoPerToken: 1_250, cacheWrite12hNanoPerToken: 2_500, reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"] });
    expect(openAiQualifiedModel("gpt-6.1-sol")).toMatchObject({ inputNanoPerToken: 2_000, cachedInputNanoPerToken: 100, outputNanoPerToken: 10_000,
      cacheWrite30mNanoPerToken: 2_500, cacheWrite12hNanoPerToken: 5_000, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] });
    expect(openAiQualifiedModel("gpt-4o")).toBeNull();
  });

  it("bounds the model test's schema within its allowance", () => {
    const bytes = Buffer.byteLength(JSON.stringify(z.toJSONSchema(TakeoffExchangeSchema, { unrepresentable: "any" })));
    expect(bytes).toBeLessThan(OPENAI_SCHEMA_TOKENS_ALLOWANCE);
  });
});

describe("bound of a call whose input OpenAI counted", () => {
  it("prices every counted input token at the 12-hour cache write rate and the whole output budget", () => {
    // Terra: input written to a 12-hour cache costs 2,50 $ / M, output 5 $ / M.
    expect(boundCountedCall({ model: "gpt-6.1-terra", inputTokens: 40_000, maxOutputTokens: 32_000 }))
      .toEqual({ status: "priced", inputTokens: 40_000, outputTokens: 32_000, nanoUsd: 40_000 * 2_500 + 32_000 * 5_000 });
  });

  it("is never below what the call can cost when every input token is written for 12 hours", () => {
    // Review round 2: 200 000 Sol input tokens all written for 12 hours + 50 000 output cost 1,50 $.
    const bound = boundCountedCall({ model: "gpt-6.1-sol", inputTokens: 200_000, maxOutputTokens: 50_000 });
    const worst = costOfOpenAiUsage("gpt-6.1-sol", usage({ input: 200_000, cacheWrite: 200_000, cacheWrite12h: 200_000, output: 50_000 }), "default");
    expect(worst).toBe(1_500_000_000);
    expect(bound.status === "priced" && bound.nanoUsd).toBeGreaterThanOrEqual(worst!);
  });

  it("applies the long-context rate to the whole request past 272 000 input tokens", () => {
    expect(boundCountedCall({ model: "gpt-6.1-sol", inputTokens: 300_000, maxOutputTokens: 10_000 }))
      .toMatchObject({ nanoUsd: 300_000 * 5_000 * 2 + 10_000 * 10_000 * 1.5 });
  });

  it("refuses a model without a known price instead of treating it as free", () => {
    expect(boundCountedCall({ model: "gpt-unknown", inputTokens: 10, maxOutputTokens: 100 })).toEqual({ status: "unknown_price" });
    expect(boundModelTest("gpt-unknown")).toEqual({ status: "unknown_price" });
  });
});

describe("output budget from what is left under the ceiling", () => {
  it("takes the largest output the allotment can pay once the counted input is priced, never above the cap", () => {
    // Sol, 300 000 input tokens: the input alone (1,50 $) passes 1,00 $; nothing is left.
    expect(maxOutputWithin({ model: "gpt-6.1-sol", inputTokens: 300_000, allotmentNanoUsd: LAB_API_KEY_CEILING_NANO_USD, cap: 64_000 })).toBe(0);
    // Sol, one dense page of 40 000 tokens: 0,20 $ of input leaves 0,80 $, that is 80 000 output tokens, capped at 64 000.
    expect(maxOutputWithin({ model: "gpt-6.1-sol", inputTokens: 40_000, allotmentNanoUsd: LAB_API_KEY_CEILING_NANO_USD, cap: 64_000 })).toBe(64_000);
    // Half the ceiling each for two configurations: 0,30 $ left, 30 000 tokens.
    expect(maxOutputWithin({ model: "gpt-6.1-sol", inputTokens: 40_000, allotmentNanoUsd: 500_000_000, cap: 64_000 })).toBe(30_000);
    for (const [inputTokens, allotment] of [[40_000, 500_000_000], [150_000, 1_000_000_000], [250_000, 1_000_000_000], [271_000, 700_000_000]] as const) {
      const cap = 64_000;
      const budget = maxOutputWithin({ model: "gpt-6.1-sol", inputTokens, allotmentNanoUsd: allotment, cap });
      // No budget: the input alone passes the allotment, and the call is refused (prepare's minimum).
      if (budget === 0) continue;
      const bound = boundCountedCall({ model: "gpt-6.1-sol", inputTokens, maxOutputTokens: budget });
      expect(bound.status === "priced" && bound.nanoUsd).toBeLessThanOrEqual(allotment);
    }
  });

  it("names the smallest useful answer and caps the highest efforts higher", () => {
    expect(LAB_MIN_USEFUL_OUTPUT_TOKENS).toBe(8_000);
    expect(labMaxOutputTokens(null)).toBe(32_000);
    expect(labMaxOutputTokens("high")).toBe(32_000);
    expect(labMaxOutputTokens("max")).toBe(64_000);
  });

  it("bounds a text-only call by its bytes, which bound its tokens", () => {
    expect(boundTextOnlyCall({ model: "gpt-6.1-terra", textBytes: 200, maxOutputTokens: 1_024 }))
      .toMatchObject({ nanoUsd: (200 + OPENAI_SCHEMA_TOKENS_ALLOWANCE + 1_000) * 2_500 + 1_024 * 5_000 });
  });
});

describe("cost after a call", () => {
  it("bills cached input at its rate, written input at the write rate, reasoning once inside the output", () => {
    // 10 000 input: 4 000 read from cache, 1 000 written for 30 minutes, 500 for 12 hours, 4 500 ordinary;
    // 3 000 output of which 2 000 reasoning.
    const cost = costOfOpenAiUsage("gpt-6.1-terra", usage({ input: 10_000, cachedInput: 4_000, cacheWrite: 1_500, cacheWrite12h: 500, output: 3_000, reasoning: 2_000 }), "default");
    expect(cost).toBe(4_500 * 1_000 + 4_000 * 50 + 1_000 * 1_250 + 500 * 2_500 + 3_000 * 5_000);
  });

  it("has no known cost for a model without a price or a tier other than Standard", () => {
    expect(costOfOpenAiUsage("gpt-unknown", usage({ input: 1, output: 1 }), "default")).toBeNull();
    for (const tier of ["priority", "fast", "flex", null]) {
      expect(costOfOpenAiUsage("gpt-6.1-terra", usage({ input: 1, output: 1 }), tier)).toBeNull();
    }
  });
});

describe("US dollar amounts", () => {
  it("labels US dollars and never shows a positive cost as zero", () => {
    expect(formatUsd(1_000_000_000)).toBe("1,00 $ US");
    expect(formatUsd(123_456_789)).toBe("0,12 $ US");
    expect(formatUsd(4_000_000)).toBe("moins de 0,01 $ US");
    expect(formatUsd(0)).toBe("0,00 $ US");
    expect(formatUsd(null)).toBe("consommation à confirmer");
  });

  it("rounds a ceiling or a bound up to the cent", () => {
    expect(formatUsdCeiling(1)).toBe("0,01 $ US");
    expect(formatUsdCeiling(1_230_000_001)).toBe("1,24 $ US");
  });
});
