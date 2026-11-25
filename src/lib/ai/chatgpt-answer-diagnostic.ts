import { z } from "zod";

import type { TokenUsage } from "@/lib/ai/structured-call";

type JsonStage = "stream_event_json" | "answer_json";
type SchemaStage = "response_envelope" | "answer_schema";
type AnswerDiagnosis =
  | { stage: JsonStage; exception: "SyntaxError"; position?: number }
  | { stage: SchemaStage; exception: "ZodError"; issues: { path: string; code: string }[]; issue_count: number };

// Preserve the exception types used by the bench and other inference callers. Only this projection goes to takeoff.
const failures = new WeakMap<Error, { diagnosis: AnswerDiagnosis; usage?: TokenUsage }>();
const MAX_ISSUES = 12;
const MAX_PATH_LENGTH = 160;

export function chatGptAnswerFailure(error: unknown) {
  return error instanceof Error ? failures.get(error) : undefined;
}

export function attachChatGptAnswerUsage(error: unknown, usage: TokenUsage | undefined) {
  const failure = chatGptAnswerFailure(error);
  if (failure && usage) failure.usage = usage;
}

export function decodeChatGptJson(text: string, stage: JsonStage): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      // V8 may quote input in its message. Take only the numeric offset from its location suffix.
      const offset = /\b(?:in|after) JSON at position (\d{1,8})(?: \(line \d+ column \d+\))?$/.exec(error.message);
      failures.set(error, { diagnosis: { stage, exception: "SyntaxError", ...(offset && { position: Number(offset[1]) }) } });
    }
    throw error;
  }
}

function collectSchemaFields(schema: z.core.JSONSchema.JSONSchema | boolean | undefined, fields: Set<string>) {
  if (typeof schema !== "object") return;
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    fields.add(key);
    collectSchemaFields(child, fields);
  }
  const items = Array.isArray(schema.items) ? schema.items : [schema.items];
  for (const child of [...items, ...Object.values(schema.$defs ?? {}), ...(schema.prefixItems ?? []),
    ...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) collectSchemaFields(child, fields);
}

function safePath(path: readonly PropertyKey[], fields: ReadonlySet<string>, prefix: string) {
  const segments = path.slice(0, 12).map((segment) => {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return `[${segment}]`;
    if (typeof segment === "string" && fields.has(segment) && /^[A-Za-z_][A-Za-z_0-9]{0,47}$/.test(segment)) return `.${segment}`;
    // A record key can come directly from the answer. Never copy it into the path.
    return "[?]";
  });
  const formatted = prefix + segments.join("");
  return formatted.length > MAX_PATH_LENGTH || path.length > segments.length
    ? `${formatted.slice(0, MAX_PATH_LENGTH - 1)}…` : formatted;
}

export function parseChatGptAnswerSchema<T>(schema: z.ZodType<T>, value: unknown, stage: SchemaStage): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = new Set<string>();
  collectSchemaFields(z.toJSONSchema(schema, { unrepresentable: "any" }), fields);
  const prefix = stage === "response_envelope" ? "$.output" : "$";
  failures.set(result.error, { diagnosis: { stage, exception: "ZodError", issue_count: result.error.issues.length,
    issues: result.error.issues.slice(0, MAX_ISSUES).map((issue) => ({ path: safePath(issue.path, fields, prefix), code: issue.code })) } });
  throw result.error;
}

export function parseChatGptAnswerText<T>(schema: z.ZodType<T>, text: string, usage?: TokenUsage): T {
  try {
    return parseChatGptAnswerSchema(schema, decodeChatGptJson(text, "answer_json"), "answer_schema");
  } catch (error) {
    attachChatGptAnswerUsage(error, usage);
    throw error;
  }
}
