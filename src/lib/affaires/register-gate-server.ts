import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { z } from "zod";

import { mapSupabaseError } from "@/lib/http/api-response";
import { type Supabase, applyVersionScopeFilter } from "@/lib/affaires/register-store-server";

import {
  AFFAIRE_REGISTER_KIND_LABELS,
  buildAffaireRegisterBusinessLocation,
  deriveAffaireRegisterBusinessImpact,
  extractAffaireRegisterClientClarificationRequest,
  extractAffaireRegisterBusinessImpact,
  extractAffaireRegisterFollowUp,
  affaireRegisterEntryKindSchema,
  affaireRegisterRevalidationImpactedStageSchema,
  extractAffaireRegisterSeverityDecision,
  affaireRegisterEntrySeveritySchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
  extractAffaireRegisterContinuationDecision,
  extractAffaireRegisterRevalidationRequest,
  isAffaireRegisterEntryRevalidationRequired,
  resolveAffaireRegisterBusinessLocation,
  type AffaireRegisterClientClarificationRequest,
  type AffaireRegisterContinuationDecision,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterFollowUp,
  type AffaireRegisterRevalidationRequest,
  type AffaireRegisterScopeType,
  type AffaireRegisterSeverityDecision,
} from "./register";
import { isRecord } from "@/lib/value-guards";

type AffaireRegisterGateEntry = {
  id: string;
  kind: AffaireRegisterEntryKind;
  code?: string | null;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  text: string;
  scopeType?: AffaireRegisterScopeType;
  scopeId?: string | null;
  scopeRef?: string | null;
  scopeLabel: string;
  versionId?: string | null;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  businessImpact?: ReturnType<typeof deriveAffaireRegisterBusinessImpact>;
  location?: ReturnType<typeof buildAffaireRegisterBusinessLocation>;
  severityDecision?: AffaireRegisterSeverityDecision | null;
  followUp?: AffaireRegisterFollowUp | null;
  clientClarificationRequest?: AffaireRegisterClientClarificationRequest | null;
  continuationDecision?: AffaireRegisterContinuationDecision | null;
  revalidationRequest?: AffaireRegisterRevalidationRequest | null;
};

export type AffaireRegisterGateSummary = {
  openQuestionsCount: number;
  criticalOpenEntries: AffaireRegisterGateEntry[];
  nonCriticalOpenEntries: AffaireRegisterGateEntry[];
  clarifyWithClientEntries: AffaireRegisterGateEntry[];
  criticalClarifyWithClientEntries?: AffaireRegisterGateEntry[];
  openAssumptionEntries: AffaireRegisterGateEntry[];
  openMissingPieceEntries: AffaireRegisterGateEntry[];
  continuedWithHypothesisEntries?: AffaireRegisterGateEntry[];
  continuedCriticalMissingPieceEntries?: AffaireRegisterGateEntry[];
  revalidationRequiredEntries?: AffaireRegisterGateEntry[];
  criticalRevalidationRequiredEntries?: AffaireRegisterGateEntry[];
  revalidationImpactedStages?: Array<
    z.infer<typeof affaireRegisterRevalidationImpactedStageSchema>
  >;
};

const GATE_ENTRY_SELECT = [
  "id",
  "kind",
  "code",
  "text",
  "severity",
  "status",
  "scope_type",
  "scope_id",
  "scope_ref",
  "scope_label",
  "version_id",
  "source_document_id",
  "source_file_name",
  "is_active",
  "metadata",
].join(", ");

