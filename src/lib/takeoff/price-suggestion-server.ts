import "server-only";

import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { assertTakeoffOperatorActionRole, parseWithSchema } from "@/lib/takeoff/server-helpers";
import { z } from "zod";
import { suggestEstimateCataloguePrices } from "@/lib/estimates/supplier-comparison-server";
import { updateEstimateItem } from "@/lib/estimates/item-update-server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  requestTakeoffPriceSuggestionSchema,
  reviewTakeoffPriceSuggestionSchema,
  takeoffJobIdSchema,
  takeoffPriceSuggestionQuerySchema,
} from "@/lib/takeoff/schemas";
import {
  type TakeoffPriceSuggestionResponse,
  type ReviewTakeoffPriceSuggestionInput,
  type ReviewTakeoffPriceSuggestionResponse,
  type RequestTakeoffPriceSuggestionInput,
  type GetTakeoffPriceSuggestionQuery,
} from "@/lib/takeoff/types";
import {
  buildTakeoffPriceSuggestion,
} from "@/lib/takeoff/price-suggestions";
import {
  getEstimateVersionProjectIdOrThrow,
  assertTakeoffJobAccessibleForVersion,
} from "@/lib/takeoff/version-access-server";
import {
  type EstimateItemPriceSuggestionRow,
  prepareTakeoffPriceSuggestionSources,
  buildPriceSuggestionFingerprint,
  getPriceSuggestionSelectedPriceCents,
  buildPriceSuggestionStatus,
  isTakeoffPriceSuggestionPending,
  buildPriceSuggestionQueryText,
} from "@/lib/takeoff/price-suggestion-preparation";
import {
  type TakeoffPriceSuggestionInsert,
  updateTakeoffPriceSuggestionRecord,
  insertTakeoffPriceSuggestion,
  insertTakeoffPriceSuggestionSources,
  readTakeoffPriceSuggestionForReview,
  reviewPendingTakeoffPriceSuggestion,
  parsePriceSuggestionServerResponse,
  normalizeTakeoffPriceSuggestionRow,
  mapTakeoffPriceSuggestionSnapshot,
  listTakeoffPriceCandidateEstimateItems,
  getTakeoffPriceSuggestionLineOrThrow,
  getEstimateVersionsForPriceSuggestion,
  getActiveTakeoffPriceSuggestionRow,
  listTakeoffPriceSuggestionSourceRows,
} from "@/lib/takeoff/price-suggestion-repository";
import {
  takeoffPriceSuggestionResponseSchema,
  takeoffPriceSuggestionReviewResponseSchema,
} from "@/lib/takeoff/price-suggestion-contracts";

async function collectTakeoffPriceSuggestionSources(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  projectId: string;
  line: EstimateItemPriceSuggestionRow;
}) {
  const queryText = buildPriceSuggestionQueryText(input.line);

  const [catalogueSuggestions, candidateRows] = await Promise.all([
    queryText.length >= 2
      ? suggestEstimateCataloguePrices(input.versionId, queryText)
      : Promise.resolve({
          query: queryText,
          stale_price_days: 0,
          suggestions: [],
        }),
    listTakeoffPriceCandidateEstimateItems({
      supabase: input.supabase,
      tenantId: input.tenantId,
    }),
  ]);

  const candidateVersionById = await getEstimateVersionsForPriceSuggestion({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionIds: candidateRows.map((row) => row.version_id),
  });

  return prepareTakeoffPriceSuggestionSources({
    line: input.line,
    versionId: input.versionId,
    projectId: input.projectId,
    catalogueSuggestions: catalogueSuggestions.suggestions,
    candidateRows,
    candidateVersionById,
    now: Date.now(),
  });
}

