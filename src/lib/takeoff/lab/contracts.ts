import { z } from "zod";

import { chatGptReasoningEffortSchema, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";

// Contracts of the takeoff lab (TI-661), shared by its routes and its screens.
// The lab stores runs and verdicts as files under TAKEOFF_LAB_OUTPUT_DIR, never
// in the database: names below become path segments, hence [a-z0-9-] only.

/** Campaigns, runs, tasks and document ids: lowercase letters, digits and inner dashes, at most 80 characters. */
export const LAB_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
/** Reason a campaign name is refused, shown next to the field and on the launch button. */
export const LAB_CAMPAIGN_ERROR = "Nom de campagne : lettres minuscules, chiffres et tirets.";
export const LabNameSchema = z.string().regex(LAB_NAME_PATTERN, "Nom invalide : lettres minuscules, chiffres et tirets.");
/** sha256 hex of JSON.stringify([runId, configId, "item" | "question", index | name]). */
export const ELEMENT_ID_PATTERN = /^[0-9a-f]{64}$/;
export const ElementIdSchema = z.string().regex(ELEMENT_ID_PATTERN, "Identifiant d’élément invalide.");

/**
 * Layout of TAKEOFF_LAB_DATASET_DIR: the L0 manifest (TI-659) and its PDF binaries,
 * plus, for a fictional dataset, a truth by lines read by evaluateTakeoffBenchmark.
 */
export const LAB_DATASET_LAYOUT = {
  manifest: "manifest.json",
  raw: (id: string) => `raw/${id}.pdf`,
  lineTruth: (id: string) => `lab/truth/${id}.json`,
} as const;

export const LAB_MAX_CONFIGS = 4;
export const LAB_CONFIG_IDS = ["A", "B", "C", "D"] as const;
export type LabConfigId = (typeof LAB_CONFIG_IDS)[number];
/** Decisions limits (src/lib/ai/decisions.ts), checked before any call. */
export const DECISIONS_INSTRUCTIONS_MAX = 8000;
export const DECISIONS_IMAGE_BASE64_MAX = 3 * 1024 * 1024;
export const EXTRACTION_PROMPT_MAX = 50_000;

export type LabProvider = "chatgpt" | "decisions";
export type LabTaskKind = "extraction" | "choice";

export const LabConfigInputSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("chatgpt"), model: z.string().trim().min(1).max(200), reasoningEffort: chatGptReasoningEffortSchema.nullable() }).strict(),
  z.object({ provider: z.literal("decisions") }).strict(),
]);
export type LabConfigInput = z.infer<typeof LabConfigInputSchema>;

export const LabBoxSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().gt(0).max(1),
  height: z.number().finite().gt(0).max(1),
}).strict();
/** One page of the document, optionally a region of it drawn on the displayed page; null: the whole PDF. */
export const LabCropSchema = z.object({ page: z.number().int().min(1).max(10_000), box: LabBoxSchema.nullable() }).strict();
export type LabCrop = z.infer<typeof LabCropSchema>;

export const LabImageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  data: z.string().min(1).max(DECISIONS_IMAGE_BASE64_MAX, "L’image dépasse 3 Mio en base64.").regex(/^[A-Za-z0-9+/]+={0,2}$/, "Image base64 invalide."),
}).strict();

export const LabRunRequestSchema = z.object({
  documentId: LabNameSchema,
  campaign: LabNameSchema,
  taskId: LabNameSchema,
  crop: LabCropSchema.nullable(),
  prompt: z.string().trim().min(1, "Le prompt est vide.").max(EXTRACTION_PROMPT_MAX),
  configs: z.array(LabConfigInputSchema).min(1, "Ajoutez une configuration.").max(LAB_MAX_CONFIGS, "Quatre configurations au plus."),
  /** The page or region rendered by the browser, sent to Decisions (a route, not a server action: 1 Mo). */
  image: LabImageSchema.nullable(),
}).strict();
export type LabRunRequest = z.infer<typeof LabRunRequestSchema>;

export const LabVerdictSchema = z.enum(["good", "bad"]);
export type LabVerdict = z.infer<typeof LabVerdictSchema>;
export const LabVerdictRequestSchema = z.object({ verdict: LabVerdictSchema }).strict();

// ---------------------------------------------------------------------------
// Stored run: <output>/runs/lab-<runId>.json

