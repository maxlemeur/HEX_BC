import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError, mapSupabaseError } from "@/lib/http/api-response";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { getTakeoffExecutionSelection } from "@/lib/ai/chatgpt-takeoff";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import {
  createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, evaluateTakeoffPreparation,
  takeoffExecutionSelectionSchema, takeoffPreparationSchema, type TakeoffExecutionSelection, type TakeoffPreparation, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { buildDeducedTakeoffPreparation, DETAILED_TAKEOFF_PROCESSING, getDeducedPlanCandidates, isDossierDefaultSource, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import { hasCyclicPlanRevisionDecisions, readPlanTitleBlock } from "@/lib/takeoff/plan-revision-identity";
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
import { assertTakeoffPreparationProcessing, type TakeoffRequestedProcessing } from "@/lib/takeoff/preparation-processing-server";
import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { reconcileTakeoffPageTriageStatuses } from "@/lib/takeoff/page-triage";
import {
  runTakeoffPageTriage, TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS, TAKEOFF_PAGE_TRIAGE_MAX_PAGES, TAKEOFF_PAGE_TRIAGE_MAX_TOKENS, TAKEOFF_PAGE_TRIAGE_TEXT,
} from "@/lib/takeoff/page-triage-server";
import { getTakeoffDecisionsCapability } from "@/lib/takeoff/takeoff-decisions-server";

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
  execution_selection: takeoffExecutionSelectionSchema.optional(),
  readiness: z.object({
    status: z.enum(["incomplete", "ready_with_reservations", "ready"]), can_launch: z.boolean(),
    blockers: z.array(snapshotIssueSchema), reservations: z.array(snapshotIssueSchema),
  }).strict(),
}).strict();

function executionFingerprint({ profileId, hostId, model, reasoningEffort }: TakeoffExecutionSelection) {
  return createHash("sha256").update(JSON.stringify([profileId, hostId, model, reasoningEffort])).digest("hex");
}

export async function loadTakeoffExecutionPreview() {
  const context = await getAuthenticatedContext();
  const selection = await getTakeoffExecutionSelection(context.supabase, context, "chatgpt");
  return { model: selection.model, reasoningEffort: selection.reasoningEffort, fingerprint: executionFingerprint(selection) };
}

async function selectionForConfirmation(context: AuthenticatedTenantContext, expectedFingerprint?: string) {
  const selection = takeoffExecutionSelectionSchema.parse(await getTakeoffExecutionSelection(context.supabase, context, "chatgpt"));
  if (executionFingerprint(selection) !== expectedFingerprint) {
    throw new ApiError({ status: 409, code: "TAKEOFF_CHATGPT_SELECTION_CHANGED",
      message: "Le compte, le modèle ou l’effort ChatGPT a changé. Vérifiez la sélection affichée et confirmez de nouveau." });
  }
  return selection;
}

/**
 * The affaire's preparation as its options show it: the saved draft reconciled with the dossier's current pieces, and,
 * with a plan set, the preparation deduced from the dossier for that set. The automatic start seals the same deduction,
 * through the server's own client, without saving it over the member's draft.
 */
export async function loadPreparation(context: Pick<AuthenticatedTenantContext, "supabase" | "tenantId">, projectId: string, planSetId?: string) {
  const [record, availableSources] = await Promise.all([
    readPreparationRecord(context, projectId), readPreparationSources(context, projectId),
  ]);
  const saved = record ? takeoffPreparationSchema.parse(record.draft) : createEmptyTakeoffPreparation();
  const { draft: reconciled, changedSourceIds } = reconcilePreparationSources(saved, availableSources);
  let draft = reconciled;
  if (planSetId) {
    const { data, error } = await context.supabase.from("affaire_briefs").select("scope,lots")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).maybeSingle();
    if (error) throw mapSupabaseError(error, "Impossible de charger le périmètre du dossier.");
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 200) : [];
    const scope = strings(data?.scope);
    // A piece that changed role since the draft was saved (an attachment become CCTP) is a new piece: the defaults of
    // its new role apply, whether or not the draft already came from the dossier.
    const savedKinds = new Map(saved.sources.map((source) => [source.document_id, source.kind]));
    const currentKinds = new Map(availableSources.map((source) => [source.document_id, source.kind]));
    const kept = (id: string) => savedKinds.has(id) && (!currentKinds.has(id) || currentKinds.get(id) === savedKinds.get(id));
    draft = buildDeducedTakeoffPreparation({
      sources: availableSources, planSetId,
      saved: record ? { ...reconciled, sources: reconciled.sources.filter((source) => kept(source.document_id)) } : null,
      lots: strings(data?.lots), buildings: scope.filter((entry) => /\bb[âa]timents?\b/i.test(entry)), zones: scope.filter((entry) => /\bzones?\b/i.test(entry)),
    });
  }
  const needsSave = !record || JSON.stringify(saved) !== JSON.stringify(draft);
  return {
    draft, revision: record?.revision ?? null, availableSources, changedSourceIds, needsSave,
    confirmedAt: changedSourceIds.length || (planSetId && needsSave) ? null : record?.confirmed_at ?? null,
    confirmedBy: changedSourceIds.length || (planSetId && needsSave) ? null : record?.confirmed_by ?? null,
    sourceFingerprint: getPreparationSourcesFingerprint(availableSources),
    readiness: evaluateTakeoffPreparation(draft),
  };
}

