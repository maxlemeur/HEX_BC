import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import {
  assertLocalChatGptOverride, callLocalChatGptStructured, listLocalChatGptModels, type LocalChatGptOverride, type LocalChatGptRawResult,
} from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import { callOpenAiDecisions, getOpenAiDecisionsCapability, OPENAI_DECISIONS_MODEL, type OpenAiDecisionAnswer, type OpenAiDecisionQuestion, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { badRequest, conflict, notFound } from "@/lib/estimates/errors";
import { classifyCallError, describeError } from "@/lib/takeoff/bench/run";
import { TAKEOFF_C_TIMEOUT_MS_DEFAULT } from "@/lib/takeoff/constants";
import {
  LAB_CONFIG_IDS, LAB_VECTOR_TASK_ID, type LabAnswer, type LabConfigInput, type LabConfigResult, type LabDecisionsBudget, type LabElement,
  type LabRun, type LabRunRequest, type LabRunSummary, type LabStopReason, type LabUsage,
} from "@/lib/takeoff/lab/contracts";
import { cropLabPdf } from "@/lib/takeoff/lab/crop";
import { assertCropPage, readLabDocument, readLabTruth } from "@/lib/takeoff/lab/dataset";
import { assertNormalizedBox } from "@/lib/takeoff/lab/geometry";
import { scoreLabExtraction } from "@/lib/takeoff/lab/score";
import {
  canonicalJson, elementIdOf, listJsonFiles, outputSubdirectory, readDecisionsTokenCap, readLabJson, requireLabPaths, runFile,
  sha256Hex, writeLabJson, type LabPaths,
} from "@/lib/takeoff/lab/storage";
import { findLabTask, vectorGroupsQuestionTemplate, type LabTask } from "@/lib/takeoff/lab/tasks";
import { runVectorGroupsConfig } from "@/lib/takeoff/lab/vectors";
import { isDecisionsRunStop } from "@/lib/takeoff/vectors/group-decisions-server";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { TakeoffExchange } from "@/lib/takeoff/types";

// One essai of the takeoff lab (TI-661): a document (whole PDF, or one page
// cropped with pdf-lib), one task, one to four configurations run one after the
// other, each timed by the lab's clock. ChatGPT gets its model and effort as an
// `override` (TI-660), checked first against listLocalChatGptModels with a
// profile that already has a model (that function would otherwise write the
// default one); the profile itself is never written. A schema failure is an
// answer (raw text, error, tokens, one element to judge); a quota or a rate
// limit stops the essai at once, without retry, as do authorisation and account
// errors; a timeout or a rejected request fails its configuration only.
// Decisions runs within TAKEOFF_LAB_DECISIONS_MAX_TOKENS, counted from the
// stored runs once the single-essai lock is taken (no other essai can still
// write its usage); a failed call stops the essai. The run is written atomically,
// stopped or not, before it is returned.
// « Classe de calque » (vectors.ts) is one Decisions configuration on a whole
// page: no browser image, no zone, its fixed questions; its calls stop at the
// first failure or at the cap's remainder, and its usage is their sum.

export type LabAccess = { owner: ChatGptOwner; email: string | null };

const RunFileSchema = z.looseObject({ schema_version: z.literal(1), id: z.string(), campaign: z.string(), configs: z.array(z.unknown()) });

function newRunId(now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-").toLowerCase();
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function usageOf(usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number }): LabUsage {
  return { input: usage.inputTokens, output: usage.outputTokens, reasoning: usage.reasoningTokens, total: usage.totalTokens };
}

function choiceLabel(task: LabTask, value: unknown) {
  return task.question?.choices.find((choice) => choice.value === value)?.label ?? String(value);
}

function labAnswer(task: LabTask, answer: OpenAiDecisionAnswer): LabAnswer {
  const probabilities = answer.probabilities?.map((entry) => ({
    value: String(entry.value), label: choiceLabel(task, entry.value), probability: entry.probability,
  })).sort((left, right) => right.probability - left.probability) ?? null;
  return {
    name: answer.name, label: task.question?.label ?? answer.name, status: answer.status,
    value: answer.value === null ? null : String(answer.value), value_label: answer.value === null ? null : choiceLabel(task, answer.value),
    confidence: answer.confidence, probabilities,
  };
}

function extractionElements(runId: string, configId: string, exchange: TakeoffExchange): LabElement[] {
  return exchange.items.map((item, index) => ({
    id: elementIdOf(runId, configId, "item", index), kind: "item", key: index, label: item.designation,
    detail: `${item.quantity} ${item.unit}`, source_page: item.source_page ?? null, evidence: item.evidence ?? null,
    schema_error: false, answer: null, json: item,
  }));
}

function answerElements(runId: string, configId: string, answers: LabAnswer[]): LabElement[] {
  return answers.map((answer) => ({
    id: elementIdOf(runId, configId, "question", answer.name), kind: "question", key: answer.name, label: answer.label,
    detail: answer.value_label ?? `Réponse ${answer.status === "refused" ? "refusée" : answer.status === "missing" ? "manquante" : "invalide"}`,
    source_page: null, evidence: null, schema_error: false, answer, json: answer,
  }));
}

/** An answer that failed its schema is one element: the person judges the output as given. */
function schemaErrorElement(runId: string, configId: string, kind: "item" | "question", key: number | string, raw: string, message: string): LabElement {
  let json: unknown = raw;
  try { json = JSON.parse(raw); } catch { /* Not JSON: shown as text. */ }
  return { id: elementIdOf(runId, configId, kind, key), kind, key, label: "Erreur de schéma", detail: message,
    source_page: null, evidence: null, schema_error: true, answer: null, json };
}

function schemaIssues(error: SyntaxError | z.ZodError) {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 20).map((issue) => `${issue.path.length ? issue.path.join(".") : "(racine)"} : ${issue.message}`);
  }
  return [`JSON invalide : ${error.message.slice(0, 200)}`];
}

