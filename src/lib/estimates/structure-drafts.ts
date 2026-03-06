import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeMappedRowsForEstimateCreation,
  type ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import { fetchMappedRowsForImport } from "@/lib/affaires/import-flow-server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";
import {
  applyEstimateStructureDraftSchema,
  estimateStructureDraftSourceKindSchema,
  estimateStructureDraftStrategySchema,
  estimateStructureDraftNodeActionSchema,
  estimateStructureDraftApplyModeSchema,
  generateEstimateStructureDraftSchema,
} from "./schemas";

type Supabase = SupabaseClient<Database>;
type JsonRecord = Record<string, unknown>;
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_metadata?: unknown;
  source_extracted_at?: string | null;
};
type EstimateItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
type EstimateItemUpdate = Database["public"]["Tables"]["estimate_items"]["Update"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
type EstimateStructureDraftRow =
  Database["public"]["Tables"]["estimate_structure_drafts"]["Row"];
type EstimateStructureDraftInsert =
  Database["public"]["Tables"]["estimate_structure_drafts"]["Insert"];
type EstimateStructureDraftNodeRow =
  Database["public"]["Tables"]["estimate_structure_draft_nodes"]["Row"];
type EstimateStructureDraftNodeInsert =
  Database["public"]["Tables"]["estimate_structure_draft_nodes"]["Insert"];
type EstimateStructureDraftApplicationInsert =
  Database["public"]["Tables"]["estimate_structure_draft_applications"]["Insert"];
type EstimateStructureDraftApplyRpcResult =
  Database["public"]["Functions"]["apply_estimate_structure_draft"]["Returns"][number];
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;
type GenerateEstimateStructureDraftInput = z.infer<
  typeof generateEstimateStructureDraftSchema
>;
type ApplyEstimateStructureDraftInput = z.infer<
  typeof applyEstimateStructureDraftSchema
>;
type EstimateStructureDraftStrategy = z.infer<
  typeof estimateStructureDraftStrategySchema
>;
type EstimateStructureDraftNodeAction = z.infer<
  typeof estimateStructureDraftNodeActionSchema
>;
type EstimateStructureDraftApplyMode = z.infer<
  typeof estimateStructureDraftApplyModeSchema
>;
type EstimateStructureDraftSourceKind = z.infer<
  typeof estimateStructureDraftSourceKindSchema
>;

type EmbeddedProjectAccess = Pick<
  EstimateProjectRow,
  | "id"
  | "tenant_id"
  | "user_id"
  | "name"
  | "reference"
  | "client_name"
  | "notes"
  | "is_archived"
>;

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

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

export type EstimateStructureDraftSourceSummary = {
  kind: EstimateStructureDraftSourceKind;
  label: string;
  available: boolean;
  used: boolean;
  detail: string | null;
};

export type EstimateStructureDraftEvidenceEntry = {
  type: "dpgf" | "history" | "template" | "assembly" | "brief";
  label: string;
  excerpt: string | null;
};

export type EstimateStructureDraftNodePayload = {
  id: string;
  parent_id: string | null;
  order_index: number;
  hierarchy_level: number;
  label: string;
  normalized_label: string;
  confidence: number;
  confidence_label: "elevee" | "moyenne" | "faible";
  default_action: EstimateStructureDraftNodeAction;
  duplicate_match_item_id: string | null;
  duplicate_match_path: string | null;
  provenance: EstimateStructureDraftEvidenceEntry[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  children: EstimateStructureDraftNodePayload[];
};

export type EstimateStructureDraftSummary = {
  root_count: number;
  new_count: number;
  merge_count: number;
  duplicate_count: number;
  low_confidence_count: number;
};

export type EstimateStructureDraftResult = {
  draft_id: string;
  version_id: string;
  strategy: EstimateStructureDraftStrategy;
  sources: EstimateStructureDraftSourceSummary[];
  summary: EstimateStructureDraftSummary;
  nodes: EstimateStructureDraftNodePayload[];
  generated_at: string;
};

export type EstimateStructureDraftApplyResult = {
  draft_id: string;
  version_id: string;
  mode: EstimateStructureDraftApplyMode;
  created_count: number;
  merged_count: number;
  skipped_count: number;
  created_item_ids: string[];
  merged_item_ids: string[];
  version: {
    id: string;
    updated_at: string;
  };
};

type EstimateStructureSourceEntry = {
  id: string;
  kind: EstimateStructureDraftSourceKind;
  type: EstimateStructureDraftEvidenceEntry["type"];
  label: string;
  path: string[];
  excerpt: string | null;
  fact: string;
  hypothesis: string | null;
  inference: string | null;
  weight: number;
};

type EstimateStructurePromptSource = {
  kind: EstimateStructureDraftSourceKind;
  label: string;
  detail: string | null;
  entries: string[];
};

type EstimateStructureDraftGenerationMetadata = {
  model: string | null;
  prompt_version: string;
  used_fallback: boolean;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  source_entry_count: number;
  generation_summary: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

type EstimateStructureGeminiNode = {
  label: string;
  confidence: number;
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  provenance: Array<{
    source_kind: EstimateStructureDraftSourceKind;
    label: string;
    excerpt: string | null;
  }>;
  children: EstimateStructureGeminiNode[];
};

type EstimateStructureGeminiExchange = {
  summary: string | null;
  roots: EstimateStructureGeminiNode[];
};

type EstimateStructureDraftLoaded = {
  draft: EstimateStructureDraftRow;
  nodes: EstimateStructureDraftNodePayload[];
};

type EstimateStructureExistingSection = Pick<
  EstimateItemRow,
  "id" | "parent_id" | "position" | "title"
> & {
  normalized_label: string;
  hierarchy_level: number;
  path: string;
};

type EstimateStructureDraftNodePayloadFlat = Omit<
  EstimateStructureDraftNodePayload,
  "children"
>;

type EstimateStructureDraftSourceBundle = {
  source_summaries: EstimateStructureDraftSourceSummary[];
  prompt_sources: EstimateStructurePromptSource[];
  source_entries: EstimateStructureSourceEntry[];
};

type MutableExistingSection = EstimateStructureExistingSection;

type EstimateStructureDraftPlannedCreate = {
  id: string;
  parent_id: string | null;
  item_type: "section";
  position: number;
  title: string;
  source_provider: string | null;
  source_job_id: string | null;
  source_file_name: string | null;
  source_page: number | null;
};

type EstimateStructureDraftPlannedUpdate = {
  id: string;
  title: string | null;
  source_provider: string | null;
  source_job_id: string | null;
  source_file_name: string | null;
  source_page: number | null;
};

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const ROOT_PARENT_KEY = "__root__";
const ESTIMATE_STRUCTURE_PROVIDER = "ai_structure";
const ESTIMATE_STRUCTURE_SOURCE_FILE_NAME = "Structure IA";
const ESTIMATE_STRUCTURE_PROMPT_VERSION = "est382_structure_draft_v1";
const ESTIMATE_STRUCTURE_PROMPT_MODEL = "gemini-3-pro-preview";
const ESTIMATE_STRUCTURE_PROMPT_THINKING_LEVEL = "medium" as const;
const ESTIMATE_STRUCTURE_MAX_SOURCE_ENTRIES = 80;
const ESTIMATE_STRUCTURE_MAX_CHILDREN = 14;
const ESTIMATE_STRUCTURE_MAX_HIERARCHY_LEVEL = 4;

const EstimateStructureGeminiNodeSchema: z.ZodType<EstimateStructureGeminiNode> =
  z.lazy(() =>
    z.object({
      label: z.string().trim().min(1).max(160),
      confidence: z.number().min(0).max(1),
      facts: z.array(z.string().trim().min(1).max(240)).max(6).default([]),
      hypotheses: z
        .array(z.string().trim().min(1).max(240))
        .max(6)
        .default([]),
      inferences: z
        .array(z.string().trim().min(1).max(240))
        .max(6)
        .default([]),
      provenance: z
        .array(
          z.object({
            source_kind: estimateStructureDraftSourceKindSchema,
            label: z.string().trim().min(1).max(160),
            excerpt: z
              .union([z.string().trim().min(1).max(240), z.null()])
              .default(null),
          })
        )
        .max(6)
        .default([]),
      children: z.array(EstimateStructureGeminiNodeSchema).max(20).default([]),
    })
  );

const EstimateStructureGeminiExchangeSchema = z.object({
  summary: z.union([z.string().trim().min(1).max(400), z.null()]).default(null),
  roots: z.array(EstimateStructureGeminiNodeSchema).min(1).max(24),
});

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSectionTitleKey(value: string | null | undefined) {
  const normalized = toNullableText(value);
  if (!normalized) return "section";
  return normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

export function assertDraftStatus(status: EstimateStatus) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
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
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
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

  const version = data as unknown as VersionAccessRow;
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

  return (data ?? null) as
    | {
        id: string;
        version_id: string;
        user_id: string | null;
        locked_at: string | null;
        expires_at: string | null;
      }
    | null;
}

async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const lock = await getActiveDraftLockForVersion({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

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

async function fetchEstimateVersionToken(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, updated_at")
    .eq("id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de recuperer le jeton de version.");
    }

    throw badRequest("Impossible de recuperer le jeton de version.");
  }

  return data;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.35;
  return Math.max(0, Math.min(1, Number(value)));
}

function getConfidenceLabel(
  confidence: number
): EstimateStructureDraftNodePayload["confidence_label"] {
  if (confidence >= 0.75) return "elevee";
  if (confidence >= 0.55) return "moyenne";
  return "faible";
}

function toJson(value: unknown): Json {
  return value as Json;
}

function pickStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizeEvidenceEntries(value: unknown): EstimateStructureDraftEvidenceEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as JsonRecord;
      const type =
        typeof record.type === "string" ? record.type.trim().toLowerCase() : null;
      const label =
        typeof record.label === "string" ? record.label.trim() : "";
      const excerpt =
        typeof record.excerpt === "string" ? record.excerpt.trim() : null;

      if (
        !type ||
        !label ||
        (type !== "dpgf" &&
          type !== "history" &&
          type !== "template" &&
          type !== "assembly" &&
          type !== "brief")
      ) {
        return null;
      }

      return {
        type,
        label,
        excerpt: excerpt && excerpt.length > 0 ? excerpt : null,
      } satisfies EstimateStructureDraftEvidenceEntry;
    })
    .filter(
      (entry): entry is EstimateStructureDraftEvidenceEntry => entry !== null
    );
}

