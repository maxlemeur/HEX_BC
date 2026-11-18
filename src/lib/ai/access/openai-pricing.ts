import type { AiReasoningEffort, ApiKeyOfferedModel } from "@/lib/ai/access/contracts";
import type { ApiKeyCallUsage } from "@/lib/ai/access/api-key-errors";

// Models this code qualifies for a personal OpenAI API key, with their price.
// Read on the OpenAI model and pricing pages on 18 November 2026, standard
// tier, US dollars per million tokens. A model missing from this table is never
// offered and never called: its spend could not be bounded.
//   gpt-6.1-terra: 1,00 input · 0,05 cached input · 5,00 output; efforts none…max;
//   gpt-6.1-sol:   2,00 input · 0,10 cached input · 10,00 output; efforts low…max.
//   Both: a request past 272 000 input tokens is billed 2× input and 1,5× output.
// Prices are kept in nano-dollars per token (integers): 1 $ / M = 1 000 n$ per token.
//
// The bound before a call is prudent, not a forecast. The PDF page counts its
// extracted text and its image: neither is known before sending, so each page
// counts `pageTextTokensMax` (an assumption of this code: a dense plan page)
// and `pageImageTokensMax` (2 500 patches × 1,2 at high detail, the documented
// multiplier of the previous Terra and of GPT-6 Astra, doubled because the 6.1
// multiplier is not published). The output counts its whole budget, reasoning
// included (max_output_tokens covers both).

export type OpenAiModelPrice = {
  name: string;
  inputNanoPerToken: number;
  cachedInputNanoPerToken: number;
  outputNanoPerToken: number;
  reasoningEfforts: readonly AiReasoningEffort[];
  defaultReasoningEffort: AiReasoningEffort;
  pageImageTokensMax: number;
};

export const OPENAI_PRICE_TABLE = {
  verifiedOn: "2026-11-18",
  id: "openai-standard-2026-11-18",
  source: "https://developers.openai.com/api/docs/pricing",
  longContextThreshold: 272_000,
  pageTextTokensMax: 25_000,
  models: {
    "gpt-6.1-terra": {
      name: "GPT-6.1 Terra", inputNanoPerToken: 1_000, cachedInputNanoPerToken: 50, outputNanoPerToken: 5_000,
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium", pageImageTokensMax: 6_000,
    },
    "gpt-6.1-sol": {
      name: "GPT-6.1 Sol", inputNanoPerToken: 2_000, cachedInputNanoPerToken: 100, outputNanoPerToken: 10_000,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium", pageImageTokensMax: 6_000,
    },
  } satisfies Record<string, OpenAiModelPrice>,
} as const;

/** The developer message's fixed words and the JSON schema it carries, in tokens (UTF-8 bytes bound tokens). */
export const OPENAI_SCHEMA_TOKENS_ALLOWANCE = 8_000;
/** Message framing and the request's own overhead. */
const REQUEST_OVERHEAD_TOKENS = 1_000;

/** 1,00 $ US per lab essai (all its key configurations together). */
export const LAB_API_KEY_CEILING_NANO_USD = 1_000_000_000;
/** The model test of « Mon profil »: a minimal answer, no document. */
export const MODEL_TEST_MAX_OUTPUT_TOKENS = 1_024;
export const MODEL_TEST_CEILING_NANO_USD = 50_000_000;
/** The test question's words, at most (openai-api.ts checks its own). */
export const MODEL_TEST_PROMPT_BYTES_MAX = 200;

/** The output budget of a lab extraction, reasoning included. */
export function labMaxOutputTokens(effort: AiReasoningEffort | null) {
  return effort === "xhigh" || effort === "max" ? 64_000 : 32_000;
}

export function openAiQualifiedModel(id: string): OpenAiModelPrice | null {
  return Object.hasOwn(OPENAI_PRICE_TABLE.models, id) ? OPENAI_PRICE_TABLE.models[id as keyof typeof OPENAI_PRICE_TABLE.models] : null;
}

