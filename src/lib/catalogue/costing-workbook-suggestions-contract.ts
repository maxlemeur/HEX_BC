import { z } from "zod";

// Types only: the arbiter is a server module, and this contract is read by the screen.
import { AI_BILLING_SOURCES } from "@/lib/ai/access/contracts";
import { chatGptPreferencesSchema, chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import type { ChoiceProvider } from "@/lib/ai/choice-questions";

import {
  COSTING_WORKBOOK_OPTIONAL_COLUMNS,
  COSTING_WORKBOOK_REQUIRED_COLUMNS,
  type CostingWorkbookColumn,
} from "./costing-workbook";

/**
 * Contract of /api/catalogue/workbook-import/suggestions, shared by the import screen and the route: proposals
 * that speed up what the office corrects in the costing workbook import. Nothing is written by these routes, and
 * a proposal applies nothing: the office confirms it in the screen.
 *
 *  - GET answers `{ defaultProvider, providers }`: the profile's preferred source and the available sources and models.
 *  - POST answers the proposals of one task. Without `provider` they come from the deterministic pass alone
 *    (`status: "deterministic"`, `provider: null`). With a provider, that pass runs first and the provider is asked
 *    only for what it left undecided and that has something to choose from; `status` and `message` are then the
 *    provider's (`unavailable` and `failed` keep the deterministic proposals).
 *
 * `items` has one entry per entry of the request, in its order. A `suggestion` whose identifier is null means
 * « none of the candidates » (the arbiter answered « aucun »); `suggestion: null` means nothing could be proposed.
 */

/** The same values as CHOICE_PROVIDERS of the arbiter, in its order. */
export const COSTING_WORKBOOK_SUGGESTION_PROVIDERS = ["chatgpt_plan", "personal_api_key", "decisions"] as const satisfies readonly ChoiceProvider[];

/** Largest request body the route reads: 100 lines or 300 values of a sheet are far below it. */
export const COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES = 512 * 1024;

export const COSTING_WORKBOOK_SUGGESTION_LIMITS = {
  suppliers: 200,
  articles: 100,
  supplyTypeGroups: 200,
  headers: 60,
  samples: 3,
  supplierCodes: 300,
} as const;

const COLUMNS: readonly CostingWorkbookColumn[] = [...COSTING_WORKBOOK_REQUIRED_COLUMNS, ...COSTING_WORKBOOK_OPTIONAL_COLUMNS];

const providerSchema = z.enum(COSTING_WORKBOOK_SUGGESTION_PROVIDERS);
const aiSelection = {
  provider: providerSchema.optional(),
  model: z.string().min(1).max(200).optional().describe("Modèle proposé par la source choisie."),
  reasoning_effort: z.string().min(1).max(20).nullable().optional()
    .describe("Niveau de raisonnement proposé par le modèle. La valeur null sélectionne Automatique."),
};
/** A column the reader knows, by its exact name (« PR. FO », « F1_nom »…). */
const columnSchema = z.enum(COLUMNS);
const name = z.string().min(1).max(255);
const samples = z.array(z.string().max(255)).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.samples);
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

const suppliersRequest = z.object({
  task: z.literal("suppliers"),
  ...aiSelection,
  /** Supplier names as the workbook writes them. */
  names: z.array(name).min(1).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.suppliers),
}).strict();

const articlesRequest = z.object({
  task: z.literal("articles"),
  ...aiSelection,
  /** Workbook lines to find in the catalogue; `key` is the screen's own, returned as it is. */
  lines: z.array(z.object({
    key: z.string().min(1).max(40),
    reference: z.string().max(255),
    wording: z.string().max(500),
    material: z.string().max(255),
    dimension: z.string().max(255),
    unit: z.string().max(40),
  }).strict()).min(1).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.articles)
    .refine((lines) => distinct(lines.map((line) => line.key)), "Chaque ligne porte une clé distincte."),
}).strict();

const supplyTypesRequest = z.object({
  task: z.literal("supply_types"),
  ...aiSelection,
  /** Proposed drafts without supply type, grouped by what they are; `count` is the size of the group. */
  groups: z.array(z.object({
    key: z.string().min(1).max(200),
    family_code: z.string().max(80).nullable(),
    product_type: z.string().max(255),
    material: z.string().max(255).nullable(),
    samples,
    count: z.number().int().nonnegative(),
  }).strict()).min(1).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.supplyTypeGroups)
    .refine((groups) => distinct(groups.map((group) => group.key)), "Chaque groupe porte une clé distincte."),
}).strict();

const columnsRequest = z.object({
  task: z.literal("columns"),
  ...aiSelection,
  /** Columns the reader did not find in the header row. */
  missing: z.array(columnSchema).min(1).max(COLUMNS.length)
    .refine(distinct, "Chaque colonne manquante est nommée une fois."),
  /** Header cells the reader did not recognise: zero-based position, text, first values below. */
  headers: z.array(z.object({
    index: z.number().int().min(0).max(16_383),
    text: z.string().max(255),
    samples,
  }).strict()).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.headers)
    .refine((headers) => distinct(headers.map((header) => header.index)), "Chaque en-tête a sa propre position."),
}).strict();

