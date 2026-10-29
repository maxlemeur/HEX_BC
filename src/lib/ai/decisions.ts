import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";
const DECISIONS_URL = "https://api.openai.com/v1/decisions";
const MAX_EVIDENCE_BYTES = 256 * 1024;
const probability = z.number().finite().min(0).max(1);
const choiceValue = z.union([z.string().max(300), z.boolean()]);
const questionBase = { name: z.string().min(1).max(160), instructions: z.string().min(1).max(8000) };
const questionSchema = z.discriminatedUnion("type", [
  z.object({ ...questionBase, type: z.literal("predicate") }).strict(),
  z.object({ ...questionBase, type: z.literal("choice"), choices: z.array(z.object({
    value: choiceValue, description: z.string().max(1000).optional(),
  }).strict()).min(2).max(255) }).strict(),
  z.object({ ...questionBase, type: z.literal("score"), levels: z.array(z.object({
    label: z.string().min(1).max(160), description: z.string().max(1000).optional(),
  }).strict()).min(2).max(10) }).strict(),
]);

export type OpenAiDecisionQuestion = z.infer<typeof questionSchema>;
export type OpenAiDecisionsCapability = {
  status: "disabled" | "not_configured" | "available";
  model: typeof OPENAI_DECISIONS_MODEL;
  billing: "separate_api";
  message: string;
};
export type OpenAiDecisionAnswer = {
  name: string;
  type: OpenAiDecisionQuestion["type"];
  status: "answered" | "refused" | "missing" | "invalid";
  value: string | boolean | number | null;
  confidence: number | null;
};
export type OpenAiDecisionsResult = {
  status: "available" | "partial" | "unavailable" | "failed";
  capability: OpenAiDecisionsCapability;
  message: string;
  answers: OpenAiDecisionAnswer[];
  provenance: {
    tenant_id: string;
    project_id: string;
    preparation_fingerprint: string;
    request_fingerprint: string;
    model: string;
    requested_at: string;
    usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  };
};

/** Configuration is explicit; ChatGPT subscription tokens are never used here. */
export function getOpenAiDecisionsCapability(): OpenAiDecisionsCapability {
  const base = { model: OPENAI_DECISIONS_MODEL, billing: "separate_api" } as const;
  if (process.env.MERGEONE_OPENAI_DECISIONS !== "1") return {
    ...base, status: "disabled", message: "Le classement Decisions est désactivé. La préparation manuelle reste disponible.",
  };
  if (!process.env.OPENAI_DECISIONS_API_KEY?.trim()) return {
    ...base, status: "not_configured", message: "L’accès API Decisions n’est pas configuré côté serveur. Le forfait ChatGPT ne l’active pas.",
  };
  return { ...base, status: "available", message: "Decisions configuré : consommation API distincte du forfait ChatGPT, accès à confirmer lors de la demande." };
}

function emptyAnswer(question: OpenAiDecisionQuestion, status: OpenAiDecisionAnswer["status"]): OpenAiDecisionAnswer {
  return { name: question.name, type: question.type, status, value: null, confidence: null };
}

/** Validate each answer independently: one refusal must not discard other answers. */
export function parseOpenAiDecisionAnswers(questions: OpenAiDecisionQuestion[], payload: unknown): OpenAiDecisionAnswer[] {
  const parsed = z.object({ answers: z.array(z.unknown()) }).safeParse(payload);
  if (!parsed.success) return questions.map((question) => emptyAnswer(question, "invalid"));
  return questions.map((question) => {
    const matching = parsed.data.answers.filter((answer) =>
      typeof answer === "object" && answer !== null && "name" in answer && answer.name === question.name);
    if (matching.length === 0) return emptyAnswer(question, "missing");
    if (matching.length !== 1) return emptyAnswer(question, "invalid");
    const answer = matching[0];
    const refusal = z.object({ name: z.literal(question.name), type: z.literal("refusal") }).safeParse(answer);
    if (refusal.success) return emptyAnswer(question, "refused");
    if (question.type === "predicate") {
      const result = z.object({ type: z.literal("predicate"), probability }).safeParse(answer);
      return result.success ? { ...emptyAnswer(question, "answered"), value: result.data.probability } : emptyAnswer(question, "invalid");
    }
    if (question.type === "choice") {
      const result = z.object({ type: z.literal("choice"), choice: choiceValue, confidence: probability,
        probabilities: z.array(z.object({ value: choiceValue, probability })).max(255),
      }).safeParse(answer);
      if (!result.success) return emptyAnswer(question, "invalid");
      const allowed = question.choices.map((choice) => choice.value);
      const returned = result.data.probabilities.map((entry) => entry.value);
      if (!allowed.includes(result.data.choice) || returned.some((value) => !allowed.includes(value)) ||
          new Set(returned).size !== returned.length) return emptyAnswer(question, "invalid");
      return { ...emptyAnswer(question, "answered"), value: result.data.choice, confidence: result.data.confidence };
    }
    const result = z.object({ type: z.literal("score"), score: z.number().finite().min(0).max(question.levels.length - 1),
      confidence: probability, probabilities: z.array(z.object({ label: z.string(), value: z.number().int(), probability })).max(10),
    }).safeParse(answer);
    if (!result.success || result.data.probabilities.some((entry) => question.levels[entry.value]?.label !== entry.label) ||
        new Set(result.data.probabilities.map((entry) => entry.value)).size !== result.data.probabilities.length) {
      return emptyAnswer(question, "invalid");
    }
    return { ...emptyAnswer(question, "answered"), value: result.data.score, confidence: result.data.confidence };
  });
}