export async function loadTakeoffPreparation(projectId: string, planSetId?: string) {
  projectIdSchema.parse(projectId);
  projectIdSchema.optional().parse(planSetId);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, projectId);
  return loadPreparation(context, projectId, planSetId);
}

async function readPreparationRevision(context: AuthenticatedTenantContext, projectId: string, revision: number, confirmed: boolean) {
  const state = await loadPreparation(context, projectId);
  if (state.revision !== revision || Boolean(state.confirmedAt) !== confirmed) {
    preparationConflict("La préparation a changé dans une autre fenêtre. Rechargez-la avant de continuer.");
  }
  return state;
}

/** A dossier piece the draft has not seen in its current role (new, or reclassified) is never left out unseen. */
function assertDossierSourcesReviewed(draft: TakeoffPreparation, sources: TakeoffPreparation["sources"]) {
  const planSetId = draft.provenance?.plan_set_id;
  if (!planSetId) return;
  const reviewed = new Map(draft.sources.map((source) => [source.document_id, source.kind]));
  if (sources.some((source) => (isDossierDefaultSource(source, planSetId) || reviewed.has(source.document_id)) &&
      reviewed.get(source.document_id) !== source.kind)) {
    preparationConflict("Des pièces ont été ajoutées ou reclassées dans le dossier. Rechargez la préparation pour vérifier la sélection mise à jour.");
  }
}

