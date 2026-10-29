import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import {
  createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, evaluateTakeoffPreparation,
  takeoffPreparationSchema, type TakeoffPreparation, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { getPreparationSourcesFingerprint, reconcilePreparationSources } from "@/lib/takeoff/preparation-sources";
import {
  assertPreparationProjectAccess, persistPreparationRecord, preparationConflict,
  readPreparationRecord, readPreparationSources,
} from "@/lib/takeoff/preparation-repository";
import type { Json } from "@/types/database";
import { generateTakeoffPreparationAssistance } from "@/lib/takeoff/preparation-assistance-server";
import { classifyPreparationReferenceFormat } from "@/lib/takeoff/preparation-reference-loader";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { hasTakeoffPreparationCopyReceipt } from "@/lib/takeoff/preparation-copy-provenance-server";

const projectIdSchema = z.string().uuid();
const revisionSchema = z.number().int().positive();
const uploadSourceId = /^upload:([a-f0-9]{64})$/;
const snapshotIssueSchema = z.object({
  code: z.string(), path: z.string(), message: z.string(), source_document_id: z.string().optional(),
}).strict();
const storedPreparationSnapshotSchema = z.object({
  schema_version: z.literal(1), preparation_revision: revisionSchema,
  confirmed_by: z.string().uuid(), confirmed_at: z.string().datetime({ offset: true }),
  preparation: takeoffPreparationSchema,
  readiness: z.object({
    status: z.enum(["incomplete", "ready_with_reservations", "ready"]), can_launch: z.boolean(),
    blockers: z.array(snapshotIssueSchema), reservations: z.array(snapshotIssueSchema),
  }).strict(),
}).strict();

async function loadPreparation(context: AuthenticatedTenantContext, projectId: string) {
  const [record, availableSources] = await Promise.all([
    readPreparationRecord(context, projectId), readPreparationSources(context, projectId),
  ]);
  const saved = record ? takeoffPreparationSchema.parse(record.draft) : createEmptyTakeoffPreparation();
  const { draft, changedSourceIds } = reconcilePreparationSources(saved, availableSources);
  return {
    draft, revision: record?.revision ?? null, availableSources, changedSourceIds,
    confirmedAt: changedSourceIds.length ? null : record?.confirmed_at ?? null,
    confirmedBy: changedSourceIds.length ? null : record?.confirmed_by ?? null,
    sourceFingerprint: getPreparationSourcesFingerprint(availableSources),
    readiness: evaluateTakeoffPreparation(draft),
  };
}

export async function loadTakeoffPreparation(projectId: string) {
  projectIdSchema.parse(projectId);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, projectId);
  return loadPreparation(context, projectId);
}
export type TakeoffPreparationState = Awaited<ReturnType<typeof loadTakeoffPreparation>>;

function validateCanonicalSources(draft: TakeoffPreparation, availableSources: TakeoffPreparation["sources"]) {
  const available = new Map(availableSources.map((source) => [source.document_id, source]));
  for (const source of draft.sources.filter((entry) => entry.active)) {
    const uploadMatch = source.document_id.match(uploadSourceId);
    if (uploadMatch) {
      if (source.plan_set_id || source.file_path || source.source_version !== uploadMatch[1]) {
        preparationConflict("L'identité du fichier à téléverser doit être vérifiée à nouveau.");
      }
      source.content_hash = uploadMatch[1];
      continue;
    }
    const current = available.get(source.document_id);
    if (!current || current.source_version !== source.source_version || current.kind !== source.kind) {
      preparationConflict(`La source « ${source.document_name} » a changé. Vérifiez sa version avant de confirmer.`);
    }
    source.plan_set_id = current.plan_set_id;
    source.file_path = current.file_path;
    source.page_count = current.page_count;
    source.source_updated_at = current.source_updated_at;
    source.mime_type = current.mime_type;
    source.document_name = current.document_name;
  }
}

