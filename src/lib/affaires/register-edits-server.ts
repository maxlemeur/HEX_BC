import { readAllRows } from "@/lib/supabase/read-all";
import { z } from "zod";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import {
  badRequest,
  mapSupabaseError,
  notFound,
} from "@/lib/http/api-response";
import type { Json } from "@/types/database";
import {
  type AffaireRegisterEntryWithProfilesRow,
  REGISTER_ACCESS,
  ENTRY_SELECT,
  normalizeAffaireRegisterEntryRow,
  toAffaireRegisterEntry,
  applyVersionScopeFilter,
  insertAffaireRegisterEvent,
  updateAffaireRegisterEntryWithEvent,
} from "@/lib/affaires/register-store-server";
import { resolveScopeForEntry } from "@/lib/affaires/register-scope-server";

import {
  buildAffaireRegisterDerivedMetadata,
  buildAffaireRegisterContinuationHypothesisText,
  extractAffaireRegisterClientClarificationRequest,
  affaireRegisterEntryKindSchema,
  affaireRegisterRevalidationCauseSchema,
  affaireRegisterRevalidationImpactedStageSchema,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  isAffaireRegisterEntryResolved,
  normalizeAffaireRegisterText,
  type AffaireRegisterClientClarificationRequest,
  type AffaireRegisterContinuationDecision,
  type AffaireRegisterRevalidationRequest,
  type AffaireRegisterSeverityDecision,
} from "./register";

const createAffaireRegisterEntryInputSchema = z
  .object({
    projectId: z.string().uuid("projectId invalide."),
    versionId: z.string().uuid("versionId invalide.").nullable().optional(),
    kind: affaireRegisterEntryKindSchema,
    text: z.string().trim().min(1, "Le texte est requis.").max(320),
    severity: affaireRegisterEntrySeveritySchema,
    scopeType: affaireRegisterScopeTypeSchema,
    scopeId: z.string().uuid("scopeId invalide.").nullable().optional(),
    scopeRef: z.string().trim().max(120).nullable().optional(),
    scopeLabel: z.string().trim().max(180).nullable().optional(),
    sourceDocumentId: z.string().uuid("sourceDocumentId invalide.").nullable().optional(),
    sourceFileName: z.string().trim().max(255).nullable().optional(),
    code: z.string().trim().max(120).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.scopeType === "lot" || value.scopeType === "line") && !value.scopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeId"],
        message: "Le périmètre sélectionné est requis.",
      });
    }

    if (value.scopeType === "exception") {
      if (!value.versionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["versionId"],
          message: "Une version courante est requise pour une exception.",
        });
      }
      if (!value.scopeRef || value.scopeRef.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scopeRef"],
          message: "La référence d'exception est requise.",
        });
      }
      if (!value.scopeLabel || value.scopeLabel.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scopeLabel"],
          message: "Le libellé d'exception est requis.",
        });
      }
    }
  });

const updateAffaireRegisterEntryStatusInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  status: affaireRegisterEntryStatusSchema,
  comment: z.string().trim().max(320).nullable().optional(),
});

const requestAffaireRegisterRevalidationInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  cause: affaireRegisterRevalidationCauseSchema,
  impactedStages: z
    .array(affaireRegisterRevalidationImpactedStageSchema)
    .min(1, "Au moins une étape impactee est requise.")
    .max(5),
  triggerDocumentId: z.string().uuid("triggerDocumentId invalide.").nullable().optional(),
  triggerFileName: z.string().trim().max(255).nullable().optional(),
  comment: z.string().trim().max(320).nullable().optional(),
});

const continueAffaireRegisterWithHypothesisInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  entryId: z.string().uuid("entryId invalide."),
  comment: z.string().trim().max(320).nullable().optional(),
});

function readContinuationSourceEntryId(metadata: Record<string, unknown>) {
  const source = metadata.continuationSource;
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    typeof (source as Record<string, unknown>).entryId !== "string"
  ) {
    return null;
  }

  return (source as Record<string, unknown>).entryId;
}