function normalizeSourceSummaries(
  value: unknown
): EstimateStructureDraftSourceSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as JsonRecord;
      const kind =
        typeof record.kind === "string" ? record.kind.trim() : null;
      const label =
        typeof record.label === "string" ? record.label.trim() : "";

      if (!kind || !label) {
        return null;
      }

      const parsedKind = estimateStructureDraftSourceKindSchema.safeParse(kind);
      if (!parsedKind.success) {
        return null;
      }

      return {
        kind: parsedKind.data,
        label,
        available: Boolean(record.available),
        used: Boolean(record.used),
        detail:
          typeof record.detail === "string" && record.detail.trim().length > 0
            ? record.detail.trim()
            : null,
      } satisfies EstimateStructureDraftSourceSummary;
    })
    .filter(
      (entry): entry is EstimateStructureDraftSourceSummary => entry !== null
    );
}

function normalizeDraftSummary(value: unknown): EstimateStructureDraftSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      root_count: 0,
      new_count: 0,
      merge_count: 0,
      duplicate_count: 0,
      low_confidence_count: 0,
    };
  }

  const record = value as JsonRecord;
  const toCount = (field: string) => {
    const candidate = record[field];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(0, Math.trunc(candidate));
    }
    return 0;
  };

  return {
    root_count: toCount("root_count"),
    new_count: toCount("new_count"),
    merge_count: toCount("merge_count"),
    duplicate_count: toCount("duplicate_count"),
    low_confidence_count: toCount("low_confidence_count"),
  };
}

function buildDraftSummary(
  nodes: EstimateStructureDraftNodePayload[]
): EstimateStructureDraftSummary {
  const flat = flattenDraftNodes(nodes);

  return {
    root_count: nodes.length,
    new_count: flat.filter((node) => node.default_action === "create").length,
    merge_count: flat.filter((node) => node.default_action === "merge").length,
    duplicate_count: flat.filter((node) => node.duplicate_match_item_id !== null)
      .length,
    low_confidence_count: flat.filter((node) => node.confidence < 0.55).length,
  };
}

function flattenDraftNodes(
  nodes: EstimateStructureDraftNodePayload[]
): EstimateStructureDraftNodePayloadFlat[] {
  const flattened: EstimateStructureDraftNodePayloadFlat[] = [];

  const visit = (node: EstimateStructureDraftNodePayload) => {
    flattened.push({
      id: node.id,
      parent_id: node.parent_id,
      order_index: node.order_index,
      hierarchy_level: node.hierarchy_level,
      label: node.label,
      normalized_label: node.normalized_label,
      confidence: node.confidence,
      confidence_label: node.confidence_label,
      default_action: node.default_action,
      duplicate_match_item_id: node.duplicate_match_item_id,
      duplicate_match_path: node.duplicate_match_path,
      provenance: node.provenance,
      facts: node.facts,
      hypotheses: node.hypotheses,
      inferences: node.inferences,
    });
    node.children.forEach(visit);
  };

  nodes.forEach(visit);
  return flattened;
}

function rebuildDraftNodes(
  rows: EstimateStructureDraftNodePayloadFlat[]
): EstimateStructureDraftNodePayload[] {
  const byId = new Map<string, EstimateStructureDraftNodePayload>();
  const roots: EstimateStructureDraftNodePayload[] = [];

  rows.forEach((row) => {
    byId.set(row.id, {
      ...row,
      children: [],
    });
  });

  rows.forEach((row) => {
    const current = byId.get(row.id);
    if (!current) return;

    if (!row.parent_id) {
      roots.push(current);
      return;
    }

    const parent = byId.get(row.parent_id);
    if (!parent) {
      roots.push(current);
      return;
    }

    parent.children.push(current);
  });

  const sortNodes = (items: EstimateStructureDraftNodePayload[]) => {
    items.sort((left, right) => {
      if (left.order_index !== right.order_index) {
        return left.order_index - right.order_index;
      }

      return left.label.localeCompare(right.label, "fr");
    });
    items.forEach((item) => sortNodes(item.children));
  };

  sortNodes(roots);
  return roots;
}

function buildExistingSections(
  items: EstimateItemRow[]
): MutableExistingSection[] {
  const sections = items
    .filter((item) => item.item_type === "section")
    .map((item) => ({
      id: item.id,
      parent_id: item.parent_id,
      position: item.position,
      title: item.title,
      normalized_label: normalizeSectionTitleKey(item.title),
      hierarchy_level: 1,
      path: toNullableText(item.title) ?? "Section",
    }));

  const byParent = new Map<string, MutableExistingSection[]>();
  sections.forEach((section) => {
    const key = section.parent_id ?? ROOT_PARENT_KEY;
    const current = byParent.get(key);
    if (current) {
      current.push(section);
      return;
    }

    byParent.set(key, [section]);
  });

  const visit = (
    parentId: string | null,
    level: number,
    parentPath: string | null
  ) => {
    const key = parentId ?? ROOT_PARENT_KEY;
    const siblings = byParent.get(key) ?? [];
    siblings
      .sort((left, right) => left.position - right.position)
      .forEach((section) => {
        const label = toNullableText(section.title) ?? "Section";
        section.hierarchy_level = level;
        section.path = parentPath ? `${parentPath} > ${label}` : label;
        section.normalized_label = normalizeSectionTitleKey(label);
        visit(section.id, level + 1, section.path);
      });
  };

  visit(null, 1, null);
  return sections;
}

function buildExistingSectionsByParent(
  sections: MutableExistingSection[]
): Map<string, MutableExistingSection[]> {
  const byParent = new Map<string, MutableExistingSection[]>();

  sections.forEach((section) => {
    const key = section.parent_id ?? ROOT_PARENT_KEY;
    const current = byParent.get(key);
    if (current) {
      current.push(section);
      return;
    }

    byParent.set(key, [section]);
  });

  byParent.forEach((siblings) => {
    siblings.sort((left, right) => left.position - right.position);
  });

  return byParent;
}

function truncatePath(path: string[]) {
  return path
    .map((segment) => toNullableText(segment))
    .filter((segment): segment is string => segment !== null)
    .slice(0, ESTIMATE_STRUCTURE_MAX_HIERARCHY_LEVEL);
}

function buildPathKey(path: string[]) {
  return truncatePath(path).map((segment) => normalizeSectionTitleKey(segment)).join(">");
}