export type LabUsage = { input: number; output: number; reasoning: number; total: number };
export type LabProbability = { value: string; label: string; probability: number };
export type LabAnswer = {
  name: string;
  label: string;
  status: "answered" | "refused" | "missing" | "invalid";
  value: string | null;
  value_label: string | null;
  confidence: number | null;
  /** Decisions only: one bar per option. */
  probabilities: LabProbability[] | null;
};
export type LabScore =
  | { kind: "lines"; truth: string; expected: number; candidates: number; matched: number; precision: number; recall: number; quantity_accuracy: number }
  | { kind: "keys"; truth: string; status: "scored" | "not_run" | "read_failed"; keys_scored: number; keys_ok: number; keys_missed: number; false_positive_groups: number; attachment_rate: number | null };

export type LabElement = {
  id: string;
  kind: "item" | "question";
  key: number | string;
  label: string;
  detail: string | null;
  source_page: number | null;
  evidence: string | null;
  schema_error: boolean;
  answer: LabAnswer | null;
  /** What the right-hand side of a verdict shows. */
  json: unknown;
};

export type LabConfigStatus = "ok" | "schema_error" | "partial" | "failed" | "not_run";
export type LabConfigResult = {
  id: LabConfigId;
  provider: LabProvider;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  status: LabConfigStatus;
  /** Banner: schema error, Decisions failed/partial message, provider error, or why it did not run. */
  message: string | null;
  latency_ms: number | null;
  usage: LabUsage | null;
  /** ChatGPT: the answer's text as received; Decisions: the normalized OpenAiDecisionsResult. */
  raw: string | null;
  schema_error: { name: string; issues: string[] } | null;
  answers: LabAnswer[] | null;
  score: LabScore | null;
  elements: LabElement[];
};

export type LabStopReason = "quota" | "rate_limit" | "auth_required" | "account_missing" | "model_missing" | "selection_changed" | "decisions_failed" | "other";

export type LabRun = {
  schema_version: 1;
  id: string;
  created_at: string;
  author: { user_id: string; email: string | null };
  campaign: string;
  task: { id: string; kind: LabTaskKind; label: string };
  document: { id: string; source: "dataset" | "fixture"; sha256: string; pages: number };
  crop: LabCrop | null;
  prompt: { text: string; base: string | null; sha256: string; version: string };
  status: "complete" | "stopped";
  stop: { reason: LabStopReason; message: string } | null;
  configs: LabConfigResult[];
};

export type LabStoredVerdict = {
  schema_version: 1;
  element_id: string;
  verdict: LabVerdict;
  author: { user_id: string; email: string | null };
  at: string;
  campaign: string;
  task: string;
  run_id: string;
  config_id: LabConfigId;
  provider: LabProvider;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  prompt_version: string;
  document_id: string;
  document_sha256: string;
};

// ---------------------------------------------------------------------------
// Responses

export type LabDocumentSummary = {
  id: string;
  source: "dataset" | "fixture";
  label: string;
  pages: number;
  truth: "lines" | "keys" | null;
};

export type LabTaskDescriptor = {
  id: string;
  kind: LabTaskKind;
  /** The screen that launches it: the essai, or the vectors page (TI-662 « classe de calque »). */
  screen: "essai" | "vectors";
  label: string;
  description: string;
  providers: LabProvider[];
  defaultPrompt: string;
  promptBase: string | null;
  promptMax: number;
  question: { name: string; label: string; choices: Array<{ value: string; label: string; description?: string }> } | null;
};

/** Task of the vectors page (TI-662 L3c): one Decisions class per vector group of a document page. */
export const LAB_VECTOR_TASK_ID = "classe-de-calque";
/** Segments of a page's groups the vectors page draws at most; past it the geometry is cut and says so. */
export const LAB_VECTOR_MAX_SEGMENTS = 20_000;

export type LabVectorClassSource = "keyword" | "legend" | "label" | "rule" | "document" | "user" | "decisions";

/** One group of traces of the page (a layer, else a colour, width and dash), as the vectors page shows it. */
export type LabVectorGroup = {
  id: string;
  /** Layer name, else « #rrggbb · 0,5 pt ». */
  name: string;
  layer: string | null;
  colors: string[];
  width: number;
  dash: string | null;
  /** False for a layer the document hides by default (OFF): never read, never drawn. */
  visible: boolean;
  near_white: boolean;
  grey: boolean;
  class: string | null;
  source: LabVectorClassSource | null;
  confidence: number | null;
  /** Networks a shared legend colour hesitates between. */
  candidates: string[];
  /** A group left « à revoir » with what the classification proposes (TI-704 « hors_liste »), else null. */
  proposal: string | null;
  /** classifyByKeywords alone (layer name, else legend colour). */
  keyword: { class: string | null; source: "keyword" | "legend" | null };
  length_pt: number;
  /** Visible stroke length on site; null when the page scale is not measurable. */
  length_m: number | null;
  segments: number;
  /** Flat x0, y0, x1, y1 … in page points (y down), one decimal; cut at LAB_VECTOR_MAX_SEGMENTS per page. */
  geometry: number[];
  geometry_capped: boolean;
};

