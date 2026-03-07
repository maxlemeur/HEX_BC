import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "@/lib/estimates/errors";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import type { Database, Json } from "@/types/database";

import type {
  VersionZeroDraftStatus,
  VersionZeroLineReviewStatus,
  VersionZeroLotStatus,
} from "./schemas";

type Supabase = SupabaseClient<Database>;
type JsonRecord = Record<string, unknown>;
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionZeroDraftRow =
  Database["public"]["Tables"]["estimate_version_zero_drafts"]["Row"];
type EstimateVersionZeroLotRow =
  Database["public"]["Tables"]["estimate_version_zero_lots"]["Row"];
type EstimateVersionZeroLineRow =
  Database["public"]["Tables"]["estimate_version_zero_lines"]["Row"];
type EstimateVersionZeroApplicationInsert =
  Database["public"]["Tables"]["estimate_version_zero_applications"]["Insert"];

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

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

type VersionAccessRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "status"
  | "margin_multiplier"
  | "tax_rate_bp"
  | "updated_at"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;

type AffaireBriefRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  status: string;
  summary: string;
  project_object: string;
  scope: unknown;
  lots: unknown;
  assumptions: unknown;
  vigilance_points: unknown;
  missing_elements: unknown;
  updated_at: string;
};

type AffaireBriefSourceLinkRow = {
  source_document_id: string;
  block_key: string;
  entry_index: number;
  source_file_name: string;
  rationale: string | null;
};

type DraftLockRow = {
  id: string;
  version_id: string;
  user_id: string | null;
  locked_at: string | null;
  expires_at: string | null;
};

type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_metadata?: Json | null;
  source_extracted_at?: string | null;
};

type VersionZeroDraftState = "active" | "terminal";

export type VersionZeroReviewEvidence = {
  type: "fact" | "hypothesis" | "inference" | "risk";
  text: string;
};

export type VersionZeroReviewLine = {
  id: string;
  lotId: string;
  order: number;
  reviewStatus: VersionZeroLineReviewStatus;
  confidence: number;
  confidenceLabel: "elevee" | "moyenne" | "faible";
  proposed: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  edited: {
    title: string | null;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  effective: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  materializedEstimateItemId: string | null;
};

export type VersionZeroReviewLot = {
  id: string;
  key: string;
  label: string;
  order: number;
  status: VersionZeroLotStatus;
  confidence: number | null;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  lines: VersionZeroReviewLine[];
};

export type VersionZeroDraftSummary = {
  versionId: string;
  projectId: string;
  hasConfirmedBrief: boolean;
  confirmedBriefId: string | null;
  isVersionEmpty: boolean;
  canGenerate: boolean;
  availableLots: string[];
  activeDraft: {
    id: string;
    status: VersionZeroDraftStatus;
    createdAt: string;
    materializedAt: string | null;
    selectedLots: string[];
    counts: {
      lots: number;
      lines: number;
      pending: number;
      accepted: number;
      edited: number;
      rejected: number;
      missingLots: number;
      partialLots: number;
      lowConfidenceLines: number;
    };
    summaryText: string | null;
    state: VersionZeroDraftState;
  } | null;
};

export type VersionZeroReview = {
  draft: {
    id: string;
    versionId: string;
    projectId: string;
    briefId: string | null;
    status: VersionZeroDraftStatus;
    createdAt: string;
    updatedAt: string;
    materializedAt: string | null;
    selectedLots: string[];
    summaryText: string | null;
    generationMetadata: JsonRecord;
    counts: VersionZeroDraftSummary["activeDraft"]["counts"];
  };
  lots: VersionZeroReviewLot[];
};

type InternalVersionZeroLine = {
  proposedTitle: string;
  proposedDescription: string | null;
  proposedQuantity: number | null;
  proposedUnit: string | null;
  confidence: number;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
};

type InternalVersionZeroLot = {
  key: string;
  label: string;
  order: number;
  status: VersionZeroLotStatus;
  confidence: number | null;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  lines: InternalVersionZeroLine[];
};

type InternalVersionZeroGeneration = {
  lots: InternalVersionZeroLot[];
  summaryText: string | null;
  generationMetadata: JsonRecord;
};

type VersionZeroGeminiLine = {
  title: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missing_signals: string[];
  risk_signals: string[];
};

type VersionZeroGeminiLot = {
  lot_label: string;
  status: VersionZeroLotStatus;
  confidence: number;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missing_signals: string[];
  risk_signals: string[];
  lines: VersionZeroGeminiLine[];
};

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const VERSION_ZERO_ACTIVE_STATUSES: VersionZeroDraftStatus[] = [
  "ia_a_revoir",
  "ready_for_version",
];
const VERSION_ZERO_TERMINAL_STATUSES: VersionZeroDraftStatus[] = [
  "materialized",
  "discarded",
  "superseded",
];
const VERSION_ZERO_PROMPT_VERSION = "est384-v1";

const VersionZeroGeminiSchema = z.object({
  summary: z.union([z.string().trim().min(1).max(400), z.null()]).default(null),
  lots: z
    .array(
      z.object({
        lot_label: z.string().trim().min(1).max(160),
        status: z.enum(["generated", "partial", "missing"]).default("partial"),
        confidence: z.number().min(0).max(1).default(0.55),
        provenance: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        facts: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        hypotheses: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        inferences: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        missing_signals: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        risk_signals: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
        lines: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(240),
              description: z.union([z.string().trim().min(1).max(500), z.null()]).default(null),
              quantity: z.union([z.number().min(0), z.null()]).default(null),
              unit: z.union([z.string().trim().min(1).max(40), z.null()]).default(null),
              confidence: z.number().min(0).max(1).default(0.55),
              provenance: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
              facts: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
              hypotheses: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
              inferences: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
              missing_signals: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
              risk_signals: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
            })
          )
          .max(12)
          .default([]),
      })
    )
    .max(50)
    .default([]),
});

function resolveEmbeddedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickStringArray(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, limit);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalized = toNullableText(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });

  return result;
}

function normalizeLotKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "lot";
}

function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return 0.45;
  return Math.max(0, Math.min(1, Number(value)));
}

