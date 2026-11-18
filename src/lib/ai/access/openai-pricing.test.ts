import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  boundOpenAiCall, costOfOpenAiUsage, formatUsd, formatUsdCeiling, LAB_API_KEY_CEILING_NANO_USD, labMaxOutputTokens, OPENAI_PRICE_TABLE,
  OPENAI_SCHEMA_TOKENS_ALLOWANCE, openAiQualifiedModel,
} from "@/lib/ai/access/openai-pricing";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

// The money of a paid call, in US dollars, before and after it. Failure modes:
// a bound that forgets the PDF pages or the reasoning, a model without a price
// that passes as free, cached or reasoning tokens billed twice, a positive cost
// shown as « 0,00 $ US », and a long prompt billed at the short-context rate.

describe("OpenAI price table", () => {
  it("is dated and qualifies only priced models", () => {
    expect(OPENAI_PRICE_TABLE.verifiedOn).toBe("2026-11-18");
    expect(Object.keys(OPENAI_PRICE_TABLE.models).sort()).toEqual(["gpt-6.1-sol", "gpt-6.1-terra"]);
    expect(openAiQualifiedModel("gpt-6.1-terra")?.reasoningEfforts).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(openAiQualifiedModel("gpt-6.1-sol")?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(openAiQualifiedModel("gpt-4o")).toBeNull();
  });

  it("bounds the level-C schema within its allowance", () => {
    const bytes = Buffer.byteLength(JSON.stringify(z.toJSONSchema(TakeoffExchangeSchema, { unrepresentable: "any" })));
    expect(bytes).toBeLessThan(OPENAI_SCHEMA_TOKENS_ALLOWANCE);
  });
});

describe("bound before a call", () => {
  it("counts the prompt, every PDF page and the whole output budget, at the standard rate", () => {
    const one = boundOpenAiCall({ model: "gpt-6.1-terra", promptBytes: 10_000, pages: 1, maxOutputTokens: 32_000 });
    const two = boundOpenAiCall({ model: "gpt-6.1-terra", promptBytes: 10_000, pages: 2, maxOutputTokens: 32_000 });
    if (one.status !== "priced" || two.status !== "priced") throw new Error("Terra is priced.");
    expect(two.inputTokens - one.inputTokens).toBe(OPENAI_PRICE_TABLE.pageTextTokensMax + OPENAI_PRICE_TABLE.models["gpt-6.1-terra"].pageImageTokensMax);
    // Terra: 1 $ / M input, 5 $ / M output.
    expect(one.nanoUsd).toBe(one.inputTokens * 1_000 + 32_000 * 5_000);
    expect(one.nanoUsd).toBeLessThan(LAB_API_KEY_CEILING_NANO_USD);
  });

  it("refuses a model without a known price instead of treating it as free", () => {
    expect(boundOpenAiCall({ model: "gpt-unknown", promptBytes: 10, pages: 0, maxOutputTokens: 100 })).toEqual({ status: "unknown_price" });
  });

  it("applies the long-context rate to the whole request past 272 000 input tokens", () => {
    const short = boundOpenAiCall({ model: "gpt-6.1-sol", promptBytes: 100_000, pages: 0, maxOutputTokens: 10_000 });
    const long = boundOpenAiCall({ model: "gpt-6.1-sol", promptBytes: 300_000, pages: 0, maxOutputTokens: 10_000 });
    if (short.status !== "priced" || long.status !== "priced") throw new Error("Sol is priced.");
    expect(short.nanoUsd).toBe(short.inputTokens * 2_000 + 10_000 * 10_000);
    expect(long.nanoUsd).toBe(long.inputTokens * 2_000 * 2 + 10_000 * 10_000 * 1.5);
  });

  it("gives the highest efforts a larger output budget", () => {
    expect(labMaxOutputTokens(null)).toBe(32_000);
    expect(labMaxOutputTokens("high")).toBe(32_000);
    expect(labMaxOutputTokens("max")).toBe(64_000);
  });
});

describe("cost after a call", () => {
  it("bills cached input at its rate and reasoning once, inside the output", () => {
    // 10 000 input of which 4 000 cached; 3 000 output of which 2 000 reasoning.
    const cost = costOfOpenAiUsage("gpt-6.1-terra", { input: 10_000, cachedInput: 4_000, output: 3_000, reasoning: 2_000, total: 13_000 });
    expect(cost).toBe(6_000 * 1_000 + 4_000 * 50 + 3_000 * 5_000);
  });

  it("has no cost for a model without a price", () => {
    expect(costOfOpenAiUsage("gpt-unknown", { input: 1, cachedInput: 0, output: 1, reasoning: 0, total: 2 })).toBeNull();
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