export function inferDpgfPath(title: string) {
  const normalized = title
    .replace(/[|;]+/g, " / ")
    .replace(/[–—]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  const explicitParts = normalized
    .split(/\s*(?:>|\/|:| - )\s*/g)
    .map((part) => toNullableText(part))
    .filter((part): part is string => part !== null);

  if (explicitParts.length >= 2) {
    return truncatePath(explicitParts);
  }

  const words = normalized
    .split(/\s+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);

  if (words.length >= 4) {
    return truncatePath([
      words.slice(0, 2).join(" "),
      normalized,
    ]);
  }

  return truncatePath([normalized]);
}

function parseProjectNotesPaths(notes: string) {
  const normalized = notes
    .split(/\r?\n+/g)
    .flatMap((line) => line.split(/[;•]/g))
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim()
    )
    .filter((line) => line.length >= 4);

  return normalized.slice(0, 20).map((line) => {
    const parts = line
      .split(/\s*(?:>|\/|→)\s*/g)
      .map((part) => toNullableText(part))
      .filter((part): part is string => part !== null);

    return truncatePath(parts.length > 0 ? parts : [line]);
  });
}

function toEvidenceType(
  kind: EstimateStructureDraftSourceKind
): EstimateStructureDraftEvidenceEntry["type"] {
  switch (kind) {
    case "linked_dpgf":
      return "dpgf";
    case "historical_versions":
      return "history";
    case "template_library":
      return "template";
    case "assembly_library":
      return "assembly";
    case "project_notes":
    case "confirmed_brief":
      return "brief";
    default:
      return "brief";
  }
}

function buildPromptSources(
  sourceSummaries: EstimateStructureDraftSourceSummary[],
  sourceEntries: EstimateStructureSourceEntry[]
): EstimateStructurePromptSource[] {
  return sourceSummaries
    .filter((source) => source.available)
    .map((source) => ({
      kind: source.kind,
      label: source.label,
      detail: source.detail,
      entries: sourceEntries
        .filter((entry) => entry.kind === source.kind)
        .slice(0, 12)
        .map((entry) => `${entry.path.join(" > ")}${entry.excerpt ? ` :: ${entry.excerpt}` : ""}`),
    }));
}

function buildHeuristicNodes(
  sourceEntries: EstimateStructureSourceEntry[]
): EstimateStructureDraftNodePayload[] {
  type CandidateNode = {
    label: string;
    normalized_label: string;
    entries: EstimateStructureSourceEntry[];
    children: Map<string, CandidateNode>;
  };

  const roots = new Map<string, CandidateNode>();

  const ensureNode = (
    siblings: Map<string, CandidateNode>,
    label: string
  ): CandidateNode => {
    const normalized = normalizeSectionTitleKey(label);
    const existing = siblings.get(normalized);
    if (existing) {
      return existing;
    }

    const created: CandidateNode = {
      label,
      normalized_label: normalized,
      entries: [],
      children: new Map(),
    };
    siblings.set(normalized, created);
    return created;
  };

  sourceEntries.forEach((entry) => {
    const path = truncatePath(entry.path);
    if (path.length === 0) {
      return;
    }

    let siblings = roots;
    path.forEach((segment) => {
      const node = ensureNode(siblings, segment);
      node.entries.push(entry);
      siblings = node.children;
    });
  });

  const toNodePayload = (
    candidate: CandidateNode,
    hierarchyLevel: number,
    parentId: string | null,
    orderIndex: number
  ): EstimateStructureDraftNodePayload => {
    const distinctKinds = new Set(candidate.entries.map((entry) => entry.kind)).size;
    const totalWeight = candidate.entries.reduce((sum, entry) => sum + entry.weight, 0);
    const confidence = clampConfidence(
      Math.min(
        0.92,
        0.35 +
          distinctKinds * 0.16 +
          Math.min(0.25, totalWeight / 20) +
          (hierarchyLevel === 1 ? 0.08 : 0)
      )
    );
    const groupedFacts = Array.from(
      new Set(candidate.entries.map((entry) => entry.fact))
    ).slice(0, 4);
    const groupedHypotheses = Array.from(
      new Set(
        candidate.entries
          .map((entry) => entry.hypothesis)
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, 4);
    const groupedInferences = Array.from(
      new Set(
        candidate.entries
          .map((entry) => entry.inference)
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, 4);
    const provenance = Array.from(
      new Map(
        candidate.entries.map((entry) => [
          `${entry.kind}::${entry.label}::${entry.excerpt ?? ""}`,
          {
            type: entry.type,
            label: entry.label,
            excerpt: entry.excerpt,
          } satisfies EstimateStructureDraftEvidenceEntry,
        ])
      ).values()
    ).slice(0, 5);

    const children = Array.from(candidate.children.values())
      .sort((left, right) => {
        const leftWeight = left.entries.reduce((sum, entry) => sum + entry.weight, 0);
        const rightWeight = right.entries.reduce((sum, entry) => sum + entry.weight, 0);
        if (leftWeight !== rightWeight) {
          return rightWeight - leftWeight;
        }

        return left.label.localeCompare(right.label, "fr");
      })
      .slice(0, ESTIMATE_STRUCTURE_MAX_CHILDREN)
      .map((child, index) =>
        toNodePayload(child, hierarchyLevel + 1, null, index)
      );

    return {
      id: randomUUID(),
      parent_id: parentId,
      order_index: orderIndex,
      hierarchy_level: hierarchyLevel,
      label: candidate.label,
      normalized_label: candidate.normalized_label,
      confidence,
      confidence_label: getConfidenceLabel(confidence),
      default_action: "create",
      duplicate_match_item_id: null,
      duplicate_match_path: null,
      provenance,
      facts: groupedFacts,
      hypotheses: groupedHypotheses,
      inferences:
        groupedInferences.length > 0
          ? groupedInferences
          : [`Titre consolide a partir de ${candidate.entries.length} source(s).`],
      children,
    };
  };

  return Array.from(roots.values())
    .sort((left, right) => {
      const leftWeight = left.entries.reduce((sum, entry) => sum + entry.weight, 0);
      const rightWeight = right.entries.reduce((sum, entry) => sum + entry.weight, 0);
      if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight;
      }

      return left.label.localeCompare(right.label, "fr");
    })
    .slice(0, ESTIMATE_STRUCTURE_MAX_CHILDREN)
    .map((candidate, index) => toNodePayload(candidate, 1, null, index))
    .map((node) => assignParentIds(node, null));
}

function assignParentIds(
  node: EstimateStructureDraftNodePayload,
  parentId: string | null
): EstimateStructureDraftNodePayload {
  const assignedId = randomUUID();
  return {
    ...node,
    id: assignedId,
    parent_id: parentId,
    children: node.children.map((child, index) =>
      assignParentIds(
        {
          ...child,
          order_index: index,
        },
        assignedId
      )
    ),
  };
}

function buildHeuristicLookup(
  nodes: EstimateStructureDraftNodePayload[]
): Map<string, EstimateStructureDraftNodePayload> {
  const lookup = new Map<string, EstimateStructureDraftNodePayload>();

  const visit = (node: EstimateStructureDraftNodePayload, path: string[]) => {
    const nextPath = [...path, node.label];
    lookup.set(buildPathKey(nextPath), node);
    node.children.forEach((child) => visit(child, nextPath));
  };

  nodes.forEach((node) => visit(node, []));
  return lookup;
}

function mergeGeminiNodesWithHeuristic(input: {
  nodes: EstimateStructureGeminiNode[];
  heuristicLookup: Map<string, EstimateStructureDraftNodePayload>;
}): EstimateStructureDraftNodePayload[] {
  const visit = (
    node: EstimateStructureGeminiNode,
    path: string[],
    parentId: string | null,
    orderIndex: number,
    hierarchyLevel: number
  ): EstimateStructureDraftNodePayload | null => {
    const label = toNullableText(node.label);
    if (!label) {
      return null;
    }

    const nextPath = [...path, label];
    const heuristic = input.heuristicLookup.get(buildPathKey(nextPath));
    const confidence = clampConfidence(
      heuristic
        ? (clampConfidence(node.confidence) + heuristic.confidence) / 2
        : clampConfidence(node.confidence)
    );
    const facts =
      node.facts.length > 0 ? node.facts.slice(0, 4) : heuristic?.facts ?? [];
    const hypotheses =
      node.hypotheses.length > 0
        ? node.hypotheses.slice(0, 4)
        : heuristic?.hypotheses ?? [];
    const inferences =
      node.inferences.length > 0
        ? node.inferences.slice(0, 4)
        : heuristic?.inferences ?? [];
    const provenance =
      node.provenance.length > 0
        ? node.provenance.map((entry) => ({
            type: toEvidenceType(entry.source_kind),
            label: entry.label,
            excerpt: entry.excerpt,
          }))
        : heuristic?.provenance ?? [];

    const payload: EstimateStructureDraftNodePayload = {
      id: randomUUID(),
      parent_id: parentId,
      order_index: orderIndex,
      hierarchy_level: hierarchyLevel,
      label,
      normalized_label: normalizeSectionTitleKey(label),
      confidence,
      confidence_label: getConfidenceLabel(confidence),
      default_action: "create",
      duplicate_match_item_id: null,
      duplicate_match_path: null,
      provenance,
      facts,
      hypotheses,
      inferences,
      children: [],
    };

    const children = node.children
      .slice(0, ESTIMATE_STRUCTURE_MAX_CHILDREN)
      .map((child, index) =>
        visit(child, nextPath, payload.id, index, hierarchyLevel + 1)
      )
      .filter((child): child is EstimateStructureDraftNodePayload => child !== null);

    payload.children = dedupeSiblingNodes(children);
    return payload;
  };

  return dedupeSiblingNodes(
    input.nodes
      .slice(0, ESTIMATE_STRUCTURE_MAX_CHILDREN)
      .map((node, index) => visit(node, [], null, index, 1))
      .filter((node): node is EstimateStructureDraftNodePayload => node !== null)
  );
}

function dedupeSiblingNodes(
  nodes: EstimateStructureDraftNodePayload[]
): EstimateStructureDraftNodePayload[] {
  const byKey = new Map<string, EstimateStructureDraftNodePayload>();

  nodes.forEach((node) => {
    const key = node.normalized_label;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, node);
      return;
    }

    const mergedFacts = Array.from(new Set([...existing.facts, ...node.facts])).slice(
      0,
      4
    );
    const mergedHypotheses = Array.from(
      new Set([...existing.hypotheses, ...node.hypotheses])
    ).slice(0, 4);
    const mergedInferences = Array.from(
      new Set([...existing.inferences, ...node.inferences])
    ).slice(0, 4);
    const mergedProvenance = Array.from(
      new Map(
        [...existing.provenance, ...node.provenance].map((entry) => [
          `${entry.type}::${entry.label}::${entry.excerpt ?? ""}`,
          entry,
        ])
      ).values()
    ).slice(0, 5);

    existing.confidence = clampConfidence(
      Math.max(existing.confidence, node.confidence)
    );
    existing.confidence_label = getConfidenceLabel(existing.confidence);
    existing.facts = mergedFacts;
    existing.hypotheses = mergedHypotheses;
    existing.inferences = mergedInferences;
    existing.provenance = mergedProvenance;
    existing.children = dedupeSiblingNodes([...existing.children, ...node.children]);
  });

  return Array.from(byKey.values()).map((node, index) => ({
    ...node,
    order_index: index,
  }));
}