function getConfidenceLabel(value: number): "elevee" | "moyenne" | "faible" {
  if (value >= 0.75) return "elevee";
  if (value >= 0.55) return "moyenne";
  return "faible";
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    input.context.tenantRole === TENANT_ADMIN_ROLE
  );
}

function toJsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function readStringArrayFromJson(value: Json) {
  return pickStringArray(value, 64);
}

function extractLotMetadata(row: EstimateVersionZeroLotRow) {
  return toJsonRecord(row.metadata);
}

function extractLineMetadata(row: EstimateVersionZeroLineRow) {
  return toJsonRecord(row.metadata);
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;
  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
  };
}

async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
) {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_multiplier, tax_rate_bp, updated_at, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    project.is_archived ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version,
    project,
  };
}

function assertDraftStatus(status: EstimateStatus) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

async function getActiveDraftLockForVersion(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
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

  return (data ?? null) as DraftLockRow | null;
}

async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const lock = await getActiveDraftLockForVersion(input);
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

  throw conflict("Cette version est deja verrouillee par un autre utilisateur.", {
    lock: {
      version_id: lock.version_id,
      user_id: lock.user_id,
      locked_at: lock.locked_at,
      expires_at: lock.expires_at,
      is_owner: false,
    },
  });
}

async function assertVersionIsEmpty(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { count, error } = await input.supabase
    .from("estimate_items")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier le contenu de la version.");
  }

  if ((count ?? 0) > 0) {
    throw conflict(
      "La V0 ne peut etre generee ou appliquee que sur une version brouillon vide.",
      { versionId: input.versionId, itemCount: count ?? 0 },
      "EST384_VERSION_NOT_EMPTY"
    );
  }

  return true;
}

async function loadConfirmedBrief(input: {
  supabase: Supabase;
  projectId: string;
  briefId?: string | null;
}) {
  let query = input.supabase
    .from("affaire_briefs" as never)
    .select(
      "id, tenant_id, project_id, status, summary, project_object, scope, lots, assumptions, vigilance_points, missing_elements, updated_at" as never
    )
    .eq("project_id", input.projectId)
    .eq("status", "confirme");

  if (input.briefId) {
    query = query.eq("id", input.briefId);
  }

  const response = await query
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (response.error) {
    throw mapSupabaseError(response.error, "Impossible de charger le brief confirme.");
  }

  return (response.data ?? null) as AffaireBriefRow | null;
}

async function loadBriefSourceLinks(input: {
  supabase: Supabase;
  briefId: string;
}) {
  const response = await input.supabase
    .from("affaire_brief_source_links" as never)
    .select(
      "source_document_id, block_key, entry_index, source_file_name, rationale" as never
    )
    .eq("brief_id", input.briefId)
    .order("block_key", { ascending: true })
    .order("entry_index", { ascending: true });

  if (response.error) {
    throw mapSupabaseError(
      response.error,
      "Impossible de charger la provenance du brief confirme."
    );
  }

  return (response.data ?? []) as AffaireBriefSourceLinkRow[];
}

function filterRelevantEntries(entries: string[], lotLabel: string, fallbackLimit = 2) {
  const normalizedLot = normalizeLotKey(lotLabel);
  const relevant = entries.filter((entry) =>
    normalizeLotKey(entry).includes(normalizedLot) ||
    normalizedLot.includes(normalizeLotKey(entry))
  );
  return relevant.length > 0 ? relevant : entries.slice(0, fallbackLimit);
}

function buildFallbackLots(input: {
  brief: AffaireBriefRow;
  sourceLinks: AffaireBriefSourceLinkRow[];
  lotLabels: string[];
}) {
  const scope = pickStringArray(input.brief.scope, 16);
  const assumptions = pickStringArray(input.brief.assumptions, 8);
  const vigilancePoints = pickStringArray(input.brief.vigilance_points, 8);
  const missingElements = pickStringArray(input.brief.missing_elements, 8);
  const sourceFiles = uniqueStrings(input.sourceLinks.map((link) => link.source_file_name));

  return input.lotLabels.map((lotLabel, index) => {
    const relevantScope = filterRelevantEntries(scope, lotLabel, 2);
    const relevantMissing = filterRelevantEntries(missingElements, lotLabel, 2);
    const relevantVigilance = filterRelevantEntries(vigilancePoints, lotLabel, 2);
    const lotAssumptions = assumptions.slice(0, 2);
    const provenance = uniqueStrings([
      ...sourceFiles.slice(0, 3).map((name) => `Brief confirme: ${name}`),
      input.brief.summary,
    ]);
    const facts = uniqueStrings([
      input.brief.project_object,
      ...relevantScope,
    ]).slice(0, 4);
    const hypotheses = uniqueStrings([
      ...lotAssumptions,
      relevantScope.length === 0 ? `Le perimetre detaille du lot ${lotLabel} reste a confirmer.` : null,
    ]).slice(0, 4);
    const inferences = uniqueStrings([
      relevantScope.length > 0
        ? `Le lot ${lotLabel} doit etre structure a partir des elements explicites du brief.`
        : `Le lot ${lotLabel} necessite une decomposition manuelle complementaire.`,
    ]);
    const riskSignals = uniqueStrings([
      ...relevantVigilance,
      "Aucun prix automatique n'est propose par EST-384 sans validation humaine.",
    ]).slice(0, 4);
    const missingSignals = uniqueStrings([
      ...relevantMissing,
      relevantScope.length === 0 ? `Manque de details operatoires pour le lot ${lotLabel}.` : null,
    ]).slice(0, 4);

    const lines: InternalVersionZeroLine[] =
      relevantScope.length > 0
        ? relevantScope.slice(0, 3).map((entry, lineIndex) => ({
            proposedTitle:
              lineIndex === 0
                ? `${lotLabel} - prestation principale`
                : `${lotLabel} - poste ${lineIndex + 1}`,
            proposedDescription: entry,
            proposedQuantity: null,
            proposedUnit: null,
            confidence: relevantMissing.length === 0 ? 0.63 : 0.52,
            provenance,
            facts: uniqueStrings([entry, input.brief.project_object]).slice(0, 3),
            hypotheses: [...hypotheses],
            inferences: [...inferences],
            missingSignals: [...missingSignals],
            riskSignals: [...riskSignals],
          }))
        : [
            {
              proposedTitle: `${lotLabel} - chiffrage a consolider`,
              proposedDescription:
                "Lot identifie dans le brief confirme, mais decomposition detaillee a revoir.",
              proposedQuantity: null,
              proposedUnit: null,
              confidence: 0.38,
              provenance,
              facts,
              hypotheses,
              inferences,
              missingSignals,
              riskSignals,
            },
          ];

    const confidence =
      lines.length > 0
        ? lines.reduce((total, line) => total + line.confidence, 0) / lines.length
        : null;
    const hasMissingCoverage = relevantMissing.length > 0 || relevantScope.length === 0;

    return {
      key: normalizeLotKey(lotLabel),
      label: lotLabel,
      order: index,
      status: lines.length === 0 ? "missing" : hasMissingCoverage ? "partial" : "generated",
      confidence,
      provenance,
      facts,
      hypotheses,
      inferences,
      missingSignals,
      riskSignals,
      lines,
    } satisfies InternalVersionZeroLot;
  });
}