function validateCanonicalSources(draft: TakeoffPreparation, availableSources: TakeoffPreparation["sources"]) {
  const available = new Map(availableSources.map((source) => [source.document_id, source]));
  for (const source of draft.sources.filter((entry) => entry.active)) {
    const uploadMatch = source.document_id.match(uploadSourceId);
    if (uploadMatch) {
      if (draft.provenance && !source.source_version) continue;
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
  assertDossierSourcesReviewed(draft, availableSources);
  if (draft.provenance && hasCyclicPlanRevisionDecisions(getDeducedPlanCandidates(draft.sources), draft.plan_revision_decisions ?? [])) {
    preparationConflict("Les choix d’indices se contredisent. Gardez une version de chaque plan avant d’enregistrer.");
  }
  if (draft.provenance && draft.sources.some((source) => source.alternate_of) && input.expectedRevision !== null) {
    const previous = await readPreparationRecord(context, input.projectId);
    if (previous?.revision !== input.expectedRevision) preparationConflict("La préparation a changé. Rechargez-la avant de l’enregistrer.");
    const original = takeoffPreparationSchema.parse(previous.draft);
    const savedById = new Map(original.sources.map((source) => [source.document_id, source]));
    for (const selected of draft.sources) {
      const saved = savedById.get(selected.document_id);
      if (!saved?.pages_before_deduplication || JSON.stringify(saved.pages) === JSON.stringify(selected.pages)) continue;
      delete selected.pages_before_deduplication;
      for (const copy of draft.sources) {
        if (!copy.active && copy.alternate_of === selected.document_id && copy.content_hash === saved.content_hash) delete copy.alternate_of;
      }
    }
  }
  validateCanonicalSources(draft, availableSources);
  const reconciled = reconcilePreparationSources(draft, availableSources).draft;
  const revision = (input.expectedRevision ?? 0) + 1;
  await persistPreparationRecord({
    context, projectId: input.projectId, expectedRevision: input.expectedRevision,
    revision, draft: reconciled as unknown as Json,
    snapshot: null, confirmedAt: null,
  });
  return readPreparationRevision(context, input.projectId, revision, false);
}

export async function confirmTakeoffPreparation(input: {
  projectId: string; expectedRevision: number; expectedExecutionFingerprint?: string;
}) {
  projectIdSchema.parse(input.projectId);
  revisionSchema.parse(input.expectedRevision);
  z.string().regex(/^[a-f0-9]{64}$/).optional().parse(input.expectedExecutionFingerprint);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId, true);
  const [record, sources] = await Promise.all([
    readPreparationRecord(context, input.projectId), readPreparationSources(context, input.projectId),
  ]);
  if (record?.confirmed_at && record.confirmed_snapshot &&
      (record.revision === input.expectedRevision || record.revision === input.expectedRevision + 1)) {
    const confirmed = takeoffPreparationSchema.parse(record.draft);
    assertTakeoffPreparationProcessing(confirmed);
    assertDossierSourcesReviewed(confirmed, sources);
    validateCanonicalSources(confirmed, sources);
    if (confirmed.provenance) {
      await selectionForConfirmation(context, input.expectedExecutionFingerprint);
      const stored = storedPreparationSnapshotSchema.parse(record.confirmed_snapshot);
      if (stored.confirmed_by !== context.userId || !stored.execution_selection ||
          executionFingerprint(stored.execution_selection) !== input.expectedExecutionFingerprint) {
        preparationConflict("Cette confirmation utilise une autre sélection ChatGPT. Préparez une nouvelle analyse avec votre forfait.");
      }
    }
    if (reconcilePreparationSources(confirmed, sources).changedSourceIds.length) {
      preparationConflict("Les sources ont changé. Vérifiez la préparation avant une nouvelle confirmation.");
    }
    return readPreparationRevision(context, input.projectId, record.revision, true);
  }
  if (!record || record.revision !== input.expectedRevision) {
    preparationConflict("La préparation a changé. Rechargez-la avant de confirmer.");
  }
  let draft = takeoffPreparationSchema.parse(record.draft);
  assertTakeoffPreparationProcessing(draft);
  if (draft.provenance) {
    assertTakeoffPreparationProcessing(draft, DETAILED_TAKEOFF_PROCESSING);
    // A previously resolved alternative is still part of the attestable choice.
    for (const source of getDeducedPlanCandidates(draft.sources)) {
      source.active = true;
      source.pages = source.pages_before_deduplication ?? source.pages;
      delete source.pages_before_deduplication;
      delete source.alternate_of;
    }
  }
  assertDossierSourcesReviewed(draft, sources);
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
    if (!source.file_path) preparationConflict(`La pièce « ${source.document_name} » n’a pas de fichier accessible.`);
    const { data, error } = await context.supabase.storage.from(source.plan_set_id ? PLAN_FILES_BUCKET : AFFAIRE_INTAKE_BUCKET).download(source.file_path);
    if (error || !data) preparationConflict(`Impossible de lire la pièce « ${source.document_name} ». Rendez-la accessible ou retirez-la des pièces retenues.`);
    if (!source.plan_set_id) {
      referenceBytes += data.size;
      if (referenceBytes > 20 * 1024 * 1024) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "Les pièces de référence dépassent 20 Mo. Réduisez la sélection avant de confirmer.", retryable: false });
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const previousHash = source.content_hash;
    source.content_hash = createHash("sha256").update(bytes).digest("hex");
    if (draft.provenance && source.kind === "plan") {
      const document = await renderPdfPages(bytes, { ...TAKEOFF_PAGE_TRIAGE_TEXT, pages: [source.pages[0] ?? 1] });
      source.plan_identity = readPlanTitleBlock(document.pages[0]?.regionText ?? "");
      // The member's settled choice for this reading of these bytes; otherwise the metadata or file name, then what
      // the preparation recorded for these bytes (an index the operator entered), then the title block. A differing
      // reading stays a difference the member settles.
      const sameBytes = !previousHash || previousHash === source.content_hash;
      if (!sameBytes) delete source.revision_reading_settled;
      const reading = source.plan_identity?.revision ?? null;
      const settled = Boolean(reading && source.revision && source.revision_reading_settled === reading);
      const known = sources.find((current) => current.document_id === source.document_id)?.revision;
      source.revision = settled ? source.revision : known ?? (sameBytes ? source.revision : null) ?? reading;
    }
  }
  const revision = record.revision + 1;
  // A metadata edit during the download cannot be confirmed from an older read.
  const latest = await readPreparationSources(context, input.projectId);
  validateCanonicalSources(draft, latest);
  if (draft.provenance && getPreparationSourcesFingerprint(sources) !== getPreparationSourcesFingerprint(latest)) {
    preparationConflict("Les pièces du dossier ont changé pendant la vérification. Rechargez la préparation.");
  }
  if (draft.provenance) {
    draft = resolveDeducedPlanVersions(draft);
    if (evaluateTakeoffPreparation(draft).blockers.some((blocker) => blocker.code === "source_revision_conflict" || blocker.code === "source_revision_mismatch")) {
      await persistPreparationRecord({ context, projectId: input.projectId, expectedRevision: record.revision, revision,
        draft: draft as unknown as Json, snapshot: null, confirmedAt: null });
      return readPreparationRevision(context, input.projectId, revision, false);
    }
  }
  const confirmedAt = new Date().toISOString();
  const snapshot = createTakeoffPreparationSnapshot({ preparation: draft, confirmedBy: context.userId, confirmedAt, revision });
  if (draft.provenance) snapshot.execution_selection = await selectionForConfirmation(context, input.expectedExecutionFingerprint);
  await persistPreparationRecord({
    context, projectId: input.projectId, expectedRevision: record.revision, revision,
    draft: snapshot.preparation as unknown as Json, snapshot: snapshot as unknown as Json, confirmedAt,
  });
  return readPreparationRevision(context, input.projectId, revision, true);
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

