import type { StructuredCall, StructuredCallOptions } from "@/lib/ai/structured-call";
import type { PosteExchangeAnswer, PosteExchangeManifest, PosteExchangeOutput } from "@/lib/takeoff/poste-exchange";

/**
 * The controlled provider of the second measuring order, for isolated tests and the owned-worker journeys: it reads the
 * manifest its prompt carries, as the model would, answers each requested item from a script (by default « not found »
 * on every page it owns) and returns the answer through the call's own schema, as the local reader does. No AI call.
 */

/** The manifest of a call, read from its prompt (the line after « MANIFESTE »). */
export function readPosteManifest(prompt: string): PosteExchangeManifest {
  const lines = prompt.split("\n");
  const at = lines.indexOf("MANIFESTE");
  if (at < 0) throw new Error("The prompt carries no manifest.");
  return JSON.parse(lines[at + 1]) as PosteExchangeManifest;
}

export type PosteScriptEntry = {
  key: string;
  label: string;
  chunkId: string;
  /** The fragment's pages, those it owns, numbered as the attached PDF (from 1). */
  pages: number[];
  owned: number[];
};
export type PosteScript = (entry: PosteScriptEntry) => PosteExchangeAnswer | "omit";

export const posteNotFound = (entry: Pick<PosteScriptEntry, "key" | "owned">): PosteExchangeAnswer => ({
  post_id: entry.key, outcome: "not_found", searched_pages: entry.owned, reason_code: "NO_INDICATION",
  reason_text: "Aucun indice sur les pages lues.", observations: [],
});

export const posteMeasured = (entry: Pick<PosteScriptEntry, "key" | "owned">, observations: Array<{ page: number; quantity: number;
  unit?: string }>): PosteExchangeAnswer => ({
  post_id: entry.key, outcome: "measured", searched_pages: entry.owned, reason_code: null, reason_text: null,
  observations: observations.map(({ page, quantity, unit }) => ({ page, quantity, unit: unit ?? "u", evidence: `symboles relevés page ${page}`,
    method: "symbol_count", confidence: 0.9, measurement_basis: null, counts_as: "distinct", basis_as_requested: false })),
});

export type ControlledPosteCall = StructuredCall & {
  /** Each call as the provider received it. */
  received: Array<{ chunkId: string; prompt: string; files: NonNullable<StructuredCallOptions<unknown>["files"]> }>;
};

export function controlledPosteCall(script: PosteScript = posteNotFound, options: {
  /** The pages of each call declared unreadable, numbered as the attached PDF. */
  unreadable?: (manifest: PosteExchangeManifest) => number[];
  /** A change to the answer before its schema reads it (a version, a key of another call). */
  alter?: (output: PosteExchangeOutput) => unknown;
  totalTokens?: number;
} = {}): ControlledPosteCall {
  const received: ControlledPosteCall["received"] = [];
  const call = (async <T>(callOptions: StructuredCallOptions<T>) => {
    const manifest = readPosteManifest(callOptions.prompt);
    received.push({ chunkId: manifest.chunk_id, prompt: callOptions.prompt, files: callOptions.files ?? [] });
    const responses = manifest.requested_posts.flatMap((post) => {
      const answer = script({ key: post.post_id, label: post.label, chunkId: manifest.chunk_id, pages: manifest.page_scope.pages,
        owned: manifest.page_scope.owned_pages });
      return answer === "omit" ? [] : [answer];
    });
    const output: PosteExchangeOutput = {
      schema_version: manifest.schema_version, prompt_version: manifest.prompt_version, chunk_id: manifest.chunk_id, responses,
      unreadable_pages: options.unreadable?.(manifest) ?? [], unlisted_findings: [], warnings: [],
    };
    const totalTokens = options.totalTokens ?? 1_000;
    return {
      data: callOptions.schema.parse(options.alter ? options.alter(output) : output), tokenCount: totalTokens,
      tokenUsage: { inputTokens: totalTokens, reasoningTokens: 0, outputTokens: 0, totalTokens }, costCents: 0, durationMs: 1,
      model: callOptions.context?.model ?? "controlled", promptVersion: callOptions.context?.promptVersion ?? manifest.prompt_version,
    };
  }) as ControlledPosteCall;
  call.received = received;
  return call;
}
