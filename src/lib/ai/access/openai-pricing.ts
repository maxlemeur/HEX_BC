import type { AiReasoningEffort, ApiKeyOfferedModel } from "@/lib/ai/access/contracts";
import type { ApiKeyCallUsage } from "@/lib/ai/access/api-key-errors";
import { RETIRED_OPENAI_MODEL } from "@/lib/ai/chatgpt-model-preferences";

// OpenAI API prices for new requests and recorded usage.
// Verified on 22 November 2026 against the OpenAI model pages and pricing page.
// This table covers Standard processing.
//   Cache writes are billed instead of ordinary input at 1,25× input (30-minute
//   lifetime, the default) or 2,5× (12 hours). Past 272 000 input tokens, the
//   whole request is billed 2× input and 1,5× output.
//   Requests pin `service_tier: "default"` (Standard). The tier a response
//   reports is checked: any other leaves the cost « à confirmer ».
// Prices are kept in nano-dollars per token (integers): 1 $ / M = 1 000 n$ per token.
//
// The bound of a call is an upper bound of what OpenAI may bill. A call with a
// document is bounded from its input as OpenAI counts it (the input token
// counting endpoint, on the exact outgoing request), every input token priced
// at the 12-hour cache write rate (the adapter asks for no cache write, but a
// written token costs no more than this), plus the whole output budget, reasoning
// included. A text-only call (the model test) is bounded by its UTF-8 bytes,
// which bound its tokens. The output budget of a lab call is what its share of
// the ceiling leaves once the counted input is priced.

export type OpenAiModelPrice = {
  name: string;
  inputNanoPerToken: number;
  cachedInputNanoPerToken: number;
  /** Total rate of a token written to a 30-minute cache (instead of ordinary input). */
  cacheWrite30mNanoPerToken: number;
  /** Total rate of a token written to a 12-hour cache. */
  cacheWrite12hNanoPerToken: number;
  outputNanoPerToken: number;
  reasoningEfforts: readonly AiReasoningEffort[];
  defaultReasoningEffort: AiReasoningEffort;
};

export const OPENAI_PRICE_TABLE = {
  verifiedOn: "2026-11-22",
  id: "openai-standard-2026-11-22",
  source: "https://developers.openai.com/api/docs/pricing",
  serviceTier: "default",
  longContextThreshold: 272_000,
  models: {
    "gpt-6.1-terra": {
      name: "GPT-6.1 Terra", inputNanoPerToken: 1_000, cachedInputNanoPerToken: 50, cacheWrite30mNanoPerToken: 1_250,
      cacheWrite12hNanoPerToken: 2_500, outputNanoPerToken: 5_000,
      reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium",
    },
    [RETIRED_OPENAI_MODEL]: {
      name: "GPT-6.1 Sol", inputNanoPerToken: 2_000, cachedInputNanoPerToken: 100, cacheWrite30mNanoPerToken: 2_500,
      cacheWrite12hNanoPerToken: 5_000, outputNanoPerToken: 10_000,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium",
    },
    "gpt-6.2-astra": {
      name: "GPT-6.2 Astra", inputNanoPerToken: 8_000, cachedInputNanoPerToken: 400, cacheWrite30mNanoPerToken: 10_000,
      cacheWrite12hNanoPerToken: 20_000, outputNanoPerToken: 40_000,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium",
    },
    "gpt-6.2-sol": {
      name: "GPT-6.2 Sol", inputNanoPerToken: 2_000, cachedInputNanoPerToken: 100, cacheWrite30mNanoPerToken: 2_500,
      cacheWrite12hNanoPerToken: 5_000, outputNanoPerToken: 10_000,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium",
    },
  } satisfies Record<string, OpenAiModelPrice>,
} as const;

/** Message framing and the request's own overhead. */
const REQUEST_OVERHEAD_TOKENS = 1_000;

/** 1,00 $ US per lab essai (all its key configurations together). */
export const LAB_API_KEY_CEILING_NANO_USD = 1_000_000_000;
/** Below this output budget an extraction cannot hold a useful answer (reasoning included): the call is refused. */
export const LAB_MIN_USEFUL_OUTPUT_TOKENS = 8_000;
/** The model test of « Mon profil »: a minimal answer, no document. */
export const MODEL_TEST_MAX_OUTPUT_TOKENS = 1_024;
export const MODEL_TEST_CEILING_NANO_USD = 100_000_000;
/** The serialized text-only input and schema (checked before sending in openai-api.ts). */
export const MODEL_TEST_INPUT_BYTES_MAX = 1_000;

/** The largest output budget of a lab extraction, reasoning included; what the ceiling leaves may lower it. */
export function labMaxOutputTokens(effort: AiReasoningEffort | null) {
  return effort === "xhigh" || effort === "max" ? 64_000 : 32_000;
}