export type LabVectorPage = {
  document: { id: string; sha256: string; pages: number };
  page: number;
  mode: "layers" | "colours" | "raster";
  size_pt: [number, number];
  scale: { status: "verified" | "format" | "calibrated" | "unverified"; reason: string | null; denominator: number | null; cartouche: string | null;
    cotes: number; consistent_cotes: number };
  detection: number | null;
  groups: LabVectorGroup[];
  segments: { total: number; shown: number; cap: number; capped: boolean };
  networks: Array<{ network: string; material: string | null; dn: number | null; runs: number; length_pt: number; length_m: number | null }>;
  surfaces: Array<{ room: string; printed_m2: number; polygon_m2: number | null; deviation: number | null }>;
  /** The « classe de calque » run whose answers this reading applies (readVectorPage's decisions), or null: keywords only. */
  run: { id: string; campaign: string; created_at: string; answers: number; applied: number } | null;
  timings: { extraction_ms: number; reading_ms: number };
};

export type LabDecisionsBudget = { cap: number | null; used: number; remaining: number | null; calls_without_usage: number };

export type LabState = {
  configured: boolean;
  message: string | null;
  documents: LabDocumentSummary[];
  tasks: LabTaskDescriptor[];
  decisions: { available: boolean; message: string; model: string; budget: LabDecisionsBudget };
  chatgpt: { connected: boolean; model: string | null; reasoning_effort: ChatGptReasoningEffort | null; message: string | null };
  campaigns: string[];
  /** Campaign of the latest essai: the verdicts and stats open on it. */
  latest_campaign: string | null;
};

export type LabRunSummary = {
  id: string;
  created_at: string;
  campaign: string;
  task: LabRun["task"];
  document: LabRun["document"];
  crop: LabCrop | null;
  prompt_version: string;
  status: LabRun["status"];
  configs: Array<Pick<LabConfigResult, "id" | "provider" | "model" | "reasoning_effort" | "status" | "latency_ms" | "usage" | "score"> & { elements: number }>;
};

export type LabCampaignElement = LabElement & {
  run_id: string;
  run_created_at: string;
  config_id: LabConfigId;
  provider: LabProvider;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  config_status: LabConfigStatus;
  config_message: string | null;
  task: LabRun["task"];
  document: LabRun["document"];
  crop: LabCrop | null;
  prompt_version: string;
  verdict: LabVerdict | null;
  verdict_at: string | null;
  verdict_author: string | null;
};

export type LabCampaign = { campaign: string; elements: LabCampaignElement[] };

export type LabStatsGroup = {
  id: string;
  task: LabRun["task"];
  provider: LabProvider;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  prompt_version: string;
  label: string;
  good: number;
  bad: number;
  judged: number;
  /** good / (good + bad); null before the first verdict. */
  rate: number | null;
  responses: number;
  mean_tokens: number | null;
  mean_latency_ms: number | null;
};

export type LabStats = { groups: LabStatsGroup[]; verdicts: number; runs: number };

export type LabBenchReportSummary = {
  name: string;
  started_at: string | null;
  commit: string | null;
  dataset_sha256: string | null;
  status: string | null;
  couples: Array<{ model: string; reasoning_effort: string | null; passes: number; keys_ok: number[]; keys_scored: number | null }>;
};

// ---------------------------------------------------------------------------
// Labels shared by the screens

export function configLabel(config: { provider: LabProvider; model: string; reasoning_effort: ChatGptReasoningEffort | null }) {
  return config.provider === "decisions" ? `Decisions · ${config.model}` : `${config.model} · ${config.reasoning_effort ?? "auto"}`;
}

/** « takeoff-c-v1 · 1a2b3c4d » or « questions · 1a2b3c4d ». */
export function promptVersionLabel(version: string) {
  const [base, sha] = version.includes("+") ? version.split("+") : ["questions", version];
  return `${base} · ${sha.slice(0, 8)}`;
}

/** Default campaign: document + date (yyyymmdd), as a lab name. */
export function defaultCampaignName(documentId: string, date: Date) {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${documentId.slice(0, 70).replace(/-+$/, "")}-${day}`;
}
