import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { mapSupabaseError, unprocessableEntity } from "@/lib/estimates/errors";
import type {
  TakeoffCarryOverLinkState,
  TakeoffCarryOverStatus,
  TakeoffCarryOverSummary,
  TakeoffLinkedJobSummary,
} from "@/lib/takeoff/types";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

const CHUNK_SIZE = 500;
const uuidSchema = z.string().uuid("Identifiant version invalide.");

const takeoffJobSummaryRowSchema = z
  .object({
    id: z.string().uuid(),
    estimate_version_id: z.string().uuid(),
    status: z.string(),
    level: z.string(),
    source_file_name: z.string().nullable(),
    source_file_type: z.string().nullable(),
    source_file_size_bytes: z.number().int().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const takeoffVersionLinkRowSchema = z
  .object({
    takeoff_job_id: z.string().uuid(),
    source_version_id: z.string().uuid(),
    target_version_id: z.string().uuid(),
    linked_at: z.string(),
  })
  .strict();

const estimateVersionNumberRowSchema = z
  .object({
    id: z.string().uuid(),
    version_number: z.number().int().positive(),
  })
  .strict();

const ACQUIRED_TAKEOFF_JOB_STATUSES = new Set(["completed", "applied"]);
const IN_PROGRESS_TAKEOFF_JOB_STATUSES = new Set(["pending", "processing"]);
const ACTION_REQUIRED_TAKEOFF_JOB_STATUSES = new Set(["failed", "canceled"]);

function parseVersionId(versionId: string): string {
  const parsed = uuidSchema.safeParse(versionId);
  if (!parsed.success) {
    throw unprocessableEntity(
      "versionId invalide.",
      {
        issues: parsed.error.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
        })),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

function toUniqueUuids(values: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const parsed = uuidSchema.safeParse(trimmed);
    if (!parsed.success) {
      continue;
    }

    unique.add(parsed.data);
  }

  return [...unique];
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeTakeoffJobRows(rows: unknown[]): z.infer<typeof takeoffJobSummaryRowSchema>[] {
  return rows
    .map((row) => {
      const parsed = takeoffJobSummaryRowSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((row): row is z.infer<typeof takeoffJobSummaryRowSchema> => row !== null);
}

function normalizeTakeoffVersionLinkRows(
  rows: unknown[]
): z.infer<typeof takeoffVersionLinkRowSchema>[] {
  return rows
    .map((row) => {
      const parsed = takeoffVersionLinkRowSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((row): row is z.infer<typeof takeoffVersionLinkRowSchema> => row !== null);
}

function normalizeEstimateVersionNumberRows(
  rows: unknown[]
): z.infer<typeof estimateVersionNumberRowSchema>[] {
  return rows
    .map((row) => {
      const parsed = estimateVersionNumberRowSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    })
    .filter((row): row is z.infer<typeof estimateVersionNumberRowSchema> => row !== null);
}

function toTimestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export type LinkTakeoffJobsCarryOverResult = {
  source_job_count: number;
  linked_count: number;
};

export async function linkTakeoffJobsFromSourceVersionToTargetVersion(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  sourceVersionId: string;
  targetVersionId: string;
}): Promise<LinkTakeoffJobsCarryOverResult> {
  const sourceVersionId = parseVersionId(input.sourceVersionId);
  const targetVersionId = parseVersionId(input.targetVersionId);

  if (sourceVersionId === targetVersionId) {
    return {
      source_job_count: 0,
      linked_count: 0,
    };
  }

  const sourceJobsPromise = input.supabase
    .from("takeoff_jobs" as never)
    .select("id" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("estimate_version_id" as never, sourceVersionId as never);

  const inheritedLinksPromise = input.supabase
    .from("takeoff_version_links" as never)
    .select("takeoff_job_id, source_version_id, target_version_id, linked_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("target_version_id" as never, sourceVersionId as never);

  const [
    { data: sourceJobsData, error: sourceJobsError },
    { data: inheritedLinksData, error: inheritedLinksError },
  ] = await Promise.all([sourceJobsPromise, inheritedLinksPromise]);

  if (sourceJobsError) {
    throw mapSupabaseError(
      sourceJobsError,
      "Impossible de recuperer les jobs takeoff de la version source."
    );
  }

  if (inheritedLinksError) {
    throw mapSupabaseError(
      inheritedLinksError,
      "Impossible de recuperer les liens takeoff de la version source."
    );
  }

  const sourceJobs = toUniqueUuids(
    ((sourceJobsData ?? []) as Array<{ id?: string | null }>).map((row) => row.id)
  );
  const inheritedLinks = normalizeTakeoffVersionLinkRows(
    (inheritedLinksData ?? []) as unknown[]
  );

  const sourceVersionIdByJobId = new Map<string, string>(
    inheritedLinks.map((link) => [link.takeoff_job_id, link.source_version_id] as const)
  );

  for (const sourceJobId of sourceJobs) {
    sourceVersionIdByJobId.set(sourceJobId, sourceVersionId);
  }

  if (sourceVersionIdByJobId.size === 0) {
    return {
      source_job_count: 0,
      linked_count: 0,
    };
  }

  const payload = [...sourceVersionIdByJobId.entries()].map(
    ([jobId, sourceVersionIdForJob]) => ({
      tenant_id: input.tenantId,
      takeoff_job_id: jobId,
      source_version_id: sourceVersionIdForJob,
      target_version_id: targetVersionId,
      linked_by: input.userId,
    })
  );

  let linkedCount = 0;
  const chunks = chunkArray(payload, CHUNK_SIZE);

  for (const chunk of chunks) {
    const { data, error } = await input.supabase
      .from("takeoff_version_links" as never)
      .upsert(chunk as never, {
        onConflict: "takeoff_job_id,target_version_id",
        ignoreDuplicates: true,
      })
      .select("id" as never);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de lier les jobs takeoff a la nouvelle version."
      );
    }

    linkedCount += Array.isArray(data) ? data.length : 0;
  }

  return {
    source_job_count: sourceVersionIdByJobId.size,
    linked_count: linkedCount,
  };
}

async function getVersionNumberById(input: {
  supabase: Supabase;
  tenantId: string;
  versionIds: string[];
}): Promise<Map<string, number>> {
  if (input.versionIds.length === 0) {
    return new Map();
  }

  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, version_number" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .in("id" as never, input.versionIds as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les versions sources des liens.");
  }

  const rows = normalizeEstimateVersionNumberRows((data ?? []) as unknown[]);
  return new Map(rows.map((row) => [row.id, row.version_number]));
}

export function createTakeoffCarryOverSummary(input: {
  sourceVersionId: string | null;
  sourceVersionNumber?: number | null;
  state: TakeoffCarryOverSummary["state"];
  totalJobs?: number;
  acquiredJobs?: number;
  inProgressJobs?: number;
  actionRequiredJobs?: number;
}): TakeoffCarryOverSummary {
  return {
    sourceVersionId: input.sourceVersionId,
    sourceVersionNumber: input.sourceVersionNumber ?? null,
    state: input.state,
    totalJobs: Math.max(input.totalJobs ?? 0, 0),
    acquiredJobs: Math.max(input.acquiredJobs ?? 0, 0),
    inProgressJobs: Math.max(input.inProgressJobs ?? 0, 0),
    actionRequiredJobs: Math.max(input.actionRequiredJobs ?? 0, 0),
  };
}

export function createTakeoffCarryOverStatus(input: {
  summary: TakeoffCarryOverSummary;
  linkState: TakeoffCarryOverLinkState;
  linkedJobs?: number;
  sourceJobs?: number;
}): TakeoffCarryOverStatus {
  const linkedJobs = Math.max(input.linkedJobs ?? 0, 0);
  const sourceJobs = Math.max(
    input.sourceJobs ?? input.summary.totalJobs,
    linkedJobs,
    0
  );
  const summaryTotalJobs = Math.max(input.summary.totalJobs, sourceJobs);
  const summary =
    summaryTotalJobs === input.summary.totalJobs
      ? input.summary
      : {
          ...input.summary,
          totalJobs: summaryTotalJobs,
        };
  const unlinkedJobs = Math.max(sourceJobs - linkedJobs, 0);

  return {
    summary,
    linkState: input.linkState,
    linkedJobs,
    unlinkedJobs,
  };
}

export async function summarizeTakeoffCarryOverSourceVersion(input: {
  supabase: Supabase;
  tenantId: string;
  sourceVersionId: string | null | undefined;
}): Promise<TakeoffCarryOverSummary> {
  if (!input.sourceVersionId) {
    return createTakeoffCarryOverSummary({
      sourceVersionId: null,
      state: "not_applicable",
    });
  }

  const sourceVersionId = parseVersionId(input.sourceVersionId);
  const [jobs, versionNumberById] = await Promise.all([
    listAccessibleTakeoffJobsForVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      versionId: sourceVersionId,
    }),
    getVersionNumberById({
      supabase: input.supabase,
      tenantId: input.tenantId,
      versionIds: [sourceVersionId],
    }),
  ]);

  if (jobs.length === 0) {
    return createTakeoffCarryOverSummary({
      sourceVersionId,
      sourceVersionNumber: versionNumberById.get(sourceVersionId) ?? null,
      state: "empty",
    });
  }

  let acquiredJobs = 0;
  let inProgressJobs = 0;
  let actionRequiredJobs = 0;

  for (const job of jobs) {
    const normalizedStatus = job.status.trim().toLowerCase();

    if (ACQUIRED_TAKEOFF_JOB_STATUSES.has(normalizedStatus)) {
      acquiredJobs += 1;
      continue;
    }

    if (IN_PROGRESS_TAKEOFF_JOB_STATUSES.has(normalizedStatus)) {
      inProgressJobs += 1;
      continue;
    }

    if (ACTION_REQUIRED_TAKEOFF_JOB_STATUSES.has(normalizedStatus)) {
      actionRequiredJobs += 1;
      continue;
    }

    inProgressJobs += 1;
  }

  return createTakeoffCarryOverSummary({
    sourceVersionId,
    sourceVersionNumber: versionNumberById.get(sourceVersionId) ?? null,
    state:
      inProgressJobs > 0 || actionRequiredJobs > 0 ? "attention_required" : "ready",
    totalJobs: jobs.length,
    acquiredJobs,
    inProgressJobs,
    actionRequiredJobs,
  });
}

export async function getTakeoffLinkedSourceVersionByJobId(input: {
  supabase: Supabase;
  tenantId: string;
  targetVersionId: string;
  jobIds: string[];
}): Promise<
  Map<
    string,
    {
      source_version_id: string;
      source_version_number: number | null;
    }
  >
> {
  const targetVersionId = parseVersionId(input.targetVersionId);
  const uniqueJobIds = toUniqueUuids(input.jobIds);

  if (uniqueJobIds.length === 0) {
    return new Map();
  }

  const { data, error } = await input.supabase
    .from("takeoff_version_links" as never)
    .select("takeoff_job_id, source_version_id, target_version_id, linked_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("target_version_id" as never, targetVersionId as never)
    .in("takeoff_job_id" as never, uniqueJobIds as never);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les liens de provenance takeoff."
    );
  }

  const links = normalizeTakeoffVersionLinkRows((data ?? []) as unknown[]);
  if (links.length === 0) {
    return new Map();
  }

  const sourceVersionIds = toUniqueUuids(
    links.map((link) => link.source_version_id)
  );
  const versionNumberById = await getVersionNumberById({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionIds: sourceVersionIds,
  });

  return new Map(
    links.map((link) => [
      link.takeoff_job_id,
      {
        source_version_id: link.source_version_id,
        source_version_number: versionNumberById.get(link.source_version_id) ?? null,
      },
    ])
  );
}

export async function listAccessibleTakeoffJobsForVersion(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<TakeoffLinkedJobSummary[]> {
  const versionId = parseVersionId(input.versionId);

  const directJobsPromise = input.supabase
    .from("takeoff_jobs" as never)
    .select(
      "id, estimate_version_id, status, level, source_file_name, source_file_type, source_file_size_bytes, created_at, updated_at" as never
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("estimate_version_id" as never, versionId as never);

  const linkedJobsPromise = input.supabase
    .from("takeoff_version_links" as never)
    .select("takeoff_job_id, source_version_id, target_version_id, linked_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("target_version_id" as never, versionId as never);

  const [{ data: directJobsData, error: directJobsError }, { data: linksData, error: linksError }] =
    await Promise.all([directJobsPromise, linkedJobsPromise]);

  if (directJobsError) {
    throw mapSupabaseError(directJobsError, "Impossible de charger les jobs takeoff.");
  }

  if (linksError) {
    throw mapSupabaseError(
      linksError,
      "Impossible de charger les liens takeoff de la version."
    );
  }

  const directJobs = normalizeTakeoffJobRows((directJobsData ?? []) as unknown[]);
  const links = normalizeTakeoffVersionLinkRows((linksData ?? []) as unknown[]);
  const linkedJobIds = toUniqueUuids(links.map((link) => link.takeoff_job_id));

  let linkedJobs: z.infer<typeof takeoffJobSummaryRowSchema>[] = [];

  if (linkedJobIds.length > 0) {
    const { data, error } = await input.supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, estimate_version_id, status, level, source_file_name, source_file_type, source_file_size_bytes, created_at, updated_at" as never
      )
      .eq("tenant_id" as never, input.tenantId as never)
      .in("id" as never, linkedJobIds as never);

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger les jobs takeoff lies.");
    }

    linkedJobs = normalizeTakeoffJobRows((data ?? []) as unknown[]);
  }

  const sourceVersionIds = toUniqueUuids(links.map((link) => link.source_version_id));
  const sourceVersionNumberById = await getVersionNumberById({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionIds: sourceVersionIds,
  });
  const linkByJobId = new Map(
    links.map((link) => [link.takeoff_job_id, link] as const)
  );

  const directById = new Map<string, TakeoffLinkedJobSummary>(
    directJobs.map((job) => [
      job.id,
      {
        ...job,
        linked_from_version_id: null,
        linked_from_version_number: null,
        is_linked: false,
      },
    ])
  );

  for (const linkedJob of linkedJobs) {
    if (directById.has(linkedJob.id)) {
      continue;
    }

    const link = linkByJobId.get(linkedJob.id);
    const sourceVersionId = link?.source_version_id ?? null;

    directById.set(linkedJob.id, {
      ...linkedJob,
      linked_from_version_id: sourceVersionId,
      linked_from_version_number: sourceVersionId
        ? (sourceVersionNumberById.get(sourceVersionId) ?? null)
        : null,
      is_linked: true,
    });
  }

  return [...directById.values()].sort((a, b) => {
    return toTimestamp(b.created_at) - toTimestamp(a.created_at);
  });
}