async function tryGenerateGeminiLots(input: {
  projectName: string;
  brief: AffaireBriefRow;
  sourceLinks: AffaireBriefSourceLinkRow[];
  lotLabels: string[];
}) {
  if (input.lotLabels.length === 0) {
    return null;
  }

  const sourceFiles = uniqueStrings(input.sourceLinks.map((link) => link.source_file_name));
  const prompt = [
    "Tu prepares une V0 de devis batiment relue par un humain.",
    "Contraintes obligatoires:",
    "- distinguer faits, hypotheses et inferences",
    "- ne proposer aucun prix",
    "- quantite et unite peuvent etre null si inconnues",
    "- si le brief est incomplet, utiliser status partial ou missing",
    "- produire des lignes courtes, auditables et explicables",
    "",
    `Projet: ${input.projectName}`,
    `Resume brief: ${input.brief.summary}`,
    `Objet: ${input.brief.project_object}`,
    `Lots cibles: ${input.lotLabels.join(", ")}`,
    `Scope: ${pickStringArray(input.brief.scope, 12).join(" | ") || "aucun"}`,
    `Hypotheses: ${pickStringArray(input.brief.assumptions, 8).join(" | ") || "aucune"}`,
    `Vigilance: ${pickStringArray(input.brief.vigilance_points, 8).join(" | ") || "aucune"}`,
    `Manquants: ${pickStringArray(input.brief.missing_elements, 8).join(" | ") || "aucun"}`,
    `Fichiers source: ${sourceFiles.join(", ") || "non renseignes"}`,
  ].join("\n");

  const result = await callGeminiStructured({
    prompt,
    schema: VersionZeroGeminiSchema,
    thinkingLevel: "low",
    timeoutMs: 25_000,
    maxRetries: 1,
    context: {
      promptVersion: VERSION_ZERO_PROMPT_VERSION,
    },
  });

  return result;
}

function mergeGeneratedLots(input: {
  fallbackLots: InternalVersionZeroLot[];
  aiLots: VersionZeroGeminiLot[] | null;
}) {
  if (!input.aiLots || input.aiLots.length === 0) {
    return input.fallbackLots;
  }

  const aiLotsByKey = new Map<string, VersionZeroGeminiLot>();
  input.aiLots.forEach((lot) => {
    aiLotsByKey.set(normalizeLotKey(lot.lot_label), lot);
  });

  return input.fallbackLots.map((fallbackLot) => {
    const aiLot = aiLotsByKey.get(fallbackLot.key);
    if (!aiLot) {
      return fallbackLot;
    }

    const lines =
      aiLot.lines.length > 0
        ? aiLot.lines.map((line) => ({
            proposedTitle: line.title,
            proposedDescription: line.description,
            proposedQuantity: line.quantity,
            proposedUnit: line.unit,
            confidence: clampConfidence(line.confidence),
            provenance: uniqueStrings([...line.provenance, ...fallbackLot.provenance]).slice(0, 8),
            facts: uniqueStrings([...line.facts, ...fallbackLot.facts]).slice(0, 8),
            hypotheses: uniqueStrings([
              ...line.hypotheses,
              ...fallbackLot.hypotheses,
            ]).slice(0, 8),
            inferences: uniqueStrings([
              ...line.inferences,
              ...fallbackLot.inferences,
            ]).slice(0, 8),
            missingSignals: uniqueStrings([
              ...line.missing_signals,
              ...fallbackLot.missingSignals,
            ]).slice(0, 8),
            riskSignals: uniqueStrings([
              ...line.risk_signals,
              ...fallbackLot.riskSignals,
            ]).slice(0, 8),
          }))
        : fallbackLot.lines;

    return {
      ...fallbackLot,
      status:
        aiLot.status ??
        (lines.length === 0
          ? "missing"
          : fallbackLot.missingSignals.length > 0
            ? "partial"
            : "generated"),
      confidence: clampConfidence(aiLot.confidence),
      provenance: uniqueStrings([...aiLot.provenance, ...fallbackLot.provenance]).slice(0, 8),
      facts: uniqueStrings([...aiLot.facts, ...fallbackLot.facts]).slice(0, 8),
      hypotheses: uniqueStrings([
        ...aiLot.hypotheses,
        ...fallbackLot.hypotheses,
      ]).slice(0, 8),
      inferences: uniqueStrings([
        ...aiLot.inferences,
        ...fallbackLot.inferences,
      ]).slice(0, 8),
      missingSignals: uniqueStrings([
        ...aiLot.missing_signals,
        ...fallbackLot.missingSignals,
      ]).slice(0, 8),
      riskSignals: uniqueStrings([
        ...aiLot.risk_signals,
        ...fallbackLot.riskSignals,
      ]).slice(0, 8),
      lines,
    } satisfies InternalVersionZeroLot;
  });
}

function computeDraftCounts(input: { lots: VersionZeroReviewLot[] }) {
  const counts = {
    lots: input.lots.length,
    lines: 0,
    pending: 0,
    accepted: 0,
    edited: 0,
    rejected: 0,
    missingLots: 0,
    partialLots: 0,
    lowConfidenceLines: 0,
  };

  input.lots.forEach((lot) => {
    if (lot.status === "missing") counts.missingLots += 1;
    if (lot.status === "partial") counts.partialLots += 1;

    lot.lines.forEach((line) => {
      counts.lines += 1;
      if (line.reviewStatus === "pending") counts.pending += 1;
      if (line.reviewStatus === "accepted") counts.accepted += 1;
      if (line.reviewStatus === "edited") counts.edited += 1;
      if (line.reviewStatus === "rejected") counts.rejected += 1;
      if (line.confidence < 0.55) counts.lowConfidenceLines += 1;
    });
  });

  return counts;
}