function annotateNodesAgainstExistingSections(input: {
  nodes: EstimateStructureDraftNodePayload[];
  existingSectionsByParent: Map<string, MutableExistingSection[]>;
}) {
  const visit = (
    node: EstimateStructureDraftNodePayload,
    matchParentId: string | null | undefined
  ): EstimateStructureDraftNodePayload => {
    const canMatch = matchParentId !== undefined;
    const siblings = canMatch
      ? input.existingSectionsByParent.get(matchParentId ?? ROOT_PARENT_KEY) ?? []
      : [];
    const match = siblings.find(
      (candidate) =>
        candidate.normalized_label === node.normalized_label &&
        candidate.hierarchy_level === node.hierarchy_level
    );

    const childrenParentId = match ? match.id : undefined;

    return {
      ...node,
      default_action: match ? "merge" : "create",
      duplicate_match_item_id: match?.id ?? null,
      duplicate_match_path: match?.path ?? null,
      children: node.children.map((child) => visit(child, childrenParentId)),
    };
  };

  return input.nodes.map((node) => visit(node, null));
}

async function loadLatestLinkedDpgfImportForProject(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_imports")
    .select("id, filename, status, created_at, parse_mode, row_count")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la source DPGF liee.");
  }

  return (data ?? null) as
    | {
        id: string;
        filename: string;
        status: string;
        created_at: string;
        parse_mode: string;
        row_count: number | null;
      }
    | null;
}

