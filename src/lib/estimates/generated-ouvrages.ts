import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertDraftStatus,
  createEstimateItem,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type JsonRecord = Record<string, unknown>;
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_metadata?: unknown;
  source_extracted_at?: string | null;
};

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type EmbeddedProjectAccess = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  reference: string | null;
  client_name: string | null;
  notes: string | null;
  is_archived: boolean;
};

type VersionAccessRow = {
  id: string;
  project_id: string;
  status: EstimateStatus;
  updated_at: string;
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type DraftLockRow = {
  id: string;
  version_id: string;
  user_id: string;
  locked_at: string;
  expires_at: string;
};

type GeneratedOuvrageDraftRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  created_by: string;
  source_kind: GeneratedOuvrageInputSourceKind;
  preferred_lot_id: string | null;
  status: GeneratedOuvrageDraftStatus;
  summary: Json;
  generation_metadata: Json;
  applied_at: string | null;
};

type GeneratedOuvrageSourceFragmentRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  draft_id: string;
  fragment_order: number;
  source_kind: GeneratedOuvrageFragmentKind;
  status: GeneratedOuvrageFragmentStatus;
  label: string;
  excerpt: string;
  normalized_excerpt: string;
  source_document_id: string | null;
  source_file_name: string | null;
  source_page_from: number | null;
  source_page_to: number | null;
  selection_label: string | null;
  cctp_section_ref: string | null;
  metadata: Json;
};

type GeneratedOuvrageCandidateRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  draft_id: string;
  candidate_order: number;
  suggested_lot_id: string | null;
  lot_label: string | null;
  designation: string;
  normalized_designation: string;
  unit: string | null;
  quantity: number | null;
  confidence: number;
  ai_status: GeneratedOuvrageCandidateAiStatus;
  resolution_status: GeneratedOuvrageCandidateResolutionStatus;
  reasoning: string | null;
  metadata: Json;
};

type GeneratedOuvrageCandidateSourceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  draft_id: string;
  candidate_id: string;
  source_fragment_id: string;
  source_rank: number;
  rationale: string | null;
  metadata: Json;
};

type GeneratedOuvrageApplicationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  draft_id: string;
  candidate_id: string;
  target_version_id: string;
  estimate_item_id: string;
  applied_by: string | null;
  applied_payload: Json;
};

type AffaireBriefRow = {
  id: string;
  project_id: string;
  status: string;
  summary: string;
  project_object: string;
  scope: unknown;
  lots: unknown;
  assumptions: unknown;
  vigilance_points: unknown;
  missing_elements: unknown;
};

type EstimateTemplateSummaryRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type EstimateAssemblySummaryRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type HistoricalLineRow = {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  quantity: number | null;
  created_at: string;
};

type DraftLoaded = {
  draft: GeneratedOuvrageDraftRow;
  fragments: GeneratedOuvrageSourceFragmentRow[];
  candidates: GeneratedOuvrageCandidateRow[];
  candidateSources: GeneratedOuvrageCandidateSourceRow[];
  applications: GeneratedOuvrageApplicationRow[];
};

const GENERATED_OUVRAGE_MODEL = "gemini-3-pro-preview";
const GENERATED_OUVRAGE_PROMPT_VERSION = "est381-generated-ouvrages-v1";
const GENERATED_OUVRAGE_PROMPT_THINKING_LEVEL = "medium" as const;
const MAX_SOURCE_TEXT_LENGTH = 12_000;
const MAX_REASON_LENGTH = 320;
const MAX_SELECTION_LABEL_LENGTH = 180;
const MAX_SOURCE_FILE_NAME_LENGTH = 255;
const MAX_CANDIDATES = 12;
const HISTORY_FRAGMENT_LIMIT = 6;
const LIBRARY_FRAGMENT_LIMIT = 6;

export const generatedOuvrageInputSourceKindSchema = z.enum([
  "free_text",
  "cctp_excerpt",
  "internal_note",
]);
export const generatedOuvrageFragmentKindSchema = z.enum([
  "free_text",
  "cctp_excerpt",
  "internal_note",
  "history",
  "library",
]);
export const generatedOuvrageFragmentStatusSchema = z.enum(["active", "discarded"]);
export const generatedOuvrageDraftStatusSchema = z.enum([
  "pending",
  "partially_applied",
  "applied",
  "discarded",
]);
export const generatedOuvrageCandidateAiStatusSchema = z.enum([
  "certain",
  "plausible",
  "question",
]);
export const generatedOuvrageCandidateResolutionStatusSchema = z.enum([
  "pending",
  "inserted",
  "rejected",
]);

const generatedOuvrageGenerateInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide."),
  sourceKind: generatedOuvrageInputSourceKindSchema,
  sourceText: z
    .string()
    .trim()
    .min(1, "Le texte source est requis.")
    .max(MAX_SOURCE_TEXT_LENGTH, `Le texte source depasse ${MAX_SOURCE_TEXT_LENGTH} caracteres.`),
  preferredLotId: z.string().uuid("preferredLotId invalide.").nullable().optional(),
  sourceDocumentId: z.string().uuid("sourceDocumentId invalide.").nullable().optional(),
  sourceFileName: z
    .string()
    .trim()
    .max(MAX_SOURCE_FILE_NAME_LENGTH, "sourceFileName trop long.")
    .nullable()
    .optional(),
  sourcePageFrom: z.number().int().min(1).nullable().optional(),
  sourcePageTo: z.number().int().min(1).nullable().optional(),
  selectionLabel: z
    .string()
    .trim()
    .max(MAX_SELECTION_LABEL_LENGTH, "selectionLabel trop long.")
    .nullable()
    .optional(),
});

const generatedOuvrageFetchInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
});

const generatedOuvrageInsertCandidateSchema = z.object({
  candidateId: z.string().uuid("candidateId invalide."),
  designation: z.string().trim().min(1, "La designation est requise.").max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite("Quantite invalide.").min(0).nullable().optional(),
  lotId: z.string().uuid("lotId invalide.").nullable().optional(),
});

const generatedOuvrageInsertInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  acceptedCandidates: z
    .array(generatedOuvrageInsertCandidateSchema)
    .min(1, "Au moins un ouvrage doit etre selectionne.")
    .max(MAX_CANDIDATES, `Maximum ${MAX_CANDIDATES} ouvrages par insertion.`),
});

const generatedOuvrageRejectInputSchema = z.object({
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
  reason: z.string().trim().max(MAX_REASON_LENGTH).nullable().optional(),
});

const geminiGeneratedOuvrageCandidateSchema = z.object({
  lotLabel: z.string().trim().max(180).nullable().optional(),
  designation: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite().min(0).nullable().optional(),
  confidence: z.number().finite().min(0).max(1),
  status: generatedOuvrageCandidateAiStatusSchema,
  sourceFragmentIds: z.array(z.string().uuid()).max(6).default([]),
  reasoning: z.string().trim().max(320).nullable().optional(),
});

const geminiGeneratedOuvrageExchangeSchema = z.object({
  summary: z.string().trim().max(320).nullable().optional(),
  candidates: z.array(geminiGeneratedOuvrageCandidateSchema).max(MAX_CANDIDATES),
});

type GeneratedOuvrageInputSourceKind = z.infer<
  typeof generatedOuvrageInputSourceKindSchema
>;
type GeneratedOuvrageFragmentKind = z.infer<
  typeof generatedOuvrageFragmentKindSchema
>;
type GeneratedOuvrageFragmentStatus = z.infer<
  typeof generatedOuvrageFragmentStatusSchema
>;
type GeneratedOuvrageDraftStatus = z.infer<typeof generatedOuvrageDraftStatusSchema>;
type GeneratedOuvrageCandidateAiStatus = z.infer<
  typeof generatedOuvrageCandidateAiStatusSchema
>;
type GeneratedOuvrageCandidateResolutionStatus = z.infer<
  typeof generatedOuvrageCandidateResolutionStatusSchema