export async function saveTakeoffPreparation(input: {
  projectId: string; draft: TakeoffPreparation; expectedRevision: number | null;
}) {
  projectIdSchema.parse(input.projectId);
  revisionSchema.nullable().parse(input.expectedRevision);
  const draft = takeoffPreparationSchema.parse(input.draft);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId, true);
  if (draft.assistance && (draft.assistance.provenance.tenant_id !== context.tenantId || draft.assistance.provenance.project_id !== input.projectId)) {
    preparationConflict("La proposition d'assistance appartient à une autre affaire.");
  }
  const availableSources = await readPreparationSources(context, input.projectId);
  validateCanonicalSources(draft, availableSources);
  const reconciled = reconcilePreparationSources(draft, availableSources).draft;
  await persistPreparationRecord({
    context, projectId: input.projectId, expectedRevision: input.expectedRevision,
    revision: (input.expectedRevision ?? 0) + 1, draft: reconciled as unknown as Json,
    snapshot: null, confirmedAt: null,
  });
  return loadPreparation(context, input.projectId);
}

export async function confirmTakeoffPreparation(input: { projectId: string; expectedRevision: number }) {
  projectIdSchema.parse(input.projectId);
  revisionSchema.parse(input.expectedRevision);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId, true);
  const [record, sources] = await Promise.all([
    readPreparationRecord(context, input.projectId), readPreparationSources(context, input.projectId),
  ]);
  if (record?.confirmed_at && record.confirmed_snapshot &&
      (record.revision === input.expectedRevision || record.revision === input.expectedRevision + 1)) {
    const confirmed = takeoffPreparationSchema.parse(record.draft);
    validateCanonicalSources(confirmed, sources);
    if (reconcilePreparationSources(confirmed, sources).changedSourceIds.length) {
      preparationConflict("Les sources ont changé. Vérifiez la préparation avant une nouvelle confirmation.");
    }
    return loadPreparation(context, input.projectId);
  }
  if (!record || record.revision !== input.expectedRevision) {
    preparationConflict("La préparation a changé. Rechargez-la avant de confirmer.");
  }
  const draft = takeoffPreparationSchema.parse(record.draft);
  validateCanonicalSources(draft, sources);
  const referenceSources = draft.sources.filter((source) => source.active && source.kind !== "plan" && !source.document_id.startsWith("upload:"));
  if (referenceSources.length > 20) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "Sélectionnez au maximum 20 pièces de référence avant de confirmer.", retryable: false });
  }
  for (const source of referenceSources) {
    if (!classifyPreparationReferenceFormat({ file_name: source.document_name, mime_type: source.mime_type })) {
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
        message: `La pièce « ${source.document_name} » ne peut pas servir de référence à cette analyse. Utilisez un PDF, CSV, Excel ou texte, ou retirez-la des sources actives.`, retryable: false });
    }
  }
  // Confirm the actual bytes, including historical imports without a trustworthy hash.
  let referenceBytes = 0;
  for (const source of draft.sources.filter((entry) => entry.active && !entry.document_id.startsWith("upload:"))) {
    if (!source.file_path) preparationConflict("Un plan actif n'a plus de fichier source.");
    const { data, error } = await context.supabase.storage.from(source.plan_set_id ? PLAN_FILES_BUCKET : AFFAIRE_INTAKE_BUCKET).download(source.file_path);
    if (error || !data) throw mapSupabaseError({ code: "SOURCE_DOWNLOAD", message: error?.message ?? "Fichier introuvable." }, "Impossible de vérifier le contenu du plan.");
    if (!source.plan_set_id) {
      referenceBytes += data.size;
      if (referenceBytes > 20 * 1024 * 1024) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "Les pièces de référence dépassent 20 Mo. Réduisez la sélection avant de confirmer.", retryable: false });
    }
    source.content_hash = createHash("sha256").update(Buffer.from(await data.arrayBuffer())).digest("hex");
  }
  const revision = record.revision + 1;
  const confirmedAt = new Date().toISOString();
  const snapshot = createTakeoffPreparationSnapshot({ preparation: draft, confirmedBy: context.userId, confirmedAt, revision });
  // A metadata edit during the download cannot be confirmed from an older read.
  const latest = await readPreparationSources(context, input.projectId);
  validateCanonicalSources(draft, latest);
  await persistPreparationRecord({
    context, projectId: input.projectId, expectedRevision: record.revision, revision,
    draft: draft as unknown as Json, snapshot: snapshot as unknown as Json, confirmedAt,
  });
  return loadPreparation(context, input.projectId);
}