/** Read-only: lets the documents step disable « Proposer le tri des pages » without any call. */
export async function getTakeoffPageTriageAvailability(projectId: string) {
  projectIdSchema.parse(projectId);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, projectId);
  const capability = getTakeoffDecisionsCapability();
  return { status: capability.status, message: capability.message, model: capability.model, max_pages: TAKEOFF_PAGE_TRIAGE_MAX_PAGES };
}

export type TakeoffPageTriageOutcome = {
  document_id: string;
  status: "proposed" | "partial" | "unavailable";
  message: string;
  pages: number;
  excluded: number;
  to_review: number;
  cached: number;
  calls: number;
  total_tokens: number;
  /** `call_failed`: Decisions refused or failed; the client stops before the next document. */
  stop_reason: "call_failed" | "budget_reached" | "time_limit" | "render_failed" | "page_limit" | "page_count_mismatch" | null;
};

/**
 * Explicit triage of one active plan at level C: renders its pages server-side,
 * asks Decisions per page and stores the proposal in `page_triage` only; the
 * selection (`pages`, `active`) changes on acceptance alone. Like any draft
 * change, the new revision reopens a launch confirmation.
 */
export async function proposeTakeoffPageTriage(input: { projectId: string; expectedRevision: number; documentId: string }) {
  projectIdSchema.parse(input.projectId);
  revisionSchema.parse(input.expectedRevision);
  const documentId = z.string().trim().min(1).max(4000).parse(input.documentId);
  const context = await getAuthenticatedContext();
  await assertPreparationProjectAccess(context, input.projectId, true);
  const state = await loadPreparation(context, input.projectId);
  if (state.revision !== input.expectedRevision) preparationConflict("La préparation a changé avant le tri des pages. Rechargez-la.");
  if (state.draft.processing.level !== "C") {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED, retryable: false,
      message: "Le tri des pages s’applique au niveau Détaillé. Choisissez ce niveau ou sélectionnez les pages manuellement." });
  }
  const capability = getTakeoffDecisionsCapability();
  if (capability.status !== "available") throw new TakeoffError({ status: 422, code: TakeoffErrorCode.BAD_REQUEST, message: capability.message, retryable: false });
  const index = state.draft.sources.findIndex((source) => source.document_id === documentId);
  const source = state.draft.sources[index];
  if (!source?.active || source.kind !== "plan" || !source.plan_set_id || !source.file_path) {
    preparationConflict("Seuls les plans actifs du dossier peuvent être triés.");
  }
  const available = state.availableSources.find((entry) => entry.document_id === documentId);
  if (!available || available.source_version !== source.source_version) preparationConflict(`Le plan « ${source.document_name} » a changé. Vérifiez sa version avant le tri.`);
  const { data, error } = await context.supabase.storage.from(PLAN_FILES_BUCKET).download(source.file_path);
  if (error || !data) throw mapSupabaseError({ code: "SOURCE_DOWNLOAD", message: error?.message ?? "Fichier introuvable." }, "Impossible de lire le plan à trier.");
  const run = await runTakeoffPageTriage({
    owner: { tenantId: context.tenantId, userId: context.userId }, projectId: input.projectId,
    bytes: new Uint8Array(await data.arrayBuffer()), fileName: source.document_name, sourceVersion: source.source_version,
    scope: { levels: state.draft.scope.levels, zones: state.draft.scope.zones }, previous: source.page_triage,
    budget: createDecisionsTokenBudget(TAKEOFF_PAGE_TRIAGE_MAX_TOKENS, TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS),
    pageCountHint: source.page_count, expectedPageCount: source.page_count,
  });
  const counts = {
    pages: run.triage?.page_count ?? 0,
    excluded: run.triage?.pages.filter((page) => page.proposal === "exclude").length ?? 0,
    to_review: run.triage?.pages.filter((page) => page.proposal === "review").length ?? 0,
    cached: run.calls.filter((call) => call.status === "cached").length,
    calls: run.calls.filter((call) => !["cached", "skipped"].includes(call.status)).length,
    total_tokens: run.run_usage.total_tokens,
    stop_reason: run.stop?.reason ?? null,
  };
  if (!run.triage) {
    return { state, outcome: { document_id: documentId, status: "unavailable", message: run.stop?.message ?? "Le tri n’a pas pu être proposé.", ...counts } satisfies TakeoffPageTriageOutcome };
  }
  const latest = await loadPreparation(context, input.projectId);
  if (latest.revision !== state.revision || latest.sourceFingerprint !== state.sourceFingerprint) {
    preparationConflict("Les sources ou la préparation ont changé pendant le tri. Relancez-le.");
  }
  const draft = takeoffPreparationSchema.parse(structuredClone(state.draft));
  draft.sources[index] = reconcileTakeoffPageTriageStatuses({ ...draft.sources[index], page_triage: run.triage });
  await persistPreparationRecord({
    context, projectId: input.projectId, expectedRevision: state.revision, revision: state.revision + 1,
    draft: takeoffPreparationSchema.parse(draft) as unknown as Json, snapshot: null, confirmedAt: null,
  });
  const summary = `${counts.excluded} page${counts.excluded > 1 ? "s" : ""} à écarter, ${counts.to_review} à vérifier sur ${counts.pages}.`;
  const outcome: TakeoffPageTriageOutcome = {
    document_id: documentId, status: run.stop ? "partial" : "proposed",
    message: run.stop ? `${run.stop.message} ${summary}` : `Tri proposé : ${summary} Acceptez-le pour l’appliquer à la sélection.`,
    ...counts,
  };
  return { state: await loadPreparation(context, input.projectId), outcome };
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
  context: AuthenticatedTenantContext; estimateVersionId: string | null; projectId?: string;
  preparationRevision: number | null; planSetId?: string; upload?: { hash: string; fileName: string };
  sourceVersionId?: string;
} & TakeoffRequestedProcessing): Promise<TakeoffPreparationSnapshot> {
  revisionSchema.nullable().parse(input.preparationRevision);
  let projectId = input.projectId;
  if (input.estimateVersionId !== null) {
    const { data: version, error } = await input.context.supabase.from("estimate_versions")
      .select("id,project_id").eq("tenant_id", input.context.tenantId)
      .eq("id", input.estimateVersionId).single();
    if (error || !version || (projectId && version.project_id !== projectId)) {
      preparationConflict("La version cible n'appartient pas à l'affaire de cette préparation.");
    }
    projectId = version.project_id;
  }
  if (!projectId) preparationConflict("L’affaire du métré est introuvable.");
  await assertPreparationProjectAccess(input.context, projectId, true);
  const [record, sources] = await Promise.all([
    readPreparationRecord(input.context, projectId), readPreparationSources(input.context, projectId),
  ]);
  if (!record?.confirmed_at || !record.confirmed_by || !record.confirmed_snapshot || record.revision !== input.preparationRevision) {
    preparationConflict("Vérifiez et confirmez la préparation du métré avant de lancer l'analyse.");
  }
  const stored = storedPreparationSnapshotSchema.parse(record.confirmed_snapshot);
  const preparation = takeoffPreparationSchema.parse(stored.preparation);
  assertTakeoffPreparationProcessing(preparation, input);
  if (stored.preparation_revision !== record.revision || stored.confirmed_by !== record.confirmed_by ||
      Date.parse(stored.confirmed_at) !== Date.parse(record.confirmed_at) ||
      JSON.stringify(preparation) !== JSON.stringify(takeoffPreparationSchema.parse(record.draft))) {
    preparationConflict("La confirmation ne correspond plus à la préparation enregistrée.");
  }
  assertDossierSourcesReviewed(preparation, sources);
  validateCanonicalSources(preparation, sources);
  createTakeoffPreparationSnapshot({
    preparation, revision: record.revision, confirmedAt: stored.confirmed_at, confirmedBy: stored.confirmed_by,
  });
  const destination = preparation.destination;
  if (input.estimateVersionId === null && (destination.kind !== "analysis_only" || destination.estimate_version_id !== null)) {
    preparationConflict("Confirmez une préparation d’analyse seule pour ce métré.");
  }
  const provenanceSources = new Set([
    ...(input.sourceVersionId ? [input.sourceVersionId] : []),
    ...(destination.kind === "estimate_review" && destination.estimate_version_id !== input.estimateVersionId && destination.estimate_version_id ? [destination.estimate_version_id] : []),
  ]);
  for (const sourceVersionId of provenanceSources) {
    if (!input.estimateVersionId || !await hasTakeoffPreparationCopyReceipt({
      context: input.context, projectId, sourceVersionId,
      targetVersionId: input.estimateVersionId, preparationRevision: record.revision,
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
  if (preparation.provenance) {
    // A revision choice binds both files, and an identical copy is set aside for its bytes: the file left out is
    // re-read here, the retained one by the worker before any model call. Only what the confirmed selection set aside
    // counts: a plan set the member left keeps its set-aside files for a return, and the confirmation already kept
    // only the revision choices between the plans of this selection.
    const prepared = new Map(preparation.sources.map((source) => [source.document_id, source]));
    const available = new Map(sources.map((source) => [source.document_id, source]));
    const participants = [
      ...(preparation.plan_revision_decisions ?? []).flatMap((decision) => [decision.left, decision.right]),
      ...getDeducedPlanCandidates(preparation.sources).filter((source) => !source.active)
        .map((source) => ({ document_id: source.document_id, content_hash: source.content_hash })),
    ];
    const checked = new Set<string>();
    for (const { document_id, content_hash } of participants) {
      const source = prepared.get(document_id);
      const current = available.get(document_id);
      if (!source || !content_hash || !current?.file_path || current.kind !== "plan" || current.plan_set_id !== preparation.provenance.plan_set_id ||
          current.source_version !== source.source_version || source.content_hash !== content_hash) {
        preparationConflict("Une version de plan a changé. Préparez une nouvelle analyse et vérifiez le choix d’indices.");
      }
      if (source.active || checked.has(document_id)) continue;
      const { data, error } = await input.context.supabase.storage.from(PLAN_FILES_BUCKET).download(current.file_path);
      if (error || !data || createHash("sha256").update(new Uint8Array(await data.arrayBuffer())).digest("hex") !== content_hash) {
        preparationConflict(`La version « ${source.document_name} » a changé ou est inaccessible. Préparez une nouvelle analyse et vérifiez les plans retenus.`);
      }
      checked.add(document_id);
    }
  }
  // PostgREST formats timestamptz with +00:00, while the immutable JSON kept Z.
  // Validate current eligibility above, then submit the exact stored JSON to SQL.
  return structuredClone(record.confirmed_snapshot) as unknown as TakeoffPreparationSnapshot;
}