>;
type GenerateGeneratedOuvrageInput = z.infer<typeof generatedOuvrageGenerateInputSchema>;
type FetchGeneratedOuvrageDraftInput = z.infer<typeof generatedOuvrageFetchInputSchema>;
type InsertGeneratedOuvragesInput = z.infer<typeof generatedOuvrageInsertInputSchema>;
type RejectGeneratedOuvrageDraftInput = z.infer<typeof generatedOuvrageRejectInputSchema>;
type GeminiGeneratedOuvrageExchange = z.infer<
  typeof geminiGeneratedOuvrageExchangeSchema
>;

type GeneratedOuvragePromptCandidate = GeminiGeneratedOuvrageExchange["candidates"][number];

type GeneratedOuvrageDraftSummary = {
  totalCandidates: number;
  certainCount: number;
  plausibleCount: number;
  questionCount: number;
  pendingCount: number;
  insertedCount: number;
  rejectedCount: number;
};

type SourceFragmentSeed = {
  sourceKind: GeneratedOuvrageFragmentKind;
  label: string;
  excerpt: string;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  sourcePageFrom?: number | null;
  sourcePageTo?: number | null;
  selectionLabel?: string | null;
  cctpSectionRef?: string | null;
  metadata?: JsonRecord;
};

export type GeneratedOuvrageCandidateSource = {
  sourceFragmentId: string;
  sourceDocumentId: string | null;
  type: "text" | "cctp" | "history" | "library";
  label: string;
  excerpt: string | null;
  sourceFileName: string | null;
  sourcePageFrom: number | null;
  sourcePageTo: number | null;
  selectionLabel: string | null;
};

export type GeneratedOuvrageCandidate = {
  candidateId: string;
  suggestedLotId: string | null;
  lotLabel: string | null;
  designation: string;
  unit: string | null;
  quantity: number | null;
  confidence: number;
  status: GeneratedOuvrageCandidateAiStatus;
  resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
  reasoning: string | null;
  sources: GeneratedOuvrageCandidateSource[];
};

export type GeneratedOuvrageDraftResult = {
  draftId: string;
  versionId: string;
  projectId: string;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotId: string | null;
  status: GeneratedOuvrageDraftStatus;
  summary: GeneratedOuvrageDraftSummary;
  generatedAt: string;
  candidates: GeneratedOuvrageCandidate[];
};

export type InsertGeneratedOuvragesResult = {
  ok: true;
  insertedCount: number;
  draftStatus: GeneratedOuvrageDraftStatus;
  projectId: string;
  versionId: string;
};

export type RejectGeneratedOuvrageDraftResult = {
  ok: true;
  draftStatus: GeneratedOuvrageDraftStatus;
  projectId: string;
  versionId: string;
};

function toNullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string, maxLength?: number) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (typeof maxLength === "number" && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength).trim();
  }
  return trimmed;
}

function normalizeMultilineText(value: string, maxLength?: number) {
  const compact = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return typeof maxLength === "number" && compact.length > maxLength
    ? compact.slice(0, maxLength).trim()
    : compact;
}

function normalizeDesignation(value: string) {
  return normalizeText(value).toLowerCase();
}

function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

function toJson(value: JsonRecord | JsonRecord[] | string[] | string | number | boolean | null) {
  return value as Json;
}

function pickStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toNullableText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function mapFragmentKindToCandidateSourceType(
  kind: GeneratedOuvrageFragmentKind
): GeneratedOuvrageCandidateSource["type"] {
  if (kind === "cctp_excerpt") return "cctp";
  if (kind === "history") return "history";
  if (kind === "library") return "library";
  return "text";
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    input.context.tenantRole === "admin"
  );
}

function resolveEmbeddedOne<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, updated_at, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(row.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version: row,
    project,
  };
}

async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const { data, error } = await input.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, locked_at, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier le verrou de brouillon.");
  }

  const lock = (data ?? null) as DraftLockRow | null;

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      { lock: null },
      "LOCK_REQUIRED"
    );
  }

  if (lock.user_id === input.userId) {
    return;
  }

  throw conflict(
    "Cette version brouillon est deja verrouillee par un autre utilisateur.",
    { lockedByUserId: lock.user_id, expiresAt: lock.expires_at },
    "LOCK_OWNED_BY_OTHER"
  );
}

async function loadLotLabel(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  lotId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("id, title, item_type, version_id")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.lotId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le lot selectionne.");
  }

  if (!data) {
    throw notFound("Lot introuvable.", undefined, "EST381_LOT_NOT_FOUND");
  }

  if ((data as { item_type?: string }).item_type !== "section") {
    throw badRequest("Le lot selectionne doit etre un chapitre du devis.");
  }

  return normalizeText((data as { title: string }).title, 180);
}

async function loadConfirmedBriefFragments(input: {
  supabase: Supabase;
  projectId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const { data, error } = await input.supabase
      .from("affaire_briefs" as never)
      .select(
        "id, project_id, status, summary, project_object, scope, lots, assumptions, vigilance_points, missing_elements" as never
      )
      .eq("project_id", input.projectId)
      .eq("status", "confirme")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data) || data.length === 0) {
      return [];
    }

    const brief = data[0] as AffaireBriefRow;
    const fragments: SourceFragmentSeed[] = [];

    const summary = toNullableText(brief.summary);
    if (summary) {
      fragments.push({
        sourceKind: "internal_note",
        label: "Brief confirme",
        excerpt: summary,
        metadata: { block: "summary" },
      });
    }

    const projectObject = toNullableText(brief.project_object);
    if (projectObject) {
      fragments.push({
        sourceKind: "internal_note",
        label: "Objet du chantier",
        excerpt: projectObject,
        metadata: { block: "project_object" },
      });
    }

    const bulletBlocks = [
      ["scope", "Perimetre"],
      ["lots", "Lots du brief"],
      ["assumptions", "Hypotheses confirmees"],
      ["vigilance_points", "Points de vigilance"],
      ["missing_elements", "Elements manquants"],
    ] as const;

    for (const [key, label] of bulletBlocks) {
      const values = pickStringArray(brief[key]);
      if (values.length === 0) continue;
      fragments.push({
        sourceKind: "internal_note",
        label,
        excerpt: values.join("\n"),
        metadata: { block: key },
      });
    }

    return fragments;
  } catch {
    return [];
  }
}

async function loadHistoricalFragments(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  excludeVersionId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const { data: versionData, error: versionError } = await input.supabase
      .from("estimate_versions")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .neq("id", input.excludeVersionId)
      .order("updated_at", { ascending: false })
      .limit(3);

    if (versionError || !versionData || versionData.length === 0) {
      return [];
    }

    const versionIds = versionData.map((row) => row.id);
    const { data: itemData, error: itemError } = await input.supabase
      .from("estimate_items")
      .select("id, version_id, title, description, quantity, created_at")
      .eq("tenant_id", input.tenantId)
      .eq("item_type", "line")
      .in("version_id", versionIds)
      .order("created_at", { ascending: false })
      .limit(HISTORY_FRAGMENT_LIMIT);

    if (itemError || !itemData) {
      return [];
    }

    return (itemData as HistoricalLineRow[]).map((row) => {
      const parts = [normalizeText(row.title, 220)];
      const description = toNullableText(row.description);
      if (description) {
        parts.push(description);
      }
      if (typeof row.quantity === "number") {
        parts.push(`Quantite historique: ${row.quantity}`);
      }
      return {
        sourceKind: "history" as const,
        label: "Historique affaire",
        excerpt: parts.join(" | "),
        metadata: {
          versionId: row.version_id,
          estimateItemId: row.id,
        },
      };
    });
  } catch {
    return [];
  }
}