function choiceQuestion(task: LabTask, instructions: string): OpenAiDecisionQuestion {
  const question = task.question!;
  return { type: "choice", name: question.name, instructions,
    choices: question.choices.map((choice) => ({ value: choice.value, ...(choice.description ? { description: choice.description } : {}) })) };
}

function chatGptChoicePrompt(task: LabTask, instructions: string) {
  const question = task.question!;
  return [instructions, "", "Choix possibles (valeur : libellé) :",
    ...question.choices.map((choice) => `- ${choice.value} : ${choice.label}`), "",
    "Réponds avec un objet JSON { \"choix\": une des valeurs ci-dessus, \"confiance\": probabilité entre 0 et 1 }."].join("\n");
}

function chatGptChoiceSchema(task: LabTask) {
  const values = task.question!.choices.map((choice) => choice.value) as [string, ...string[]];
  return z.object({ choix: z.enum(values), confiance: z.number().finite().min(0).max(1) }).strict();
}

// ---------------------------------------------------------------------------
// Stored runs and the Decisions budget

export async function listLabRuns(paths: LabPaths): Promise<LabRun[]> {
  const files = await listJsonFiles(outputSubdirectory(paths, "runs"));
  const runs = await Promise.all(files.filter((file) => /\/lab-[a-z0-9-]+\.json$/.test(file))
    .map((file) => readLabJson(file, (value) => RunFileSchema.parse(value) as unknown as LabRun, paths.outputDir)));
  return runs.sort((left, right) => (left.created_at < right.created_at ? 1 : left.created_at > right.created_at ? -1 : 0));
}

export async function readLabRun(paths: LabPaths, runId: string): Promise<LabRun> {
  const file = runFile(paths, runId);
  const runs = await listJsonFiles(outputSubdirectory(paths, "runs"));
  if (!runs.includes(file)) throw notFound("Essai introuvable.");
  return readLabJson(file, (value) => RunFileSchema.parse(value) as unknown as LabRun, paths.outputDir);
}

export function summarizeLabRun(run: LabRun): LabRunSummary {
  return {
    id: run.id, created_at: run.created_at, campaign: run.campaign, task: run.task, document: run.document, crop: run.crop,
    prompt_version: run.prompt.version, status: run.status,
    configs: run.configs.map((config) => ({
      id: config.id, provider: config.provider, model: config.model, reasoning_effort: config.reasoning_effort, status: config.status,
      latency_ms: config.latency_ms, usage: config.usage, score: config.score, elements: config.elements.length,
    })),
  };
}