const supplierCodesRequest = z.object({
  task: z.literal("supplier_codes"),
  ...aiSelection,
  /** Supplier reference cells the reader refused. */
  values: z.array(name).min(1).max(COSTING_WORKBOOK_SUGGESTION_LIMITS.supplierCodes),
}).strict();

/** Body of POST /api/catalogue/workbook-import/suggestions. */
export const costingWorkbookSuggestionsRequestSchema = z.discriminatedUnion("task", [
  suppliersRequest, articlesRequest, supplyTypesRequest, columnsRequest, supplierCodesRequest,
]);
export type CostingWorkbookSuggestionsRequest = z.infer<typeof costingWorkbookSuggestionsRequestSchema>;
export type CostingWorkbookSuggestionTask = CostingWorkbookSuggestionsRequest["task"];

const outcome = {
  /** The provider asked for; null when none was. */
  provider: providerSchema.nullable(),
  model: z.string().nullable(),
  status: z.enum(["deterministic", "available", "partial", "unavailable", "failed"]),
  message: z.string(),
};
const confidence = z.number().min(0).max(1).nullable();

const suppliersResponse = z.object({
  task: z.literal("suppliers"),
  ...outcome,
  items: z.array(z.object({
    name: z.string(),
    /** Closest first; `score` from 0 to 1 (supplierNameSimilarity). */
    candidates: z.array(z.object({ supplier_id: z.string(), label: z.string(), score: z.number() })),
    suggestion: z.object({ supplier_id: z.string().nullable(), confidence, source: z.enum(["match", "ai"]) }).nullable(),
  })),
});

const articlesResponse = z.object({
  task: z.literal("articles"),
  ...outcome,
  items: z.array(z.object({
    key: z.string(),
    /** Safest first; `score` from 0 to 100, for ordering only (the material request matcher's). */
    candidates: z.array(z.object({
      product_id: z.string(),
      reference: z.string().nullable(),
      designation: z.string(),
      score: z.number(),
      reasons: z.array(z.string()),
      warnings: z.array(z.string()),
    })),
    suggestion: z.object({ product_id: z.string().nullable(), confidence, source: z.enum(["match", "ai"]) }).nullable(),
  })),
});

const supplyTypesResponse = z.object({
  task: z.literal("supply_types"),
  ...outcome,
  items: z.array(z.object({
    key: z.string(),
    suggestion: z.object({ supply_type_id: z.string().nullable(), confidence, source: z.enum(["catalogue", "ai"]) }).nullable(),
  })),
});

const columnsResponse = z.object({
  task: z.literal("columns"),
  ...outcome,
  items: z.array(z.object({
    column: z.string(),
    /** `index` is the position of one of the request's headers. */
    suggestion: z.object({ index: z.number().int().nullable(), confidence, source: z.enum(["match", "ai"]) }).nullable(),
  })),
});

const supplierCodesResponse = z.object({
  task: z.literal("supplier_codes"),
  ...outcome,
  items: z.array(z.object({
    value: z.string(),
    /** `code`: a supplier's product code; `price_source`: a quote, an order, a document; `none`: no code. */
    suggestion: z.object({ kind: z.enum(["code", "price_source", "none"]), confidence, source: z.literal("ai") }).nullable(),
  })),
});

/** Answer of POST /api/catalogue/workbook-import/suggestions (the `data` of the envelope). */
export const costingWorkbookSuggestionsResponseSchema = z.discriminatedUnion("task", [
  suppliersResponse, articlesResponse, supplyTypesResponse, columnsResponse, supplierCodesResponse,
]);
export type CostingWorkbookSuggestionsResponse = z.infer<typeof costingWorkbookSuggestionsResponseSchema>;
export type CostingWorkbookSuggestionsResponseOf<Task extends CostingWorkbookSuggestionTask> =
  Extract<CostingWorkbookSuggestionsResponse, { task: Task }>;
export type CostingWorkbookSuggestionStatus = CostingWorkbookSuggestionsResponse["status"];

const availability = z.object({ available: z.boolean(), message: z.string() });
const personalSource = availability.extend({
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    reasoningEfforts: z.array(chatGptReasoningEffortSchema),
    defaultReasoningEffort: chatGptReasoningEffortSchema.nullable(),
  })),
  preferences: chatGptPreferencesSchema.nullable(),
});

/** Answer of GET /api/catalogue/workbook-import/suggestions (the `data` of the envelope). */
export const costingWorkbookSuggestionProvidersResponseSchema = z.object({
  defaultProvider: z.enum(AI_BILLING_SOURCES).nullable().describe("La source préférée dans Mon profil. La valeur null indique que les préférences sont illisibles."),
  providers: z.object({ chatgpt_plan: personalSource, personal_api_key: personalSource, decisions: availability }),
});
export type CostingWorkbookSuggestionProvidersResponse = z.infer<typeof costingWorkbookSuggestionProvidersResponseSchema>;
