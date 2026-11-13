import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";

export const OPENAI_DECISIONS_MODEL = "gpt-6-luna";
const DECISIONS_URL = "https://api.openai.com/v1/decisions";
const MAX_EVIDENCE_BYTES = 256 * 1024;
const probability = z.number().finite().min(0).max(1);
const choiceValue = z.union([z.string().max(300), z.boolean()]);
const MAX_QUESTION_JSON_BYTES = 32 * 1024;
const imageSchema = z.object({ mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z.string().max(3 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/), detail: z.enum(["low", "high", "auto"]).optional(),
}).strict();
/** A question's own evidence (TI-704): its words, a JSON of its own and an image of its own, in this order. */
const partSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(8000) }).strict(),
  z.object({ type: z.literal("json"), data: z.record(z.string(), z.unknown()) }).strict()
    .refine((part) => Buffer.byteLength(JSON.stringify(part.data), "utf8") <= MAX_QUESTION_JSON_BYTES, "Le contexte d’une question Decisions est trop volumineux."),
  z.object({ type: z.literal("image"), image: imageSchema }).strict(),
]);
const instructionsSchema = z.union([z.string().min(1).max(8000), z.array(partSchema).min(1).max(4)
  .refine((parts) => parts[0]?.type === "text", "Une question Decisions commence par ses mots.")]);
const questionBase = { name: z.string().min(1).max(160), instructions: instructionsSchema };
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
export type OpenAiDecisionQuestionPart = z.infer<typeof partSchema>;
/** `detail` (TI-704): how finely the model reads it; the provider's default without it. */
export type OpenAiDecisionImage = { mimeType: "image/png" | "image/jpeg" | "image/webp"; data: string; detail?: "low" | "high" | "auto" };
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
  /**
   * Validated probability of each option of an answered choice or score (TI-661).
   * Choice: the option's value; score: the level index, its label in question.levels.
   */
  probabilities?: { value: string | boolean | number; probability: number }[];
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
      return { ...emptyAnswer(question, "answered"), value: result.data.choice, confidence: result.data.confidence,
        probabilities: result.data.probabilities.map(({ value, probability: share }) => ({ value, probability: share })) };
    }
    const result = z.object({ type: z.literal("score"), score: z.number().finite().min(0).max(question.levels.length - 1),
      confidence: probability, probabilities: z.array(z.object({ label: z.string(), value: z.number().int(), probability })).max(10),
    }).safeParse(answer);
    if (!result.success || result.data.probabilities.some((entry) => question.levels[entry.value]?.label !== entry.label) ||
        new Set(result.data.probabilities.map((entry) => entry.value)).size !== result.data.probabilities.length) {
      return emptyAnswer(question, "invalid");
    }
    return { ...emptyAnswer(question, "answered"), value: result.data.score, confidence: result.data.confidence,
      probabilities: result.data.probabilities.map(({ value, probability: share }) => ({ value, probability: share })) };
  });
}

/** Shared images of a call, and every image of its questions with them, at most (TI-704: legend blocks, a group's own image). */
export const OPENAI_DECISIONS_IMAGE_LIMITS = { shared: 6, total: 40, base64Bytes: 12 * 1024 * 1024 } as const;
const DEFAULT_TIMEOUT_MS = 20_000;

const asImagePart = (image: OpenAiDecisionImage) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}`,
  ...(image.detail ? { detail: image.detail } : {}) });

/** The provider's form of a question: its instructions as given, or its parts as content parts. */
function providerQuestion(question: OpenAiDecisionQuestion) {
  if (typeof question.instructions === "string") return question;
  return { ...question, instructions: question.instructions.map((part) => (part.type === "text" ? { type: "input_text", text: part.text }
    : part.type === "json" ? { type: "input_json", data: part.data } : asImagePart(part.image))) };
}

const imagesOf = (question: OpenAiDecisionQuestion) => (typeof question.instructions === "string" ? []
  : question.instructions.flatMap((part) => (part.type === "image" ? [part.image] : [])));
const imageHash = (image: OpenAiDecisionImage) => createHash("sha256").update(image.mimeType).update(image.detail ?? "").update(image.data).digest("hex");

/**
 * Internal adapter only. Routes must authorize and construct these fixed questions. `developer`: the instructions of
 * the task, before the evidence (TI-704); `timeoutMs`: at most 60 s, 20 s by default.
 */
export async function callOpenAiDecisions(input: {
  owner: ChatGptOwner;
  context: { tenantId: string; projectId: string; preparationFingerprint: string };
  evidence: Record<string, unknown>;
  images?: OpenAiDecisionImage[];
  questions: OpenAiDecisionQuestion[];
  developer?: string;
  timeoutMs?: number;
}): Promise<OpenAiDecisionsResult> {
  if (!input.owner.userId || !input.owner.tenantId || input.owner.tenantId !== input.context.tenantId) {
    throw new Error("Le contexte Decisions n’appartient pas au tenant autorisé.");
  }
  const questions = z.array(questionSchema).min(1).max(400).parse(input.questions);
  if (new Set(questions.map((question) => question.name)).size !== questions.length || questions.some((question) =>
    question.type === "choice" && new Set(question.choices.map((choice) => choice.value)).size !== question.choices.length)) {
    throw new Error("Les questions et les choix Decisions doivent être uniques.");
  }
  const developer = input.developer === undefined ? null : z.string().min(1).max(8000).parse(input.developer);
  const timeoutMs = Math.min(60_000, Math.max(1_000, Math.floor(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)));
  const evidence = JSON.stringify(input.evidence);
  if (Buffer.byteLength(evidence, "utf8") > MAX_EVIDENCE_BYTES) throw new Error("Le contexte Decisions est trop volumineux.");
  const images = z.array(imageSchema).max(OPENAI_DECISIONS_IMAGE_LIMITS.shared).parse(input.images ?? []);
  const questionImages = questions.flatMap(imagesOf);
  if (images.length + questionImages.length > OPENAI_DECISIONS_IMAGE_LIMITS.total
    || [...images, ...questionImages].reduce((bytes, image) => bytes + image.data.length, 0) > OPENAI_DECISIONS_IMAGE_LIMITS.base64Bytes) {
    throw new Error("Les aperçus Decisions dépassent la taille autorisée.");
  }
  const capability = getOpenAiDecisionsCapability();
  const provenance: OpenAiDecisionsResult["provenance"] = {
    tenant_id: input.owner.tenantId, project_id: input.context.projectId,
    preparation_fingerprint: input.context.preparationFingerprint,
    request_fingerprint: createHash("sha256").update(JSON.stringify({
      tenant: input.owner.tenantId, user: input.owner.userId, context: input.context, evidence,
      // A question's images by their hash, as the shared ones: the fingerprint never holds image data.
      questions: questions.map((question) => (typeof question.instructions === "string" ? question : { ...question,
        instructions: question.instructions.map((part) => (part.type === "image" ? { type: "image", image_hash: imageHash(part.image) } : part)) })),
      ...(images.length ? { image_hashes: images.map(imageHash) } : {}),
      ...(developer ? { developer } : {}),
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
        input: [
          ...(developer ? [{ role: "developer", content: [{ type: "input_text", text: developer }] }] : []),
          { role: "user", content: [{ type: "input_json", data: input.evidence }, ...images.map(asImagePart)] },
        ],
        questions: questions.map(providerQuestion),
        // Partition provider caching by both tenant and user; never cache results across tenants.
        prompt_cache_key: createHash("sha256").update(`${input.owner.tenantId}:${input.owner.userId}`).digest("hex"),
      }),
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
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