/** The qualified models, in order of preference (Terra first). */
export function openAiQualifiedModelIds(): string[] {
  return Object.keys(OPENAI_PRICE_TABLE.models);
}

/** The offer for a key: qualified models the key lists, or all qualified ones, marked unverified, when it may not list. */
export function offeredOpenAiModels(listed: ReadonlySet<string> | null): ApiKeyOfferedModel[] {
  return openAiQualifiedModelIds().filter((id) => listed === null || listed.has(id)).map((id) => {
    const price = openAiQualifiedModel(id)!;
    return { id, name: price.name, reasoningEfforts: [...price.reasoningEfforts], defaultReasoningEffort: price.defaultReasoningEffort, verified: listed !== null };
  });
}

export type OpenAiCallBound =
  | { status: "priced"; inputTokens: number; outputTokens: number; nanoUsd: number }
  | { status: "unknown_price" };

/** The most a call can cost: every input token at the full rate, the whole output budget. */
export function boundOpenAiCall(input: { model: string; promptBytes: number; pages: number; maxOutputTokens: number }): OpenAiCallBound {
  const price = openAiQualifiedModel(input.model);
  if (!price) return { status: "unknown_price" };
  const inputTokens = input.promptBytes + OPENAI_SCHEMA_TOKENS_ALLOWANCE + REQUEST_OVERHEAD_TOKENS
    + input.pages * (OPENAI_PRICE_TABLE.pageTextTokensMax + price.pageImageTokensMax);
  const long = inputTokens > OPENAI_PRICE_TABLE.longContextThreshold;
  const nanoUsd = inputTokens * price.inputNanoPerToken * (long ? 2 : 1)
    + Math.ceil(input.maxOutputTokens * price.outputNanoPerToken * (long ? 1.5 : 1));
  return { status: "priced", inputTokens, outputTokens: input.maxOutputTokens, nanoUsd };
}

/** What « Tester le modèle » can cost at most, announced before it runs. */
export function boundModelTest(model: string): OpenAiCallBound {
  return boundOpenAiCall({ model, promptBytes: MODEL_TEST_PROMPT_BYTES_MAX, pages: 0, maxOutputTokens: MODEL_TEST_MAX_OUTPUT_TOKENS });
}

/**
 * What the provider's announced usage costs. Its input count includes the
 * cached tokens, its output count the reasoning tokens: each is billed once.
 */
export function costOfOpenAiUsage(model: string, usage: ApiKeyCallUsage): number | null {
  const price = openAiQualifiedModel(model) ?? openAiQualifiedModel(snapshotBase(model));
  if (!price) return null;
  const cached = Math.min(Math.max(0, usage.cachedInput), Math.max(0, usage.input));
  const long = usage.input > OPENAI_PRICE_TABLE.longContextThreshold;
  const input = (usage.input - cached) * price.inputNanoPerToken + cached * price.cachedInputNanoPerToken;
  return input * (long ? 2 : 1) + Math.ceil(Math.max(0, usage.output) * price.outputNanoPerToken * (long ? 1.5 : 1));
}

/** « gpt-6.1-terra-2026-10-01 » → « gpt-6.1-terra »: a dated snapshot the provider answers with. */
function snapshotBase(model: string) {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

const usd = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

/** A spent amount, rounded to the cent; « moins de 0,01 $ US » rather than a positive zero. */
export function formatUsd(nanoUsd: number | null): string {
  if (nanoUsd === null) return "consommation à confirmer";
  const cents = Math.round(nanoUsd / 10_000_000);
  if (nanoUsd > 0 && cents === 0) return "moins de 0,01 $ US";
  return `${usd.format(cents / 100).replace(/\s/g, " ")} $ US`;
}

/** A ceiling or a bound, rounded up to the cent. */
export function formatUsdCeiling(nanoUsd: number): string {
  return `${usd.format(Math.ceil(nanoUsd / 10_000_000) / 100).replace(/\s/g, " ")} $ US`;
}