const VectorCallLogSchema = z.looseObject({ calls: z.array(z.looseObject({ usage: z.unknown() })) });

/** Calls of a « classe de calque » configuration sent without usage, from its call log; null when the log is unreadable. */
function vectorCallsWithoutUsage(raw: string | null) {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  const parsed = VectorCallLogSchema.safeParse(value);
  return parsed.success ? parsed.data.calls.filter((call) => call.usage === null || call.usage === undefined).length : null;
}

/**
 * Total tokens of every Decisions call stored in the output run; calls without usage counted apart: one per
 * configuration (one call each), or, for « classe de calque » (none to many calls), those of its call log.
 */
export function decisionsBudget(runs: readonly LabRun[], cap: number | null): LabDecisionsBudget {
  let used = 0;
  let withoutUsage = 0;
  for (const run of runs) {
    for (const config of run.configs) {
      if (config.provider !== "decisions" || config.status === "not_run") continue;
      if (config.usage) used += config.usage.total;
      const logged = run.task.id === LAB_VECTOR_TASK_ID ? vectorCallsWithoutUsage(config.raw) : null;
      if (logged !== null) withoutUsage += logged;
      else if (!config.usage) withoutUsage += 1;
    }
  }
  return { cap, used, remaining: cap === null ? null : Math.max(0, cap - used), calls_without_usage: withoutUsage };
}

// ---------------------------------------------------------------------------
// Pre-flight: everything that can be refused is refused before the first call.

function checkConfigs(task: LabTask, configs: readonly LabConfigInput[]) {
  const seen = new Set<string>();
  for (const config of configs) {
    if (!task.providers.includes(config.provider)) throw badRequest(`La tâche « ${task.label} » ne se lance pas sur ${config.provider === "decisions" ? "Decisions" : "ChatGPT"}.`);
    const key = config.provider === "decisions" ? "decisions" : `${config.model}\u0000${config.reasoningEffort ?? "auto"}`;
    if (seen.has(key)) throw badRequest("Deux configurations identiques : changez le modèle ou l’effort.");
    seen.add(key);
  }
}

function overrideKey(model: string, effort: string | null) {
  return `${model}\u0000${effort ?? "auto"}`;
}

/**
 * Checks every ChatGPT configuration before the first call and returns the frozen overrides of
 * assertLocalChatGptOverride: callLocalChatGptStructured then sends them without listing the models
 * again, so the lab's latency is the answer's, not a /models round trip.
 */
type LabChatGptPreflight = {
  overrides: Map<string, Readonly<LocalChatGptOverride>>;
  /**
   * The profile checked before the first call, passed to every call of the essai: a profile switched
   * in another tab during the run then stops it (« … a changé », selection_changed) instead of
   * silently sending the next configurations with another account.
   */
  selection: { profileId: string; model: string; reasoningEffort: ChatGptReasoningEffort | null } | undefined;
};

async function preflightChatGpt(owner: ChatGptOwner, configs: readonly Extract<LabConfigInput, { provider: "chatgpt" }>[]): Promise<LabChatGptPreflight> {
  const checked = new Map<string, Readonly<LocalChatGptOverride>>();
  if (configs.length === 0) return { overrides: checked, selection: undefined };
  const fail = (error: unknown): never => { throw conflict(describeError(error).message, undefined, "TAKEOFF_LAB_CHATGPT"); };
  const credential = await getLocalChatGptCredential(owner).catch(fail);
  if (!credential) throw conflict("Connectez votre compte ChatGPT dans Mon profil.", undefined, "TAKEOFF_LAB_CHATGPT");
  // Without a profile model, listLocalChatGptModels would write the default one: the lab never writes the profile.
  if (!credential.model) throw conflict("Choisissez un modèle ChatGPT dans Mon profil : le labo ne modifie jamais le profil.", undefined, "TAKEOFF_LAB_CHATGPT");
  const models = await listLocalChatGptModels(owner).catch(fail);
  const unavailable = configs.filter((config) => {
    const model = models.find((entry) => entry.id === config.model);
    return !model || (config.reasoningEffort !== null && !model.reasoningEfforts.includes(config.reasoningEffort));
  });
  if (unavailable.length > 0) {
    throw badRequest(`Indisponible pour ce compte ChatGPT : ${unavailable.map((config) => `${config.model} · ${config.reasoningEffort ?? "auto"}`).join(", ")}.`);
  }
  for (const config of configs) {
    const override = await assertLocalChatGptOverride(owner, credential, { model: config.model, reasoningEffort: config.reasoningEffort }).catch(fail);
    checked.set(overrideKey(config.model, config.reasoningEffort), override);
  }
  return { overrides: checked, selection: { profileId: credential.profileId, model: credential.model, reasoningEffort: credential.reasoningEffort ?? null } };
}