export async function assistTakeoffPreparation(input: { projectId: string; expectedRevision: number | null; instruction?: string }) {
  projectIdSchema.parse(input.projectId);
  revisionSchema.nullable().parse(input.expectedRevision);
  const instruction = z.string().trim().max(2000).optional().parse(input.instruction);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId, true);
  const state = await loadPreparation(context, input.projectId);
  if (state.revision !== input.expectedRevision) preparationConflict("La préparation a changé avant l'assistance. Rechargez-la.");
  const readBrief = () => context.supabase.from("affaire_briefs" as never)
    .select("summary,scope,lots,updated_at" as never).eq("tenant_id" as never, context.tenantId as never)
    .eq("project_id" as never, input.projectId as never).abortSignal(new AbortController().signal).maybeSingle();
  const { data: briefData, error: briefError } = await readBrief();
  if (briefError) throw mapSupabaseError(briefError, "Impossible de charger le brief de l'affaire.");
  const brief = briefData as { summary?: string; scope?: unknown; lots?: unknown } | null;
  const result = await generateTakeoffPreparationAssistance({
    owner: { tenantId: context.tenantId, userId: context.userId }, projectId: input.projectId,
    preparation: state.draft, sources: state.availableSources, revision: state.revision,
    sourceFingerprint: state.sourceFingerprint,
    instruction,
    ...(brief ? { brief: {
      summary: brief.summary,
      scope: Array.isArray(brief.scope) ? brief.scope.filter((entry): entry is string => typeof entry === "string").join("\n") : undefined,
      lots: Array.isArray(brief.lots) ? brief.lots.filter((entry): entry is string => typeof entry === "string") : [],
    } } : {}),
  });
  const latest = await loadPreparation(context, input.projectId);
  const { data: latestBrief, error: latestBriefError } = await readBrief();
  if (latestBriefError) throw mapSupabaseError(latestBriefError, "Impossible de vérifier le brief de l'affaire.");
  if (latest.revision !== state.revision || latest.sourceFingerprint !== state.sourceFingerprint || JSON.stringify(latestBrief) !== JSON.stringify(briefData)) {
    preparationConflict("Les sources ou la préparation ont changé pendant l'assistance. Relancez les propositions.");
  }
  return result;
}

export async function getTakeoffPreparationSourcePreview(input: { projectId: string; documentId: string; page?: number }) {
  projectIdSchema.parse(input.projectId);
  z.string().trim().min(1).max(4000).parse(input.documentId);
  z.number().int().positive().optional().parse(input.page);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId);
  const sources = await readPreparationSources(context, input.projectId);
  const source = sources.find((entry) => entry.document_id === input.documentId);
  if (!source?.file_path) preparationConflict("Cette pièce n'est plus disponible dans le dossier.");
  const { data, error } = await context.supabase.storage.from(source.plan_set_id ? PLAN_FILES_BUCKET : AFFAIRE_INTAKE_BUCKET)
    .createSignedUrl(source.file_path, 120);
  if (error || !data?.signedUrl) throw mapSupabaseError({ code: "SOURCE_PREVIEW", message: error?.message ?? "Lien indisponible." }, "Impossible d'ouvrir la pièce source.");
  return { url: `${data.signedUrl}${input.page ? `#page=${input.page}` : ""}`, name: source.document_name };
}

