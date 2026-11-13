import "server-only";

import type { z } from "zod";

import type { AssistantDocumentLedger } from "@/lib/assistant/document-citations";
import type { AssistantModelDelta, AssistantModelTurn, AssistantTokenUsage } from "@/lib/assistant/model-turn";

/** A read the model may ask for. `run` re-checks the user's access itself: arguments come from the model. */
export type AssistantTool = {
  name: string;
  description: string;
  /** Shown to the user while the tool runs, e.g. « Lecture du devis ». */
  activity: string;
  input: z.ZodType;
  /** `signal` is the answer's: the member's Stop and its time bound. A read that can pass it on to its download does. */
  run(input: unknown, signal: AbortSignal): Promise<unknown>;
};

/**
 * What a document read gives back besides its text result: the content parts of
 * the document itself (a PDF file, an image), sent to the model as the next
 * input item. A tool result is text; a file reaches the model the way the
 * dossier classification already sends it through the plan, in a message whose
 * opening `intro` says it is data read by a tool, not the member speaking.
 */
export type AssistantToolAttachment = { intro: string; parts: Record<string, unknown>[] };

export class AssistantToolResult {
  constructor(readonly output: unknown, readonly attachment: AssistantToolAttachment | null) {}
}

/** A refusal worded for the model. Any other error reaches it as a fixed message only. */
export class AssistantToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantToolError";
  }
}

/** A refusal the application worded for its user (4xx) is told to the model as is; anything else stays a failure. */
export async function withUserFacingRefusals<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (error instanceof Error && typeof status === "number" && status >= 400 && status < 500) throw new AssistantToolError(error.message);
    throw error;
  }
}

export type AssistantEvent =
  | AssistantModelDelta
  | { type: "tool_started"; callId: string; name: string; activity: string }
  | { type: "tool_finished"; callId: string; ok: boolean }
  /** A model request succeeded: what it carried has been seen, and the text it wrote is complete. Not sent to the browser. */
  | { type: "model_turn_finished" };

export type AssistantModelRequest = { input: unknown[]; toolsAllowed: boolean };
export type CallAssistantModel = (
  request: AssistantModelRequest, onDelta: (delta: AssistantModelDelta) => void, signal: AbortSignal,
) => Promise<AssistantModelTurn>;

export type AssistantLoopResult = {
  text: string;
  tools: Array<{ name: string; activity: string; ok: boolean }>;
  usage: AssistantTokenUsage;
  modelCalls: number;
};

export const ASSISTANT_MAX_TOOL_CALLS = 8;
const MAX_TOOL_OUTPUT_CHARACTERS = 120_000;

type ToolOutcome = { ok: boolean; output: string; attachment?: AssistantToolAttachment | null };

function failure(message: string): ToolOutcome {
  return { ok: false, output: JSON.stringify({ erreur: message }) };
}

/** The tool's own promise, unless the answer is stopped first: a stopped answer waits for no read. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    work.then((value) => { signal.removeEventListener("abort", stop); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", stop); reject(error); });
  });
}

async function runTool(tool: AssistantTool | undefined, rawArguments: string, signal: AbortSignal): Promise<ToolOutcome> {
  if (!tool) return failure("Outil inconnu.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return failure("Arguments refusés : ce n’est pas un objet JSON.");
  }
  const input = tool.input.safeParse(parsed);
  if (!input.success) {
    const fields = input.error.issues.map((issue) => issue.path.join(".") || "racine").join(", ");
    return failure(`Arguments refusés (${fields}). Respecte le schéma de l’outil.`);
  }
  try {
    const value = await untilAborted(tool.run(input.data, signal), signal);
    const result = value instanceof AssistantToolResult ? value : new AssistantToolResult(value, null);
    const output = JSON.stringify(result.output ?? null);
    if (output.length > MAX_TOOL_OUTPUT_CHARACTERS) {
      return failure("Résultat trop volumineux pour être lu en une fois. Affine la demande (une section, une ligne, un filtre).");
    }
    return { ok: true, output, attachment: result.attachment };
  } catch (error) {
    // Stopped or out of time: the answer ends here, not with a failed read.
    if (signal.aborted) throw signal.reason;
    if (error instanceof AssistantToolError) return failure(error.message);
    // The cause stays in the server log, by tool name only: no argument, no provider or database payload.
    console.error("assistant_tool_failed", tool.name, error instanceof Error ? error.name : "unknown");
    return failure("La lecture a échoué.");
  }
}

/**
 * One user turn: the model answers, asks for reads, gets their results and
 * answers again, until it has nothing more to read. Past the tool limit it must
 * answer with what it has. An interruption rejects with the signal's AbortError;
 * what was emitted until then is all the caller can keep.
 */
export async function runAssistantLoop(options: {
  input: unknown[];
  tools: AssistantTool[];
  callModel: CallAssistantModel;
  emit(event: AssistantEvent): void;
  signal: AbortSignal;
  maxToolCalls?: number;
  /**
   * The documents this answer reads. It is told when a request leaves and when
   * it succeeds (its pages are then seen), and it says when the next request
   * must be the last one: every request sends again all that was read.
   */
  documents?: Pick<AssistantDocumentLedger, "allowsMoreReads" | "requestStarting" | "requestSucceeded">;
}): Promise<AssistantLoopResult> {
  const maxToolCalls = options.maxToolCalls ?? ASSISTANT_MAX_TOOL_CALLS;
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  const input = [...options.input];
  const texts: string[] = [];
  const used: AssistantLoopResult["tools"] = [];
  const usage: AssistantTokenUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
  let modelCalls = 0;
  let toolCalls = 0;

  for (;;) {
    options.signal.throwIfAborted();
    const toolsAllowed = toolCalls < maxToolCalls && (options.documents?.allowsMoreReads() ?? true);
    options.documents?.requestStarting();
    const turn = await options.callModel({ input, toolsAllowed }, options.emit, options.signal);
    options.documents?.requestSucceeded();
    options.emit({ type: "model_turn_finished" });
    modelCalls += 1;
    for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "totalTokens"] as const) usage[key] += turn.usage[key];
    if (turn.text.trim()) texts.push(turn.text.trim());
    // A request without tools is the last one: a call it still makes is not run, and no request follows it.
    if (turn.toolCalls.length === 0 || !toolsAllowed) return { text: texts.join("\n\n"), tools: used, usage, modelCalls };

    input.push(...turn.replayItems);
    // Documents follow the results of the turn: each call is answered first, as the Responses API expects.
    const attachments: AssistantToolAttachment[] = [];
    for (const call of turn.toolCalls) {
      options.signal.throwIfAborted();
      const tool = tools.get(call.name);
      // The label shown to the member is never text the model chose.
      const activity = tool?.activity ?? "Lecture inconnue";
      options.emit({ type: "tool_started", callId: call.callId, name: call.name, activity });
      const result = toolCalls >= maxToolCalls
        ? failure("Limite de lectures atteinte pour cette réponse. Réponds avec ce que tu as déjà lu.")
        : await runTool(tool, call.arguments, options.signal);
      toolCalls += 1;
      used.push({ name: call.name, activity, ok: result.ok });
      options.emit({ type: "tool_finished", callId: call.callId, ok: result.ok });
      input.push({ type: "function_call_output", call_id: call.callId, output: result.output });
      if (result.attachment) attachments.push(result.attachment);
    }
    // The lowest role there is: a document never speaks as the application's rules (developer) do.
    for (const attachment of attachments) {
      input.push({ role: "user", content: [{ type: "input_text", text: attachment.intro }, ...attachment.parts] });
    }
  }
}