function buildSummaryPayload(input: { lots: InternalVersionZeroLot[]; summaryText: string | null }) {
  const counts = {
    lot_count: input.lots.length,
    line_count: input.lots.reduce((total, lot) => total + lot.lines.length, 0),
    missing_lot_count: input.lots.filter((lot) => lot.status === "missing").length,
    partial_lot_count: input.lots.filter((lot) => lot.status === "partial").length,
    low_confidence_line_count: input.lots.reduce(
      (total, lot) => total + lot.lines.filter((line) => line.confidence < 0.55).length,
      0
    ),
    summary_text: input.summaryText,
  };

  return counts satisfies JsonRecord;
}

async function persistGeneratedDraft(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  projectId: string;
  versionId: string;
  briefId: string | null;
  selectedLots: string[];
  generation: InternalVersionZeroGeneration;
}) {
  const { data: draftData, error: draftError } = await input.supabase
    .from("estimate_version_zero_drafts")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      brief_id: input.briefId,
      created_by: input.userId,
      status: "ia_a_revoir",
      summary: buildSummaryPayload({
        lots: input.generation.lots,
        summaryText: input.generation.summaryText,
      }),
      generation_metadata: input.generation.generationMetadata,
      selected_lots: input.selectedLots,
    })
    .select("*")
    .single();

  if (draftError || !draftData) {
    throw mapSupabaseError(draftError, "Impossible de creer le snapshot V0.");
  }

  const draft = draftData as EstimateVersionZeroDraftRow;
  const lotRows = input.generation.lots.map((lot) => ({
    tenant_id: input.tenantId,
    project_id: input.projectId,
    version_id: input.versionId,
    draft_id: draft.id,
    lot_key: lot.key,
    lot_order: lot.order,
    lot_label: lot.label,
    status: lot.status,
    confidence: lot.confidence,
    provenance: {
      items: lot.provenance,
    },
    risk_signals: lot.riskSignals,
    metadata: {
      facts: lot.facts,
      hypotheses: lot.hypotheses,
      inferences: lot.inferences,
      missing_signals: lot.missingSignals,
    },
  }));

  const { data: insertedLots, error: lotsError } = await input.supabase
    .from("estimate_version_zero_lots")
    .insert(lotRows)
    .select("*")
    .order("lot_order", { ascending: true });

  if (lotsError || !insertedLots) {
    throw mapSupabaseError(lotsError, "Impossible de persister les lots V0.");
  }

  const insertedLotRows = insertedLots as EstimateVersionZeroLotRow[];
  const lotIdByKey = new Map(insertedLotRows.map((row) => [row.lot_key, row.id]));

  const lineRows = input.generation.lots.flatMap((lot) =>
    lot.lines.map((line, index) => ({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      draft_id: draft.id,
      lot_id: lotIdByKey.get(lot.key) ?? "",
      line_order: index,
      review_status: "pending",
      proposed_title: line.proposedTitle,
      proposed_description: line.proposedDescription,
      proposed_quantity: line.proposedQuantity,
      proposed_unit: line.proposedUnit,
      confidence: line.confidence,
      provenance: {
        items: line.provenance,
      },
      facts: line.facts,
      hypotheses: line.hypotheses,
      inferences: line.inferences,
      missing_signals: line.missingSignals,
      metadata: {
        risk_signals: line.riskSignals,
      },
    }))
  );

  if (lineRows.length > 0) {
    const { error: linesError } = await input.supabase
      .from("estimate_version_zero_lines")
      .insert(lineRows);

    if (linesError) {
      throw mapSupabaseError(linesError, "Impossible de persister les lignes V0.");
    }
  }

  return draft;
}

async function supersedeActiveDrafts(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  newDraftId: string;
}) {
  const { error } = await input.supabase
    .from("estimate_version_zero_drafts")
    .update({
      status: "superseded",
      superseded_by_draft_id: input.newDraftId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .in("status", VERSION_ZERO_ACTIVE_STATUSES)
    .neq("id", input.newDraftId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de superseder la V0 precedente.");
  }
}

function toSummaryText(value: Json) {
  const record = toJsonRecord(value);
  return toNullableText(
    typeof record.summary_text === "string" ? record.summary_text : null
  );
}

function parseSelectedLots(value: Json) {
  return readStringArrayFromJson(value);
}

async function loadRelevantDrafts(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_version_zero_drafts")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les snapshots V0.");
  }

  return (data ?? []) as EstimateVersionZeroDraftRow[];
}

async function loadDraftOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  draftId?: string | null;
}) {
  const drafts = await loadRelevantDrafts(input);
  const draft =
    (input.draftId
      ? drafts.find((entry) => entry.id === input.draftId)
      : drafts.find((entry) => VERSION_ZERO_ACTIVE_STATUSES.includes(entry.status)) ??
        drafts[0]) ?? null;

  if (!draft) {
    throw notFound("Snapshot V0 introuvable.", undefined, "EST384_DRAFT_NOT_FOUND");
  }

  return draft;
}