function openAiModelPrice(id: string): OpenAiModelPrice | null {
  return Object.hasOwn(OPENAI_PRICE_TABLE.models, id) ? OPENAI_PRICE_TABLE.models[id as keyof typeof OPENAI_PRICE_TABLE.models] : null;
}

export function openAiQualifiedModel(id: string): OpenAiModelPrice | null {
  return id === RETIRED_OPENAI_MODEL ? null : openAiModelPrice(id);
}

/** The qualified models, in order of preference (Terra first). */
export function openAiQualifiedModelIds(): string[] {
  return Object.keys(OPENAI_PRICE_TABLE.models).filter((id) => id !== RETIRED_OPENAI_MODEL);
}

/** The offer for a key: qualified models the key lists, or all qualified ones, marked unverified, when it may not list. */
export function offeredOpenAiModels(listed: ReadonlySet<string> | null): ApiKeyOfferedModel[] {
  return openAiQualifiedModelIds().filter((id) => listed === null || listed.has(id)).map((id) => {
    const price = openAiQualifiedModel(id)!;
    return { id, name: price.name, reasoningEfforts: [...price.reasoningEfforts], defaultReasoningEffort: price.defaultReasoningEffort, verified: listed !== null };
  });
}

export type OpenAiCallBound =
  | { status: "priced"; nanoUsd: number }
  | { status: "unknown_price" };

const isLong = (inputTokens: number) => inputTokens > OPENAI_PRICE_TABLE.longContextThreshold;

/** The most an input costs: every token at the 12-hour cache write rate (the highest), the long-context rate past the threshold. */
function inputBoundNano(price: OpenAiModelPrice, inputTokens: number) {
  return inputTokens * price.cacheWrite12hNanoPerToken * (isLong(inputTokens) ? 2 : 1);
}

function outputRateNano(price: OpenAiModelPrice, inputTokens: number) {
  return price.outputNanoPerToken * (isLong(inputTokens) ? 1.5 : 1);
}

/** The most a call can cost once OpenAI counted its input: that input, the whole output budget. */
export function boundCountedCall(input: { model: string; inputTokens: number; maxOutputTokens: number }): OpenAiCallBound {
  const price = openAiQualifiedModel(input.model);
  if (!price) return { status: "unknown_price" };
  return { status: "priced",
    nanoUsd: inputBoundNano(price, input.inputTokens) + Math.ceil(input.maxOutputTokens * outputRateNano(price, input.inputTokens)) };
}

/**
 * What « Tester le modèle » can cost at most, announced before it runs. A text-only call: its UTF-8 bytes, the
 * schema allowance and the framing bound its input tokens.
 */
export function boundModelTest(model: string): OpenAiCallBound {
  return boundCountedCall({ model, inputTokens: MODEL_TEST_INPUT_BYTES_MAX + REQUEST_OVERHEAD_TOKENS,
    maxOutputTokens: MODEL_TEST_MAX_OUTPUT_TOKENS });
}

/** The largest output budget, at most `cap`, whose bound with the counted input fits the allotment (0 when none does). */
export function maxOutputWithin(input: { model: string; inputTokens: number; allotmentNanoUsd: number; cap: number }): number {
  const price = openAiQualifiedModel(input.model);
  if (!price) return 0;
  const left = input.allotmentNanoUsd - inputBoundNano(price, input.inputTokens);
  if (left <= 0) return 0;
  return Math.max(0, Math.min(input.cap, Math.floor(left / outputRateNano(price, input.inputTokens))));
}

/**
 * What the provider's announced usage costs, or null when it cannot be known: an unpriced model, or a tier
 * other than Standard (« consommation à confirmer »). The input count includes the tokens read from and written
 * to the cache, the output count the reasoning tokens: each is billed once, at its own rate.
 */
export function costOfOpenAiUsage(model: string, usage: ApiKeyCallUsage, serviceTier: string | null): number | null {
  const price = openAiModelPrice(model) ?? openAiModelPrice(snapshotBase(model));
  if (!price || serviceTier !== OPENAI_PRICE_TABLE.serviceTier) return null;
  const total = Math.max(0, usage.input);
  const cached = Math.min(Math.max(0, usage.cachedInput), total);
  const written = Math.min(Math.max(0, usage.cacheWrite), total - cached);
  const written12h = Math.min(Math.max(0, usage.cacheWrite12h), written);
  const input = (total - cached - written) * price.inputNanoPerToken + cached * price.cachedInputNanoPerToken
    + (written - written12h) * price.cacheWrite30mNanoPerToken + written12h * price.cacheWrite12hNanoPerToken;
  return input * (isLong(total) ? 2 : 1) + Math.ceil(Math.max(0, usage.output) * outputRateNano(price, total));
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