async function loadLibraryFragments(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const [templateResult, assemblyResult] = await Promise.all([
      input.supabase
        .from("estimate_templates")
        .select("id, name, description, updated_at")
        .eq("tenant_id", input.tenantId)
        .eq("user_id", input.ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(LIBRARY_FRAGMENT_LIMIT),
      input.supabase
        .from("estimate_assemblies")
        .select("id, name, description, updated_at")
        .eq("tenant_id", input.tenantId)
        .eq("user_id", input.ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(LIBRARY_FRAGMENT_LIMIT),
    ]);

    const fragments: SourceFragmentSeed[] = [];

    if (!templateResult.error && templateResult.data) {
      for (const row of templateResult.data as EstimateTemplateSummaryRow[]) {
        fragments.push({
          sourceKind: "library",
          label: "Template de devis",
          excerpt: [normalizeText(row.name, 180), toNullableText(row.description)]
            .filter((value): value is string => Boolean(value))
            .join(" | "),
          metadata: { templateId: row.id },
        });
      }
    }

    if (!assemblyResult.error && assemblyResult.data) {
      for (const row of assemblyResult.data as EstimateAssemblySummaryRow[]) {
        fragments.push({
          sourceKind: "library",
          label: "Assemblage",
          excerpt: [normalizeText(row.name, 180), toNullableText(row.description)]
            .filter((value): value is string => Boolean(value))
            .join(" | "),
          metadata: { assemblyId: row.id },
        });
      }
    }

    return fragments.slice(0, LIBRARY_FRAGMENT_LIMIT);
  } catch {
    return [];
  }
}

async function buildSourceFragmentSeeds(input: {
  supabase: Supabase;
  tenantId: string;
  project: EmbeddedProjectAccess;
  versionId: string;
  sourceKind: GeneratedOuvrageInputSourceKind;
  sourceText: string;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  sourcePageFrom?: number | null;
  sourcePageTo?: number | null;
  selectionLabel?: string | null;
}) {
  const primaryFragment: SourceFragmentSeed = {
    sourceKind: input.sourceKind,
    label:
      input.sourceKind === "cctp_excerpt"
        ? "Extrait CCTP selectionne"
        : input.sourceKind === "internal_note"
          ? "Note interne"
          : "Texte libre saisi",
    excerpt: normalizeMultilineText(input.sourceText, MAX_SOURCE_TEXT_LENGTH),
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceFileName: toNullableText(input.sourceFileName),
    sourcePageFrom: input.sourcePageFrom ?? null,
    sourcePageTo: input.sourcePageTo ?? null,
    selectionLabel: toNullableText(input.selectionLabel),
    metadata: {
      origin: "input",
    },
  };

  const [briefFragments, historyFragments, libraryFragments] = await Promise.all([
    loadConfirmedBriefFragments({
      supabase: input.supabase,
      projectId: input.project.id,
    }),
    loadHistoricalFragments({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.project.id,
      excludeVersionId: input.versionId,
    }),
    loadLibraryFragments({
      supabase: input.supabase,
      tenantId: input.tenantId,
      ownerUserId: input.project.user_id,
    }),
  ]);

  const noteFragment =
    toNullableText(input.project.notes) === null
      ? []
      : [
          {
            sourceKind: "internal_note" as const,
            label: "Notes affaire",
            excerpt: normalizeMultilineText(input.project.notes ?? "", 500),
            metadata: { origin: "project_notes" },
          } satisfies SourceFragmentSeed,
        ];

  const deduped = new Map<string, SourceFragmentSeed>();
  for (const seed of [
    primaryFragment,
    ...noteFragment,
    ...briefFragments,
    ...historyFragments,
    ...libraryFragments,
  ]) {
    if (!seed.excerpt) continue;
    const normalizedKey = `${seed.sourceKind}:${normalizeText(seed.label, 180)}:${seed.excerpt
      .trim()
      .toLowerCase()}`;
    if (!deduped.has(normalizedKey)) {
      deduped.set(normalizedKey, seed);
    }
  }

  return Array.from(deduped.values()).slice(0, 20);
}

async function discardPendingGeneratedOuvrageDrafts(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  excludeDraftId?: string;
}) {
  let query = input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("tenant_id", input.tenantId)
    .eq("target_version_id", input.versionId)
    .eq("created_by", input.userId)
    .eq("status", "pending");

  if (input.excludeDraftId) {
    query = query.neq("id", input.excludeDraftId);
  }

  const { data, error } = await query.select("id" as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible d'archiver les brouillons precedents.");
  }

  const discardedDraftIds = Array.isArray(data)
    ? data
        .map((row) => toNullableText((row as { id?: string }).id))
        .filter((id): id is string => Boolean(id))
    : [];

  if (discardedDraftIds.length === 0) {
    return;
  }

  const { error: fragmentError } = await input.supabase
    .from("estimate_generated_ouvrage_source_fragments" as never)
    .update({
      status: "discarded",
    } as never)
    .in("draft_id", discardedDraftIds);

  if (fragmentError) {
    throw mapSupabaseError(fragmentError, "Impossible d'archiver les fragments precedents.");
  }
}