function normalizeReviewLine(row: EstimateVersionZeroLineRow): VersionZeroReviewLine {
  const metadata = extractLineMetadata(row);
  const effective =
    row.review_status === "edited"
      ? {
          title: toNullableText(row.edited_title) ?? row.proposed_title,
          description:
            row.edited_description !== null ? row.edited_description : row.proposed_description,
          quantity:
            row.edited_quantity !== null ? Number(row.edited_quantity) : row.proposed_quantity,
          unit: row.edited_unit !== null ? row.edited_unit : row.proposed_unit,
        }
      : {
          title: row.proposed_title,
          description: row.proposed_description,
          quantity: row.proposed_quantity,
          unit: row.proposed_unit,
        };

  return {
    id: row.id,
    lotId: row.lot_id,
    order: row.line_order,
    reviewStatus: row.review_status,
    confidence: clampConfidence(row.confidence),
    confidenceLabel: getConfidenceLabel(clampConfidence(row.confidence)),
    proposed: {
      title: row.proposed_title,
      description: row.proposed_description,
      quantity: row.proposed_quantity,
      unit: row.proposed_unit,
    },
    edited: {
      title: row.edited_title,
      description: row.edited_description,
      quantity: row.edited_quantity,
      unit: row.edited_unit,
    },
    effective,
    provenance: readStringArrayFromJson(toJsonRecord(row.provenance).items as Json),
    facts: readStringArrayFromJson(row.facts),
    hypotheses: readStringArrayFromJson(row.hypotheses),
    inferences: readStringArrayFromJson(row.inferences),
    missingSignals: readStringArrayFromJson(row.missing_signals),
    riskSignals: readStringArrayFromJson(metadata.risk_signals as Json),
    materializedEstimateItemId: row.materialized_estimate_item_id,
  };
}

function normalizeReviewLot(input: {
  row: EstimateVersionZeroLotRow;
  lines: EstimateVersionZeroLineRow[];
}) {
  const metadata = extractLotMetadata(input.row);
  return {
    id: input.row.id,
    key: input.row.lot_key,
    label: input.row.lot_label,
    order: input.row.lot_order,
    status: input.row.status,
    confidence:
      input.row.confidence === null ? null : clampConfidence(input.row.confidence),
    provenance: readStringArrayFromJson(toJsonRecord(input.row.provenance).items as Json),
    facts: readStringArrayFromJson(metadata.facts as Json),
    hypotheses: readStringArrayFromJson(metadata.hypotheses as Json),
    inferences: readStringArrayFromJson(metadata.inferences as Json),
    missingSignals: readStringArrayFromJson(metadata.missing_signals as Json),
    riskSignals: readStringArrayFromJson(input.row.risk_signals),
    lines: input.lines
      .sort((left, right) => left.line_order - right.line_order)
      .map(normalizeReviewLine),
  } satisfies VersionZeroReviewLot;
}

async function loadReviewLots(input: {
  supabase: Supabase;
  tenantId: string;
  draftId: string;
}) {
  const [lotsResponse, linesResponse] = await Promise.all([
    input.supabase
      .from("estimate_version_zero_lots")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("draft_id", input.draftId)
      .order("lot_order", { ascending: true }),
    input.supabase
      .from("estimate_version_zero_lines")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("draft_id", input.draftId)
      .order("line_order", { ascending: true }),
  ]);

  if (lotsResponse.error) {
    throw mapSupabaseError(lotsResponse.error, "Impossible de charger les lots V0.");
  }
  if (linesResponse.error) {
    throw mapSupabaseError(linesResponse.error, "Impossible de charger les lignes V0.");
  }

  const lineRows = (linesResponse.data ?? []) as EstimateVersionZeroLineRow[];
  const linesByLotId = new Map<string, EstimateVersionZeroLineRow[]>();
  lineRows.forEach((line) => {
    const current = linesByLotId.get(line.lot_id) ?? [];
    current.push(line);
    linesByLotId.set(line.lot_id, current);
  });

  return ((lotsResponse.data ?? []) as EstimateVersionZeroLotRow[]).map((row) =>
    normalizeReviewLot({
      row,
      lines: linesByLotId.get(row.id) ?? [],
    })
  );
}

async function refreshDraftStatus(input: {
  supabase: Supabase;
  tenantId: string;
  draft: EstimateVersionZeroDraftRow;
  lots: VersionZeroReviewLot[];
}) {
  if (
    VERSION_ZERO_TERMINAL_STATUSES.includes(input.draft.status) ||
    input.lots.length === 0
  ) {
    return input.draft.status;
  }

  const counts = computeDraftCounts({ lots: input.lots });
  const nextStatus: VersionZeroDraftStatus =
    counts.pending === 0 ? "ready_for_version" : "ia_a_revoir";

  if (nextStatus === input.draft.status) {
    return input.draft.status;
  }

  const { error } = await input.supabase
    .from("estimate_version_zero_drafts")
    .update({
      status: nextStatus,
      summary: {
        ...toJsonRecord(input.draft.summary),
        pending_count: counts.pending,
        accepted_count: counts.accepted,
        edited_count: counts.edited,
        rejected_count: counts.rejected,
      },
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.draft.id);

  if (error) {
    throw mapSupabaseError(error, "Impossible de synchroniser le statut V0.");
  }

  return nextStatus;
}

async function buildDraftSummary(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  project: EmbeddedProjectAccess;
}) {
  const [confirmedBrief, drafts, isVersionEmpty] = await Promise.all([
    loadConfirmedBrief({
      supabase: input.context.supabase,
      projectId: input.project.id,
    }),
    loadRelevantDrafts({
      supabase: input.context.supabase,
      tenantId: input.context.tenantId,
      versionId: input.version.id,
    }),
    (async () => {
      const { count, error } = await input.context.supabase
        .from("estimate_items")
        .select("id", { head: true, count: "exact" })
        .eq("tenant_id", input.context.tenantId)
        .eq("version_id", input.version.id);

      if (error) {
        throw mapSupabaseError(error, "Impossible de verifier le contenu de la version.");
      }

      return (count ?? 0) === 0;
    })(),
  ]);

  const activeDraft =
    drafts.find((draft) => VERSION_ZERO_ACTIVE_STATUSES.includes(draft.status)) ?? null;

  let activeDraftSummary: VersionZeroDraftSummary["activeDraft"] = null;
  if (activeDraft) {
    const lots = await loadReviewLots({
      supabase: input.context.supabase,
      tenantId: input.context.tenantId,
      draftId: activeDraft.id,
    });
    const counts = computeDraftCounts({ lots });
    const nextStatus = await refreshDraftStatus({
      supabase: input.context.supabase,
      tenantId: input.context.tenantId,
      draft: activeDraft,
      lots,
    });

    activeDraftSummary = {
      id: activeDraft.id,
      status: nextStatus,
      createdAt: activeDraft.created_at,
      materializedAt: activeDraft.materialized_at,
      selectedLots: parseSelectedLots(activeDraft.selected_lots),
      counts,
      summaryText: toSummaryText(activeDraft.summary),
      state: "active",
    };
  }

  return {
    versionId: input.version.id,
    projectId: input.project.id,
    hasConfirmedBrief: Boolean(confirmedBrief),
    confirmedBriefId: confirmedBrief?.id ?? null,
    isVersionEmpty,
    canGenerate:
      confirmedBrief !== null && isVersionEmpty && input.version.status === "draft",
    availableLots: uniqueStrings(pickStringArray(confirmedBrief?.lots ?? [], 20)),
    activeDraft: activeDraftSummary,
  } satisfies VersionZeroDraftSummary;
}