/** Refuses a Decisions essai that cannot run; returns the tokens the cap still allows. */
async function preflightDecisions(paths: LabPaths, request: LabRunRequest, task: LabTask) {
  const capability = getOpenAiDecisionsCapability();
  if (capability.status !== "available") throw conflict(capability.message, undefined, "TAKEOFF_LAB_DECISIONS");
  const cap = readDecisionsTokenCap();
  if (cap === null) throw conflict("TAKEOFF_LAB_DECISIONS_MAX_TOKENS doit être un entier positif.", undefined, "TAKEOFF_LAB_DECISIONS");
  const budget = decisionsBudget(await listLabRuns(paths), cap);
  if (budget.used >= cap) {
    throw conflict(`Plafond Decisions atteint : ${budget.used} jetons sur ${cap}. Thanh peut relever TAKEOFF_LAB_DECISIONS_MAX_TOKENS.`, undefined, "TAKEOFF_LAB_DECISIONS_CAP");
  }
  // « Classe de calque » draws its own images on the server (group-evidence-render-server.ts): no browser image.
  if (task.id !== LAB_VECTOR_TASK_ID && !request.image) throw badRequest("Decisions a besoin de l’image de la page ou de la zone : rechargez le document.");
  return cap - budget.used;
}

// ---------------------------------------------------------------------------
// The essai

const STOP_MESSAGES: Record<LabStopReason, string> = {
  quota: "Limite du forfait ChatGPT : essai arrêté, sans relance.",
  rate_limit: "ChatGPT limite les demandes : essai arrêté, sans relance.",
  auth_required: "Accès ChatGPT refusé : reconnectez le compte dans Mon profil.",
  account_missing: "Compte ChatGPT absent : essai arrêté.",
  model_missing: "Modèle ChatGPT indisponible : essai arrêté.",
  selection_changed: "Le profil ChatGPT a changé pendant l’essai : essai arrêté.",
  decisions_failed: "Decisions a échoué : essai arrêté, sans relance.",
  other: "Erreur du fournisseur : essai arrêté, sans relance.",
};

let running = false;

export async function executeLabRun(access: LabAccess, request: LabRunRequest, clock: () => number = () => performance.now()): Promise<LabRun> {
  const paths = await requireLabPaths();
  const task = findLabTask(request.taskId);
  if (!task) throw badRequest("Tâche inconnue.");
  checkConfigs(task, request.configs);
  if (request.prompt.length > task.promptMax) throw badRequest(`Le prompt dépasse ${task.promptMax} caractères.`);
  const document = await readLabDocument(request.documentId);
  if (request.crop) {
    assertCropPage(document, request.crop.page);
    if (request.crop.box) {
      try { assertNormalizedBox(request.crop.box); } catch (error) { throw badRequest(describeError(error).message); }
    }
  }
  // A one-page document read whole is the whole PDF: scored like it.
  const crop = request.crop && (request.crop.box || document.summary.pages > 1) ? request.crop : null;
  const chatgpt = request.configs.filter((config): config is Extract<LabConfigInput, { provider: "chatgpt" }> => config.provider === "chatgpt");
  const decisions = request.configs.some((config) => config.provider === "decisions");
  // Decisions sees one rendered page: on a multi-page document the essai names it, for every configuration.
  if (decisions && document.summary.pages > 1 && !crop) {
    throw badRequest("Decisions lit une seule page : cochez « Seulement la page » ou tracez une zone.");
  }
  if (task.id === LAB_VECTOR_TASK_ID) {
    if (crop?.box) throw badRequest("La classe de calque se lit sur une page entière : effacez la zone.");
    if (request.prompt !== task.defaultPrompt) throw badRequest("Les questions de la classe de calque sont fixées par la lecture vectorielle : le prompt ne se modifie pas.");
  }
  // The lock comes before the pre-flights: the Decisions remainder is read once no other essai can still write its usage.
  if (running) throw conflict("Un essai est déjà en cours : attendez sa fin.", undefined, "TAKEOFF_LAB_BUSY");
  running = true;
  try {
    const chatGptPreflight = await preflightChatGpt(access.owner, chatgpt);
    const decisionsRemaining = decisions ? await preflightDecisions(paths, request, task) : null;
    return await runEssai(paths, access, request, task, document, crop, chatGptPreflight, decisionsRemaining, clock);
  } finally {
    running = false;
  }
}