async function discardGeneratedOuvrageDraftOnFailure(input: {
  supabase: Supabase;
  draftId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("id", input.draftId)
    .select("id" as never)
    .single();

  if (error || !data) {
    throw mapSupabaseError(
      error,
      "Impossible d'archiver le brouillon d'ouvrages incomplet."
    );
  }

  const { error: fragmentError } = await input.supabase
    .from("estimate_generated_ouvrage_source_fragments" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("draft_id", input.draftId);

  if (fragmentError) {
    throw mapSupabaseError(
      fragmentError,
      "Impossible d'archiver les fragments du brouillon d'ouvrages incomplet."
    );
  }
}

function parseSourceKindLabel(kind: GeneratedOuvrageInputSourceKind) {
  switch (kind) {
    case "cctp_excerpt":
      return "extrait CCTP";
    case "internal_note":
      return "note interne";
    default:
      return "texte libre";
  }
}

function buildGeneratedOuvragePrompt(input: {
  project: EmbeddedProjectAccess;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotLabel: string | null;
  fragments: GeneratedOuvrageSourceFragmentRow[];
}) {
  const fragmentLines = input.fragments
    .map((fragment) => {
      const metaParts = [
        `kind=${fragment.source_kind}`,
        `label=${fragment.label}`,
        fragment.source_file_name ? `file=${fragment.source_file_name}` : null,
        fragment.selection_label ? `selection=${fragment.selection_label}` : null,
      ].filter((value): value is string => Boolean(value));
      return [
        `- [${fragment.id}] ${metaParts.join(" | ")}`,
        fragment.excerpt,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Tu aides un chiffreur BTP a proposer des ouvrages candidats a partir d'un texte source.",
    "Reponse strictement structuree selon le schema JSON fourni.",
    "Ne cree rien automatiquement, propose seulement des candidats revus par un humain.",
    `Contexte affaire: ${input.project.name}`,
    `Source principale: ${parseSourceKindLabel(input.sourceKind)}`,
    input.preferredLotLabel ? `Lot prefere: ${input.preferredLotLabel}` : "Lot prefere: aucun",
    "",
    "Regles:",
    "1. Chaque candidat doit contenir designation, unit si visible, quantity si deducible, confidence et status.",
    "2. Utilise status=certain si la source est explicite et exploitable, plausible si une interpretation reste raisonnable, question si l'information manque ou est ambigue.",
    "3. sourceFragmentIds doit contenir uniquement des ids presents ci-dessous.",
    "4. Si aucun lot clair n'apparait, laisse lotLabel a null.",
    "5. N'invente ni prix ni details absents.",
    "",
    "Fragments sources:",
    fragmentLines,
  ].join("\n");
}

function splitFallbackLines(sourceText: string) {
  const normalized = sourceText.replace(/\r/g, "");
  const rawLines = normalized
    .split("\n")
    .flatMap((line) => line.split(/[;•]/))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  if (rawLines.length > 1) {
    return rawLines;
  }

  return normalized
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

function parseQuantityAndUnit(value: string) {
  const match = value.match(
    /(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|ml|m|u|unite|forfait|kg|t)\b/i
  );

  if (!match) {
    return {
      quantity: null,
      unit: null,
    };
  }

  const quantity = Number(match[1]?.replace(",", "."));
  const unit = match[2]?.toLowerCase() ?? null;

  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit:
      unit === "unite"
        ? "u"
        : unit === "m²"
          ? "m2"
          : unit === "m³"
            ? "m3"
            : unit,
  };
}

function buildFallbackCandidates(input: {
  sourceText: string;
  sourceFragmentId: string;
  preferredLotLabel: string | null;
}): GeminiGeneratedOuvrageExchange {
  const lines = splitFallbackLines(input.sourceText).slice(0, MAX_CANDIDATES);
  const deduped = new Set<string>();
  const candidates: GeneratedOuvragePromptCandidate[] = [];

  for (const line of lines) {
    const designation = normalizeText(
      line.replace(/\b\d+(?:[.,]\d+)?\s*(m2|m²|m3|m³|ml|m|u|unite|forfait|kg|t)\b/gi, ""),
      220
    );
    const normalizedDesignation = normalizeDesignation(designation || line);

    if (!normalizedDesignation || deduped.has(normalizedDesignation)) {
      continue;
    }

    deduped.add(normalizedDesignation);
    const parsed = parseQuantityAndUnit(line);
    const hasQuantity = typeof parsed.quantity === "number";
    const status: GeneratedOuvrageCandidateAiStatus = line.includes("?")
      ? "question"
      : hasQuantity
        ? "plausible"
        : "question";

    candidates.push({
      lotLabel: input.preferredLotLabel,
      designation: designation || normalizeText(line, 220),
      unit: parsed.unit,
      quantity: parsed.quantity,
      confidence: hasQuantity ? 0.62 : 0.38,
      status,
      sourceFragmentIds: [input.sourceFragmentId],
      reasoning: hasQuantity
        ? "Fallback heuristique base sur le texte source."
        : "Information incomplete a clarifier en revue humaine.",
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      lotLabel: input.preferredLotLabel,
      designation: normalizeText(input.sourceText, 220),
      unit: null,
      quantity: null,
      confidence: 0.25,
      status: "question",
      sourceFragmentIds: [input.sourceFragmentId],
      reasoning: "Aucune structure exploitable detectee automatiquement.",
    });
  }

  return {
    summary: "Fallback heuristique utilise.",
    candidates,
  };
}

async function generatePromptCandidates(input: {
  project: EmbeddedProjectAccess;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotLabel: string | null;
  fragments: GeneratedOuvrageSourceFragmentRow[];
}) {
  const prompt = buildGeneratedOuvragePrompt(input);

  try {
    const result = await callGeminiStructured<GeminiGeneratedOuvrageExchange>({
      prompt,
      schema: geminiGeneratedOuvrageExchangeSchema,
      thinkingLevel: GENERATED_OUVRAGE_PROMPT_THINKING_LEVEL,
      context: {
        model: GENERATED_OUVRAGE_MODEL,
        promptVersion: GENERATED_OUVRAGE_PROMPT_VERSION,
      },
    });

    return {
      exchange: result.data,
      metadata: {
        model: result.model,
        prompt_version: result.promptVersion,
        used_fallback: false,
        token_count: result.tokenCount,
        cost_cents: result.costCents,
        duration_ms: result.durationMs,
        summary: result.data.summary ?? null,
      } satisfies JsonRecord,
    };
  } catch (error) {
    const primaryFragment = input.fragments[0];
    return {
      exchange: buildFallbackCandidates({
        sourceText: primaryFragment?.excerpt ?? "",
        sourceFragmentId: primaryFragment?.id ?? "",
        preferredLotLabel: input.preferredLotLabel,
      }),
      metadata: {
        model: null,
        prompt_version: GENERATED_OUVRAGE_PROMPT_VERSION,
        used_fallback: true,
        token_count: null,
        cost_cents: null,
        duration_ms: null,
        summary: "Fallback heuristique utilise.",
        failure_message: error instanceof Error ? error.message : "Generation indisponible.",
      } satisfies JsonRecord,
    };
  }
}

function sanitizePromptCandidates(input: {
  promptCandidates: GeneratedOuvragePromptCandidate[];
  fragments: GeneratedOuvrageSourceFragmentRow[];
  preferredLotId: string | null;
  preferredLotLabel: string | null;
}) {
  const fragmentIdSet = new Set(input.fragments.map((fragment) => fragment.id));
  const primaryFragmentId = input.fragments[0]?.id ?? null;
  const seen = new Set<string>();

  return input.promptCandidates
    .map((candidate, index) => {
      const designation = normalizeText(candidate.designation, 500);
      if (!designation) return null;

      const normalizedDesignation = normalizeDesignation(designation);
      if (seen.has(normalizedDesignation)) {
        return null;
      }
      seen.add(normalizedDesignation);

      const sourceFragmentIds = candidate.sourceFragmentIds.filter((fragmentId) =>
        fragmentIdSet.has(fragmentId)
      );

      if (sourceFragmentIds.length === 0 && primaryFragmentId) {
        sourceFragmentIds.push(primaryFragmentId);
      }

      return {
        candidateOrder: index,
        designation,
        normalizedDesignation,
        lotLabel: toNullableText(candidate.lotLabel) ?? input.preferredLotLabel,
        suggestedLotId: input.preferredLotId,
        unit: toNullableText(candidate.unit)?.slice(0, 64) ?? null,
        quantity:
          typeof candidate.quantity === "number" && Number.isFinite(candidate.quantity)
            ? Number(candidate.quantity.toFixed(3))
            : null,
        confidence: clampConfidence(candidate.confidence),
        aiStatus: candidate.status,
        reasoning: toNullableText(candidate.reasoning)?.slice(0, 320) ?? null,
        sourceFragmentIds,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .slice(0, MAX_CANDIDATES);
}

function buildDraftSummary(candidates: GeneratedOuvrageCandidateRow[]) {
  return candidates.reduce<GeneratedOuvrageDraftSummary>(
    (summary, candidate) => {
      summary.totalCandidates += 1;
      if (candidate.ai_status === "certain") summary.certainCount += 1;
      if (candidate.ai_status === "plausible") summary.plausibleCount += 1;
      if (candidate.ai_status === "question") summary.questionCount += 1;
      if (candidate.resolution_status === "pending") summary.pendingCount += 1;
      if (candidate.resolution_status === "inserted") summary.insertedCount += 1;
      if (candidate.resolution_status === "rejected") summary.rejectedCount += 1;
      return summary;
    },
    {
      totalCandidates: 0,
      certainCount: 0,
      plausibleCount: 0,
      questionCount: 0,
      pendingCount: 0,
      insertedCount: 0,
      rejectedCount: 0,
    }
  );
}

function deriveDraftStatus(input: {
  candidates: GeneratedOuvrageCandidateRow[];
  applications: GeneratedOuvrageApplicationRow[];
}): GeneratedOuvrageDraftStatus {
  const pendingCount = input.candidates.filter(
    (candidate) => candidate.resolution_status === "pending"
  ).length;

  if (input.applications.length === 0) {
    return pendingCount === 0 ? "discarded" : "pending";
  }

  return pendingCount === 0 ? "applied" : "partially_applied";
}

async function updateDraftProjection(input: {
  supabase: Supabase;
  draft: GeneratedOuvrageDraftRow;
  candidates: GeneratedOuvrageCandidateRow[];
  applications: GeneratedOuvrageApplicationRow[];
  generationMetadata?: JsonRecord;
}) {
  const summary = buildDraftSummary(input.candidates);
  const nextStatus = deriveDraftStatus({
    candidates: input.candidates,
    applications: input.applications,
  });

  const payload: Record<string, unknown> = {
    status: nextStatus,
    summary: toJson(summary),
    applied_at:
      nextStatus === "applied" || nextStatus === "partially_applied"
        ? input.draft.applied_at ?? new Date().toISOString()
        : null,
  };

  if (input.generationMetadata) {
    payload.generation_metadata = toJson(input.generationMetadata);
  }

  const { data, error } = await input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update(payload as never)
    .eq("id", input.draft.id)
    .select("*" as never)
    .single();

  if (error || !data) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le brouillon d'ouvrages.");
  }

  return data as GeneratedOuvrageDraftRow;
}

async function logEstimateVersionEventIfPossible(input: {
  versionId: string;
  eventType:
    | "generated_ouvrage_draft_created"
    | "generated_ouvrage_inserted"
    | "generated_ouvrage_discarded";
  actorUserId: string | null;
  metadata: JsonRecord;
}) {
  try {
    const rpcClient = createServiceRoleClient();
    const { error } = await rpcClient.rpc("log_estimate_version_event", {
      p_estimate_version_id: input.versionId,
      p_event_type: input.eventType,
      p_created_by: input.actorUserId,
      p_metadata: toJson(input.metadata),
      p_occurred_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Failed to log generated ouvrage event", {
        versionId: input.versionId,
        eventType: input.eventType,
        error,
      });
    }
  } catch (error) {
    console.error("Failed to initialize service-role event logging", {
      versionId: input.versionId,
      eventType: input.eventType,
      error,
    });
  }
}

async function loadGeneratedOuvrageDraftOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  draftId: string;
}): Promise<DraftLoaded> {
  const [draftResult, fragmentResult, candidateResult, candidateSourceResult, applicationResult] =
    (await Promise.all([
      input.supabase
        .from("estimate_generated_ouvrage_drafts" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("target_version_id", input.versionId)
        .eq("id", input.draftId)
        .single(),
      input.supabase
        .from("estimate_generated_ouvrage_source_fragments" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("fragment_order", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_candidates" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("candidate_order", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_candidate_sources" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("source_rank", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_applications" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("created_at", { ascending: true }),
    ])) as [
      { data: unknown; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
    ];

  if (draftResult.error || !draftResult.data) {
    if (draftResult.error) {
      throw mapSupabaseError(
        draftResult.error as never,
        "Impossible de charger le brouillon d'ouvrages."
      );
    }
    throw notFound("Brouillon d'ouvrages introuvable.");
  }

  if (fragmentResult.error) {
    throw mapSupabaseError(
      fragmentResult.error as never,
      "Impossible de charger les fragments sources du brouillon."
    );
  }

  if (candidateResult.error) {
    throw mapSupabaseError(
      candidateResult.error as never,
      "Impossible de charger les candidats d'ouvrages."
    );
  }

  if (candidateSourceResult.error) {
    throw mapSupabaseError(
      candidateSourceResult.error as never,
      "Impossible de charger les rattachements source des candidats."
    );
  }

  if (applicationResult.error) {
    throw mapSupabaseError(
      applicationResult.error as never,
      "Impossible de charger les applications du brouillon."
    );
  }

  return {
    draft: draftResult.data as GeneratedOuvrageDraftRow,
    fragments: (fragmentResult.data ?? []) as GeneratedOuvrageSourceFragmentRow[],
    candidates: (candidateResult.data ?? []) as GeneratedOuvrageCandidateRow[],
    candidateSources: (candidateSourceResult.data ?? []) as GeneratedOuvrageCandidateSourceRow[],
    applications: (applicationResult.data ?? []) as GeneratedOuvrageApplicationRow[],
  };
}

function normalizeDraftResult(loaded: DraftLoaded): GeneratedOuvrageDraftResult {
  const fragmentById = new Map(
    loaded.fragments.map((fragment) => [fragment.id, fragment] as const)
  );
  const sourceRowsByCandidateId = new Map<string, GeneratedOuvrageCandidateSourceRow[]>();

  for (const row of loaded.candidateSources) {
    const current = sourceRowsByCandidateId.get(row.candidate_id);
    if (current) {
      current.push(row);
    } else {
      sourceRowsByCandidateId.set(row.candidate_id, [row]);
    }
  }

  const summary = buildDraftSummary(loaded.candidates);

  return {
    draftId: loaded.draft.id,
    versionId: loaded.draft.target_version_id,
    projectId: loaded.draft.project_id,
    sourceKind: loaded.draft.source_kind,
    preferredLotId: loaded.draft.preferred_lot_id,
    status: loaded.draft.status,
    summary,
    generatedAt: loaded.draft.created_at,
    candidates: loaded.candidates.map((candidate) => ({
      candidateId: candidate.id,
      suggestedLotId: candidate.suggested_lot_id,
      lotLabel: candidate.lot_label,
      designation: candidate.designation,
      unit: candidate.unit,
      quantity: candidate.quantity,
      confidence: clampConfidence(candidate.confidence),
      status: candidate.ai_status,
      resolutionStatus: candidate.resolution_status,
      reasoning: candidate.reasoning,
      sources: (sourceRowsByCandidateId.get(candidate.id) ?? [])
        .sort((left, right) => left.source_rank - right.source_rank)
        .map((row) => fragmentById.get(row.source_fragment_id))
        .filter(
          (fragment): fragment is GeneratedOuvrageSourceFragmentRow => Boolean(fragment)
        )
        .map((fragment) => ({
          sourceFragmentId: fragment.id,
          sourceDocumentId: fragment.source_document_id,
          type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
          label: fragment.label,
          excerpt: fragment.excerpt,
          sourceFileName: fragment.source_file_name,
          sourcePageFrom: fragment.source_page_from,
          sourcePageTo: fragment.source_page_to,
          selectionLabel: fragment.selection_label,
        })),
    })),
  };
}

function pickPrimaryFragment(
  fragmentSources: GeneratedOuvrageCandidateSource[]
): GeneratedOuvrageCandidateSource | null {
  return fragmentSources[0] ?? null;
}

async function rollbackInsertedGeneratedOuvrages(input: {
  supabase: Supabase;
  versionId: string;
  createdEstimateItemIds: string[];
  candidateReverts: Array<{
    candidateId: string;
    resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
    metadata: Json;
  }>;
}) {
  if (input.createdEstimateItemIds.length > 0) {
    const { error: deleteItemsError } = await input.supabase
      .from("estimate_items" as never)
      .delete()
      .eq("version_id", input.versionId)
      .in("id", input.createdEstimateItemIds);

    if (deleteItemsError) {
      throw mapSupabaseError(
        deleteItemsError,
        "Impossible de restaurer les lignes d'estimation apres un echec d'insertion."
      );
    }
  }

  for (const revert of input.candidateReverts) {
    const { error: revertCandidateError } = await input.supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .update({
        resolution_status: revert.resolutionStatus,
        metadata: revert.metadata,
      } as never)
      .eq("id", revert.candidateId);

    if (revertCandidateError) {
      throw mapSupabaseError(
        revertCandidateError,
        "Impossible de restaurer le statut d'un candidat d'ouvrage apres un echec d'insertion."
      );
    }
  }
}

export async function generateOuvragesFromText(
  input: GenerateGeneratedOuvrageInput
): Promise<GeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageGenerateInputSchema.parse({
    ...input,
    sourceText: normalizeMultilineText(input.sourceText, MAX_SOURCE_TEXT_LENGTH),
    sourceFileName: input.sourceFileName
      ? normalizeText(input.sourceFileName, MAX_SOURCE_FILE_NAME_LENGTH)
      : null,
    selectionLabel: input.selectionLabel
      ? normalizeText(input.selectionLabel, MAX_SELECTION_LABEL_LENGTH)
      : null,
  });

  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  if (project.id !== parsed.projectId) {
    throw notFound("Affaire introuvable.");
  }

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
  });

  const preferredLotLabel = parsed.preferredLotId
    ? await loadLotLabel({
        supabase,
        tenantId,
        versionId: parsed.versionId,
        lotId: parsed.preferredLotId,
      })
    : null;

  const { data: draftData, error: draftError } = await supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .insert({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      target_version_id: parsed.versionId,
      created_by: userId,
      source_kind: parsed.sourceKind,
      preferred_lot_id: parsed.preferredLotId ?? null,
      status: "pending",
      summary: {},
      generation_metadata: {},
    } as never)
    .select("*" as never)
    .single();

  if (draftError || !draftData) {
    throw mapSupabaseError(draftError, "Impossible de creer le brouillon d'ouvrages.");
  }

  const draft = draftData as GeneratedOuvrageDraftRow;
  let fragments: GeneratedOuvrageSourceFragmentRow[] = [];
  let candidates: GeneratedOuvrageCandidateRow[] = [];
  let sourceLinkRows: Array<{
    tenant_id: string;
    draft_id: string;
    candidate_id: string;
    source_fragment_id: string;
    source_rank: number;
    rationale: string | null;
    metadata: JsonRecord;
  }> = [];
  let generation: Awaited<ReturnType<typeof generatePromptCandidates>> | null = null;
  let updatedDraft: GeneratedOuvrageDraftRow | null = null;

  try {
    const fragmentSeeds = await buildSourceFragmentSeeds({
      supabase,
      tenantId,
      project,
      versionId: parsed.versionId,
      sourceKind: parsed.sourceKind,
      sourceText: parsed.sourceText,
      sourceDocumentId: parsed.sourceDocumentId ?? null,
      sourceFileName: parsed.sourceFileName ?? null,
      sourcePageFrom: parsed.sourcePageFrom ?? null,
      sourcePageTo: parsed.sourcePageTo ?? null,
      selectionLabel: parsed.selectionLabel ?? null,
    });

    const fragmentInsertRows = fragmentSeeds.map((seed, index) => ({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      draft_id: draft.id,
      fragment_order: index,
      source_kind: seed.sourceKind,
      status: "active",
      label: normalizeText(seed.label, 180),
      excerpt: seed.excerpt,
      normalized_excerpt: seed.excerpt.toLowerCase(),
      source_document_id: seed.sourceDocumentId ?? null,
      source_file_name: toNullableText(seed.sourceFileName),
      source_page_from: seed.sourcePageFrom ?? null,
      source_page_to: seed.sourcePageTo ?? null,
      selection_label: toNullableText(seed.selectionLabel),
      cctp_section_ref: toNullableText(seed.cctpSectionRef),
      metadata: seed.metadata ?? {},
    }));

    const { data: fragmentData, error: fragmentError } = await supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .insert(fragmentInsertRows as never)
      .select("*" as never)
      .order("fragment_order", { ascending: true });

    if (fragmentError || !fragmentData) {
      throw mapSupabaseError(
        fragmentError,
        "Impossible de persister les fragments sources des ouvrages."
      );
    }

    fragments = fragmentData as GeneratedOuvrageSourceFragmentRow[];
    generation = await generatePromptCandidates({
      project,
      sourceKind: parsed.sourceKind,
      preferredLotLabel,
      fragments,
    });

    const sanitizedCandidates = sanitizePromptCandidates({
      promptCandidates: generation.exchange.candidates,
      fragments,
      preferredLotId: parsed.preferredLotId ?? null,
      preferredLotLabel,
    });

    const candidateInsertRows = sanitizedCandidates.map((candidate) => ({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      target_version_id: parsed.versionId,
      draft_id: draft.id,
      candidate_order: candidate.candidateOrder,
      suggested_lot_id: candidate.suggestedLotId,
      lot_label: candidate.lotLabel,
      designation: candidate.designation,
      normalized_designation: candidate.normalizedDesignation,
      unit: candidate.unit,
      quantity: candidate.quantity,
      confidence: candidate.confidence,
      ai_status: candidate.aiStatus,
      resolution_status: "pending",
      reasoning: candidate.reasoning,
      metadata: {},
    }));

    const { data: candidateData, error: candidateError } = await supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .insert(candidateInsertRows as never)
      .select("*" as never)
      .order("candidate_order", { ascending: true });

    if (candidateError || !candidateData) {
      throw mapSupabaseError(
        candidateError,
        "Impossible de persister les candidats d'ouvrages."
      );
    }

    candidates = candidateData as GeneratedOuvrageCandidateRow[];
    sourceLinkRows = candidates.flatMap((candidate, index) => {
      const sourceFragmentIds = sanitizedCandidates[index]?.sourceFragmentIds ?? [];
      return sourceFragmentIds.map((sourceFragmentId, sourceRank) => ({
        tenant_id: tenantId,
        draft_id: draft.id,
        candidate_id: candidate.id,
        source_fragment_id: sourceFragmentId,
        source_rank: sourceRank,
        rationale: sanitizedCandidates[index]?.reasoning ?? null,
        metadata: {},
      }));
    });

    if (sourceLinkRows.length > 0) {
      const { error: sourceLinkError } = await supabase
        .from("estimate_generated_ouvrage_candidate_sources" as never)
        .insert(sourceLinkRows as never);

      if (sourceLinkError) {
        throw mapSupabaseError(
          sourceLinkError,
          "Impossible de persister la provenance des candidats."
        );
      }
    }

    updatedDraft = await updateDraftProjection({
      supabase,
      draft,
      candidates,
      applications: [],
      generationMetadata: {
        model: generation.metadata.model ?? null,
        prompt_version: generation.metadata.prompt_version,
        used_fallback: Boolean(generation.metadata.used_fallback),
        token_count: generation.metadata.token_count ?? null,
        cost_cents: generation.metadata.cost_cents ?? null,
        duration_ms: generation.metadata.duration_ms ?? null,
        summary: generation.metadata.summary ?? null,
        source_fragment_count: fragments.length,
        candidate_count: candidates.length,
        preferred_lot_label: preferredLotLabel,
        source_document_id: parsed.sourceDocumentId ?? null,
      },
    });
  } catch (error) {
    try {
      await discardGeneratedOuvrageDraftOnFailure({
        supabase,
        draftId: draft.id,
      });
    } catch (cleanupError) {
      throw internalError(
        "La generation du brouillon a echoue et son archivage automatique a aussi echoue.",
        {
          draftId: draft.id,
          cause: error,
          cleanupError,
        },
        "EST381_DRAFT_GENERATION_CLEANUP_FAILED"
      );
    }

    throw error;
  }

  await discardPendingGeneratedOuvrageDrafts({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
    excludeDraftId: draft.id,
  });

  if (!updatedDraft || !generation) {
    throw internalError(
      "Le brouillon d'ouvrages genere est incomplet apres materialisation.",
      { draftId: draft.id },
      "EST381_DRAFT_GENERATION_INCOMPLETE"
    );
  }

  await logEstimateVersionEventIfPossible({
    versionId: parsed.versionId,
    eventType: "generated_ouvrage_draft_created",
    actorUserId: userId,
    metadata: {
      draft_id: draft.id,
      source_kind: parsed.sourceKind,
      candidate_count: candidates.length,
      question_count: candidates.filter((candidate) => candidate.ai_status === "question")
        .length,
      used_fallback: Boolean(generation?.metadata.used_fallback),
    },
  });

  return normalizeDraftResult({
    draft: updatedDraft,
    fragments,
    candidates,
    candidateSources: sourceLinkRows.map((row, index) => ({
      id: `pending-link-${index}`,
      created_at: updatedDraft.created_at,
      tenant_id: tenantId,
      draft_id: row.draft_id,
      candidate_id: row.candidate_id,
      source_fragment_id: row.source_fragment_id,
      source_rank: row.source_rank,
      rationale: row.rationale,
      metadata: row.metadata as Json,
    })),
    applications: [],
  });
}

export async function fetchGeneratedOuvrageDraft(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageFetchInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  await getVersionAccessOrThrow(supabase, parsed.versionId, context);

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });

  return normalizeDraftResult(loaded);
}

export async function insertGeneratedOuvrages(
  input: InsertGeneratedOuvragesInput
): Promise<InsertGeneratedOuvragesResult> {
  const parsed = generatedOuvrageInsertInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, parsed.versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });

  if (loaded.draft.status === "discarded") {
    throw conflict("Ce brouillon a deja ete rejete.", undefined, "EST381_DRAFT_DISCARDED");
  }

  const candidateById = new Map(
    loaded.candidates.map((candidate) => [candidate.id, candidate] as const)
  );
  const existingApplicationsByCandidateId = new Map(
    loaded.applications.map((application) => [application.candidate_id, application] as const)
  );
  const candidateSourcesByCandidateId = new Map<string, GeneratedOuvrageCandidateSource[]>();

  const normalizedDraft = normalizeDraftResult(loaded);
  for (const candidate of normalizedDraft.candidates) {
    candidateSourcesByCandidateId.set(candidate.candidateId, candidate.sources);
  }

  const seenAcceptedCandidateIds = new Set<string>();
  const preparedAcceptedCandidates = parsed.acceptedCandidates.map((acceptedCandidate) => {
    const candidate = candidateById.get(acceptedCandidate.candidateId);
    if (!candidate) {
      throw notFound("Candidat d'ouvrage introuvable.");
    }

    if (seenAcceptedCandidateIds.has(candidate.id)) {
      throw conflict(
        "Ce candidat d'ouvrage est present plusieurs fois dans le lot d'insertion.",
        { candidateId: candidate.id },
        "EST381_DUPLICATE_ACCEPTED_CANDIDATE"
      );
    }
    seenAcceptedCandidateIds.add(candidate.id);

    if (candidate.resolution_status !== "pending") {
      throw conflict(
        "Ce candidat n'est plus disponible pour insertion.",
        { candidateId: candidate.id, status: candidate.resolution_status },
        "EST381_CANDIDATE_NOT_PENDING"
      );
    }

    if (existingApplicationsByCandidateId.has(candidate.id)) {
      throw conflict(
        "Ce candidat a deja ete applique.",
        { candidateId: candidate.id },
        "EST381_CANDIDATE_ALREADY_APPLIED"
      );
    }

    if (typeof acceptedCandidate.quantity !== "number") {
      throw badRequest(
        "La quantite doit etre renseignee avant l'insertion du candidat.",
        { candidateId: candidate.id },
        "EST381_CANDIDATE_QUANTITY_REQUIRED"
      );
    }

    const fragmentSources = candidateSourcesByCandidateId.get(candidate.id) ?? [];
    const primaryFragment = pickPrimaryFragment(fragmentSources);
    const designation = normalizeText(acceptedCandidate.designation, 500);
    const appliedPayload = {
      designation,
      unit: toNullableText(acceptedCandidate.unit),
      quantity: acceptedCandidate.quantity,
      lot_id: acceptedCandidate.lotId ?? null,
      suggested_lot_id: candidate.suggested_lot_id,
      ai_status: candidate.ai_status,
      confidence: clampConfidence(candidate.confidence),
      source_fragment_ids: fragmentSources.map((source) => source.sourceFragmentId),
    } satisfies JsonRecord;

    return {
      acceptedCandidate,
      appliedPayload,
      candidate,
      designation,
      primaryFragment,
      quantity: acceptedCandidate.quantity,
    };
  });

  let insertedCount = 0;
  const refreshedApplications = [...loaded.applications];
  const refreshedCandidates = [...loaded.candidates];
  const createdEstimateItemIds: string[] = [];
  const candidateReverts: Array<{
    candidateId: string;
    resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
    metadata: Json;
  }> = [];
  let updatedDraft: GeneratedOuvrageDraftRow | null = null;

  try {
    for (const preparedCandidate of preparedAcceptedCandidates) {
      const {
        acceptedCandidate,
        appliedPayload,
        candidate,
        designation,
        primaryFragment,
        quantity,
      } = preparedCandidate;

      const createResult = await createEstimateItem(parsed.versionId, {
        item_type: "line",
        parent_id: acceptedCandidate.lotId ?? null,
        title: designation,
        quantity,
        unit_price_ht_cents: 0,
        source_provider: "generated_ouvrage",
        source_job_id: loaded.draft.id,
        source_file_name: primaryFragment?.sourceFileName ?? null,
        source_page: primaryFragment?.sourcePageFrom ?? null,
      });

      createdEstimateItemIds.push(createResult.item.id);

      const { data: applicationData, error: applicationError } = await supabase
        .from("estimate_generated_ouvrage_applications" as never)
        .insert({
          tenant_id: tenantId,
          draft_id: loaded.draft.id,
          candidate_id: candidate.id,
          target_version_id: parsed.versionId,
          estimate_item_id: createResult.item.id,
          applied_by: userId,
          applied_payload: appliedPayload,
        } as never)
        .select("*" as never)
        .single();

      if (applicationError || !applicationData) {
        throw mapSupabaseError(
          applicationError,
          "Impossible de tracer l'application du candidat d'ouvrage."
        );
      }

      const nextCandidateMetadata = {
        ...(candidate.metadata && typeof candidate.metadata === "object"
          ? (candidate.metadata as JsonRecord)
          : {}),
        applied_at: new Date().toISOString(),
        applied_by: userId,
      };

      const { data: updatedCandidateData, error: updatedCandidateError } = await supabase
        .from("estimate_generated_ouvrage_candidates" as never)
        .update({
          resolution_status: "inserted",
          metadata: nextCandidateMetadata,
        } as never)
        .eq("id", candidate.id)
        .select("*" as never)
        .single();

      if (updatedCandidateError || !updatedCandidateData) {
        throw mapSupabaseError(
          updatedCandidateError,
          "Impossible de mettre a jour le statut du candidat d'ouvrage."
        );
      }

      candidateReverts.push({
        candidateId: candidate.id,
        resolutionStatus: candidate.resolution_status,
        metadata: candidate.metadata,
      });
      existingApplicationsByCandidateId.set(
        candidate.id,
        applicationData as GeneratedOuvrageApplicationRow
      );
      refreshedApplications.push(applicationData as GeneratedOuvrageApplicationRow);

      const candidateIndex = refreshedCandidates.findIndex((entry) => entry.id === candidate.id);
      if (candidateIndex >= 0) {
        refreshedCandidates[candidateIndex] = updatedCandidateData as GeneratedOuvrageCandidateRow;
      }

      insertedCount += 1;
    }

    updatedDraft = await updateDraftProjection({
      supabase,
      draft: loaded.draft,
      candidates: refreshedCandidates,
      applications: refreshedApplications,
    });
  } catch (error) {
    try {
      await rollbackInsertedGeneratedOuvrages({
        supabase,
        versionId: parsed.versionId,
        createdEstimateItemIds,
        candidateReverts,
      });
    } catch (rollbackError) {
      throw internalError(
        "L'insertion des ouvrages a echoue et la restauration automatique est incomplete.",
        {
          draftId: loaded.draft.id,
          cause: error,
          rollbackError,
        },
        "EST381_INSERT_ROLLBACK_FAILED"
      );
    }

    throw error;
  }

  if (!updatedDraft) {
    throw internalError(
      "Le brouillon d'ouvrages n'a pas pu etre actualise apres insertion.",
      { draftId: loaded.draft.id },
      "EST381_INSERT_DRAFT_UPDATE_MISSING"
    );
  }

  if (insertedCount > 0) {
    await logEstimateVersionEventIfPossible({
      versionId: parsed.versionId,
      eventType: "generated_ouvrage_inserted",
      actorUserId: userId,
      metadata: {
        draft_id: loaded.draft.id,
        inserted_count: insertedCount,
        candidate_ids: parsed.acceptedCandidates.map((candidate) => candidate.candidateId),
      },
    });
  }

  return {
    ok: true,
    insertedCount,
    draftStatus: updatedDraft?.status ?? loaded.draft.status,
    projectId: loaded.draft.project_id,
    versionId: parsed.versionId,
  };
}

export async function rejectGeneratedOuvrageDraft(
  input: RejectGeneratedOuvrageDraftInput
): Promise<RejectGeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageRejectInputSchema.parse({
    ...input,
    reason: input.reason ? normalizeText(input.reason, MAX_REASON_LENGTH) : null,
  });

  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { data: draftData, error: draftLookupError } = await supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .select("*" as never)
    .eq("tenant_id", tenantId)
    .eq("id", parsed.draftId)
    .single();

  if (draftLookupError || !draftData) {
    throw mapSupabaseError(draftLookupError, "Impossible de charger le brouillon d'ouvrages.");
  }

  const draft = draftData as GeneratedOuvrageDraftRow;
  const { version } = await getVersionAccessOrThrow(supabase, draft.target_version_id, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: draft.target_version_id,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: draft.target_version_id,
    draftId: draft.id,
  });

  if (loaded.draft.status === "discarded") {
    throw conflict("Ce brouillon a deja ete rejete.", undefined, "EST381_DRAFT_DISCARDED");
  }

  const candidate = loaded.candidates.find((entry) => entry.id === parsed.candidateId);
  if (!candidate) {
    throw notFound("Candidat d'ouvrage introuvable.");
  }

  if (candidate.resolution_status !== "pending") {
    throw conflict(
      "Ce candidat n'est plus disponible pour rejet.",
      { candidateId: candidate.id, status: candidate.resolution_status },
      "EST381_CANDIDATE_NOT_PENDING"
    );
  }

  const nextMetadata = {
    ...(candidate.metadata && typeof candidate.metadata === "object"
      ? (candidate.metadata as JsonRecord)
      : {}),
    rejection_reason: parsed.reason ?? null,
    rejected_at: new Date().toISOString(),
    rejected_by: userId,
  } satisfies JsonRecord;

  const { data: updatedCandidateData, error: updatedCandidateError } = await supabase
    .from("estimate_generated_ouvrage_candidates" as never)
    .update({
      resolution_status: "rejected",
      metadata: nextMetadata,
    } as never)
    .eq("id", candidate.id)
    .select("*" as never)
    .single();

  if (updatedCandidateError || !updatedCandidateData) {
    throw mapSupabaseError(
      updatedCandidateError,
      "Impossible de mettre a jour le statut du candidat d'ouvrage."
    );
  }

  const refreshedCandidates = loaded.candidates.map((entry) =>
    entry.id === candidate.id
      ? (updatedCandidateData as GeneratedOuvrageCandidateRow)
      : entry
  );

  const updatedDraft = await updateDraftProjection({
    supabase,
    draft: loaded.draft,
    candidates: refreshedCandidates,
    applications: loaded.applications,
  });

  if (updatedDraft.status === "discarded") {
    const { error: fragmentError } = await supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .update({
        status: "discarded",
      } as never)
      .eq("draft_id", updatedDraft.id);

    if (fragmentError) {
      throw mapSupabaseError(
        fragmentError,
        "Impossible d'archiver les fragments du brouillon rejete."
      );
    }

    await logEstimateVersionEventIfPossible({
      versionId: updatedDraft.target_version_id,
      eventType: "generated_ouvrage_discarded",
      actorUserId: userId,
      metadata: {
        draft_id: updatedDraft.id,
        reason: parsed.reason ?? null,
      },
    });
  }

  return {
    ok: true,
    draftStatus: updatedDraft.status,
    projectId: updatedDraft.project_id,
    versionId: updatedDraft.target_version_id,
  };
}