export async function fetchVersionZeroDraftSummary(input: { versionId: string }) {
  const context = await getAuthenticatedContext();
  const { version, project } = await getVersionAccessOrThrow(
    context.supabase,
    input.versionId,
    context
  );

  return buildDraftSummary({
    context,
    version,
    project,
  });
}

export async function generateVersionZeroDraft(input: {
  versionId: string;
  briefId?: string | null;
  selectedLots?: string[];
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    input.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });
  await assertVersionIsEmpty({
    supabase,
    tenantId,
    versionId: input.versionId,
  });

  const brief = await loadConfirmedBrief({
    supabase,
    projectId: project.id,
    briefId: input.briefId ?? null,
  });

  if (!brief) {
    throw conflict(
      "Un brief confirme est requis pour generer la V0.",
      { projectId: project.id },
      "EST384_CONFIRMED_BRIEF_REQUIRED"
    );
  }

  const [sourceLinks, structureDraftResult] = await Promise.all([
    loadBriefSourceLinks({
      supabase,
      briefId: brief.id,
    }),
    generateEstimateStructureDraft(input.versionId, {
      strategy: "hybrid",
    }).catch(() => null),
  ]);

  const structureLots =
    structureDraftResult?.nodes
      .filter((node) => node.parent_id === null)
      .map((node) => node.label) ?? [];
  const briefLots = pickStringArray(brief.lots, 20);
  const availableLots = uniqueStrings([...briefLots, ...structureLots]);
  const selectedLots =
    input.selectedLots && input.selectedLots.length > 0
      ? uniqueStrings(input.selectedLots)
      : availableLots;

  if (selectedLots.length === 0) {
    throw badRequest(
      "Aucun lot exploitable n'a ete trouve dans le brief confirme.",
      undefined,
      "EST384_NO_LOTS"
    );
  }

  const fallbackLots = buildFallbackLots({
    brief,
    sourceLinks,
    lotLabels: selectedLots,
  });

  const aiResult = await tryGenerateGeminiLots({
    projectName: project.name,
    brief,
    sourceLinks,
    lotLabels: selectedLots,
  }).catch((error: unknown) => {
    return {
      data: null,
      model: null,
      promptVersion: VERSION_ZERO_PROMPT_VERSION,
      tokenCount: null,
      costCents: null,
      durationMs: null,
      error,
    };
  });

  const lots = mergeGeneratedLots({
    fallbackLots,
    aiLots: aiResult && "data" in aiResult && aiResult.data ? aiResult.data.lots : null,
  });

  const generation: InternalVersionZeroGeneration = {
    lots,
    summaryText:
      aiResult && "data" in aiResult && aiResult.data
        ? aiResult.data.summary
        : `V0 generee sur ${lots.length} lot(s), a revoir avant toute application.`,
    generationMetadata: {
      model: aiResult && "model" in aiResult ? aiResult.model : null,
      prompt_version:
        aiResult && "promptVersion" in aiResult
          ? aiResult.promptVersion
          : VERSION_ZERO_PROMPT_VERSION,
      used_fallback: !(aiResult && "data" in aiResult && aiResult.data),
      token_count: aiResult && "tokenCount" in aiResult ? aiResult.tokenCount : null,
      cost_cents: aiResult && "costCents" in aiResult ? aiResult.costCents : null,
      duration_ms: aiResult && "durationMs" in aiResult ? aiResult.durationMs : null,
      source_file_names: uniqueStrings(sourceLinks.map((entry) => entry.source_file_name)),
      selected_lots: selectedLots,
      structure_preview_root_count: structureLots.length,
      failure_message:
        aiResult && "error" in aiResult && aiResult.error instanceof Error
          ? aiResult.error.message
          : null,
    },
  };

  const persistedDraft = await persistGeneratedDraft({
    supabase,
    tenantId,
    userId,
    projectId: project.id,
    versionId: input.versionId,
    briefId: brief.id,
    selectedLots,
    generation,
  });

  await supersedeActiveDrafts({
    supabase,
    tenantId,
    versionId: input.versionId,
    newDraftId: persistedDraft.id,
  });

  return fetchVersionZeroReview({
    versionId: input.versionId,
    draftId: persistedDraft.id,
  });
}