function sortValidImportFlowLines(lines: ValidImportFlowLine[]) {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

async function loadStructureDraftSourceBundle(input: {
  supabase: Supabase;
  tenantId: string;
  project: EmbeddedProjectAccess;
  version: VersionAccessRow;
}): Promise<EstimateStructureDraftSourceBundle> {
  const { supabase, tenantId, project, version } = input;

  const [
    latestLinkedImport,
    historyVersionsResult,
    templatesResult,
    assembliesResult,
  ] = await Promise.all([
    loadLatestLinkedDpgfImportForProject({
      supabase,
      tenantId,
      projectId: project.id,
    }),
    supabase
      .from("estimate_versions")
      .select("id, version_number, title")
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .neq("id", version.id)
      .order("version_number", { ascending: false })
      .limit(5),
    supabase
      .from("estimate_templates")
      .select("id, name, description, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("estimate_assemblies")
      .select("id, name, description, updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(12),
  ]);

  if (historyVersionsResult.error) {
    throw mapSupabaseError(
      historyVersionsResult.error,
      "Impossible de charger les historiques de structure."
    );
  }
  if (templatesResult.error) {
    throw mapSupabaseError(
      templatesResult.error,
      "Impossible de charger la bibliotheque de templates."
    );
  }
  if (assembliesResult.error) {
    throw mapSupabaseError(
      assembliesResult.error,
      "Impossible de charger la bibliotheque d'assemblages."
    );
  }

  const historyVersions = (historyVersionsResult.data ?? []) as Array<{
    id: string;
    version_number: number;
    title: string | null;
  }>;
  const templateRows = (templatesResult.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  const assemblyRows = (assembliesResult.data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
  }>;

  const historyVersionIds = historyVersions.map((row) => row.id);
  const templateIds = templateRows.map((row) => row.id);

  const [
    historyItemsResult,
    templateItemsResult,
    linkedImportSource,
  ] = await Promise.all([
    historyVersionIds.length > 0
      ? supabase
          .from("estimate_items")
          .select("id, version_id, parent_id, item_type, title, position")
          .eq("tenant_id", tenantId)
          .eq("item_type", "section")
          .in("version_id", historyVersionIds)
      : Promise.resolve({ data: [], error: null }),
    templateIds.length > 0
      ? supabase
          .from("estimate_template_items")
          .select("id, template_id, parent_id, item_type, title, position")
          .eq("tenant_id", tenantId)
          .eq("item_type", "section")
          .in("template_id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    latestLinkedImport
      ? fetchMappedRowsForImport({
          supabase,
          importId: latestLinkedImport.id,
          tenantId,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  if ("error" in historyItemsResult && historyItemsResult.error) {
    throw mapSupabaseError(
      historyItemsResult.error,
      "Impossible de charger les sections historiques."
    );
  }
  if ("error" in templateItemsResult && templateItemsResult.error) {
    throw mapSupabaseError(
      templateItemsResult.error,
      "Impossible de charger les sections templates."
    );
  }

  const sourceEntries: EstimateStructureSourceEntry[] = [];
  const sourceSummaries: EstimateStructureDraftSourceSummary[] = [];

  if (latestLinkedImport) {
    const normalized = normalizeMappedRowsForEstimateCreation(linkedImportSource, {
      marginMultiplier:
        typeof version.margin_multiplier === "number"
          ? version.margin_multiplier
          : 1,
      defaultTaxRateBp:
        typeof version.tax_rate_bp === "number" ? version.tax_rate_bp : 2000,
    });
    const validLines = sortValidImportFlowLines(normalized.validLines).slice(0, 40);

    validLines.forEach((line, index) => {
      const path = inferDpgfPath(line.title);
      if (path.length === 0) return;
      sourceEntries.push({
        id: `dpgf-${index}-${line.mappedRowId}`,
        kind: "linked_dpgf",
        type: "dpgf",
        label: latestLinkedImport.filename,
        path,
        excerpt: line.title,
        fact: `Ligne DPGF detectee: ${line.title}`,
        hypothesis:
          path.length > 1
            ? "Chapitrage propose a partir du libelle DPGF."
            : null,
        inference:
          path.length > 1
            ? `Sous-structure deduite depuis "${line.title}".`
            : null,
        weight: 1.1,
      });
    });

    sourceSummaries.push({
      kind: "linked_dpgf",
      label: "DPGF lie",
      available: true,
      used: validLines.length > 0,
      detail: `${latestLinkedImport.filename} · ${validLines.length} ligne(s) retenue(s)`,
    });
  } else {
    sourceSummaries.push({
      kind: "linked_dpgf",
      label: "DPGF lie",
      available: false,
      used: false,
      detail: "Aucun DPGF lie disponible.",
    });
  }

  if (historyVersions.length > 0) {
    const historyItems = (historyItemsResult.data ?? []) as Array<{
      id: string;
      version_id: string;
      parent_id: string | null;
      item_type: string;
      title: string;
      position: number;
    }>;
    const itemsByVersion = new Map<string, EstimateItemRow[]>();
    historyItems.forEach((item) => {
      const current = itemsByVersion.get(item.version_id);
      if (current) {
        current.push(item as unknown as EstimateItemRow);
        return;
      }

      itemsByVersion.set(item.version_id, [item as unknown as EstimateItemRow]);
    });

    historyVersions.forEach((historyVersion) => {
      const versionItems = itemsByVersion.get(historyVersion.id) ?? [];
      const existingSections = buildExistingSections(versionItems);
      existingSections.forEach((section) => {
        sourceEntries.push({
          id: `history-${historyVersion.id}-${section.id}`,
          kind: "historical_versions",
          type: "history",
          label: `V${historyVersion.version_number}`,
          path: section.path.split(" > "),
          excerpt: historyVersion.title ?? null,
          fact: `Observe dans V${historyVersion.version_number}: ${section.path}`,
          hypothesis: null,
          inference: "Structure historisee sur une version precedente.",
          weight: 1.6,
        });
      });
    });

    sourceSummaries.push({
      kind: "historical_versions",
      label: "Versions historiques",
      available: true,
      used: historyItems.length > 0,
      detail: `${historyVersions.length} version(s) analysee(s)`,
    });
  } else {
    sourceSummaries.push({
      kind: "historical_versions",
      label: "Versions historiques",
      available: false,
      used: false,
      detail: "Aucun historique exploitable.",
    });
  }

  if (templateRows.length > 0) {
    const templateItems = (templateItemsResult.data ?? []) as Array<{
      id: string;
      template_id: string;
      parent_id: string | null;
      item_type: string;
      title: string;
      position: number;
    }>;
    const itemsByTemplate = new Map<string, EstimateItemRow[]>();
    templateItems.forEach((item) => {
      const current = itemsByTemplate.get(item.template_id);
      if (current) {
        current.push(item as unknown as EstimateItemRow);
        return;
      }

      itemsByTemplate.set(item.template_id, [item as unknown as EstimateItemRow]);
    });

    templateRows.forEach((template) => {
      const templateItemsForId = itemsByTemplate.get(template.id) ?? [];
      buildExistingSections(templateItemsForId).forEach((section) => {
        sourceEntries.push({
          id: `template-${template.id}-${section.id}`,
          kind: "template_library",
          type: "template",
          label: template.name,
          path: section.path.split(" > "),
          excerpt: template.description,
          fact: `Template "${template.name}" contient ${section.path}`,
          hypothesis: null,
          inference: "Structure standardisee issue de la bibliotheque.",
          weight: 1.35,
        });
      });
    });

    sourceSummaries.push({
      kind: "template_library",
      label: "Bibliotheque templates",
      available: true,
      used: templateItems.length > 0,
      detail: `${templateRows.length} template(s) pris en compte`,
    });
  } else {
    sourceSummaries.push({
      kind: "template_library",
      label: "Bibliotheque templates",
      available: false,
      used: false,
      detail: "Aucun template disponible.",
    });
  }

  if (assemblyRows.length > 0) {
    assemblyRows.forEach((assembly, index) => {
      const label = toNullableText(assembly.name);
      if (!label) return;
      sourceEntries.push({
        id: `assembly-${assembly.id}-${index}`,
        kind: "assembly_library",
        type: "assembly",
        label,
        path: truncatePath([label]),
        excerpt: assembly.description,
        fact: `Assemblage disponible: ${label}`,
        hypothesis: "L'assemblage peut constituer un lot autonome ou un sous-chapitre.",
        inference: "Regroupement propose a partir du catalogue d'assemblages.",
        weight: 0.85,
      });
    });

    sourceSummaries.push({
      kind: "assembly_library",
      label: "Bibliotheque assemblages",
      available: true,
      used: assemblyRows.length > 0,
      detail: `${assemblyRows.length} assemblage(s) explores`,
    });
  } else {
    sourceSummaries.push({
      kind: "assembly_library",
      label: "Bibliotheque assemblages",
      available: false,
      used: false,
      detail: "Aucun assemblage disponible.",
    });
  }

  const projectNotes = toNullableText(project.notes);
  if (projectNotes) {
    parseProjectNotesPaths(projectNotes).forEach((path, index) => {
      sourceEntries.push({
        id: `project-notes-${index}`,
        kind: "project_notes",
        type: "brief",
        label: "Notes affaire",
        path,
        excerpt: path.join(" > "),
        fact: `Notes affaire: ${path.join(" > ")}`,
        hypothesis: null,
        inference: "Element issu du contexte affaire local, a confirmer humainement.",
        weight: 0.95,
      });
    });

    sourceSummaries.push({
      kind: "project_notes",
      label: "Notes affaire",
      available: true,
      used: true,
      detail: "Contexte projet local utilise en fallback du brief E21.",
    });
  } else {
    sourceSummaries.push({
      kind: "project_notes",
      label: "Notes affaire",
      available: false,
      used: false,
      detail: "Aucune note affaire exploitable.",
    });
  }

  sourceSummaries.push({
    kind: "confirmed_brief",
    label: "Brief confirme",
    available: false,
    used: false,
    detail: "Contrat E21 non branche sur cette branche main.",
  });

  const dedupedEntries = Array.from(
    new Map(
      sourceEntries.map((entry) => [
        `${entry.kind}::${entry.label}::${buildPathKey(entry.path)}::${entry.excerpt ?? ""}`,
        entry,
      ])
    ).values()
  )
    .sort((left, right) => right.weight - left.weight)
    .slice(0, ESTIMATE_STRUCTURE_MAX_SOURCE_ENTRIES);

  return {
    source_summaries: sourceSummaries,
    prompt_sources: buildPromptSources(sourceSummaries, dedupedEntries),
    source_entries: dedupedEntries,
  };
}

function buildGeminiPrompt(input: {
  project: EmbeddedProjectAccess;
  sourceSummaries: EstimateStructureDraftSourceSummary[];
  promptSources: EstimateStructurePromptSource[];
  heuristicNodes: EstimateStructureDraftNodePayload[];
}) {
  const sourcesBlock = input.promptSources
    .map((source) => {
      const detail = source.detail ? ` (${source.detail})` : "";
      return [
        `- ${source.label} [${source.kind}]${detail}`,
        ...source.entries.map((entry) => `  - ${entry}`),
      ].join("\n");
    })
    .join("\n");

  const heuristicBlock = flattenDraftNodes(input.heuristicNodes)
    .map((node) => `${"  ".repeat(Math.max(0, node.hierarchy_level - 1))}- ${node.label}`)
    .join("\n");

  const availableSources = input.sourceSummaries
    .filter((source) => source.available)
    .map((source) => source.label)
    .join(", ");

  return `
Tu proposes une structure de lots/chapitres pour un devis batiment.

Contraintes strictes:
- maximum 3 niveaux hierarchiques
- labels concis et actionnables
- aucune application automatique: ceci sert uniquement de preview humaine
- toujours distinguer faits, hypotheses et inferences
- chaque noeud doit avoir une provenance exploitable
- ne retourne que le JSON conforme au schema

Contexte projet:
- affaire: ${input.project.name}
- reference: ${input.project.reference ?? "non renseignee"}
- client: ${input.project.client_name ?? "non renseigne"}
- sources disponibles: ${availableSources || "aucune"}

Sources:
${sourcesBlock || "- aucune source exploitable"}

Proposition heuristique initiale:
${heuristicBlock || "- aucune proposition heuristique"}

Consignes de generation:
- privilegie les structures observees dans l'historique et les templates
- utilise le DPGF pour completer, pas pour inventer silencieusement
- si une structure est incertaine, baisse la confiance et place le doute dans hypotheses/inferences
- les faits doivent etre des observations directes des sources
- les hypotheses doivent expliciter ce qui reste a confirmer
- les inferences doivent expliciter le raisonnement de regroupement
`.trim();
}

async function tryGenerateGeminiNodes(input: {
  project: EmbeddedProjectAccess;
  sourceSummaries: EstimateStructureDraftSourceSummary[];
  promptSources: EstimateStructurePromptSource[];
  heuristicNodes: EstimateStructureDraftNodePayload[];
}) {
  const prompt = buildGeminiPrompt(input);
  return callGeminiStructured<EstimateStructureGeminiExchange>({
    prompt,
    schema: EstimateStructureGeminiExchangeSchema,
    thinkingLevel: ESTIMATE_STRUCTURE_PROMPT_THINKING_LEVEL,
    context: {
      model: ESTIMATE_STRUCTURE_PROMPT_MODEL,
      promptVersion: ESTIMATE_STRUCTURE_PROMPT_VERSION,
    },
  });
}

function buildDraftNodesFromSources(input: {
  sourceEntries: EstimateStructureSourceEntry[];
  sourceSummaries: EstimateStructureDraftSourceSummary[];
  promptSources: EstimateStructurePromptSource[];
  project: EmbeddedProjectAccess;
  existingSections: MutableExistingSection[];
}) {
  const heuristicNodes = dedupeSiblingNodes(buildHeuristicNodes(input.sourceEntries));
  if (heuristicNodes.length === 0) {
    throw badRequest(
      "Aucune source exploitable pour generer une structure IA explicable.",
      undefined,
      "ESTIMATE_STRUCTURE_DRAFT_NO_SOURCES"
    );
  }

  const heuristicLookup = buildHeuristicLookup(heuristicNodes);
  return tryGenerateGeminiNodes({
    project: input.project,
    sourceSummaries: input.sourceSummaries,
    promptSources: input.promptSources,
    heuristicNodes,
  })
    .then((geminiResult) => {
      const geminiNodes = mergeGeminiNodesWithHeuristic({
        nodes: geminiResult.data.roots,
        heuristicLookup,
      });
      const annotated = annotateNodesAgainstExistingSections({
        nodes: geminiNodes,
        existingSectionsByParent: buildExistingSectionsByParent(input.existingSections),
      });

      return {
        nodes: annotated,
        metadata: {
          model: geminiResult.model,
          prompt_version: geminiResult.promptVersion,
          used_fallback: false,
          token_count: geminiResult.tokenCount,
          cost_cents: geminiResult.costCents,
          duration_ms: geminiResult.durationMs,
          source_entry_count: input.sourceEntries.length,
          generation_summary: geminiResult.data.summary ?? null,
          failure_code: null,
          failure_message: null,
        } satisfies EstimateStructureDraftGenerationMetadata,
      };
    })
    .catch((error: unknown) => {
      const annotated = annotateNodesAgainstExistingSections({
        nodes: heuristicNodes,
        existingSectionsByParent: buildExistingSectionsByParent(input.existingSections),
      });

      return {
        nodes: annotated,
        metadata: {
          model: null,
          prompt_version: ESTIMATE_STRUCTURE_PROMPT_VERSION,
          used_fallback: true,
          token_count: null,
          cost_cents: null,
          duration_ms: null,
          source_entry_count: input.sourceEntries.length,
          generation_summary: "Fallback heuristique utilise.",
          failure_code:
            error instanceof Error && "code" in error && typeof error.code === "string"
              ? error.code
              : null,
          failure_message: error instanceof Error ? error.message : "Generation Gemini indisponible.",
        } satisfies EstimateStructureDraftGenerationMetadata,
      };
    });
}

async function discardPendingDrafts(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const { error } = await input.supabase
    .from("estimate_structure_drafts")
    .update({
      status: "discarded",
    })
    .eq("tenant_id", input.tenantId)
    .eq("target_version_id", input.versionId)
    .eq("created_by", input.userId)
    .eq("status", "pending");

  if (error) {
    throw mapSupabaseError(error, "Impossible d'archiver les previews precedentes.");
  }
}

async function loadEstimateStructureDraftOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  draftId: string;
}) {
  const { data: draftData, error: draftError } = await input.supabase
    .from("estimate_structure_drafts")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("target_version_id", input.versionId)
    .eq("id", input.draftId)
    .single();

  if (draftError || !draftData) {
    if (draftError) {
      throw mapSupabaseError(draftError, "Impossible de charger la preview de structure.");
    }

    throw notFound("Preview de structure introuvable.");
  }

  const { data: nodeData, error: nodeError } = await input.supabase
    .from("estimate_structure_draft_nodes")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("draft_id", input.draftId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (nodeError) {
    throw mapSupabaseError(nodeError, "Impossible de charger les noeuds de structure.");
  }

  const flatNodes = ((nodeData ?? []) as EstimateStructureDraftNodeRow[]).map(
    (row) => ({
      id: row.id,
      parent_id: row.parent_node_id,
      order_index: row.order_index,
      hierarchy_level: row.hierarchy_level,
      label: row.label,
      normalized_label: row.normalized_label,
      confidence: clampConfidence(Number(row.confidence)),
      confidence_label: getConfidenceLabel(Number(row.confidence)),
      default_action: estimateStructureDraftNodeActionSchema.safeParse(
        row.default_action
      ).success
        ? (row.default_action as EstimateStructureDraftNodeAction)
        : "create",
      duplicate_match_item_id: row.duplicate_match_item_id,
      duplicate_match_path: row.duplicate_match_path,
      provenance: normalizeEvidenceEntries(row.provenance),
      facts: pickStringArray(row.facts),
      hypotheses: pickStringArray(row.hypotheses),
      inferences: pickStringArray(row.inferences),
    }))
    .sort((left, right) => {
      if (left.hierarchy_level !== right.hierarchy_level) {
        return left.hierarchy_level - right.hierarchy_level;
      }

      return left.order_index - right.order_index;
    });

  return {
    draft: draftData as EstimateStructureDraftRow,
    nodes: rebuildDraftNodes(flatNodes),
  } satisfies EstimateStructureDraftLoaded;
}

export async function generateEstimateStructureDraft(
  versionId: string,
  input: GenerateEstimateStructureDraftInput
): Promise<EstimateStructureDraftResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const { data: existingItemsData, error: existingItemsError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (existingItemsError) {
    throw mapSupabaseError(existingItemsError, "Impossible de charger la structure existante.");
  }

  const sourceBundle = await loadStructureDraftSourceBundle({
    supabase,
    tenantId,
    project,
    version,
  });

  const existingSections = buildExistingSections(
    (existingItemsData ?? []) as EstimateItemRow[]
  );

  const generation = await buildDraftNodesFromSources({
    sourceEntries: sourceBundle.source_entries,
    sourceSummaries: sourceBundle.source_summaries,
    promptSources: sourceBundle.prompt_sources,
    project,
    existingSections,
  });
  const summary = buildDraftSummary(generation.nodes);

  await discardPendingDrafts({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const draftInsert: EstimateStructureDraftInsert = {
    tenant_id: tenantId,
    project_id: project.id,
    target_version_id: versionId,
    created_by: userId,
    status: "pending",
    strategy: input.strategy ?? "hybrid",
    summary: toJson(summary),
    source_overview: toJson(sourceBundle.source_summaries),
    generation_metadata: toJson(generation.metadata),
    applied_at: null,
  };

  const { data: draftData, error: draftError } = await supabase
    .from("estimate_structure_drafts")
    .insert(draftInsert)
    .select("*")
    .single();

  if (draftError || !draftData) {
    if (draftError) {
      throw mapSupabaseError(draftError, "Impossible de creer la preview de structure.");
    }

    throw badRequest("Impossible de creer la preview de structure.");
  }

  const flattenedNodes = flattenDraftNodes(generation.nodes);
  const nodeIdMap = new Map(flattenedNodes.map((node) => [node.id, randomUUID()] as const));

  const nodesInsert: EstimateStructureDraftNodeInsert[] = flattenedNodes.map((node) => ({
    id: nodeIdMap.get(node.id) ?? randomUUID(),
    tenant_id: tenantId,
    draft_id: draftData.id,
    parent_node_id: node.parent_id ? nodeIdMap.get(node.parent_id) ?? null : null,
    order_index: node.order_index,
    hierarchy_level: node.hierarchy_level,
    label: node.label,
    normalized_label: node.normalized_label,
    confidence: node.confidence,
    default_action: node.default_action,
    duplicate_match_item_id: node.duplicate_match_item_id,
    duplicate_match_path: node.duplicate_match_path,
    provenance: toJson(node.provenance),
    facts: toJson(node.facts),
    hypotheses: toJson(node.hypotheses),
    inferences: toJson(node.inferences),
  }));

  const { error: insertNodesError } = await supabase
    .from("estimate_structure_draft_nodes")
    .insert(nodesInsert);

  if (insertNodesError) {
    await supabase
      .from("estimate_structure_drafts")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", draftData.id);
    throw mapSupabaseError(insertNodesError, "Impossible d'enregistrer les noeuds de structure.");
  }

  const persistedNodes = rebuildDraftNodes(
    flattenedNodes.map((node) => ({
      ...node,
      id: nodeIdMap.get(node.id) ?? node.id,
      parent_id: node.parent_id ? nodeIdMap.get(node.parent_id) ?? null : null,
    }) satisfies EstimateStructureDraftNodePayloadFlat)
  );

  return {
    draft_id: draftData.id,
    version_id: versionId,
    strategy: input.strategy ?? "hybrid",
    sources: sourceBundle.source_summaries,
    summary,
    nodes: persistedNodes,
    generated_at: draftData.created_at,
  };
}

export async function getEstimateStructureDraft(
  versionId: string,
  draftId: string
): Promise<EstimateStructureDraftResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  await getVersionAccessOrThrow(supabase, versionId, context);
  const loaded = await loadEstimateStructureDraftOrThrow({
    supabase,
    tenantId,
    versionId,
    draftId,
  });

  return {
    draft_id: loaded.draft.id,
    version_id: versionId,
    strategy:
      loaded.draft.strategy === "hybrid" ? loaded.draft.strategy : "hybrid",
    sources: normalizeSourceSummaries(loaded.draft.source_overview),
    summary: normalizeDraftSummary(loaded.draft.summary),
    nodes: loaded.nodes,
    generated_at: loaded.draft.created_at,
  };
}

function collectSubtreeIds(
  rootIds: string[],
  nodesByParent: Map<string, EstimateStructureDraftNodePayload[]>
) {
  const collected = new Set<string>();
  const visit = (nodeId: string) => {
    if (collected.has(nodeId)) return;
    collected.add(nodeId);
    const children = nodesByParent.get(nodeId) ?? [];
    children.forEach((child) => visit(child.id));
  };

  rootIds.forEach((rootId) => visit(rootId));
  return collected;
}

function buildDraftNodeMaps(nodes: EstimateStructureDraftNodePayload[]) {
  const byId = new Map<string, EstimateStructureDraftNodePayload>();
  const byParent = new Map<string, EstimateStructureDraftNodePayload[]>();

  const visit = (node: EstimateStructureDraftNodePayload) => {
    byId.set(node.id, node);
    const key = node.parent_id ?? ROOT_PARENT_KEY;
    const siblings = byParent.get(key);
    if (siblings) {
      siblings.push(node);
    } else {
      byParent.set(key, [node]);
    }

    node.children.forEach(visit);
  };

  nodes.forEach(visit);
  byParent.forEach((siblings) => {
    siblings.sort((left, right) => left.order_index - right.order_index);
  });
  return {
    byId,
    byParent,
  };
}

function validateDraftOverrideMap(
  overrides: ApplyEstimateStructureDraftInput["overrides"]
) {
  const byNodeId = new Map<string, (typeof overrides)[number]>();
  overrides.forEach((override) => {
    if (byNodeId.has(override.node_id)) {
      throw badRequest(
        "Un seul override est autorise par noeud.",
        { node_id: override.node_id },
        "ESTIMATE_STRUCTURE_DRAFT_OVERRIDE_DUPLICATE"
      );
    }

    byNodeId.set(override.node_id, override);
  });
  return byNodeId;
}

function computeSectionPath(
  section: MutableExistingSection,
  sectionById: Map<string, MutableExistingSection>
) {
  const parts: string[] = [];
  let cursor: MutableExistingSection | undefined = section;
  while (cursor) {
    parts.unshift(toNullableText(cursor.title) ?? "Section");
    cursor = cursor.parent_id ? sectionById.get(cursor.parent_id) : undefined;
  }
  return parts.join(" > ");
}

function throwEstimateStructureDraftApplyRpcErrorIfNeeded(error: {
  message?: string | null;
}) {
  const normalizedMessage = (error.message ?? "").toLowerCase();

  if (normalizedMessage.includes("estimate_structure_draft_not_pending")) {
    throw conflict(
      "Cette preview n'est plus applicable.",
      { status: "applied" },
      "ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING"
    );
  }

  if (normalizedMessage.includes("estimate_structure_draft_not_found")) {
    throw notFound("Preview de structure introuvable.");
  }
}

export async function applyEstimateStructureDraft(
  versionId: string,
  draftId: string,
  input: ApplyEstimateStructureDraftInput
): Promise<EstimateStructureDraftApplyResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const loaded = await loadEstimateStructureDraftOrThrow({
    supabase,
    tenantId,
    versionId,
    draftId,
  });

  if (loaded.draft.status !== "pending") {
    throw conflict(
      "Cette preview n'est plus applicable.",
      { status: loaded.draft.status },
      "ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING"
    );
  }

  const { data: existingItemsData, error: existingItemsError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (existingItemsError) {
    throw mapSupabaseError(existingItemsError, "Impossible de charger la structure cible.");
  }

  const existingItems = (existingItemsData ?? []) as EstimateItemRow[];
  if (input.mode === "create_empty" && existingItems.length > 0) {
    throw conflict(
      "Le mode creer a vide est reserve aux versions sans structure existante.",
      undefined,
      "ESTIMATE_STRUCTURE_DRAFT_CREATE_EMPTY_REQUIRES_EMPTY_VERSION"
    );
  }

  const nodeMaps = buildDraftNodeMaps(loaded.nodes);
  const rootNodeIds = new Set(
    loaded.nodes
      .filter((node) => node.parent_id === null)
      .map((node) => node.id)
  );

  input.selected_root_node_ids.forEach((nodeId) => {
    if (!rootNodeIds.has(nodeId)) {
      throw badRequest(
        "selected_root_node_ids doit contenir uniquement des lots racine.",
        { node_id: nodeId },
        "ESTIMATE_STRUCTURE_DRAFT_SELECTED_ROOT_REQUIRED"
      );
    }
  });

  const selectedSubtreeIds = collectSubtreeIds(
    input.selected_root_node_ids,
    nodeMaps.byParent
  );
  const overrideByNodeId = validateDraftOverrideMap(input.overrides);

  overrideByNodeId.forEach((_, nodeId) => {
    if (!selectedSubtreeIds.has(nodeId)) {
      throw badRequest(
        "Un override cible un noeud non selectionne.",
        { node_id: nodeId },
        "ESTIMATE_STRUCTURE_DRAFT_OVERRIDE_OUTSIDE_SELECTION"
      );
    }
  });

  const existingSections = buildExistingSections(existingItems);
  const sectionById = new Map(existingSections.map((section) => [section.id, section] as const));
  const existingSectionsByParent = buildExistingSectionsByParent(existingSections);
  const nextPositionByParent = new Map<string, number>();
  existingSections.forEach((section) => {
    const key = section.parent_id ?? ROOT_PARENT_KEY;
    const current = nextPositionByParent.get(key) ?? 0;
    if (section.position > current) {
      nextPositionByParent.set(key, section.position);
    }
  });

  const allocateNextPosition = (parentId: string | null) => {
    const key = parentId ?? ROOT_PARENT_KEY;
    const next = (nextPositionByParent.get(key) ?? 0) + 1;
    nextPositionByParent.set(key, next);
    return next;
  };

  const createdItemIds: string[] = [];
  const mergedItemIds = new Set<string>();
  const plannedCreates: EstimateStructureDraftPlannedCreate[] = [];
  const plannedUpdates: EstimateStructureDraftPlannedUpdate[] = [];
  const applicationRows: EstimateStructureDraftApplicationInsert[] = [];
  let createdCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;

  const registerSection = (section: MutableExistingSection) => {
    sectionById.set(section.id, section);
    const key = section.parent_id ?? ROOT_PARENT_KEY;
    const siblings = existingSectionsByParent.get(key);
    if (siblings) {
      siblings.push(section);
      siblings.sort((left, right) => left.position - right.position);
    } else {
      existingSectionsByParent.set(key, [section]);
    }
  };

  const resolveMergeTarget = (inputMerge: {
    node: EstimateStructureDraftNodePayload;
    parentItemId: string | null;
    overrideMergeIntoItemId: string | null | undefined;
  }) => {
    const preferredTargetId =
      inputMerge.overrideMergeIntoItemId ?? inputMerge.node.duplicate_match_item_id;
    const preferredTarget =
      preferredTargetId ? sectionById.get(preferredTargetId) ?? null : null;

    if (
      preferredTarget &&
      preferredTarget.parent_id === inputMerge.parentItemId &&
      preferredTarget.hierarchy_level === inputMerge.node.hierarchy_level
    ) {
      return preferredTarget;
    }

    const siblings =
      existingSectionsByParent.get(inputMerge.parentItemId ?? ROOT_PARENT_KEY) ?? [];
    return (
      siblings.find(
        (section) =>
          section.normalized_label === inputMerge.node.normalized_label &&
          section.hierarchy_level === inputMerge.node.hierarchy_level
      ) ?? null
    );
  };

  const applyNode = async (
    node: EstimateStructureDraftNodePayload,
    parentItemId: string | null
  ): Promise<string | null> => {
    const override = overrideByNodeId.get(node.id);
    const action = override?.action ?? node.default_action;
    const renameTo = toNullableText(override?.rename_to) ?? null;
    const label = renameTo ?? node.label;

    if (action === "skip") {
      skippedCount += 1;
      return null;
    }

    if (action === "merge") {
      const mergeTarget = resolveMergeTarget({
        node,
        parentItemId,
        overrideMergeIntoItemId: override?.merge_into_item_id,
      });

      if (!mergeTarget) {
        throw badRequest(
          "Aucune section cible n'a ete trouvee pour la fusion.",
          {
            node_id: node.id,
            label: node.label,
          },
          "ESTIMATE_STRUCTURE_DRAFT_MERGE_TARGET_REQUIRED"
        );
      }

      if (renameTo && renameTo !== mergeTarget.title) {
        plannedUpdates.push({
          id: mergeTarget.id,
          title: renameTo,
          source_provider: ESTIMATE_STRUCTURE_PROVIDER,
          source_file_name: ESTIMATE_STRUCTURE_SOURCE_FILE_NAME,
          source_page: null,
          source_job_id: null,
        });

        mergeTarget.title = renameTo;
        mergeTarget.normalized_label = normalizeSectionTitleKey(renameTo);
        mergeTarget.path = computeSectionPath(mergeTarget, sectionById);
      }

      applicationRows.push({
        tenant_id: tenantId,
        draft_id: draftId,
        draft_node_id: node.id,
        target_version_id: versionId,
        estimate_item_id: mergeTarget.id,
        applied_action: "merge",
        applied_by: userId,
      });
      mergedCount += 1;
      mergedItemIds.add(mergeTarget.id);

      for (const child of node.children) {
        await applyNode(child, mergeTarget.id);
      }

      return mergeTarget.id;
    }

    const insertedId = randomUUID();
    const position = allocateNextPosition(parentItemId);
    const insertPayload: EstimateStructureDraftPlannedCreate = {
      id: insertedId,
      parent_id: parentItemId,
      item_type: "section",
      position,
      title: label,
      source_provider: ESTIMATE_STRUCTURE_PROVIDER,
      source_job_id: null,
      source_file_name: ESTIMATE_STRUCTURE_SOURCE_FILE_NAME,
      source_page: null,
    };
    plannedCreates.push(insertPayload);

    const mutableSection: MutableExistingSection = {
      id: insertPayload.id,
      parent_id: insertPayload.parent_id,
      position: insertPayload.position,
      title: insertPayload.title,
      normalized_label: normalizeSectionTitleKey(insertPayload.title),
      hierarchy_level: node.hierarchy_level,
      path: "",
    };
    mutableSection.path = computeSectionPath(mutableSection, new Map([
      ...sectionById,
      [mutableSection.id, mutableSection],
    ]));
    registerSection(mutableSection);

    applicationRows.push({
      tenant_id: tenantId,
      draft_id: draftId,
      draft_node_id: node.id,
      target_version_id: versionId,
      estimate_item_id: insertPayload.id,
      applied_action: "create",
      applied_by: userId,
    });
    createdCount += 1;
    createdItemIds.push(insertPayload.id);

    for (const child of node.children) {
      await applyNode(child, insertPayload.id);
    }

    return insertPayload.id;
  };

  for (const rootNodeId of input.selected_root_node_ids) {
    const rootNode = nodeMaps.byId.get(rootNodeId);
    if (!rootNode) {
      throw badRequest("Noeud racine introuvable.");
    }
    await applyNode(rootNode, null);
  }

  const { data: applyRpcData, error: applyRpcError } = await supabase.rpc(
    "apply_estimate_structure_draft",
    {
      p_draft_id: draftId,
      p_target_version_id: versionId,
      p_applied_by: userId,
      p_created_items: toJson(plannedCreates),
      p_updated_items: toJson(plannedUpdates),
      p_application_rows: toJson(applicationRows),
      p_applied_at: new Date().toISOString(),
    }
  );

  if (applyRpcError) {
    throwEstimateStructureDraftApplyRpcErrorIfNeeded(applyRpcError);
    throw mapSupabaseError(applyRpcError, "Impossible d'appliquer la preview de structure.");
  }

  const rpcResult = Array.isArray(applyRpcData)
    ? ((applyRpcData[0] as EstimateStructureDraftApplyRpcResult | undefined) ?? null)
    : null;

  if (!rpcResult) {
    throw badRequest("Impossible d'appliquer la preview de structure.");
  }

  const versionToken = await fetchEstimateVersionToken({
    supabase,
    tenantId,
    versionId,
  });

  return {
    draft_id: draftId,
    version_id: versionId,
    mode: input.mode,
    created_count: createdCount,
    merged_count: mergedCount,
    skipped_count: skippedCount,
    created_item_ids: createdItemIds,
    merged_item_ids: Array.from(mergedItemIds),
    version: versionToken,
  };
}

export async function enrichEstimateItemsWithAiStructureProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  items: EstimateItemRow[];
}) {
  const itemIds = input.items.map((item) => item.id);

  if (itemIds.length === 0) {
    return input.items;
  }

  const { data: applicationData, error: applicationError } = await input.supabase
    .from("estimate_structure_draft_applications")
    .select(
      "draft_id, draft_node_id, estimate_item_id, applied_action, created_at"
    )
    .eq("tenant_id", input.tenantId)
    .in("estimate_item_id", itemIds);

  if (applicationError || !applicationData || applicationData.length === 0) {
    return input.items;
  }

  const draftNodeIds = Array.from(
    new Set(applicationData.map((row) => row.draft_node_id))
  );
  const draftIds = Array.from(new Set(applicationData.map((row) => row.draft_id)));

  const [draftNodeResult, draftResult] = await Promise.all([
    input.supabase
      .from("estimate_structure_draft_nodes")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .in("id", draftNodeIds),
    input.supabase
      .from("estimate_structure_drafts")
      .select("id, created_at, generation_metadata")
      .eq("tenant_id", input.tenantId)
      .in("id", draftIds),
  ]);

  if (draftNodeResult.error || draftResult.error) {
    return input.items;
  }

  const draftNodeById = new Map(
    ((draftNodeResult.data ?? []) as EstimateStructureDraftNodeRow[]).map((row) => [
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

  const applicationsByItemId = new Map<
    string,
    Array<{
      draft_id: string;
      draft_node_id: string;
      estimate_item_id: string;
      applied_action: string;
      created_at: string;
    }>
  >();

  applicationData.forEach((row) => {
    const current = applicationsByItemId.get(row.estimate_item_id);
    if (current) {
      current.push(row);
      return;
    }

    applicationsByItemId.set(row.estimate_item_id, [row]);
  });

  return input.items.map((item) => {
    const applications = applicationsByItemId.get(item.id);
    if (!applications || applications.length === 0) {
      return item;
    }

    const enrichedApplications = applications
      .map((application) => {
        const node = draftNodeById.get(application.draft_node_id);
        const draft = draftById.get(application.draft_id);
        if (!node || !draft) {
          return null;
        }

        const generationMetadata =
          draft.generation_metadata && typeof draft.generation_metadata === "object"
            ? (draft.generation_metadata as JsonRecord)
            : {};

        return {
          draft_id: application.draft_id,
          draft_node_id: application.draft_node_id,
          applied_action: application.applied_action,
          applied_at: application.created_at,
          generated_at: draft.created_at,
          label: node.label,
          hierarchy_level: node.hierarchy_level,
          confidence: clampConfidence(Number(node.confidence)),
          confidence_label: getConfidenceLabel(Number(node.confidence)),
          provenance: normalizeEvidenceEntries(node.provenance),
          facts: pickStringArray(node.facts),
          hypotheses: pickStringArray(node.hypotheses),
          inferences: pickStringArray(node.inferences),
          generation_mode:
            typeof generationMetadata.model === "string"
              ? generationMetadata.model
              : null,
          used_fallback: Boolean(generationMetadata.used_fallback),
        };
      })
      .filter((application): application is NonNullable<typeof application> => Boolean(application));

    if (enrichedApplications.length === 0) {
      return item;
    }

    return {
      ...item,
      source_file_name:
        toNullableText(item.source_file_name) ?? ESTIMATE_STRUCTURE_SOURCE_FILE_NAME,
      source_metadata: {
        kind: ESTIMATE_STRUCTURE_PROVIDER,
        application_count: enrichedApplications.length,
        applications: enrichedApplications,
      } satisfies JsonRecord,
      source_extracted_at: enrichedApplications[0]?.generated_at ?? null,
    };
  });
}
