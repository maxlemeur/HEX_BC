import type { StructuredCall, StructuredCallOptions } from "@/lib/ai/structured-call";
import type { PosteExchangeAnswer, PosteExchangeManifest, PosteExchangeOutput } from "@/lib/takeoff/poste-exchange";
import type { Poste } from "@/lib/takeoff/poste-list";

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

/**
 * A sealed list whose batches depend on the items' order (planPosteBatches splits on count and on bytes): 24 designations
 * of 3,900 accented characters (7,800 bytes each), then 24 short ones, their identifiers interleaved (long even, short
 * odd). Read in the list's order it makes 4 batches; sorted by identifier, 3. A plan of 90 pages read in fragments of
 * 10 pages (2 of overlap) makes 11 fragments: 44 reading calls in the list's order, above a plan's ceiling of 40; 33 by
 * identifier. Fictional designations.
 */
export function orderSensitivePosteList(): Poste[] {
  const entry = (index: number, label: string): Poste => ({ id: `eeeeeeee-0000-4000-8000-${String(index).padStart(12, "0")}`, label,
    expectedUnit: "u", measurementBasis: null, qualifiers: {}, sections: [{ id: "s", title: "Plomberie", order: 1 }], synonyms: [],
    referenceQuantity: null, origin: { kind: "manual", intentId: `i-${index}`, addedBy: "aaaaaaaa-0000-4000-8000-000000000001",
      addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } });
  return [...Array.from({ length: 24 }, (_, k) => entry(2 * k, `Désignation détaillée ${k} `.padEnd(3_900, "é"))),
    ...Array.from({ length: 24 }, (_, k) => entry(2 * k + 1, `Poste court ${k}`))];
}