function dedupeRevalidationImpactedStages(
  stages: Array<z.infer<typeof affaireRegisterRevalidationImpactedStageSchema>>
) {
  return Array.from(new Set(stages));
}

export async function createAffaireRegisterEntry(input: z.infer<typeof createAffaireRegisterEntryInputSchema>) {
  const parsed = createAffaireRegisterEntryInputSchema.parse(input);
  const { context, project } = await requireAffaireAccess(parsed.projectId, "write", REGISTER_ACCESS);
  const createdAt = new Date().toISOString();
  const scope = await resolveScopeForEntry({
    context,
    project,
    versionId: parsed.versionId ?? null,
    scopeType: parsed.scopeType,
    scopeId: parsed.scopeId ?? null,
    scopeRef: parsed.scopeRef ?? null,
    scopeLabel: parsed.scopeLabel ?? null,
  });

  const payload = {
    project_id: project.id,
    version_id: scope.versionId,
    source_document_id: parsed.sourceDocumentId ?? null,
    kind: parsed.kind,
    code: normalizeAffaireRegisterText(parsed.code ?? "", 120) || null,
    text: normalizeAffaireRegisterText(parsed.text),
    severity: parsed.severity,
    status: "open",
    origin_kind: "manual",
    scope_type: parsed.scopeType,
    scope_id: scope.scopeId,
    scope_ref: scope.scopeRef,
    scope_label: scope.scopeLabel,
    source_file_name:
      normalizeAffaireRegisterText(parsed.sourceFileName ?? "", 255) || null,
    sync_key: null,
    is_active: true,
    metadata: buildAffaireRegisterDerivedMetadata({
      metadata: {
        severityDecision: {
          mode: "canonical",
          canonicalSeverity: parsed.severity,
          overriddenSeverity: null,
          updatedAt: createdAt,
          updatedByUserId: context.userId,
          comment: null,
        } satisfies AffaireRegisterSeverityDecision,
      },
      kind: parsed.kind,
      code: normalizeAffaireRegisterText(parsed.code ?? "", 120) || null,
      severity: parsed.severity,
      status: "open",
      scopeType: parsed.scopeType,
      scopeId: scope.scopeId,
      scopeRef: scope.scopeRef,
      scopeLabel: scope.scopeLabel,
      versionId: scope.versionId,
      sourceDocumentId: parsed.sourceDocumentId ?? null,
      sourceFileName:
        normalizeAffaireRegisterText(parsed.sourceFileName ?? "", 255) || null,
    }),
    created_by: context.userId,
    updated_by: context.userId,
  } as const;

  const { data, error } = await context.supabase
    .from("affaire_register_entries")
    .insert(payload as never)
    .select(ENTRY_SELECT as never)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de créer l'entrée du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw badRequest("Réponse invalide lors de la création du registre.");
  }

  await insertAffaireRegisterEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    eventType: "created",
    reason: "manual.create",
    afterPayload: {
      kind: entry.kind,
      severity: entry.severity,
      status: entry.status,
    } satisfies Json,
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(entry),
  } as const;
}