export async function fetchVersionZeroReview(input: {
  versionId: string;
  draftId?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const { version, project } = await getVersionAccessOrThrow(
    context.supabase,
    input.versionId,
    context
  );

  const draft = await loadDraftOrThrow({
    supabase: context.supabase,
    tenantId: context.tenantId,
    versionId: input.versionId,
    draftId: input.draftId ?? null,
  });
  const lots = await loadReviewLots({
    supabase: context.supabase,
    tenantId: context.tenantId,
    draftId: draft.id,
  });
  const nextStatus = await refreshDraftStatus({
    supabase: context.supabase,
    tenantId: context.tenantId,
    draft,
    lots,
  });
  const counts = computeDraftCounts({ lots });

  return {
    draft: {
      id: draft.id,
      versionId: version.id,
      projectId: project.id,
      briefId: draft.brief_id,
      status: nextStatus,
      createdAt: draft.created_at,
      updatedAt: draft.updated_at,
      materializedAt: draft.materialized_at,
      selectedLots: parseSelectedLots(draft.selected_lots),
      summaryText: toSummaryText(draft.summary),
      generationMetadata: toJsonRecord(draft.generation_metadata),
      counts,
    },
    lots,
  } satisfies VersionZeroReview;
}

export async function reviewVersionZeroLine(input: {
  versionId: string;
  draftId: string;
  lineDraftId: string;
  reviewStatus: Exclude<VersionZeroLineReviewStatus, "pending">;
  editedValues?: {
    title?: string | null;
    description?: string | null;
    quantity?: number | null;
    unit?: string | null;
  };
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, input.versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });

  const draft = await loadDraftOrThrow({
    supabase,
    tenantId,
    versionId: input.versionId,
    draftId: input.draftId,
  });

  if (VERSION_ZERO_TERMINAL_STATUSES.includes(draft.status)) {
    throw conflict(
      "Ce snapshot V0 ne peut plus etre revu.",
      { draftId: draft.id, status: draft.status },
      "EST384_DRAFT_NOT_REVIEWABLE"
    );
  }

  const { data: lineData, error: lineError } = await supabase
    .from("estimate_version_zero_lines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("draft_id", draft.id)
    .eq("id", input.lineDraftId)
    .maybeSingle();

  if (lineError) {
    throw mapSupabaseError(lineError, "Impossible de charger la ligne V0.");
  }
  if (!lineData) {
    throw notFound("Ligne V0 introuvable.", undefined, "EST384_LINE_NOT_FOUND");
  }

  const payload: Database["public"]["Tables"]["estimate_version_zero_lines"]["Update"] = {
    review_status: input.reviewStatus,
    edited_title:
      input.reviewStatus === "edited"
        ? toNullableText(input.editedValues?.title) ?? lineData.proposed_title
        : null,
    edited_description:
      input.reviewStatus === "edited"
        ? input.editedValues?.description === undefined
          ? lineData.proposed_description
          : toNullableText(input.editedValues.description)
        : null,
    edited_quantity:
      input.reviewStatus === "edited"
        ? input.editedValues?.quantity === undefined
          ? lineData.proposed_quantity
          : input.editedValues.quantity ?? null
        : null,
    edited_unit:
      input.reviewStatus === "edited"
        ? input.editedValues?.unit === undefined
          ? lineData.proposed_unit
          : toNullableText(input.editedValues.unit)
        : null,
  };

  const { error: updateError } = await supabase
    .from("estimate_version_zero_lines")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", input.lineDraftId);

  if (updateError) {
    throw mapSupabaseError(updateError, "Impossible de mettre a jour la ligne V0.");
  }

  return fetchVersionZeroReview({
    versionId: input.versionId,
    draftId: draft.id,
  });
}

async function insertEstimateSection(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  position: number;
  title: string;
}) {
  const response = await input.supabase
    .from("estimate_items")
    .insert({
      tenant_id: input.tenantId,
      version_id: input.versionId,
      parent_id: null,
      item_type: "section",
      position: input.position,
      title: input.title,
      source_provider: "version_zero_draft",
    } as never)
    .select("*")
    .single();

  if (response.error || !response.data) {
    throw mapSupabaseError(response.error, "Impossible de creer la section issue de la V0.");
  }

  return response.data as EstimateItemRow;
}

async function insertEstimateLine(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  parentId: string;
  position: number;
  version: VersionAccessRow;
  line: VersionZeroReviewLine;
  lot: VersionZeroReviewLot;
  draft: EstimateVersionZeroDraftRow;
}) {
  const lineValues = computeEstimateLineValues(
    {
      quantity: input.line.effective.quantity,
      unit_price_ht_cents: 0,
      tax_rate_bp: input.version.tax_rate_bp,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
      pu_ht_cents: 0,
    },
    {
      marginMultiplier: input.version.margin_multiplier,
      taxRateBp: input.version.tax_rate_bp ?? 2000,
    }
  );

  const sourceMetadata: JsonRecord = {
    applications: [
      {
        draft_id: input.draft.id,
        lot_id: input.lot.id,
        line_id: input.line.id,
        lot_label: input.lot.label,
        review_status: input.line.reviewStatus,
        confidence: input.line.confidence,
        generated_at: input.draft.created_at,
        materialized_at: new Date().toISOString(),
        proposed: input.line.proposed,
        edited: input.line.edited,
        effective: input.line.effective,
        provenance: input.line.provenance,
        facts: input.line.facts,
        hypotheses: input.line.hypotheses,
        inferences: input.line.inferences,
        missing_signals: input.line.missingSignals,
        risk_signals: input.line.riskSignals,
      },
    ],
  };

  const response = await input.supabase
    .from("estimate_items")
    .insert({
      tenant_id: input.tenantId,
      version_id: input.versionId,
      parent_id: input.parentId,
      item_type: "line",
      position: input.position,
      title: input.line.effective.title,
      description: input.line.effective.description,
      quantity: input.line.effective.quantity,
      unit_price_ht_cents: 0,
      tax_rate_bp: input.version.tax_rate_bp,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
      pu_ht_cents: lineValues.puHtCents,
      line_total_ht_cents: lineValues.saleLineCents,
      line_tax_cents: lineValues.taxLineCents,
      line_total_ttc_cents: lineValues.ttcLineCents,
      source_provider: "version_zero_draft",
      source_metadata: sourceMetadata as Json,
    } as never)
    .select("*")
    .single();

  if (response.error || !response.data) {
    throw mapSupabaseError(response.error, "Impossible de creer la ligne issue de la V0.");
  }

  return response.data as EstimateItemRow;
}