export async function getTakeoffPriceSuggestion(
  jobId: string,
  query: GetTakeoffPriceSuggestionQuery
): Promise<TakeoffPriceSuggestionResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const payload = parseWithSchema(
    takeoffPriceSuggestionQuerySchema,
    query,
    "Paramètres de suggestion de prix invalides."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const activeSuggestion = await getActiveTakeoffPriceSuggestionRow({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemId: payload.estimate_item_id,
  });

  if (!activeSuggestion) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Aucune suggestion de prix active pour cette ligne.",
      details: {
        estimate_item_id: payload.estimate_item_id,
        version_id: payload.version_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const sourceRows = await listTakeoffPriceSuggestionSourceRows({
    supabase,
    tenantId,
    suggestionId: activeSuggestion.id,
  });

  return parsePriceSuggestionServerResponse(
    takeoffPriceSuggestionResponseSchema,
    {
      suggestion: mapTakeoffPriceSuggestionSnapshot({
        row: activeSuggestion,
        sourceRows,
      }),
    },
    "Suggestion de prix invalide."
  );
}

export async function requestTakeoffPriceSuggestion(
  jobId: string,
  input: RequestTakeoffPriceSuggestionInput
): Promise<TakeoffPriceSuggestionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const payload = parseWithSchema(
    requestTakeoffPriceSuggestionSchema,
    input,
    "Payload de suggestion de prix invalide."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const [projectId, line, existingSuggestion] = await Promise.all([
    getEstimateVersionProjectIdOrThrow({
      supabase,
      tenantId,
      versionId: payload.version_id,
    }),
    getTakeoffPriceSuggestionLineOrThrow({
      supabase,
      tenantId,
      versionId: payload.version_id,
      estimateItemId: payload.estimate_item_id,
    }),
    getActiveTakeoffPriceSuggestionRow({
      supabase,
      tenantId,
      versionId: payload.version_id,
      jobId: normalizedJobId,
      estimateItemId: payload.estimate_item_id,
    }),
  ]);

  const candidates = await collectTakeoffPriceSuggestionSources({
    supabase,
    tenantId,
    versionId: payload.version_id,
    projectId,
    line,
  });

  if (candidates.length === 0) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Aucune source exploitable pour proposer un prix sur cette ligne.",
      details: {
        estimate_item_id: payload.estimate_item_id,
        version_id: payload.version_id,
        fact: "Aucune source pricebook, historique ou ouvrage proche exploitable.",
        hypothesis: "La ligne peut être trop spécifique ou insuffisamment decrite.",
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const builtSuggestion = buildTakeoffPriceSuggestion({
    currentPriceCents: line.unit_price_ht_cents ?? null,
    currentUnit: line.unit ?? null,
    quantity: line.quantity,
    sources: candidates,
  });
  const snapshotFingerprint = buildPriceSuggestionFingerprint({
    lineId: line.id,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    currentPriceCents: line.unit_price_ht_cents ?? null,
    quantity: line.quantity,
    unit: line.unit ?? null,
    suggestion: builtSuggestion,
  });

  if (
    existingSuggestion &&
    existingSuggestion.snapshot_fingerprint === snapshotFingerprint &&
    payload.force_refresh !== true
  ) {
    const sourceRows = await listTakeoffPriceSuggestionSourceRows({
      supabase,
      tenantId,
      suggestionId: existingSuggestion.id,
    });

    return {
      suggestion: mapTakeoffPriceSuggestionSnapshot({
        row: existingSuggestion,
        sourceRows,
      }),
    };
  }

  if (existingSuggestion) {
    const supersedeTimestamp = new Date().toISOString();
    const { error: supersedeError } = await updateTakeoffPriceSuggestionRecord({
      supabase, tenantId, suggestionId: existingSuggestion.id,
      patch: { superseded_at: supersedeTimestamp },
    });

    if (supersedeError) {
      throw toTakeoffError(
        mapSupabaseError(
          supersedeError,
          "Impossible de superseder la suggestion de prix précédente."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: normalizedJobId,
        }
      );
    }
  }

  const suggestionInsertPayload: TakeoffPriceSuggestionInsert = {
    tenant_id: tenantId,
    project_id: projectId,
    version_id: payload.version_id,
    takeoff_job_id: normalizedJobId,
    estimate_item_id: payload.estimate_item_id,
    requested_by: userId ?? null,
    reviewed_by: null,
    snapshot_fingerprint: snapshotFingerprint,
    status: "pending",
    current_price_cents: line.unit_price_ht_cents ?? null,
    low_cents: builtSuggestion.lowCents,
    target_cents: builtSuggestion.targetCents,
    high_cents: builtSuggestion.highCents,
    confidence_score: builtSuggestion.confidenceScore,
    confidence_label: builtSuggestion.confidenceLabel,
    candidate_count: builtSuggestion.candidateCount,
    outlier_count: builtSuggestion.outlierCount,
    justification: builtSuggestion.justification,
    factors_json: builtSuggestion.factors,
    summary_json: builtSuggestion.summary,
    selected_action: null,
    selected_price_cents: null,
    review_note: null,
    reviewed_at: null,
    superseded_at: null,
    superseded_by_suggestion_id: null,
  };

  const suggestionInsertResult = await insertTakeoffPriceSuggestion({
    supabase, row: suggestionInsertPayload,
  });
  const insertedSuggestionData = suggestionInsertResult.data as unknown;

  if (suggestionInsertResult.error || !insertedSuggestionData) {
    if (existingSuggestion) {
      await updateTakeoffPriceSuggestionRecord({
        supabase, tenantId, suggestionId: existingSuggestion.id,
        patch: { superseded_at: null },
      });
    }

    if (suggestionInsertResult.error) {
      throw toTakeoffError(
        mapSupabaseError(
          suggestionInsertResult.error,
          "Impossible de persister la suggestion de prix."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: normalizedJobId,
        }
      );
    }

    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "La suggestion de prix persistee est introuvable après insertion.",
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const insertedSuggestion =
    normalizeTakeoffPriceSuggestionRow(insertedSuggestionData);

  if (existingSuggestion) {
    const { error: linkSupersedeError } = await updateTakeoffPriceSuggestionRecord({
      supabase, tenantId, suggestionId: existingSuggestion.id,
      patch: { superseded_by_suggestion_id: insertedSuggestion.id },
    });

    if (linkSupersedeError) {
      throw toTakeoffError(
        mapSupabaseError(
          linkSupersedeError,
          "Impossible de finaliser la supersession de la suggestion de prix."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: normalizedJobId,
        }
      );
    }
  }

  const sourceInsertPayload = builtSuggestion.sources.map((source) => ({
    suggestion_id: insertedSuggestion.id,
    source_kind: source.source_kind,
    kind: source.kind,
    label: source.label,
    source_ref: source.source_ref,
    price_cents: source.price_cents,
    freshness_label: source.freshness_label,
    confidence_score: source.confidence_score,
    rank: source.rank,
    is_outlier: source.is_outlier,
    source_record_table: source.source_record_table,
    source_record_id: source.source_record_id,
    metadata_json: source.metadata,
  }));

  const { error: sourceInsertError } = await insertTakeoffPriceSuggestionSources({
    supabase, rows: sourceInsertPayload,
  });

  if (sourceInsertError) {
    throw toTakeoffError(
      mapSupabaseError(
        sourceInsertError,
        "Impossible de persister les sources de la suggestion de prix."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const sourceRows = await listTakeoffPriceSuggestionSourceRows({
    supabase,
    tenantId,
    suggestionId: insertedSuggestion.id,
  });

  return {
    suggestion: mapTakeoffPriceSuggestionSnapshot({
      row: insertedSuggestion,
      sourceRows,
    }),
  };
}

export async function reviewTakeoffPriceSuggestion(
  jobId: string,
  suggestionId: string,
  input: ReviewTakeoffPriceSuggestionInput
): Promise<ReviewTakeoffPriceSuggestionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const normalizedSuggestionId = parseWithSchema(
    z.string().uuid("suggestionId invalide."),
    suggestionId,
    "suggestionId invalide."
  );
  const payload = parseWithSchema(
    reviewTakeoffPriceSuggestionSchema,
    input,
    "Payload de revue de suggestion de prix invalide."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const { data, error } = await readTakeoffPriceSuggestionForReview({
    supabase, tenantId, suggestionId: normalizedSuggestionId,
    versionId: payload.version_id, jobId: normalizedJobId,
  });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la suggestion de prix."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Suggestion de prix introuvable.",
      details: {
        suggestion_id: normalizedSuggestionId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const suggestionRow = normalizeTakeoffPriceSuggestionRow(data);
  if (suggestionRow.superseded_at !== null) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La suggestion de prix cible a déjà été supersedee.",
      details: {
        suggestion_id: normalizedSuggestionId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (!isTakeoffPriceSuggestionPending(suggestionRow)) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La suggestion de prix cible n'est plus en attente de revue.",
      details: {
        suggestion_id: normalizedSuggestionId,
        status: suggestionRow.status,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const selectedPriceCents = getPriceSuggestionSelectedPriceCents({
    action: payload.action,
    suggestion: suggestionRow,
  });
  const nextStatus = buildPriceSuggestionStatus(payload.action);
  const reviewTimestamp = new Date().toISOString();
  const reviewUpdateResult = await reviewPendingTakeoffPriceSuggestion({
    supabase, tenantId, suggestionId: normalizedSuggestionId,
    patch: {
      status: nextStatus,
      selected_action: payload.action,
      selected_price_cents: selectedPriceCents,
      review_note: payload.review_note.trim(),
      reviewed_at: reviewTimestamp,
      reviewed_by: userId ?? null,
    },
  });
  const updatedSuggestionData = reviewUpdateResult.data as unknown;

  if (reviewUpdateResult.error || !updatedSuggestionData) {
    if (reviewUpdateResult.error) {
      throw toTakeoffError(
        mapSupabaseError(
          reviewUpdateResult.error,
          "Impossible d'enregistrer la revue de suggestion de prix."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: normalizedJobId,
        }
      );
    }

    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La suggestion de prix cible n'est plus en attente de revue.",
      details: {
        suggestion_id: normalizedSuggestionId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const updatedSuggestion =
    normalizeTakeoffPriceSuggestionRow(updatedSuggestionData);
  let appliedItem: ReviewTakeoffPriceSuggestionResponse["applied_item"] = null;

  if (
    payload.action === "apply_low" ||
    payload.action === "apply_target" ||
    payload.action === "apply_high"
  ) {
    try {
      const updateResult = await updateEstimateItem(payload.version_id, {
        id: suggestionRow.estimate_item_id,
        unit_price_ht_cents: selectedPriceCents ?? 0,
      });

      appliedItem = {
        id: updateResult.item.id,
        unit_price_ht_cents: updateResult.item.unit_price_ht_cents ?? null,
        updated_at: updateResult.item.updated_at,
      };
    } catch (error) {
      await updateTakeoffPriceSuggestionRecord({
        supabase, tenantId, suggestionId: normalizedSuggestionId,
        patch: {
          status: suggestionRow.status,
          selected_action: suggestionRow.selected_action,
          selected_price_cents: suggestionRow.selected_price_cents,
          review_note: suggestionRow.review_note,
          reviewed_at: suggestionRow.reviewed_at,
          reviewed_by: suggestionRow.reviewed_by,
        },
      });

      throw error;
    }
  }

  const sourceRows = await listTakeoffPriceSuggestionSourceRows({
    supabase,
    tenantId,
    suggestionId: updatedSuggestion.id,
  });

  return parsePriceSuggestionServerResponse(
    takeoffPriceSuggestionReviewResponseSchema,
    {
      suggestion: mapTakeoffPriceSuggestionSnapshot({
        row: updatedSuggestion,
        sourceRows,
      }),
      applied_item: appliedItem,
    },
    "Revue de suggestion de prix invalide."
  );
}