export async function updateAffaireRegisterEntryStatus(
  input: z.infer<typeof updateAffaireRegisterEntryStatusInputSchema>
) {
  const parsed = updateAffaireRegisterEntryStatusInputSchema.parse(input);
  const { context, project } = await requireAffaireAccess(parsed.projectId, "write", REGISTER_ACCESS);

  const { data, error } = await context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entrée du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw notFound("Entrée du registre introuvable.");
  }

  if (entry.status === parsed.status) {
    return {
      ok: true,
      entry: toAffaireRegisterEntry(entry),
    } as const;
  }

  if (parsed.status === "clarify_with_client" && entry.status !== "open") {
    throw badRequest(
      "Seules les entrées ouvertes peuvent être basculees en clarification client."
    );
  }

  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;
  const clarificationRequest =
    parsed.status === "clarify_with_client"
      ? ({
          status: "clarify_with_client",
          requestedAt: new Date().toISOString(),
          requestedByUserId: context.userId,
          previousStatus: entry.status,
          comment,
        } satisfies AffaireRegisterClientClarificationRequest)
      : null;
  const nextMetadata = { ...entry.metadata };

  if (clarificationRequest) {
    nextMetadata.clientClarificationRequest = clarificationRequest;
  } else if ("clientClarificationRequest" in nextMetadata) {
    delete nextMetadata.clientClarificationRequest;
  }
  if (parsed.status !== "open" && "revalidationRequest" in nextMetadata) {
    delete nextMetadata.revalidationRequest;
  }
  const derivedMetadata = buildAffaireRegisterDerivedMetadata({
    metadata: nextMetadata,
    kind: entry.kind,
    code: entry.code,
    severity: entry.severity,
    status: parsed.status,
    scopeType: entry.scope_type,
    scopeId: entry.scope_id,
    scopeRef: entry.scope_ref,
    scopeLabel: entry.scope_label,
    versionId: entry.version_id,
    sourceDocumentId: entry.source_document_id,
    sourceFileName: entry.source_file_name,
    clientClarificationRequest: clarificationRequest,
    continuationDecision: extractAffaireRegisterContinuationDecision(nextMetadata),
    revalidationRequest: extractAffaireRegisterRevalidationRequest(nextMetadata),
  });

  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    patch: {
      status: parsed.status,
      metadata: derivedMetadata as Json,
    },
    eventType:
      parsed.status === "clarify_with_client"
        ? "clarify_with_client_requested"
        : "status_changed",
    reason: comment,
    beforePayload: {
      status: entry.status,
      clientClarificationRequest:
        extractAffaireRegisterClientClarificationRequest(entry.metadata),
      revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
    } satisfies Json,
    afterPayload: {
      status: parsed.status,
      clientClarificationRequest: clarificationRequest,
      revalidationRequest:
        parsed.status === "open"
          ? extractAffaireRegisterRevalidationRequest(derivedMetadata)
          : null,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de mettre à jour le registre.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
  } as const;
}

export async function requestAffaireRegisterRevalidation(
  input: z.infer<typeof requestAffaireRegisterRevalidationInputSchema>
) {
  const parsed = requestAffaireRegisterRevalidationInputSchema.parse(input);
  const { context, project } = await requireAffaireAccess(parsed.projectId, "write", REGISTER_ACCESS);
  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;

  const { data, error } = await context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entrée du registre.");
  }

  const entry = normalizeAffaireRegisterEntryRow(data);
  if (!entry) {
    throw notFound("Entrée du registre introuvable.");
  }
  if (!isAffaireRegisterEntryResolved(entry.status)) {
    throw badRequest(
      "Seules les entrées déjà résolues peuvent être relancées en revalidation."
    );
  }

  const impactedStages = dedupeRevalidationImpactedStages(parsed.impactedStages);
  const revalidationRequest = {
    status: "required",
    requestedAt: new Date().toISOString(),
    requestedByUserId: context.userId,
    previousStatus: entry.status,
    cause: parsed.cause,
    triggerDocumentId: parsed.triggerDocumentId ?? null,
    triggerFileName:
      normalizeAffaireRegisterText(parsed.triggerFileName ?? "", 255) || null,
    impactedStages,
    comment,
  } satisfies AffaireRegisterRevalidationRequest;
  const nextMetadata = {
    ...entry.metadata,
    revalidationRequest,
  };

  if ("clientClarificationRequest" in nextMetadata) {
    delete nextMetadata.clientClarificationRequest;
  }
  const derivedMetadata = buildAffaireRegisterDerivedMetadata({
    metadata: nextMetadata,
    kind: entry.kind,
    code: entry.code,
    severity: entry.severity,
    status: "open",
    scopeType: entry.scope_type,
    scopeId: entry.scope_id,
    scopeRef: entry.scope_ref,
    scopeLabel: entry.scope_label,
    versionId: entry.version_id,
    sourceDocumentId: entry.source_document_id,
    sourceFileName: entry.source_file_name,
    clientClarificationRequest: null,
    continuationDecision: extractAffaireRegisterContinuationDecision(nextMetadata),
    revalidationRequest,
  });

  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: entry.id,
    actorUserId: context.userId,
    patch: {
      status: "open",
      metadata: derivedMetadata as Json,
    },
    eventType: "revalidation_requested",
    reason: comment,
    beforePayload: {
      status: entry.status,
      clientClarificationRequest:
        extractAffaireRegisterClientClarificationRequest(entry.metadata),
      revalidationRequest: extractAffaireRegisterRevalidationRequest(entry.metadata),
    } satisfies Json,
    afterPayload: {
      status: "open",
      revalidationRequest,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de demander la revalidation du registre.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
  } as const;
}