export async function materializeVersionZeroDraft(input: {
  versionId: string;
  draftId: string;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, input.versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });
  await assertVersionIsEmpty({
    supabase,
    tenantId,
    versionId: input.versionId,
  });

  const draft = await loadDraftOrThrow({
    supabase,
    tenantId,
    versionId: input.versionId,
    draftId: input.draftId,
  });
  const review = await fetchVersionZeroReview({
    versionId: input.versionId,
    draftId: draft.id,
  });

  if (review.draft.counts.pending > 0) {
    throw conflict(
      "Toutes les lignes V0 doivent etre revues avant materialisation.",
      { draftId: draft.id, pendingCount: review.draft.counts.pending },
      "EST384_PENDING_LINES"
    );
  }

  const applicableLots = review.lots
    .map((lot) => ({
      lot,
      lines: lot.lines.filter(
        (line) => line.reviewStatus === "accepted" || line.reviewStatus === "edited"
      ),
    }))
    .filter((entry) => entry.lines.length > 0);

  let applicationOrder = 0;
  const applicationRows: EstimateVersionZeroApplicationInsert[] = [];

  for (let lotIndex = 0; lotIndex < applicableLots.length; lotIndex += 1) {
    const { lot, lines } = applicableLots[lotIndex];
    const section = await insertEstimateSection({
      supabase,
      tenantId,
      versionId: input.versionId,
      position: lotIndex + 1,
      title: lot.label,
    });

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const estimateItem = await insertEstimateLine({
        supabase,
        tenantId,
        versionId: input.versionId,
        parentId: section.id,
        position: lineIndex + 1,
        version,
        line,
        lot,
        draft,
      });

      applicationRows.push({
        tenant_id: tenantId,
        project_id: draft.project_id,
        version_id: input.versionId,
        draft_id: draft.id,
        lot_id: lot.id,
        line_id: line.id,
        estimate_item_id: estimateItem.id,
        parent_section_item_id: section.id,
        applied_by: userId,
        application_order: applicationOrder,
        applied_payload: {
          lot_label: lot.label,
          review_status: line.reviewStatus,
          confidence: line.confidence,
          effective: line.effective,
        },
      });
      applicationOrder += 1;

      const { error: lineUpdateError } = await supabase
        .from("estimate_version_zero_lines")
        .update({
          materialized_estimate_item_id: estimateItem.id,
        })
        .eq("tenant_id", tenantId)
        .eq("id", line.id);

      if (lineUpdateError) {
        throw mapSupabaseError(
          lineUpdateError,
          "Impossible de lier la ligne materialisee a la V0."
        );
      }
    }
  }

  if (applicationRows.length > 0) {
    const { error: applicationError } = await supabase
      .from("estimate_version_zero_applications")
      .insert(applicationRows);

    if (applicationError) {
      throw mapSupabaseError(
        applicationError,
        "Impossible de journaliser l'application de la V0."
      );
    }
  }

  const materializedAt = new Date().toISOString();
  const { error: draftError } = await supabase
    .from("estimate_version_zero_drafts")
    .update({
      status: "materialized",
      materialized_at: materializedAt,
    })
    .eq("tenant_id", tenantId)
    .eq("id", draft.id);

  if (draftError) {
    throw mapSupabaseError(draftError, "Impossible de finaliser la V0 materialisee.");
  }

  return fetchVersionZeroReview({
    versionId: input.versionId,
    draftId: draft.id,
  });
}

export async function enrichEstimateItemsWithVersionZeroProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  items: EstimateItemRow[];
}) {
  const targetItems = input.items.filter(
    (item) => item.source_provider === "version_zero_draft"
  );

  if (targetItems.length === 0) {
    return input.items;
  }

  const itemIds = targetItems.map((item) => item.id);
  const { data: applicationsData, error } = await input.supabase
    .from("estimate_version_zero_applications")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .in("estimate_item_id", itemIds);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger la provenance de la V0 materialisee."
    );
  }

  const applications = (applicationsData ?? []) as Database["public"]["Tables"]["estimate_version_zero_applications"]["Row"][];
  if (applications.length === 0) {
    return input.items;
  }

  const [draftsResponse, lotsResponse, linesResponse] = await Promise.all([
    input.supabase
      .from("estimate_version_zero_drafts")
      .select("*")
      .in(
        "id",
        Array.from(new Set(applications.map((application) => application.draft_id)))
      ),
    input.supabase
      .from("estimate_version_zero_lots")
      .select("*")
      .in(
        "id",
        Array.from(
          new Set(
            applications
              .map((application) => application.lot_id)
              .filter((value): value is string => typeof value === "string")
          )
        )
      ),
    input.supabase
      .from("estimate_version_zero_lines")
      .select("*")
      .in(
        "id",
        Array.from(new Set(applications.map((application) => application.line_id)))
      ),
  ]);

  if (draftsResponse.error) {
    throw mapSupabaseError(draftsResponse.error, "Impossible de charger les snapshots V0.");
  }
  if (lotsResponse.error) {
    throw mapSupabaseError(lotsResponse.error, "Impossible de charger les lots V0.");
  }
  if (linesResponse.error) {
    throw mapSupabaseError(linesResponse.error, "Impossible de charger les lignes V0.");
  }

  const draftsById = new Map(
    ((draftsResponse.data ?? []) as EstimateVersionZeroDraftRow[]).map((draft) => [
      draft.id,
      draft,
    ])
  );
  const lotsById = new Map(
    ((lotsResponse.data ?? []) as EstimateVersionZeroLotRow[]).map((lot) => [lot.id, lot])
  );
  const linesById = new Map(
    ((linesResponse.data ?? []) as EstimateVersionZeroLineRow[]).map((line) => [line.id, line])
  );

  const applicationByItemId = new Map<string, JsonRecord[]>();
  applications.forEach((application) => {
    const line = linesById.get(application.line_id);
    const lot = application.lot_id ? lotsById.get(application.lot_id) : null;
    const draft = draftsById.get(application.draft_id);
    if (!line || !draft) return;

    const metadata = applicationByItemId.get(application.estimate_item_id) ?? [];
    metadata.push({
      draft_id: draft.id,
      lot_id: lot?.id ?? null,
      lot_label: lot?.lot_label ?? null,
      review_status: line.review_status,
      confidence: line.confidence,
      generated_at: draft.created_at,
      materialized_at: draft.materialized_at,
      proposed: {
        title: line.proposed_title,
        description: line.proposed_description,
        quantity: line.proposed_quantity,
        unit: line.proposed_unit,
      },
      edited: {
        title: line.edited_title,
        description: line.edited_description,
        quantity: line.edited_quantity,
        unit: line.edited_unit,
      },
      provenance: readStringArrayFromJson(toJsonRecord(line.provenance).items as Json),
      facts: readStringArrayFromJson(line.facts),
      hypotheses: readStringArrayFromJson(line.hypotheses),
      inferences: readStringArrayFromJson(line.inferences),
      missing_signals: readStringArrayFromJson(line.missing_signals),
      risk_signals: readStringArrayFromJson(extractLineMetadata(line).risk_signals as Json),
    });
    applicationByItemId.set(application.estimate_item_id, metadata);
  });

  return input.items.map((item) => {
    const applicationsForItem = applicationByItemId.get(item.id);
    if (!applicationsForItem) {
      return item;
    }

    return {
      ...item,
      source_metadata: {
        applications: applicationsForItem,
      } as Json,
    };
  });
}