/** Every launch path consumes this gate; the worker retains the returned snapshot. */
export async function assertConfirmedTakeoffPreparation(input: {
  context: AuthenticatedTenantContext; estimateVersionId: string; projectId?: string;
  preparationRevision: number | null; planSetId?: string; upload?: { hash: string; fileName: string };
  sourceVersionId?: string;
}): Promise<TakeoffPreparationSnapshot> {
  revisionSchema.nullable().parse(input.preparationRevision);
  const { data: version, error } = await input.context.supabase.from("estimate_versions")
    .select("id,project_id").eq("tenant_id", input.context.tenantId)
    .eq("id", input.estimateVersionId).single();
  if (error || !version || (input.projectId && version.project_id !== input.projectId)) {
    preparationConflict("La version cible n'appartient pas à l'affaire de cette préparation.");
  }
  await assertPreparationProjectAccess(input.context, version.project_id, true);
  const [record, sources] = await Promise.all([
    readPreparationRecord(input.context, version.project_id), readPreparationSources(input.context, version.project_id),
  ]);
  if (!record?.confirmed_at || !record.confirmed_by || !record.confirmed_snapshot || record.revision !== input.preparationRevision) {
    preparationConflict("Vérifiez et confirmez la préparation du métré avant de lancer l'analyse.");
  }
  const stored = storedPreparationSnapshotSchema.parse(record.confirmed_snapshot);
  const preparation = takeoffPreparationSchema.parse(stored.preparation);
  if (stored.preparation_revision !== record.revision || stored.confirmed_by !== record.confirmed_by ||
      Date.parse(stored.confirmed_at) !== Date.parse(record.confirmed_at) ||
      JSON.stringify(preparation) !== JSON.stringify(takeoffPreparationSchema.parse(record.draft))) {
    preparationConflict("La confirmation ne correspond plus à la préparation enregistrée.");
  }
  validateCanonicalSources(preparation, sources);
  createTakeoffPreparationSnapshot({
    preparation, revision: record.revision, confirmedAt: stored.confirmed_at, confirmedBy: stored.confirmed_by,
  });
  const destination = preparation.destination;
  const provenanceSources = new Set([
    ...(input.sourceVersionId ? [input.sourceVersionId] : []),
    ...(destination.kind === "estimate_review" && destination.estimate_version_id !== version.id && destination.estimate_version_id ? [destination.estimate_version_id] : []),
  ]);
  for (const sourceVersionId of provenanceSources) {
    if (!await hasTakeoffPreparationCopyReceipt({
      context: input.context, projectId: version.project_id, sourceVersionId,
      targetVersionId: version.id, preparationRevision: record.revision,
    })) preparationConflict("Le brouillon ne possède pas de reçu de copie pour cette source et cette préparation. Vérifiez sa destination.");
  }
  const active = preparation.sources.filter((source) => source.active);
  if (input.planSetId) {
    const selectedPlans = active.filter((source) => source.kind === "plan");
    if (!selectedPlans.length || selectedPlans.some((source) => source.plan_set_id !== input.planSetId)) {
      preparationConflict("Les plans actifs doivent appartenir au jeu de plans choisi.");
    }
    const known = preparation.sources.filter((source) => source.plan_set_id === input.planSetId).map((source) => source.document_id).sort();
    const current = sources.filter((source) => source.plan_set_id === input.planSetId).map((source) => source.document_id).sort();
    if (JSON.stringify(known) !== JSON.stringify(current)) {
      preparationConflict("Le jeu de plans contient de nouvelles pièces. Vérifiez les sources retenues.");
    }
  }
  if (input.upload && (active.length !== 1 || active[0].document_id !== `upload:${input.upload.hash}` || active[0].document_name !== input.upload.fileName)) {
    preparationConflict("Le fichier téléversé ne correspond pas à la source confirmée.");
  }
  // PostgREST formats timestamptz with +00:00, while the immutable JSON kept Z.
  // Validate current eligibility above, then submit the exact stored JSON to SQL.
  return structuredClone(record.confirmed_snapshot) as unknown as TakeoffPreparationSnapshot;
}