async function runEssai(paths: LabPaths, access: LabAccess, request: LabRunRequest, task: LabTask,
  document: Awaited<ReturnType<typeof readLabDocument>>, crop: LabRunRequest["crop"],
  { overrides, selection }: LabChatGptPreflight, decisionsRemaining: number | null, clock: () => number): Promise<LabRun> {
  const now = new Date();
  const runId = newRunId(now);
  const vectors = task.id === LAB_VECTOR_TASK_ID;
  // The vector task reads the page itself (extraction, server-rendered images): no cropped PDF.
  const pdfBase64 = vectors ? "" : Buffer.from(crop ? await cropLabPdf(document.bytes, crop) : document.bytes).toString("base64");
  const question = task.kind === "choice" && !vectors ? choiceQuestion(task, request.prompt) : null;
  // Its questions are group-decisions.ts's: the version hashes their template, never one page's group names.
  const promptSha = vectors ? sha256Hex(canonicalJson(vectorGroupsQuestionTemplate()))
    : question ? sha256Hex(canonicalJson([question])) : sha256Hex(request.prompt);
  const promptVersion = task.promptBase ? `${task.promptBase}+${promptSha}` : promptSha;
  const truth = task.kind === "extraction" && !crop && document.summary.source === "dataset"
    ? await readLabTruth(paths.datasetDir, document.summary.id) : null;
  const run: LabRun = {
    schema_version: 1, id: runId, created_at: now.toISOString(),
    author: { user_id: access.owner.userId, email: access.email },
    campaign: request.campaign, task: { id: task.id, kind: task.kind, label: task.label },
    document: { id: document.summary.id, source: document.summary.source, sha256: document.sha256, pages: document.summary.pages },
    crop, prompt: { text: request.prompt, base: task.promptBase, sha256: promptSha, version: promptVersion },
    status: "complete", stop: null, configs: [],
  };

  for (const [index, input] of request.configs.entries()) {
    const id = LAB_CONFIG_IDS[index];
    const base: LabConfigResult = {
      id, provider: input.provider, model: input.provider === "decisions" ? OPENAI_DECISIONS_MODEL : input.model,
      reasoning_effort: input.provider === "decisions" ? null : input.reasoningEffort, status: "not_run", message: null,
      latency_ms: null, usage: null, raw: null, schema_error: null, answers: null, score: null, elements: [],
    };
    if (run.stop) {
      run.configs.push({ ...base, message: `Non lancée : ${run.stop.message}` });
      continue;
    }
    if (input.provider === "decisions" && vectors) {
      const { stop, ...result } = await runVectorGroupsConfig({ access, runId, configId: id, task, document, page: crop?.page ?? 1, promptVersion,
        remainingTokens: decisionsRemaining ?? 0 });
      run.configs.push({ ...base, ...result });
      if (stop && isDecisionsRunStop(stop.reason)) {
        run.stop = { reason: "decisions_failed", message: stop.reason === "budget_reached" ? stop.message : STOP_MESSAGES.decisions_failed };
      }
      continue;
    }
    if (input.provider === "decisions") {
      const startedAt = clock();
      const result: OpenAiDecisionsResult = await callOpenAiDecisions({
        owner: access.owner,
        context: { tenantId: access.owner.tenantId, projectId: "takeoff-lab", preparationFingerprint: sha256Hex(`${document.sha256}\u0000${task.id}\u0000${promptVersion}`) },
        evidence: task.evidence?.({ documentId: document.summary.id, pages: document.summary.pages, page: crop?.page ?? 1, region: Boolean(crop?.box) }) ?? {},
        images: request.image ? [request.image] : [],
        questions: [question!],
      });
      const latency = Math.round(clock() - startedAt);
      const usage = result.provenance.usage;
      const answers = result.answers.map((answer) => labAnswer(task, answer));
      const failed = result.status === "failed" || result.status === "unavailable";
      run.configs.push({
        ...base, status: failed ? "failed" : result.status === "partial" ? "partial" : "ok",
        message: result.status === "available" ? null : result.message, latency_ms: latency,
        usage: usage ? { input: usage.input_tokens, output: usage.output_tokens, reasoning: 0, total: usage.total_tokens } : null,
        raw: JSON.stringify(result, null, 2), answers, elements: failed ? [] : answerElements(runId, id, answers),
      });
      if (failed) run.stop = { reason: "decisions_failed", message: STOP_MESSAGES.decisions_failed };
      continue;
    }
    const override = overrides.get(overrideKey(input.model, input.reasoningEffort))!;
    const files = [{ data: pdfBase64, mimeType: "application/pdf" as const }];
    const startedAt = clock();
    try {
      if (task.kind === "extraction") {
        const answer: LocalChatGptRawResult<TakeoffExchange> = await callLocalChatGptStructured(access.owner, {
          prompt: request.prompt, schema: TakeoffExchangeSchema, files, timeoutMs: TAKEOFF_C_TIMEOUT_MS_DEFAULT,
          context: { level: "C", promptVersion: task.promptBase ?? undefined },
        }, selection, override, { returnRawOnSchemaError: true });
        const result = { ...base, model: answer.model, reasoning_effort: answer.reasoningEffort, latency_ms: Math.round(clock() - startedAt),
          usage: usageOf(answer.tokenUsage), raw: answer.rawText };
        if (answer.schemaError) {
          const issues = schemaIssues(answer.schemaError);
          run.configs.push({ ...result, status: "schema_error", message: `Erreur de schéma : ${issues[0]}`,
            schema_error: { name: answer.schemaError.name, issues }, elements: [schemaErrorElement(runId, id, "item", 0, answer.rawText, issues[0])] });
        } else {
          run.configs.push({ ...result, status: "ok", score: scoreLabExtraction(document.summary.id, truth, answer.data.items),
            elements: extractionElements(runId, id, answer.data) });
        }
      } else {
        const answer = await callLocalChatGptStructured(access.owner, {
          prompt: chatGptChoicePrompt(task, request.prompt), schema: chatGptChoiceSchema(task), files, timeoutMs: 120_000,
        }, selection, override, { returnRawOnSchemaError: true });
        const result = { ...base, model: answer.model, reasoning_effort: answer.reasoningEffort, latency_ms: Math.round(clock() - startedAt),
          usage: usageOf(answer.tokenUsage), raw: answer.rawText };
        const name = task.question!.name;
        if (answer.schemaError) {
          const issues = schemaIssues(answer.schemaError);
          run.configs.push({ ...result, status: "schema_error", message: `Erreur de schéma : ${issues[0]}`,
            schema_error: { name: answer.schemaError.name, issues }, elements: [schemaErrorElement(runId, id, "question", name, answer.rawText, issues[0])] });
        } else {
          const labeled: LabAnswer = { name, label: task.question!.label, status: "answered", value: answer.data.choix,
            value_label: choiceLabel(task, answer.data.choix), confidence: answer.data.confiance, probabilities: null };
          run.configs.push({ ...result, status: "ok", answers: [labeled], elements: answerElements(runId, id, [labeled]) });
        }
      }
    } catch (error) {
      const outcome = classifyCallError(error);
      const described = describeError(error);
      run.configs.push({ ...base, status: "failed", latency_ms: Math.round(clock() - startedAt), message: described.message });
      if (outcome.outcome === "stop") {
        const reason: LabStopReason = outcome.reason === "bench_error" ? "other" : outcome.reason;
        run.stop = { reason, message: STOP_MESSAGES[reason] };
      }
    }
  }
  if (run.stop) run.status = "stopped";
  await writeLabJson(runFile(paths, runId), run);
  return run;
}