export async function fetchAffaireRegisterGateSummary(input: {
  supabase: Supabase;
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterGateSummary> {
  let query = input.supabase
    .from("affaire_register_entries" as never)
    .select(GATE_ENTRY_SELECT as never, { count: "exact" })
    .eq("project_id", input.projectId as never)
    .eq("is_active", true as never);

  query = applyVersionScopeFilter(query as never, input.versionId ?? null) as never;

  const { data, error } = await readAllRows(() => query.order("updated_at", { ascending: false }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la synthèse du registre affaire.");
  }

  return buildAffaireRegisterGateSummary((data ?? []) as Array<Record<string, unknown>>);
}

/**
 * The gate summaries of a whole portfolio in one read per chunk of affaires, instead of one request per affaire.
 * Each affaire keeps the scope of fetchAffaireRegisterGateSummary: with a version, the entries of that version and
 * those tied to none; without one, every active entry. An affaire without entries gets an empty summary.
 */
export async function fetchAffaireRegisterGateSummaries(input: {
  supabase: Supabase;
  scopes: ReadonlyArray<{ projectId: string; versionId: string | null }>;
}): Promise<Map<string, AffaireRegisterGateSummary>> {
  const { data, error } = await readAllRowsInChunks(
    input.scopes.map((scope) => scope.projectId),
    (projectIds) => input.supabase
      .from("affaire_register_entries")
      .select(`${GATE_ENTRY_SELECT}, project_id, updated_at` as never, { count: "exact" })
      .in("project_id", projectIds as never)
      .eq("is_active", true as never) as never,
    { order: [{ column: "updated_at", ascending: false }] }
  );

  if (error) {
    throw mapSupabaseError(error as never, "Impossible de charger la synthèse du registre affaire.");
  }

  const rowsByProjectId = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const projectId = typeof row.project_id === "string" ? row.project_id : "";
    rowsByProjectId.set(projectId, [...(rowsByProjectId.get(projectId) ?? []), row]);
  }

  return new Map(input.scopes.map((scope) => [
    scope.projectId,
    buildAffaireRegisterGateSummary((rowsByProjectId.get(scope.projectId) ?? []).filter((row) =>
      !scope.versionId || row.version_id === null || row.version_id === scope.versionId)),
  ]));
}

function buildAffaireRegisterGateSummary(
  rows: Array<Record<string, unknown>>
): AffaireRegisterGateSummary {
  const normalized = rows
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      kind: affaireRegisterEntryKindSchema.parse(row.kind),
      code: typeof row.code === "string" ? row.code.trim() || null : null,
      text: typeof row.text === "string" ? row.text.trim() : "",
      severity: affaireRegisterEntrySeveritySchema.parse(row.severity),
      status: affaireRegisterEntryStatusSchema.parse(row.status),
      scopeType: affaireRegisterScopeTypeSchema.parse(row.scope_type),
      scopeId: typeof row.scope_id === "string" ? row.scope_id : null,
      scopeRef: typeof row.scope_ref === "string" ? row.scope_ref.trim() || null : null,
      scopeLabel:
        typeof row.scope_label === "string" && row.scope_label.trim().length > 0
          ? row.scope_label.trim()
          : "Affaire",
      versionId: typeof row.version_id === "string" ? row.version_id : null,
      sourceDocumentId:
        typeof row.source_document_id === "string" ? row.source_document_id : null,
      sourceFileName:
        typeof row.source_file_name === "string"
          ? row.source_file_name.trim() || null
          : null,
      clientClarificationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterClientClarificationRequest(row.metadata)
        : null,
      continuationDecision: isRecord(row.metadata)
        ? extractAffaireRegisterContinuationDecision(row.metadata)
        : null,
      revalidationRequest: isRecord(row.metadata)
        ? extractAffaireRegisterRevalidationRequest(row.metadata)
        : null,
      get businessImpact() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterBusinessImpact(row.metadata) ??
              deriveAffaireRegisterBusinessImpact({
                kind: this.kind,
                code: this.code ?? null,
                severity: this.severity,
                status: this.status,
                clientClarificationRequest: this.clientClarificationRequest,
                continuationDecision: this.continuationDecision,
                revalidationRequest: this.revalidationRequest,
              })
          : deriveAffaireRegisterBusinessImpact({
              kind: this.kind,
              code: this.code ?? null,
              severity: this.severity,
              status: this.status,
              clientClarificationRequest: this.clientClarificationRequest,
              continuationDecision: this.continuationDecision,
              revalidationRequest: this.revalidationRequest,
            });
      },
      get severityDecision() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterSeverityDecision(row.metadata)
          : null;
      },
      get followUp() {
        return isRecord(row.metadata)
          ? extractAffaireRegisterFollowUp(row.metadata)
          : null;
      },
      get location() {
        return resolveAffaireRegisterBusinessLocation({
          metadata: row.metadata,
          scopeType: this.scopeType ?? "project",
          scopeId: this.scopeId ?? null,
          scopeRef: this.scopeRef ?? null,
          scopeLabel: this.scopeLabel,
          versionId: this.versionId ?? null,
          sourceDocumentId: this.sourceDocumentId ?? null,
          sourceFileName: this.sourceFileName ?? null,
        });
      },
    }))
    .filter((row) => row.id.length > 0 && row.text.length > 0);
  const standardWorkflowEntries = normalized.filter(
    (entry) => !isAffaireRegisterEntryRevalidationRequired(entry)
  );

  const criticalOpenEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity === "critical"
  );
  const nonCriticalOpenEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity !== "critical"
  );
  const clarifyWithClientEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "clarify_with_client"
  );
  const criticalClarifyWithClientEntries = clarifyWithClientEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const openAssumptionEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "assumption"
  );
  const openMissingPieceEntries = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "missing_piece"
  );
  const continuedWithHypothesisEntries = openMissingPieceEntries.filter(
    (entry) => entry.continuationDecision?.status === "accepted_with_hypothesis"
  );
  const continuedCriticalMissingPieceEntries = continuedWithHypothesisEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const revalidationRequiredEntries = normalized.filter((entry) =>
    isAffaireRegisterEntryRevalidationRequired(entry)
  );
  const criticalRevalidationRequiredEntries = revalidationRequiredEntries.filter(
    (entry) => entry.severity === "critical"
  );
  const revalidationImpactedStages = Array.from(
    new Set(
      revalidationRequiredEntries.flatMap(
        (entry) => entry.revalidationRequest?.impactedStages ?? []
      )
    )
  );

  return {
    openQuestionsCount:
      criticalOpenEntries.length +
      nonCriticalOpenEntries.length +
      clarifyWithClientEntries.length,
    criticalOpenEntries,
    nonCriticalOpenEntries,
    clarifyWithClientEntries,
    criticalClarifyWithClientEntries,
    openAssumptionEntries,
    openMissingPieceEntries,
    continuedWithHypothesisEntries,
    continuedCriticalMissingPieceEntries,
    revalidationRequiredEntries,
    criticalRevalidationRequiredEntries,
    revalidationImpactedStages,
  } satisfies AffaireRegisterGateSummary;
}

export function buildAffaireRegisterSubmissionSignalMessage(input: {
  entries: AffaireRegisterGateEntry[];
  label: string;
  intro: string;
}) {
  const preview = input.entries
    .slice(0, 3)
    .map((entry) => `${AFFAIRE_REGISTER_KIND_LABELS[entry.kind]} : ${entry.text}`)
    .join(" · ");
  const labelPrefix = input.label.trim();

  return `${labelPrefix}: ${input.intro}${preview ? ` ${preview}` : ""}`.trim();
}