export async function continueAffaireRegisterWithHypothesis(
  input: z.infer<typeof continueAffaireRegisterWithHypothesisInputSchema>
) {
  const parsed = continueAffaireRegisterWithHypothesisInputSchema.parse(input);
  const { context, project } = await requireAffaireAccess(parsed.projectId, "write", REGISTER_ACCESS);
  const comment = normalizeAffaireRegisterText(parsed.comment ?? "", 320) || null;

  const { data, error } = await context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("id", parsed.entryId as never)
    .eq("is_active", true as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'entrée du registre.");
  }

  const sourceEntry = normalizeAffaireRegisterEntryRow(data);
  if (!sourceEntry) {
    throw notFound("Entrée du registre introuvable.");
  }

  if (sourceEntry.kind !== "missing_piece" || sourceEntry.status !== "open") {
    throw badRequest(
      "Seules les pièces manquantes ouvertes peuvent être poursuivies sous hypothèse."
    );
  }

  let assumptionsQuery = context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never, { count: "exact" })
    .eq("project_id", project.id as never)
    .eq("kind", "assumption" as never)
    .eq("is_active", true as never);
  assumptionsQuery = applyVersionScopeFilter(
    assumptionsQuery as never,
    sourceEntry.version_id
  ) as never;

  const { data: assumptionData, error: assumptionError } = await readAllRows(() => assumptionsQuery.order(
    "created_at",
    { ascending: false }
  ));

  if (assumptionError) {
    throw mapSupabaseError(
      assumptionError,
      "Impossible de charger les hypothèses de continuation."
    );
  }

  const existingHypothesis = ((assumptionData ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
    .find((row) => readContinuationSourceEntryId(row.metadata) === sourceEntry.id);

  if (
    extractAffaireRegisterContinuationDecision(sourceEntry.metadata)?.status ===
    "accepted_with_hypothesis"
  ) {
    return {
      ok: true,
      entry: toAffaireRegisterEntry(sourceEntry),
      hypothesisEntry: existingHypothesis ? toAffaireRegisterEntry(existingHypothesis) : null,
    } as const;
  }

  const hypothesisText = buildAffaireRegisterContinuationHypothesisText({
    entryText: sourceEntry.text,
  });
  const acceptedAt = new Date().toISOString();
  const continuationMetadata = {
    continuationSource: {
      kind: sourceEntry.kind,
      entryId: sourceEntry.id,
      code: sourceEntry.code,
      text: sourceEntry.text,
    },
    severityDecision: {
      mode: "canonical",
      canonicalSeverity: sourceEntry.severity,
      overriddenSeverity: null,
      updatedAt: acceptedAt,
      updatedByUserId: context.userId,
      comment,
    } satisfies AffaireRegisterSeverityDecision,
  } satisfies Record<string, unknown>;

  let hypothesisEntry: AffaireRegisterEntryWithProfilesRow | undefined =
    existingHypothesis ?? undefined;

  if (!hypothesisEntry) {
    const { data: hypothesisData, error: hypothesisInsertError } = await context.supabase
      .from("affaire_register_entries")
      .insert({
        project_id: project.id,
        version_id: sourceEntry.version_id,
        source_document_id: sourceEntry.source_document_id,
        kind: "assumption",
        code: sourceEntry.code,
        text: hypothesisText,
        severity: sourceEntry.severity,
        status: "open",
        origin_kind: "manual",
        scope_type: sourceEntry.scope_type,
        scope_id: sourceEntry.scope_id,
        scope_ref: sourceEntry.scope_ref,
        scope_label: sourceEntry.scope_label,
        source_file_name: sourceEntry.source_file_name,
        sync_key: null,
        is_active: true,
        metadata: buildAffaireRegisterDerivedMetadata({
          metadata: continuationMetadata,
          kind: "assumption",
          code: sourceEntry.code,
          severity: sourceEntry.severity,
          status: "open",
          scopeType: sourceEntry.scope_type,
          scopeId: sourceEntry.scope_id,
          scopeRef: sourceEntry.scope_ref,
          scopeLabel: sourceEntry.scope_label,
          versionId: sourceEntry.version_id,
          sourceDocumentId: sourceEntry.source_document_id,
          sourceFileName: sourceEntry.source_file_name,
        }),
        created_by: context.userId,
        updated_by: context.userId,
      } as never)
      .select(ENTRY_SELECT as never)
      .single();

    if (hypothesisInsertError) {
      throw mapSupabaseError(
        hypothesisInsertError,
        "Impossible de créer l'hypothèse de continuation."
      );
    }

    const normalizedHypothesisEntry = normalizeAffaireRegisterEntryRow(hypothesisData);
    if (!normalizedHypothesisEntry) {
      throw badRequest("Réponse invalide lors de la création de l'hypothèse.");
    }
    hypothesisEntry = normalizedHypothesisEntry;

    await insertAffaireRegisterEvent({
      supabase: context.supabase,
      entryId: hypothesisEntry.id,
      actorUserId: context.userId,
      eventType: "created",
      reason: "manual.continue_with_hypothesis",
      afterPayload: {
        kind: hypothesisEntry.kind,
        severity: hypothesisEntry.severity,
        status: hypothesisEntry.status,
        sourceEntryId: sourceEntry.id,
      } satisfies Json,
    });
  }

  const decision = {
    status: "accepted_with_hypothesis",
    hypothesisEntryId: hypothesisEntry.id,
    hypothesisText: hypothesisEntry.text,
    acceptedAt,
    acceptedByUserId: context.userId,
    comment,
  } satisfies AffaireRegisterContinuationDecision;

  const updatedMetadata = buildAffaireRegisterDerivedMetadata({
        metadata: {
          ...sourceEntry.metadata,
          continuationDecision: decision,
        },
        kind: sourceEntry.kind,
        code: sourceEntry.code,
        severity: sourceEntry.severity,
        status: sourceEntry.status,
        scopeType: sourceEntry.scope_type,
        scopeId: sourceEntry.scope_id,
        scopeRef: sourceEntry.scope_ref,
        scopeLabel: sourceEntry.scope_label,
        versionId: sourceEntry.version_id,
        sourceDocumentId: sourceEntry.source_document_id,
        sourceFileName: sourceEntry.source_file_name,
        clientClarificationRequest:
          extractAffaireRegisterClientClarificationRequest(sourceEntry.metadata),
        continuationDecision: decision,
        revalidationRequest:
          extractAffaireRegisterRevalidationRequest(sourceEntry.metadata),
      });
  const updatedEntry = await updateAffaireRegisterEntryWithEvent({
    supabase: context.supabase,
    entryId: sourceEntry.id,
    actorUserId: context.userId,
    patch: {
      metadata: updatedMetadata as Json,
    },
    eventType: "continued_with_hypothesis",
    reason: comment,
    beforePayload: {
      status: sourceEntry.status,
      continuationDecision: null,
    } satisfies Json,
    afterPayload: {
      status: sourceEntry.status,
      continuationDecision: decision,
      comment,
    } satisfies Json,
    fallbackMessage: "Impossible de tracer la continuation sous hypothèse.",
  });

  return {
    ok: true,
    entry: toAffaireRegisterEntry(updatedEntry),
    hypothesisEntry: toAffaireRegisterEntry(hypothesisEntry),
  } as const;
}