/** Internal adapter only. Routes must authorize and construct these fixed questions. */
export async function callOpenAiDecisions(input: {
  owner: ChatGptOwner;
  context: { tenantId: string; projectId: string; preparationFingerprint: string };
  evidence: Record<string, unknown>;
  questions: OpenAiDecisionQuestion[];
}): Promise<OpenAiDecisionsResult> {
  if (!input.owner.userId || !input.owner.tenantId || input.owner.tenantId !== input.context.tenantId) {
    throw new Error("Le contexte Decisions n’appartient pas au tenant autorisé.");
  }
  const questions = z.array(questionSchema).min(1).max(400).parse(input.questions);
  if (new Set(questions.map((question) => question.name)).size !== questions.length || questions.some((question) =>
    question.type === "choice" && new Set(question.choices.map((choice) => choice.value)).size !== question.choices.length)) {
    throw new Error("Les questions et les choix Decisions doivent être uniques.");
  }
  const evidence = JSON.stringify(input.evidence);
  if (Buffer.byteLength(evidence, "utf8") > MAX_EVIDENCE_BYTES) throw new Error("Le contexte Decisions est trop volumineux.");
  const capability = getOpenAiDecisionsCapability();
  const provenance: OpenAiDecisionsResult["provenance"] = {
    tenant_id: input.owner.tenantId, project_id: input.context.projectId,
    preparation_fingerprint: input.context.preparationFingerprint,
    request_fingerprint: createHash("sha256").update(JSON.stringify({
      tenant: input.owner.tenantId, user: input.owner.userId, context: input.context, evidence, questions,
    })).digest("hex"),
    model: OPENAI_DECISIONS_MODEL, requested_at: new Date().toISOString(), usage: null,
  };
  const unresolved = questions.map((question) => emptyAnswer(question, "missing"));
  if (capability.status !== "available") return { status: "unavailable", capability, message: capability.message, answers: unresolved, provenance };
  try {
    const response = await fetch(DECISIONS_URL, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_DECISIONS_API_KEY!.trim()}` },
      body: JSON.stringify({
        model: OPENAI_DECISIONS_MODEL,
        input: [{ role: "user", content: [{ type: "input_json", data: input.evidence }] }], questions,
        // Partition provider caching by both tenant and user; never cache results across tenants.
        prompt_cache_key: createHash("sha256").update(`${input.owner.tenantId}:${input.owner.userId}`).digest("hex"),
      }),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) return { status: "failed", capability, answers: unresolved, provenance,
      message: response.status === 429 ? "La limite API Decisions est atteinte. Continuez manuellement ou réessayez plus tard."
        : response.status === 401 || response.status === 403 ? "L’accès API Decisions est indisponible. Vérifiez sa configuration serveur."
        : "Decisions n’a pas répondu. La préparation reste disponible sans classement assisté.",
    };
    const payload: unknown = await response.json();
    const usage = z.object({ model: z.literal(OPENAI_DECISIONS_MODEL), usage: z.object({
      input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative(),
    }) }).safeParse(payload);
    if (!usage.success) return { status: "failed", capability, message: "La réponse Decisions est invalide. Les points restent à revoir.", answers: unresolved, provenance };
    provenance.usage = usage.data.usage;
    const answers = parseOpenAiDecisionAnswers(questions, payload);
    const complete = answers.every((answer) => answer.status === "answered");
    return { status: complete ? "available" : "partial", capability, answers, provenance,
      message: complete ? "Classement proposé à confirmer. Les réponses du modèle ne sont pas des preuves métier."
        : "Classement partiel : les réponses manquantes, invalides ou refusées restent à revoir.",
    };
  } catch {
    // No raw provider errors, automatic retries, or fallback to another billed API.
    return { status: "failed", capability, message: "La demande Decisions a échoué. Vos saisies sont conservées ; continuez manuellement.", answers: unresolved, provenance };
  }
}