export async function enrichEstimateItemsWithGeneratedOuvrageProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  items: EstimateItemRow[];
}) {
  const itemIds = input.items.map((item) => item.id);

  if (itemIds.length === 0) {
    return input.items;
  }

  const { data: applicationData, error: applicationError } = await input.supabase
    .from("estimate_generated_ouvrage_applications" as never)
    .select("*" as never)
    .eq("tenant_id", input.tenantId)
    .in("estimate_item_id", itemIds);

  if (applicationError || !applicationData || applicationData.length === 0) {
    return input.items;
  }

  const applications = applicationData as GeneratedOuvrageApplicationRow[];
  const candidateIds = Array.from(new Set(applications.map((row) => row.candidate_id)));
  const draftIds = Array.from(new Set(applications.map((row) => row.draft_id)));

  const [candidateResult, draftResult, candidateSourceResult, fragmentResult] = await Promise.all([
    input.supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_drafts" as never)
      .select("id, created_at, generation_metadata" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", draftIds),
    input.supabase
      .from("estimate_generated_ouvrage_candidate_sources" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("candidate_id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("draft_id", draftIds),
  ]);

  if (
    candidateResult.error ||
    draftResult.error ||
    candidateSourceResult.error ||
    fragmentResult.error
  ) {
    return input.items;
  }

  const candidateById = new Map(
    ((candidateResult.data ?? []) as GeneratedOuvrageCandidateRow[]).map((row) => [
      row.id,
      row,
    ] as const)
  );
  const draftById = new Map(
    ((draftResult.data ?? []) as Array<{
      id: string;
      created_at: string;
      generation_metadata: Json;
    }>).map((row) => [row.id, row] as const)
  );
  const fragmentById = new Map(
    ((fragmentResult.data ?? []) as GeneratedOuvrageSourceFragmentRow[]).map((row) => [
      row.id,
      row,
    ] as const)
  );

  const sourceRowsByCandidateId = new Map<string, GeneratedOuvrageCandidateSourceRow[]>();
  for (const row of (candidateSourceResult.data ?? []) as GeneratedOuvrageCandidateSourceRow[]) {
    const current = sourceRowsByCandidateId.get(row.candidate_id);
    if (current) {
      current.push(row);
    } else {
      sourceRowsByCandidateId.set(row.candidate_id, [row]);
    }
  }

  const applicationByItemId = new Map(
    applications.map((row) => [row.estimate_item_id, row] as const)
  );

  return input.items.map((item) => {
    const application = applicationByItemId.get(item.id);
    if (!application) {
      return item;
    }

    const candidate = candidateById.get(application.candidate_id);
    const draft = draftById.get(application.draft_id);
    const sources = (sourceRowsByCandidateId.get(application.candidate_id) ?? [])
      .sort((left, right) => left.source_rank - right.source_rank)
      .map((row) => fragmentById.get(row.source_fragment_id))
      .filter(
        (fragment): fragment is GeneratedOuvrageSourceFragmentRow => Boolean(fragment)
      )
      .map((fragment) => ({
        source_fragment_id: fragment.id,
        source_document_id: fragment.source_document_id,
        type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
        label: fragment.label,
        excerpt: fragment.excerpt,
        source_file_name: fragment.source_file_name,
        source_page_from: fragment.source_page_from,
        source_page_to: fragment.source_page_to,
        selection_label: fragment.selection_label,
      }));

    const generationMetadata =
      draft?.generation_metadata && typeof draft.generation_metadata === "object"
        ? (draft.generation_metadata as JsonRecord)
        : {};

    const appliedPayload =
      application.applied_payload && typeof application.applied_payload === "object"
        ? (application.applied_payload as JsonRecord)
        : {};

    return {
      ...item,
      source_provider: "generated_ouvrage",
      source_job_id: application.draft_id,
      source_file_name:
        toNullableText(item.source_file_name) ??
        toNullableText(sources[0]?.source_file_name) ??
        "Ouvrage genere",
      source_page: item.source_page ?? sources[0]?.source_page_from ?? null,
      source_extracted_at: draft?.created_at ?? item.source_extracted_at ?? null,
      source_metadata: {
        kind: "generated_ouvrage",
        draft_id: application.draft_id,
        candidate_id: application.candidate_id,
        application_id: application.id,
        ai_status: candidate?.ai_status ?? null,
        resolution_status: candidate?.resolution_status ?? null,
        confidence: candidate ? clampConfidence(candidate.confidence) : null,
        applied_values: {
          designation: appliedPayload.designation ?? candidate?.designation ?? item.title,
          unit: appliedPayload.unit ?? candidate?.unit ?? null,
          quantity: appliedPayload.quantity ?? candidate?.quantity ?? null,
          lot_id: appliedPayload.lot_id ?? null,
        },
        prompt_version: toNullableText(generationMetadata.prompt_version),
        used_fallback: Boolean(generationMetadata.used_fallback),
        sources,
      },
    };
  });
}
