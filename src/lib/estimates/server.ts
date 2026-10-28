import {
  assertVersionConcurrencyToken,
  normalizeConcurrencyToken,
} from "@/lib/estimates/version-concurrency";
export { normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { assertEstimateItemAidFormat } from "@/lib/estimates/item-update-plan";
import {
  ensureProductIsValid,
  ensureSupplierPriceIsValid,
  fetchEstimateVersionToken,
  getNextItemPosition,
  resolveEstimateItemAidRegex,
} from "@/lib/estimates/item-write-context";
import type { EstimateItemInsert } from "@/lib/estimates/item-write-types";
import { projectDraftMutation } from "@/lib/estimates/item-draft-projection";
export { createEstimateItem } from "@/lib/estimates/item-create-server";
export { updateEstimateItem } from "@/lib/estimates/item-update-server";
export { deleteEstimateItem, reorderEstimateItems, moveEstimateItem } from "@/lib/estimates/item-structure-server";
import { type EstimateItemRow } from "./version-read-server";
export {
  getEstimateVersionDetails,
  type EstimateItemRow,
  listEstimateItems,
  listEstimateVersionEvents,
  type EstimateVersionEvent,
} from "./version-read-server";
import {
  type EstimateStatus,
  type EstimateProjectRow,
  type EstimateVersionRow,
  normalizeEstimateCurrencyOrThrow,
  DEFAULT_CURRENCY,
} from "./version-list-server";
export {
  listEstimateProjectVersions,
  type ListEstimateProjectVersionsResult,
  type EstimateProjectVersionTimelineItem,
  listEstimateProjectDraftVersions,
  type ListEstimateProjectDraftVersionsResult,
  type EstimateProjectDraftVersionItem,
  listEstimateVersionVariants,
  type ListEstimateVersionVariantsResult,
  type EstimateVariantComparisonItem,
  listLatestEstimates,
  type SupplyTypeRow,
  type LaborRoleRow,
} from "./version-list-server";
export {
  getEstimateSupplierComparisons,
  suggestEstimateCataloguePrices,
} from "./supplier-comparison-server";
export {
  buildEstimateSupplierComparisonAlternatives,
  type EstimateSupplierComparisonCandidate,
  type EstimateSupplierComparisonAlternative,
  type SupplierComparisonAlternativeKind,
  buildEstimateSupplierPreselectionReview,
  type EstimateSupplierComparisonCoverageStatus,
  type EstimateSupplierComparisonRiskFlag,
  type EstimateSupplierComparisonCoverageSummary,
} from "./supplier-comparison";
import { readAllRows } from "@/lib/supabase/read-all";
import { randomUUID } from "node:crypto";


import { type SupabaseClient } from "@supabase/supabase-js";


import {
  IMPORT_PREVIEW_REQUIRED_MESSAGE,
  importRequiresPreview,
  normalizeMappedRowsForEstimateCreation,
  type ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import { toRpcImportItems } from "@/lib/affaires/import-flow-server";
import {
  resolveImportSaleCoefficients,
  v3LineContext,
  type ImportSaleCoefficients,
} from "@/lib/affaires/import-engine-server";
import { type EstimateItemRecord } from "@/lib/estimate-calculations";
import { DEFAULT_MAX_SECTION_DEPTH, clampMaxSectionDepth } from "@/lib/estimates/hierarchy";


import {
  calculateEstimateTotalsForItems,
  type CalculatedEstimateTotals,
} from "@/lib/estimates/version-totals";


import {
  resolveCalcEngineVersion,
  resolveEstimateEngineVersion,
} from "@/lib/estimates/calc-engine-version";
import {
  engineFreezesSnapshot,
  isUnifiedEngine,
  requireHistoricalEngine,
  usesPerUnitLabor,
  usesSaleCoefficients,
} from "@/lib/estimates/engine/capabilities";







import {
  assertEstimateVersionUnchanged,
  readAllEstimateItems,
  readEstimateItemSubtrees,
} from "@/lib/estimates/read-all-items-server";
import { insertCopiedEstimateItems, type CopiedEstimateItem } from "@/lib/estimates/copy-items-server";
import { persistAtomicEstimateSettings } from "@/lib/estimates/settings-atomic";

import {
  commitV3Copy,
  estimateV3SectionCopyToHistoricalError,
  planV3LinkedDpgfImport,
  planV3SectionCopy,
} from "@/lib/estimates/v3-section-copy";

import type { TemplateV3ConvertedLine } from "@/lib/estimates/template-v3-hours";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  persistCanonicalEstimateV2,
  type PersistCanonicalEstimateV2Input,
} from "@/lib/estimates/canonical-v2-creation";
import type { Database, Json } from "@/types/database";

import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  internalError,
  isCalculationContextConflict,
  mapSupabaseError,
  notFound,
} from "./errors";
import { evaluateEstimateSendGating } from "./gating";
import { generateEstimatePdfNow } from "./pdf-generator";
import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import type { DocumentProof1 } from "@/lib/estimates/offer-contract";
import { freezeEstimateV2Snapshot } from "./v2-snapshot-server";
import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
  PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION,
  UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION,
  type EstimateSealVersionFields,
} from "./estimate-seal";
import { normalizeEstimateItemAid } from "./schemas";

export {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
} from "./estimate-seal";




import { assertCanWriteEstimateWorkflows } from "./write-access";
import { normalizeEstimateDraftLockSessionId } from "./lock-session";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
  resolveEmbeddedOne,
  toNullableText,
  toRpcUuid,
  tryCarryOverTakeoffJobsToNewVersion,
} from "./server-context";
import type { VersionAccessRow } from "./server-context";
export {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  errorMessageContains,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
  toNullableText,
  toRpcUuid,
} from "./server-context";



import type {
  BulkUpdateEstimateItemsInput,
  BulkUpdateEstimateVersionPatchInput,
  CreateEstimateInput,
  DuplicateEstimateSectionInput,
  ImportEstimateSectionsInput,
  ImportLinkedDpgfSourceInput,
  ListEstimateImportSourcesQueryInput,
  PatchEstimateStatusInput,
  PatchEstimateVersionInput,
} from "./schemas";

export type Supabase = SupabaseClient<Database>;
type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];
type AuditLogInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];
type DpgfImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type DpgfMappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];
export type EstimateCategoryInsert = Database["public"]["Tables"]["estimate_categories"]["Insert"];
export type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
export type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];
export type MarginTierInsert = Database["public"]["Tables"]["margin_tiers"]["Insert"];
export type MarginTierUpdate = Database["public"]["Tables"]["margin_tiers"]["Update"];
export type SuggestionRuleInsert =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"];
export type SuggestionRuleUpdate =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"];
type EstimateVersionEventType =
  | "sent"
  | "accepted"
  | "archived"
  | "rejected"
  | "seal_verified";
type EstimateVersionStatusEventType = Extract<
  EstimateVersionEventType,
  "sent" | "accepted" | "archived"
>;

type CreateEstimateLatestVersionDefaultsRow = Pick<
  EstimateVersionRow,
  | "id"
  | "version_number"
  | "date_devis"
  | "validite_jours"
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"

  | "discount_amount_cents"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "max_section_depth"
>;

type EstimateImportSourceProject = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "is_archived"
>;

type EstimateImportSourceVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "total_ht_cents"
> & {
  estimate_projects: EstimateImportSourceProject | EstimateImportSourceProject[] | null;
};

export type EstimateImportSourceVersionItem = {
  id: string;
  project_id: string;
  project_name: string;
  version_number: number;
  status: EstimateStatus;
  title: string | null;
  updated_at: string;
  total_ht_cents: number;
};

export type ListEstimateImportSourcesResult = {
  items: EstimateImportSourceVersionItem[];
};

export type EstimateImportSectionPreviewItem = {
  id: string;
  title: string;
  line_count: number;
  total_ht_cents: number;
  position: number;
};

export type ListEstimateImportSectionsResult = {
  source_version_id: string;
  items: EstimateImportSectionPreviewItem[];
};

export type ImportEstimateSectionsResult = {
  source_version_id: string;
  target_version_id: string;
  mode: ImportEstimateSectionsInput["mode"];
  imported_sections_count: number;
  imported_lines_count: number;
  created_section_ids: string[];
  created_line_ids: string[];
  /** Sous-lot 2.8b : lignes v1/v2 entrées dans une v3 dont les heures changent (P-12), comme pour un modèle. */
  converted_lines?: TemplateV3ConvertedLine[];
  totals: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
  };
  version: {
    id: string;
    updated_at: string;
  };
};

type AffaireDpgfImportRow = Pick<
  DpgfImportRow,
  | "id"
  | "filename"
  | "source_format"
  | "status"
  | "created_at"
  | "parse_mode"
  | "row_count"
>;

type AffaireDpgfMappingRow = Pick<
  DpgfMappingRow,
  "id" | "status" | "updated_at" | "created_at"
>;

type DpgfMappedRowForEstimateImport = Pick<
  Database["public"]["Tables"]["dpgf_rows_mapped"]["Row"],
  "id" | "payload" | "created_at"
>;

export type AffaireLinkedDpgfSourceResult = {
  import_id: string;
  filename: string;
  source_format: string;
  import_status: string;
  mapping_status: string | null;
  imported_at: string;
  mapping_updated_at: string | null;
  parse_mode: string;
  row_count: number;
  mapped_row_count: number;
} | null;

export type ImportLinkedDpgfSourceResult = {
  source_import_id: string;
  target_version_id: string;
  created_section_id: string;
  created_line_ids: string[];
  imported_lines_count: number;
  skipped_lines_count: number;
  totals: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
  };
  version: {
    id: string;
    updated_at: string;
  };
};

type PreparedLinkedDpgfSource = {
  sourceImportId: string;
  items: EstimateItemInsert[];
  lineItems: Array<EstimateItemInsert & EstimateItemRecord>;
};

export type EstimateTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  source_version_id: string | null;
  created_by: string;
  margin_multiplier: number;
  margin_mode: EstimateVersionRow["margin_mode"];
  currency: string;
  margin_bp: number;
  discount_bp: number;
  discount_amount_cents: number | null;
  discount_mode: Database["public"]["Enums"]["estimate_discount_mode"];
  discount_steps: number[];
  global_coefficient: number;
  tax_rate_bp: number;
  rounding_mode: EstimateVersionRow["rounding_mode"];
  rounding_step_cents: number;
  validite_jours: number;
  created_at: string;
  updated_at: string;
};

export type EstimateAssemblyRow =
  Database["public"]["Tables"]["estimate_assemblies"]["Row"];
export type EstimateAssemblyInsert =
  Database["public"]["Tables"]["estimate_assemblies"]["Insert"];
export type EstimateAssemblyUpdate =
  Database["public"]["Tables"]["estimate_assemblies"]["Update"];
export type EstimateAssemblyItemInsert =
  Database["public"]["Tables"]["estimate_assembly_items"]["Insert"];
export type EstimateAssemblyMemberInsert =
  Database["public"]["Tables"]["estimate_assembly_members"]["Insert"];

const DEFAULT_MARGIN_MULTIPLIER = 1;
import { DEFAULT_TAX_RATE_BP, ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
const STALE_BULK_UPDATE_ERROR_MESSAGE = "STALE_BULK_UPDATE_ITEMS";
const VERSION_CONFLICT_ERROR_MESSAGE = ESTIMATE_VERSION_CONFLICT_MESSAGE;
const ESTIMATE_STATUS_TRANSITIONS: Readonly<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent"],
  sending: [],
  sent: ["accepted", "archived"],
  accepted: ["archived"],
  archived: [],
};
const ESTIMATE_VERSION_STATUS_EVENT_TYPES: Readonly<
  Record<EstimateStatus, EstimateVersionStatusEventType | null>
> = {
  draft: null,
  sending: null,
  sent: "sent",
  accepted: "accepted",
  archived: "archived",
};

type EstimateTotals = {
  total_ht_cents: number | null;
  total_tax_cents: number | null;
  total_ttc_cents: number | null;
};

type EstimateTotalsInvariantRule =
  | "total_ttc_gte_total_ht"
  | "total_tax_non_negative"
  | "total_ttc_equals_total_ht_plus_total_tax";

type EstimateTotalsInvariantViolation = {
  rule: EstimateTotalsInvariantRule;
  message: string;
};

const DEFAULT_ESTIMATE_CATEGORIES = [
  { name: "Materiaux", position: 1 },
  { name: "Main d'oeuvre", position: 2 },
  { name: "Sous-traitance", position: 3 },
] as const;

const DEFAULT_LABOR_ROLES = [
  { name: "Maçon", hourly_rate_cents: 0, position: 1 },
  { name: "Électricien", hourly_rate_cents: 0, position: 2 },
  { name: "Plombier", hourly_rate_cents: 0, position: 3 },
  { name: "Chauffagiste", hourly_rate_cents: 0, position: 4 },
  { name: "Menuisier", hourly_rate_cents: 0, position: 5 },
  { name: "Plaquiste", hourly_rate_cents: 0, position: 6 },
  { name: "Carreleur", hourly_rate_cents: 0, position: 7 },
  { name: "Peintre", hourly_rate_cents: 0, position: 8 },
  { name: "Couvreur", hourly_rate_cents: 0, position: 9 },
] as const;

function parseBulkUpdateCountDetails(details: string | null | undefined) {
  const match = details?.match(
    /expected_count=(\d+),(updated_count|locked_count)=(\d+)/
  );
  if (!match) return null;

  const expectedCount = Number.parseInt(match[1], 10);
  const countValue = Number.parseInt(match[3], 10);

  if (!Number.isFinite(expectedCount) || !Number.isFinite(countValue)) {
    return null;
  }

  return {
    expected_count: expectedCount,
    updated_count: countValue,
  };
}

function assertEstimateStatusTransition(
  currentStatus: EstimateStatus,
  nextStatus: EstimateStatus
) {
  const allowedTransitions = ESTIMATE_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (allowedTransitions.includes(nextStatus)) return;

  throw badRequest(
    `Transition de statut invalide: ${currentStatus} -> ${nextStatus}.`
  );
}

export async function loadEstimateSealSource(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<{ version: EstimateSealVersionFields & Pick<EstimateVersionRow, "seal_payload_version" | "content_revision">; items: EstimateItemRow[] }> {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, status, updated_at, version_number, title, exclusions, date_devis, validite_jours, currency, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, max_section_depth, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, calc_snapshot_content_revision, calc_snapshot_context, contractor_role, seal_hash, seal_payload_version, content_revision"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de charger la version.");
    }

    throw notFound("Version de chiffrage introuvable.");
  }

  const items = await readAllEstimateItems(input);
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version: versionData });

  return {
    version: versionData as EstimateSealVersionFields & Pick<EstimateVersionRow, "seal_payload_version" | "content_revision">,
    items,
  };
}

function getServiceRoleSupabaseClient() {
  try {
    return createServiceRoleClient();
  } catch (error) {
    throw internalError(
      "Configuration Supabase service role manquante pour executer le workflow protege.",
      error
    );
  }
}

function resolveStatusEventType(
  status: EstimateStatus
): EstimateVersionStatusEventType | null {
  return ESTIMATE_VERSION_STATUS_EVENT_TYPES[status] ?? null;
}

async function logEstimateVersionEvent(input: {
  versionId: string;
  eventType: EstimateVersionEventType;
  actorUserId: string | null;
  metadata?: Json;
  occurredAt?: string;
}) {
  const rpcClient = getServiceRoleSupabaseClient();

  const { error } = await rpcClient.rpc("log_estimate_version_event", {
    p_estimate_version_id: input.versionId,
    p_event_type: input.eventType,
    p_created_by: input.actorUserId,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer l'événement de statut."
    );
  }
}

async function transitionEstimateVersionStatusAtomically(input: {
  versionId: string;
  tenantId: string;
  expectedUpdatedAt: string;
  nextStatus: EstimateStatus;
  sealHash: string | null;
  actorUserId: string;
  eventMetadata?: Json;
  occurredAt: string;
  sealPayloadVersion: number;
  expectedDocumentContract: DocumentProof1;
  draftLockSessionId?: string | null;
}) {
  const rpcClient = getServiceRoleSupabaseClient();
  const parameters = {
    p_version_id: input.versionId,
    p_tenant_id: input.tenantId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_next_status: input.nextStatus,
    p_seal_hash: input.sealHash,
    p_actor_user_id: input.actorUserId,
    p_event_metadata: input.eventMetadata ?? {},
    p_occurred_at: input.occurredAt,
    p_seal_payload_version: input.sealPayloadVersion,
    p_expected_document_contract: input.expectedDocumentContract as unknown as Json,
  };
  const { data, error } = input.draftLockSessionId
    ? await rpcClient.rpc("transition_estimate_draft_to_sent", {
        ...parameters,
        p_draft_lock_session_id: input.draftLockSessionId,
      })
    : await rpcClient.rpc("transition_estimate_version_status", parameters);

  if (error) {
    if (error.message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED")) {
      throw conflict(
        "Le verrou de cette page n’est plus actif. Réessayez depuis cette page.",
        undefined,
        "LOCK_REQUIRED"
      );
    }
    if (
      error.code === "40001" ||
      error.code === "40P01" ||
      error.message.includes("ESTIMATE_VERSION_CONFLICT")
    ) {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: input.expectedUpdatedAt,
      }, "VERSION_CONFLICT");
    }

    throw mapSupabaseError(error, "Impossible de changer le statut.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: input.expectedUpdatedAt,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as EstimateVersionRow;
}

function extractPatchedEstimateTotals(input: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">) {
  const patchedTotals: Partial<EstimateTotals> = {};

  if ("total_ht_cents" in input) {
    patchedTotals.total_ht_cents = input.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input) {
    patchedTotals.total_tax_cents = input.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input) {
    patchedTotals.total_ttc_cents = input.total_ttc_cents ?? null;
  }

  return patchedTotals;
}

function mergeEstimateTotalsForPatch(input: {
  persistedTotals: EstimateTotals;
  patch: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">;
}): EstimateTotals {
  const mergedTotals: EstimateTotals = {
    ...input.persistedTotals,
  };

  if ("total_ht_cents" in input.patch) {
    mergedTotals.total_ht_cents = input.patch.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input.patch) {
    mergedTotals.total_tax_cents = input.patch.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input.patch) {
    mergedTotals.total_ttc_cents = input.patch.total_ttc_cents ?? null;
  }

  return mergedTotals;
}

function getEstimateTotalsInvariantViolation(
  totals: EstimateTotals
): EstimateTotalsInvariantViolation | null {
  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_ttc_cents < totals.total_ht_cents
  ) {
    return {
      rule: "total_ttc_gte_total_ht",
      message:
        "Incoherence des totaux: total_ttc_cents doit être supérieur ou egal a total_ht_cents.",
    };
  }

  if (totals.total_tax_cents !== null && totals.total_tax_cents < 0) {
    return {
      rule: "total_tax_non_negative",
      message:
        "Incoherence des totaux: total_tax_cents doit être supérieur ou egal a 0.",
    };
  }

  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_tax_cents !== null &&
    totals.total_ttc_cents !== totals.total_ht_cents + totals.total_tax_cents
  ) {
    return {
      rule: "total_ttc_equals_total_ht_plus_total_tax",
      message:
        "Incoherence des totaux: total_ttc_cents doit être egal a total_ht_cents + total_tax_cents.",
    };
  }

  return null;
}

async function logEstimateInvariantViolation(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  persistedTotals: EstimateTotals;
  patch: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">;
  attemptedTotals: EstimateTotals;
  violation: EstimateTotalsInvariantViolation;
}) {
  const auditPayload: AuditLogInsert = {
    tenant_id: input.tenantId,
    user_id: input.userId,
    table_name: "estimate_versions",
    record_id: input.versionId,
    estimate_version_id: input.versionId,
    action: "invariant_violation",
    before_data: {
      persisted_totals: input.persistedTotals,
    },
    after_data: {
      attempted_totals: input.attemptedTotals,
      patched_totals: extractPatchedEstimateTotals(input.patch),
      violated_rule: input.violation.rule,
      message: input.violation.message,
    },
  };

  const { error } = await input.supabase.from("audit_logs").insert(auditPayload);

  if (error) {
    console.error("Failed to log estimate invariant violation", {
      versionId: input.versionId,
      tenantId: input.tenantId,
      rule: input.violation.rule,
      error,
    });
  }
}

async function assertEstimateTotalsInvariantForPatch(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  persistedTotals: EstimateTotals;
  patch: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">;
}) {
  const attemptedTotals = mergeEstimateTotalsForPatch({
    persistedTotals: input.persistedTotals,
    patch: input.patch,
  });
  const violation = getEstimateTotalsInvariantViolation(attemptedTotals);

  if (!violation) return;

  await logEstimateInvariantViolation({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    userId: input.userId,
    persistedTotals: input.persistedTotals,
    patch: input.patch,
    attemptedTotals,
    violation,
  });

  throw badRequest(violation.message);
}

function collectSectionSubtreeItems(
  sourceSectionId: string,
  sourceItems: EstimateItemRow[]
) {
  const sourceItemsById = new Map(
    sourceItems.map((item) => [item.id, item] as const)
  );
  const rootSection = sourceItemsById.get(sourceSectionId);
  if (!rootSection) {
    return null;
  }

  const childrenByParentId = new Map<string, EstimateItemRow[]>();
  for (const item of sourceItems) {
    const parentId = item.parent_id ?? null;
    if (!parentId) continue;

    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(item);
      continue;
    }

    childrenByParentId.set(parentId, [item]);
  }

  const orderedSubtreeItems: EstimateItemRow[] = [];
  const stack: string[] = [sourceSectionId];

  while (stack.length > 0) {
    const currentItemId = stack.pop();
    if (!currentItemId) continue;

    const currentItem = sourceItemsById.get(currentItemId);
    if (!currentItem) continue;

    orderedSubtreeItems.push(currentItem);

    const directChildren = childrenByParentId.get(currentItemId) ?? [];
    for (let index = directChildren.length - 1; index >= 0; index -= 1) {
      stack.push(directChildren[index].id);
    }
  }

  return {
    rootSection,
    orderedSubtreeItems,
  };
}

function normalizeSectionTitleKey(value: string | null | undefined) {
  const normalized = toNullableText(value);
  if (!normalized) return "section";
  return normalized.toLowerCase();
}

function resolveImportedSectionTitle(input: {
  sourceTitle: string | null | undefined;
  usedTitleKeys: Set<string>;
}) {
  const fallbackTitle = "Section importée";
  const baseTitle = toNullableText(input.sourceTitle) ?? fallbackTitle;
  const baseKey = normalizeSectionTitleKey(baseTitle);

  if (!input.usedTitleKeys.has(baseKey)) {
    input.usedTitleKeys.add(baseKey);
    return baseTitle;
  }

  const firstImportedCandidate = `${baseTitle} (import)`;
  const firstImportedKey = normalizeSectionTitleKey(firstImportedCandidate);
  if (!input.usedTitleKeys.has(firstImportedKey)) {
    input.usedTitleKeys.add(firstImportedKey);
    return firstImportedCandidate;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseTitle} (import ${suffix})`;
    const candidateKey = normalizeSectionTitleKey(candidate);
    if (!input.usedTitleKeys.has(candidateKey)) {
      input.usedTitleKeys.add(candidateKey);
      return candidate;
    }
    suffix += 1;
  }

  return firstImportedCandidate;
}

function buildImportedEstimateItemInsert(input: {
  sourceItem: EstimateItemRow;
  itemId: string;
  tenantId: string;
  targetVersionId: string;
  parentId: string | null;
  position: number;
  title?: string;
}): CopiedEstimateItem {
  return {
    id: input.itemId,
    tenant_id: input.tenantId,
    version_id: input.targetVersionId,
    parent_id: input.parentId,
    item_type: input.sourceItem.item_type,
    position: input.position,
    title: input.title ?? input.sourceItem.title,
    aid: input.sourceItem.aid ?? null,
    description: input.sourceItem.description,
    quantity: input.sourceItem.quantity,
    unit_price_ht_cents: input.sourceItem.unit_price_ht_cents,
    tax_rate_bp: input.sourceItem.tax_rate_bp,
    k_fo: input.sourceItem.k_fo,
    h_mo: input.sourceItem.h_mo,
    h_mo_majoration: input.sourceItem.h_mo_majoration ?? null,
    k_mo: input.sourceItem.k_mo,
    h_mo_atelier: input.sourceItem.h_mo_atelier ?? null,
    k_mo_atelier: input.sourceItem.k_mo_atelier ?? null,
    labor_role_atelier_id: input.sourceItem.labor_role_atelier_id ?? null,
    h_mo_chantier: input.sourceItem.h_mo_chantier ?? null,
    k_mo_chantier: input.sourceItem.k_mo_chantier ?? null,
    labor_role_chantier_id: input.sourceItem.labor_role_chantier_id ?? null,
    pu_ht_cents: input.sourceItem.pu_ht_cents,
    labor_role_id: input.sourceItem.labor_role_id,
    category_id: input.sourceItem.category_id,
    supply_type_id: input.sourceItem.supply_type_id ?? null,
    selected_supplier_price_id: input.sourceItem.selected_supplier_price_id ?? null,
    source_provider: input.sourceItem.source_provider ?? null,
    source_job_id: input.sourceItem.source_job_id ?? null,
    source_file_name: input.sourceItem.source_file_name ?? null,
    source_page: input.sourceItem.source_page ?? null,
    source_metadata: input.sourceItem.source_metadata ?? {},
    line_total_ht_cents: input.sourceItem.line_total_ht_cents,
    line_tax_cents: input.sourceItem.line_tax_cents,
    line_total_ttc_cents: input.sourceItem.line_total_ttc_cents,
  };
}

function buildImportedSubtreePayload(input: {
  subtree: {
    rootSection: EstimateItemRow;
    orderedSubtreeItems: EstimateItemRow[];
  };
  tenantId: string;
  targetVersionId: string;
  rootPosition: number;
  rootTitle: string;
}) {
  const newIdBySourceId = new Map<string, string>();
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];

  input.subtree.orderedSubtreeItems.forEach((item) => {
    newIdBySourceId.set(item.id, randomUUID());
  });

  const items = input.subtree.orderedSubtreeItems.map((sourceItem) => {
    const newItemId = newIdBySourceId.get(sourceItem.id);
    if (!newItemId) {
      throw internalError("Impossible d'importer la section.");
    }

    const isRoot = sourceItem.id === input.subtree.rootSection.id;
    const sourceParentId = sourceItem.parent_id ?? null;
    const newParentId = isRoot
      ? null
      : sourceParentId
        ? (newIdBySourceId.get(sourceParentId) ?? null)
        : null;

    if (!isRoot && sourceParentId && !newParentId) {
      throw internalError("Impossible d'importer la section.");
    }

    const inserted = buildImportedEstimateItemInsert({
      sourceItem,
      itemId: newItemId,
      tenantId: input.tenantId,
      targetVersionId: input.targetVersionId,
      parentId: newParentId,
      position: isRoot ? input.rootPosition : sourceItem.position,
      title: isRoot ? input.rootTitle : undefined,
    });

    if (sourceItem.item_type === "section") {
      createdSectionIds.push(newItemId);
    } else {
      createdLineIds.push(newItemId);
    }

    return inserted;
  });

  return {
    items,
    new_id_by_source_id: newIdBySourceId,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    line_count: createdLineIds.length,
  };
}

function sortValidImportFlowLines(lines: ValidImportFlowLine[]) {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

async function loadLatestLinkedDpgfImportForProject(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_imports")
    .select(
      "id, filename, source_format, status, created_at, parse_mode, row_count"
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la source DPGF liée.");
  }

  return (data ?? null) as AffaireDpgfImportRow | null;
}

async function loadLatestDpgfMappingForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_mappings")
    .select("id, status, updated_at, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le statut de mapping DPGF."
    );
  }

  return (data ?? null) as AffaireDpgfMappingRow | null;
}

async function countMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { count, error } = await input.supabase
    .from("dpgf_rows_mapped")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de compter les lignes DPGF mappées.");
  }

  return count ?? 0;
}

async function loadMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("dpgf_rows_mapped")
    .select("id, payload, created_at", { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes DPGF mappées.");
  }

  return (data ?? []) as DpgfMappedRowForEstimateImport[];
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function loadMappedRowsForImportWithRetry(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 300);
  let lastRows: DpgfMappedRowForEstimateImport[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastRows = await loadMappedRowsForImport({
      supabase: input.supabase,
      tenantId: input.tenantId,
      importId: input.importId,
    });

    if (lastRows.length > 0) {
      return lastRows;
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
    }
  }

  return lastRows;
}

async function resolveLinkedDpgfImportSectionTitle(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  requestedTitle: string | null;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("title")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("item_type", "section")
    .is("parent_id", null);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de vérifier les chapitres existants."
    );
  }

  const usedRootTitleKeys = new Set<string>();
  for (const row of (data ?? []) as Array<{ title: string }>) {
    usedRootTitleKeys.add(normalizeSectionTitleKey(row.title));
  }

  return resolveImportedSectionTitle({
    sourceTitle: input.requestedTitle ?? "Import DPGF",
    usedTitleKeys: usedRootTitleKeys,
  });
}

type ImportLinkedDpgfSourceInternalInput = {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  versionId: string;
  marginMultiplier: number;
  defaultTaxRateBp: number;
  sectionTitle?: string | null;
  persist?: boolean;
  /** Sous-lot 2.8b (A5) : brouillon v3, ses coefficients de vente et son jeton ; lignes écrites par l'écrivain de lot. */
  v3?: { saleCoefficientFo: number; saleCoefficientMo: number; updatedAt: string };
  draftLockSessionId?: string | null;
};

async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput & { persist: false }
): Promise<PreparedLinkedDpgfSource>;
async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput
): Promise<ImportLinkedDpgfSourceResult>;
async function importLinkedDpgfSourceIntoVersionInternal(
  input: ImportLinkedDpgfSourceInternalInput
): Promise<ImportLinkedDpgfSourceResult | PreparedLinkedDpgfSource> {
  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });

  if (!latestImport) {
    throw badRequest("Aucune source DPGF liée à cette affaire.");
  }

  const mappedRows = await loadMappedRowsForImportWithRetry({
    supabase: input.supabase,
    tenantId: input.tenantId,
    importId: latestImport.id,
    maxAttempts: 10,
    retryDelayMs: 300,
  });

  if (mappedRows.length === 0) {
    throw badRequest(
      "La source DPGF liée ne contient aucune ligne mappee exploitable."
    );
  }

  const normalized = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: input.marginMultiplier,
    defaultTaxRateBp: input.defaultTaxRateBp,
    entry: "direct",
    ...(input.v3
      ? { engine: 3, saleCoefficientFo: input.v3.saleCoefficientFo, saleCoefficientMo: input.v3.saleCoefficientMo }
      : {}),
  });
  // No preview here: hours per unit and workbook parameters are refused, never priced at 0 €/h.
  if (importRequiresPreview(normalized)) {
    throw badRequest(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  }
  const validLines = sortValidImportFlowLines(normalized.validLines);

  if (validLines.length === 0) {
    throw badRequest(
      "Aucune ligne DPGF valide à importer depuis la source liée."
    );
  }

  const defaultTitle = toNullableText(latestImport.filename)
    ? `Import DPGF - ${latestImport.filename}`
    : "Import DPGF";
  const resolvedSectionTitle = await resolveLinkedDpgfImportSectionTitle({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    requestedTitle: toNullableText(input.sectionTitle) ?? defaultTitle,
  });
  const createdSectionId = randomUUID();
  const rootPosition = await getNextItemPosition(input.supabase, input.versionId, null);

  // Every copied column is explicit (copy_estimate_items_atomic stores exactly them): the values the column
  // defaults gave the section before.
  const sectionItemPayload = {
    id: createdSectionId,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: null,
    item_type: "section",
    position: rootPosition,
    title: resolvedSectionTitle,
    aid: null,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    k_mo: null,
    h_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    source_provider: "dpgf",
    // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
    source_job_id: null,
    source_file_name: latestImport.filename,
    source_page: null,
    source_metadata: {},
    // Keep section payload explicit for strict DB payload checks/default-to-null behavior.
    h_mo_majoration: 1,
    k_mo_atelier: 1,
    k_mo_chantier: 1,
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  } satisfies CopiedEstimateItem & EstimateItemInsert;

  const lineItemsPayload = validLines.map((line, index) => {
    const lineId = randomUUID();
    return {
      id: lineId,
      tenant_id: input.tenantId,
      version_id: input.versionId,
      parent_id: createdSectionId,
      item_type: "line",
      position: index + 1,
      title: line.title,
      aid: null,
      description: line.description,
      quantity: line.quantity,
      unit_price_ht_cents: line.unitPriceHtCents,
      tax_rate_bp: line.taxRateBp,
      k_fo: line.kFo,
      h_mo: line.hMo,
      h_mo_majoration: line.hMoMajoration ?? 1,
      k_mo: line.kMo,
      h_mo_atelier: null,
      k_mo_atelier: 1,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
      pu_ht_cents: line.puHtCents,
      labor_role_id: null,
      category_id: null,
      supply_type_id: null,
      selected_supplier_price_id: null,
      source_provider: "dpgf",
      // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
      source_job_id: null,
      source_file_name: latestImport.filename,
      source_page: line.rowIndex > 0 ? line.rowIndex : null,
      source_metadata: {},
      line_total_ht_cents: line.lineTotalHtCents,
      line_tax_cents: line.lineTaxCents,
      line_total_ttc_cents: line.lineTotalTtcCents,
    } satisfies CopiedEstimateItem & EstimateItemInsert & EstimateItemRecord;
  });

  if (input.persist === false) {
    return {
      sourceImportId: latestImport.id,
      items: [sectionItemPayload, ...lineItemsPayload],
      lineItems: lineItemsPayload,
    };
  }

  if (input.v3) {
    const committed = await commitV3Copy({
      versionId: input.versionId,
      updatedAt: input.v3.updatedAt,
      plan: planV3LinkedDpgfImport({
        sectionId: createdSectionId,
        rootPosition,
        sectionTitle: resolvedSectionTitle,
        filename: latestImport.filename,
        importId: latestImport.id,
        lines: validLines.map((line, index) => ({ ...line, id: lineItemsPayload[index]!.id as string })),
      }),
    });
    return {
      source_import_id: latestImport.id,
      target_version_id: input.versionId,
      created_section_id: createdSectionId,
      created_line_ids: lineItemsPayload.map((item) => item.id as string),
      imported_lines_count: lineItemsPayload.length,
      skipped_lines_count: Math.max(normalized.totalRows - lineItemsPayload.length, 0),
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  await insertCopiedEstimateItems({
    supabase: input.supabase,
    versionId: input.versionId,
    draftLockSessionId: input.draftLockSessionId,
    items: [sectionItemPayload, ...lineItemsPayload],
    failureMessage: "Impossible d'importer la source DPGF liée.",
  });

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  return {
    source_import_id: latestImport.id,
    target_version_id: input.versionId,
    created_section_id: createdSectionId,
    created_line_ids: lineItemsPayload.map((item) => item.id as string),
    imported_lines_count: lineItemsPayload.length,
    skipped_lines_count: Math.max(
      normalized.totalRows - lineItemsPayload.length,
      0
    ),
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

type EstimateRecalculationVersionOverrides = Partial<
  Pick<
    EstimateVersionRow,
    | "margin_multiplier"
    | "margin_mode"
    | "tax_rate_bp"
    | "discount_bp"

    | "discount_amount_cents"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "rounding_mode"
    | "rounding_step_cents"
    | "contractor_role"
  >
>;

type RecalculateEstimateVersionTotalsInput = {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  persist?: boolean;
  versionOverrides?: EstimateRecalculationVersionOverrides;
};

async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput & { persist: false }
): Promise<{ totals: CalculatedEstimateTotals }>;
async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput
): Promise<{
  totals: CalculatedEstimateTotals;
  version: { id: string; updated_at: string };
}>;
async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput
) {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, status, updated_at, content_revision, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, contractor_role, estimate_projects!inner(user_id)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(
        versionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const versionRecord = versionData as Pick<
    EstimateVersionRow,
    | "id"
    | "tenant_id"
    | "project_id"
    | "status"
    | "updated_at"
    | "content_revision"
    | "margin_multiplier"
    | "margin_mode"
    | "tax_rate_bp"
    | "discount_bp"

    | "discount_amount_cents"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "rounding_mode"
    | "rounding_step_cents"
    | "calc_engine_version"
    | "contractor_role"
  > & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };
  const effectiveVersionRecord = {
    ...versionRecord,
    ...input.versionOverrides,
  };

  const project = resolveEmbeddedOne(effectiveVersionRecord.estimate_projects);
  if (!project) {
    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const items = await readAllEstimateItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  const totals = await calculateEstimateTotalsForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: project.user_id,
    version: effectiveVersionRecord,
    lineItems: items.filter((item) => item.item_type === "line"),
  });

  await assertEstimateVersionUnchanged({
    supabase: input.supabase,
    version: versionRecord,
  });

  if (input.persist === false) {
    return { totals };
  }

  const { data: versionToken, error: updateVersionError } = await input.supabase
    .from("estimate_versions")
    .update({
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .select("id, updated_at")
    .single();

  if (updateVersionError || !versionToken) {
    if (updateVersionError) {
      throw mapSupabaseError(
        updateVersionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  return {
    totals,
    version: versionToken,
  };
}

export async function listEstimateImportSources(
  query?: ListEstimateImportSourcesQueryInput
): Promise<ListEstimateImportSourcesResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  let request = supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, estimate_projects!inner(id, tenant_id, user_id, name, is_archived)",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false);

  if (query?.exclude_version_id) {
    request = request.neq("id", query.exclude_version_id);
  }

  if (!isTenantAdmin(context.tenantRole)) {
    request = request.eq("estimate_projects.user_id", context.userId);
  }

  // Every version, by pages in id order only (the API returns 1 000 rows at most): a version edited between
  // two pages keeps its place, where an updated_at order would move it across pages and fail the read.
  const { data, error } = await readAllRows(() => request);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les devis sources pour l'import."
    );
  }

  // Most recently updated first, as PostgreSQL orders them: keep the microseconds Date drops.
  const updatedAtKey = (value: string) => Date.parse(value) * 1000 +
    Number((value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  const rows = ((data ?? []) as EstimateImportSourceVersionRow[]).sort((left, right) =>
    updatedAtKey(right.updated_at) - updatedAtKey(left.updated_at) ||
    right.version_number - left.version_number ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const items = rows
    .map((row): EstimateImportSourceVersionItem | null => {
      const project = resolveEmbeddedOne(row.estimate_projects);
      if (!project) return null;

      const hasAccess = canAccessOwnerResource({
        context,
        resourceUserId: project.user_id,
      });
      if (!hasAccess) return null;

      return {
        id: row.id,
        project_id: row.project_id,
        project_name: project.name,
        version_number: row.version_number,
        status: row.status,
        title: row.title,
        updated_at: row.updated_at,
        total_ht_cents: row.total_ht_cents ?? 0,
      };
    })
    .filter((row): row is EstimateImportSourceVersionItem => row !== null);

  return {
    items,
  };
}

export async function listEstimateImportSections(
  sourceVersionId: string
): Promise<ListEstimateImportSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, sourceVersionId, context);

  // Every item, by pages: the API returns 1 000 rows at most, and a partial read would miscount the sections.
  const sourceItems = await readAllEstimateItems({ supabase, tenantId, versionId: sourceVersionId });
  const rootSections = sourceItems.filter(
    (item) => item.item_type === "section" && item.parent_id === null
  );

  const items = rootSections
    .map((section): EstimateImportSectionPreviewItem | null => {
      const subtree = collectSectionSubtreeItems(section.id, sourceItems);
      if (!subtree) return null;

      const lineItems = subtree.orderedSubtreeItems.filter(
        (item) => item.item_type === "line"
      );

      return {
        id: section.id,
        title: toNullableText(section.title) ?? "Section sans titre",
        line_count: lineItems.length,
        total_ht_cents: lineItems.reduce(
          (sum, item) => sum + (item.line_total_ht_cents ?? 0),
          0
        ),
        position: section.position,
      };
    })
    .filter((section): section is EstimateImportSectionPreviewItem => section !== null)
    .sort((left, right) => left.position - right.position);

  return {
    source_version_id: sourceVersionId,
    items,
  };
}

export async function getAffaireLinkedDpgfSource(
  projectId: string
): Promise<AffaireLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  const { data: projectData, error: projectError } = await supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (projectError) {
    throw mapSupabaseError(projectError, "Impossible de charger l'affaire.");
  }

  const project = (projectData ??
    null) as Pick<
    EstimateProjectRow,
    "id" | "tenant_id" | "user_id" | "is_archived"
  > | null;

  if (
    !project ||
    project.is_archived ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Affaire introuvable.");
  }

  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase,
    tenantId,
    projectId: project.id,
  });

  if (!latestImport) {
    return null;
  }

  const [latestMapping, mappedRowCount] = await Promise.all([
    loadLatestDpgfMappingForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
    countMappedRowsForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
  ]);

  return {
    import_id: latestImport.id,
    filename: latestImport.filename,
    source_format: latestImport.source_format,
    import_status: latestImport.status,
    mapping_status: latestMapping?.status ?? null,
    imported_at: latestImport.created_at,
    mapping_updated_at: latestMapping?.updated_at ?? null,
    parse_mode: latestImport.parse_mode,
    row_count: latestImport.row_count ?? 0,
    mapped_row_count: mappedRowCount,
  };
}

export {
  createEstimateTemplateFromVersion,
  deleteEstimateTemplate,
  duplicateEstimateTemplate,
  getEstimateTemplate,
  instantiateEstimateFromTemplate,
  listEstimateTemplates,
  updateEstimateTemplate,
} from "@/lib/estimates/templates-server";

export {
  loadAssemblyItemCountByAssemblyId,
  loadAssemblyMemberCountByAssemblyId,
  loadEstimateAssemblyItems,
  loadEstimateAssemblyMembers,
  loadEstimateAssemblyOrThrow,
  loadValidLaborRoleIdsForOwner,
} from "@/lib/estimates/estimate-assembly-helpers";

export {
  assertLinePlacementAllowed,
  assertSectionPlacementAllowed,
  assertSectionSubtreePlacementAllowed,
  ensureParentIsValid,
  resolveSectionLevelFromParent,
} from "@/lib/estimates/estimate-placement-helpers";

export {
  ensureCategoryIsValid,
  ensureLaborRoleIsValid,
  getNextCategoryPosition,
  getNextLaborRolePosition,
  getNextSuggestionRulePosition,
} from "@/lib/estimates/estimate-reference-helpers";

export {
  computeAssemblyMetrics,
  createEstimateAssembly,
  deleteEstimateAssembly,
  getEstimateAssembly,
  insertAssemblyIntoVersion,
  insertTemplateIntoVersion,
  listEstimateAssemblies,
  updateEstimateAssembly,
} from "@/lib/estimates/assemblies-server";

export {
  createEstimateCategory,
  createLaborRole,
  createMarginTier,
  createSuggestionRule,
  deleteMarginTier,
  saveSuggestionRuleFeedback,
  updateLaborRole,
  updateMarginTier,
  updateSuggestionRule,
} from "@/lib/estimates/reference-data-server";

export async function duplicateEstimateVersion(
  versionId: string,
  options?: { as_variant?: boolean }
) {
  const context = await getAuthenticatedContext();
  const { supabase } = context;
  // Creer une version (ou une variante) est une ecriture de workflow, au meme
  // titre qu'une transition de statut : reservee aux roles ecrivains.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const access = await getVersionAccessOrThrow(supabase, versionId, context);
  if (access.project.is_archived) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const { data, error } = await supabase.rpc("duplicate_estimate_version", {
    source_version_id: versionId,
    as_variant: options?.as_variant === true,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de dupliquer le chiffrage.");
  }

  const duplicatedVersionId = toRpcUuid(data);
  if (!duplicatedVersionId) {
    throw badRequest("Impossible de dupliquer le chiffrage.");
  }

  return {
    version_id: duplicatedVersionId,
  };
}

/**
 * Toutes les lignes d'une version copiée, par pages (l'API rend 1 000 lignes au plus), quel que soit le moteur.
 * Sous-lot 2.8b (C8, revue Codex de la PR #59, G3 ; PR #70 pour les v1/v2) : au-delà de 500 éléments, la lecture
 * prend plusieurs pages ; la version est relue après la dernière (jeton et révision de contenu lus avec l'accès),
 * sinon une modification concurrente entre deux pages donnerait une copie mêlant deux états. Version changée :
 * 409 VERSION_CONFLICT, rien n'est copié.
 */
async function readAllItemsForCopy(supabase: Supabase, tenantId: string, version: VersionAccessRow) {
  const items = await readAllEstimateItems({ supabase, tenantId, versionId: version.id });
  await assertEstimateVersionUnchanged({ supabase, version });
  return items;
}

/**
 * Lot 3.1 (docs/testing/lot3-1-v3-copy-scale.md) : la source d'une copie, réduite aux sections sélectionnées et à leur
 * descendance (ce que la copie lit), par niveaux et par pages, puis la même vérification de version que
 * `readAllItemsForCopy`. Un identifiant hors de la version ou qui n'est pas une section reste refusé par l'appelant.
 */
async function readSelectedSubtreesForCopy(supabase: Supabase, tenantId: string, version: VersionAccessRow,
  sectionIds: readonly string[]) {
  const items = await readEstimateItemSubtrees({ supabase, tenantId, versionId: version.id, ids: sectionIds });
  await assertEstimateVersionUnchanged({ supabase, version });
  return items;
}

async function duplicateSectionInternal(input: {
  sectionId: string;
  targetVersionId?: string;
  expectedSourceVersionId?: string;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { data: sourceSectionData, error: sourceSectionError } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type, title")
    .eq("tenant_id", tenantId)
    .eq("id", input.sectionId)
    .single();

  if (sourceSectionError || !sourceSectionData) {
    throw notFound("Section introuvable.");
  }

  if (input.expectedSourceVersionId) {
    const belongsToExpectedVersion =
      sourceSectionData.version_id === input.expectedSourceVersionId;
    if (!belongsToExpectedVersion) {
      throw notFound("Section introuvable.");
    }
  }

  if (sourceSectionData.item_type !== "section") {
    throw badRequest("Seules les sections peuvent être dupliquees.");
  }

  const sourceVersionId = sourceSectionData.version_id;
  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    sourceVersionId,
    context
  );

  const resolvedTargetVersionId = input.targetVersionId ?? sourceVersion.id;
  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    resolvedTargetVersionId,
    context
  );
  // Lot 2, sous-lot 2.8b (A6, D-e) : une section entre dans une v3 par l'écrivain de lot (v3-section-copy.ts) ;
  // une section v3 n'entre pas dans une v1/v2, refus nommé avant toute écriture.
  const sourceIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(sourceVersion));
  const targetIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(targetVersion));
  if (sourceIsV3 && !targetIsV3) throw estimateV3SectionCopyToHistoricalError();

  assertDraftStatus(targetVersion.status);
  const targetLock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  // The section and its descendants, by pages, pinned to the version read with its access: a partial or mixed read
  // would copy part of the section, or two states of it.
  const sourceItems = await readSelectedSubtreesForCopy(supabase, tenantId, sourceVersion, [input.sectionId]);
  const subtree = collectSectionSubtreeItems(input.sectionId, sourceItems);

  if (!subtree) {
    throw notFound("Section introuvable.");
  }

  const rootPosition = await getNextItemPosition(supabase, targetVersion.id, null);
  const duplicatedRootTitle = `${subtree.rootSection.title} (copie)`;
  const newIdBySourceId = new Map<string, string>();

  subtree.orderedSubtreeItems.forEach((item) => {
    newIdBySourceId.set(item.id, randomUUID());
  });

  const duplicatedItemsPayload: CopiedEstimateItem[] = subtree.orderedSubtreeItems.map(
    (item) => {
      const newItemId = newIdBySourceId.get(item.id);
      if (!newItemId) {
        throw internalError("Impossible de dupliquer la section.");
      }

      const isRootSection = item.id === input.sectionId;
      const sourceParentId = item.parent_id ?? null;
      const newParentId = isRootSection
        ? null
        : sourceParentId
          ? (newIdBySourceId.get(sourceParentId) ?? null)
          : null;

      if (!isRootSection && sourceParentId && !newParentId) {
        throw internalError("Impossible de dupliquer la section.");
      }

      return buildImportedEstimateItemInsert({
        sourceItem: item,
        itemId: newItemId,
        tenantId,
        targetVersionId: targetVersion.id,
        parentId: newParentId,
        position: isRootSection ? rootPosition : item.position,
        title: isRootSection ? duplicatedRootTitle : item.title,
      });
    }
  );

  const duplicatedSectionId = newIdBySourceId.get(input.sectionId);
  if (targetIsV3 && duplicatedSectionId) {
    const plan = planV3SectionCopy({
      payload: duplicatedItemsPayload,
      sourceIdByNewId: new Map([...newIdBySourceId].map(([sourceId, newId]) => [newId, sourceId])),
      sourceItemsById: new Map(sourceItems.map((item) => [item.id, item])),
      sourceIsV3,
      sameVersion: sourceVersion.id === targetVersion.id,
    });
    const committed = await commitV3Copy({ versionId: targetVersion.id, updatedAt: targetVersion.updated_at, plan });
    return {
      duplicated_section_id: duplicatedSectionId,
      source_version_id: sourceVersion.id,
      target_version_id: targetVersion.id,
      copied_item_count: duplicatedItemsPayload.length,
      converted_lines: plan.convertedLines,
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  await insertCopiedEstimateItems({
    supabase,
    versionId: targetVersion.id,
    draftLockSessionId: targetLock.session_id,
    items: duplicatedItemsPayload,
    failureMessage: "Impossible de dupliquer la section.",
  });

  if (!duplicatedSectionId) {
    throw internalError("Impossible de dupliquer la section.");
  }

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase,
    tenantId,
    versionId: targetVersion.id,
  });

  return {
    duplicated_section_id: duplicatedSectionId,
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    copied_item_count: duplicatedItemsPayload.length,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function duplicateSection(
  sectionId: string,
  targetVersionId?: string
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId,
  });
}

export async function duplicateSectionFromVersion(
  sourceVersionId: string,
  sectionId: string,
  input?: DuplicateEstimateSectionInput
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId: input?.target_version_id ?? undefined,
    expectedSourceVersionId: sourceVersionId,
  });
}

export async function importSectionsFromVersion(
  targetVersionId: string,
  input: ImportEstimateSectionsInput
): Promise<ImportEstimateSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    targetVersionId,
    context
  );
  // Lot 2, sous-lot 2.8b (A7) : une section d'une autre version entre dans une v3 par l'écrivain de lot, convertie
  // par la règle P-12 depuis une v1/v2 (v3-section-copy.ts).
  const targetIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(targetVersion));
  assertDraftStatus(targetVersion.status);
  const targetLock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    input.source_version_id,
    context
  );
  // D-e : une section d'une v3 ne se copie pas vers une v1/v2 (lignes non chiffrées), refus nommé.
  const sourceIsV3 = usesPerUnitLabor(resolveEstimateEngineVersion(sourceVersion));
  if (sourceIsV3 && !targetIsV3) throw estimateV3SectionCopyToHistoricalError();

  // The selected sections of the source with their descendants and every item of the target, by pages, each pinned
  // to the version read with its access. A partial or mixed source read would import part of a section; a target one
  // would reuse its titles and child positions.
  const [sourceItems, targetItems] = await Promise.all([
    readSelectedSubtreesForCopy(supabase, tenantId, sourceVersion, input.section_ids),
    readAllItemsForCopy(supabase, tenantId, targetVersion),
  ]);
  const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]));

  const selectedSectionIds = input.section_ids;
  selectedSectionIds.forEach((sectionId) => {
    const sectionItem = sourceItemById.get(sectionId);
    if (!sectionItem || sectionItem.item_type !== "section") {
      throw badRequest(
        "section_ids contient un identifiant de section invalide."
      );
    }
  });

  const selectedSectionIdSet = new Set(selectedSectionIds);
  const rootSelectedSectionIds = selectedSectionIds.filter((sectionId) => {
    let parentId = sourceItemById.get(sectionId)?.parent_id ?? null;

    while (parentId) {
      if (selectedSectionIdSet.has(parentId)) {
        return false;
      }
      parentId = sourceItemById.get(parentId)?.parent_id ?? null;
    }

    return true;
  });

  const targetRootSectionIdByTitleKey = new Map<string, string>();
  const usedRootTitleKeys = new Set<string>();
  targetItems.forEach((item) => {
    if (item.item_type !== "section" || item.parent_id !== null) return;
    const titleKey = normalizeSectionTitleKey(item.title);
    usedRootTitleKeys.add(titleKey);
    if (!targetRootSectionIdByTitleKey.has(titleKey)) {
      targetRootSectionIdByTitleKey.set(titleKey, item.id);
    }
  });

  const rootParentPositionKey = "__root__";
  const highestPositionByParentKey = new Map<string, number>();
  targetItems.forEach((item) => {
    const parentKey = item.parent_id ?? rootParentPositionKey;
    const current = highestPositionByParentKey.get(parentKey) ?? 0;
    if (item.position > current) {
      highestPositionByParentKey.set(parentKey, item.position);
    }
  });

  const allocateNextPosition = (parentId: string | null) => {
    const parentKey = parentId ?? rootParentPositionKey;
    const nextPosition = (highestPositionByParentKey.get(parentKey) ?? 0) + 1;
    highestPositionByParentKey.set(parentKey, nextPosition);
    return nextPosition;
  };

  const importedItemsPayload: CopiedEstimateItem[] = [];
  const sourceIdByNewId = new Map<string, string>();
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];
  let importedLinesCount = 0;

  for (const sourceSectionId of rootSelectedSectionIds) {
    const subtree = collectSectionSubtreeItems(sourceSectionId, sourceItems);
    if (!subtree) {
      throw notFound("Section source introuvable.");
    }

    const sourceRootTitle =
      toNullableText(subtree.rootSection.title) ?? "Section importée";
    const sourceRootTitleKey = normalizeSectionTitleKey(sourceRootTitle);

    if (input.mode === "merge") {
      const existingTargetSectionId =
        targetRootSectionIdByTitleKey.get(sourceRootTitleKey);

      if (existingTargetSectionId) {
        const sourceLines = subtree.orderedSubtreeItems.filter(
          (item) => item.item_type === "line"
        );

        sourceLines.forEach((sourceLine) => {
          const lineId = randomUUID();
          sourceIdByNewId.set(lineId, sourceLine.id);
          importedItemsPayload.push(
            buildImportedEstimateItemInsert({
              sourceItem: sourceLine,
              itemId: lineId,
              tenantId,
              targetVersionId: targetVersion.id,
              parentId: existingTargetSectionId,
              position: allocateNextPosition(existingTargetSectionId),
            })
          );
          createdLineIds.push(lineId);
        });

        importedLinesCount += sourceLines.length;
        continue;
      }
    }

    const rootTitle =
      input.mode === "append"
        ? resolveImportedSectionTitle({
            sourceTitle: sourceRootTitle,
            usedTitleKeys: usedRootTitleKeys,
          })
        : sourceRootTitle;

    const importedSubtree = buildImportedSubtreePayload({
      subtree,
      tenantId,
      targetVersionId: targetVersion.id,
      rootPosition: allocateNextPosition(null),
      rootTitle,
    });

    importedItemsPayload.push(...importedSubtree.items);
    importedSubtree.new_id_by_source_id.forEach((newId, sourceId) => sourceIdByNewId.set(newId, sourceId));
    createdSectionIds.push(...importedSubtree.created_section_ids);
    createdLineIds.push(...importedSubtree.created_line_ids);
    importedLinesCount += importedSubtree.line_count;

    const createdRootSectionId = importedSubtree.created_section_ids[0];
    if (createdRootSectionId) {
      const rootTitleKey = normalizeSectionTitleKey(rootTitle);
      usedRootTitleKeys.add(rootTitleKey);
      if (!targetRootSectionIdByTitleKey.has(rootTitleKey)) {
        targetRootSectionIdByTitleKey.set(rootTitleKey, createdRootSectionId);
      }
    }
  }

  if (importedItemsPayload.length > 0 && targetIsV3) {
    const plan = planV3SectionCopy({
      payload: importedItemsPayload,
      sourceIdByNewId,
      sourceItemsById: sourceItemById,
      sourceIsV3,
      sameVersion: sourceVersion.id === targetVersion.id,
    });
    const committed = await commitV3Copy({ versionId: targetVersion.id, updatedAt: targetVersion.updated_at, plan,
      targetItems });
    return {
      source_version_id: sourceVersion.id,
      target_version_id: targetVersion.id,
      mode: input.mode,
      imported_sections_count: rootSelectedSectionIds.length,
      imported_lines_count: importedLinesCount,
      created_section_ids: createdSectionIds,
      created_line_ids: createdLineIds,
      converted_lines: plan.convertedLines,
      totals: committed.totals,
      version: { id: committed.version.id, updated_at: committed.version.updated_at },
    };
  }

  if (importedItemsPayload.length > 0) {
    await insertCopiedEstimateItems({
      supabase,
      versionId: targetVersion.id,
      draftLockSessionId: targetLock.session_id,
      items: importedItemsPayload,
      failureMessage: "Impossible d'importer les sections.",
    });
  }

  const recalculateResult =
    importedItemsPayload.length > 0
      ? await recalculateEstimateVersionTotals({
          supabase,
          tenantId,
          versionId: targetVersion.id,
        })
      : {
          totals: {
            total_ht_cents: targetVersion.total_ht_cents ?? 0,
            total_tax_cents: targetVersion.total_tax_cents ?? 0,
            total_ttc_cents: targetVersion.total_ttc_cents ?? 0,
          },
          version: await fetchEstimateVersionToken({
            supabase,
            tenantId,
            versionId: targetVersion.id,
          }),
        };

  return {
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    mode: input.mode,
    imported_sections_count: rootSelectedSectionIds.length,
    imported_lines_count: importedLinesCount,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function importLinkedDpgfSourceIntoVersion(
  versionId: string,
  input: ImportLinkedDpgfSourceInput
): Promise<ImportLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  const lock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const marginMultiplier =
    typeof version.margin_multiplier === "number"
      ? version.margin_multiplier
      : DEFAULT_MARGIN_MULTIPLIER;
  const taxRateBp =
    typeof version.tax_rate_bp === "number"
      ? version.tax_rate_bp
      : DEFAULT_TAX_RATE_BP;

  return importLinkedDpgfSourceIntoVersionInternal({
    supabase,
    tenantId,
    projectId: version.project_id,
    versionId,
    marginMultiplier,
    defaultTaxRateBp: taxRateBp,
    sectionTitle: input.section_title ?? null,
    // Sous-lot 2.8b (A5) : normalisé pour le moteur 3 aux coefficients du brouillon, jamais à ceux du classeur.
    ...(usesPerUnitLabor(resolveEstimateEngineVersion(version))
      ? { v3: { saleCoefficientFo: Number(version.sale_coefficient_fo), saleCoefficientMo: Number(version.sale_coefficient_mo),
          updatedAt: version.updated_at } }
      : {}),
    draftLockSessionId: lock.session_id,
  });
}

export async function createEstimateVariant(versionId: string) {
  return duplicateEstimateVersion(versionId, { as_variant: true });
}

export async function promoteEstimateVariant(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const variantLabel = toNullableText(version.variant_label);
  const parentVersionId = version.parent_version_id ?? null;

  if (!variantLabel || !parentVersionId) {
    throw badRequest(
      "Cette version n'est pas une variante.",
      undefined,
      "ESTIMATE_VARIANT_REQUIRED"
    );
  }

  assertDraftStatus(version.status);

  const promotionPayload = {
    parent_version_id: null,
    variant_label: null,
  } as EstimateVersionUpdate;

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(promotionPayload)
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de promouvoir la variante.");
    }
    throw badRequest("Impossible de promouvoir la variante.");
  }

  return {
    version: data,
  };
}

const DEFAULT_LABOR_ROLES_RETRY_DELAY_MS = 150;

/**
 * Seeds the owner's missing default labor roles. Every proposed labor_roles row,
 * even one an upsert would skip, try-locks the tenant calculation gate
 * exclusively and fails while any line, batch or settings save of the tenant
 * holds it: write only when a default is missing. A refused gate is retried
 * once from a fresh read; a residual refusal is a retryable 409.
 */
async function ensureDefaultLaborRoles(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}) {
  const defaultNames = DEFAULT_LABOR_ROLES.map((role) => role.name);
  for (let attempt = 1; ; attempt += 1) {
    const { data, error } = await input.supabase
      .from("labor_roles")
      .select("name")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.ownerUserId)
      .in("name", defaultNames);

    if (error) {
      throw mapSupabaseError(error, "Impossible de préparer les rôles MO par défaut.");
    }

    const existingNames = new Set((data ?? []).map((role) => role.name));
    const missingRoles = DEFAULT_LABOR_ROLES.filter((role) => !existingNames.has(role.name));
    if (missingRoles.length === 0) return;

    const payload: LaborRoleInsert[] = missingRoles.map((role) => ({
      tenant_id: input.tenantId,
      user_id: input.ownerUserId,
      name: role.name,
      hourly_rate_cents: role.hourly_rate_cents,
      is_active: true,
      position: role.position,
    }));
    const { error: insertError } = await input.supabase
      .from("labor_roles")
      .upsert(payload, {
        onConflict: "tenant_id,user_id,name",
        ignoreDuplicates: true,
      });

    if (!insertError) return;
    if (attempt === 1 && isCalculationContextConflict(insertError)) {
      await sleep(DEFAULT_LABOR_ROLES_RETRY_DELAY_MS);
      continue;
    }
    throw mapSupabaseError(insertError, "Impossible de préparer les rôles MO par défaut.");
  }
}

export async function createEstimate(
  input: CreateEstimateInput & { linked_import_id?: string | null }
) {
  const context = await getAuthenticatedContext();
  const { supabase, userId, tenantId } = context;
  const targetProjectId = input.project_id ?? null;
  const creationMode = input.creation_mode ?? "blank";
  const requestedCurrency = input.version?.currency;

  if (creationMode === "linked_dpgf_source" && !targetProjectId) {
    throw badRequest(
      "creation_mode=linked_dpgf_source requiert project_id."
    );
  }

  if (requestedCurrency !== undefined) {
    normalizeEstimateCurrencyOrThrow(requestedCurrency, {
      fallback: DEFAULT_CURRENCY,
    });
  }

  let existingProject: EstimateProjectRow | null = null;
  let latestProjectVersionDefaults: CreateEstimateLatestVersionDefaultsRow | null = null;

  if (targetProjectId) {
    const { data: projectData, error: existingProjectError } = await supabase
      .from("estimate_projects")
      .select("*")
      .eq("id", targetProjectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingProjectError) {
      throw mapSupabaseError(
        existingProjectError,
        "Impossible de charger le projet de chiffrage."
      );
    }

    if (
      !projectData ||
      projectData.is_archived ||
      !canAccessOwnerResource({
        context,
        resourceUserId: projectData.user_id,
      })
    ) {
      throw notFound("Projet de chiffrage introuvable.");
    }

    existingProject = projectData as EstimateProjectRow;

    const { data: latestVersionData, error: latestVersionError } = await supabase
      .from("estimate_versions")
      .select(
        "id, version_number, date_devis, validite_jours, margin_multiplier, margin_mode, currency, margin_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, max_section_depth"
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", existingProject.id)
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVersionError) {
      throw mapSupabaseError(
        latestVersionError,
        "Impossible de charger la version courante du projet."
      );
    }

    latestProjectVersionDefaults = (latestVersionData ??
      null) as CreateEstimateLatestVersionDefaultsRow | null;
  } else if (!input.project) {
    throw badRequest("project ou project_id est requis.");
  }

  const projectUserId = existingProject?.user_id ?? userId;
  const categoriesPayload: EstimateCategoryInsert[] = DEFAULT_ESTIMATE_CATEGORIES.map(
    (category) => ({
      tenant_id: tenantId,
      user_id: userId,
      name: category.name,
      position: category.position,
      color: null,
    })
  );

  const { error: categoriesError } = await supabase
    .from("estimate_categories")
    .upsert(categoriesPayload, {
      onConflict: "tenant_id,user_id,name",
      ignoreDuplicates: true,
    });

  if (categoriesError) {
    throw mapSupabaseError(categoriesError, "Impossible de préparer les catégories par défaut.");
  }

  await ensureDefaultLaborRoles({
    supabase,
    tenantId,
    ownerUserId: projectUserId,
  });

  let source: PersistCanonicalEstimateV2Input["source"] = {
    kind: "blank",
    importId: input.linked_import_id ?? null,
  };
  let linkedDpgfSaleCoefficients: ImportSaleCoefficients | null = null;
  if (creationMode === "linked_dpgf_source") {
    const projectId = targetProjectId!;
    const latestImport = await loadLatestLinkedDpgfImportForProject({
      supabase,
      tenantId,
      projectId,
    });
    if (!latestImport) {
      throw badRequest("Aucune source DPGF liée à cette affaire.");
    }
    // Revue 2.8b (IO14) : la source est lue en entier, par pages (PostgREST s'arrête à max_rows = 1000), pour toutes
    // les politiques depuis la lecture complète de main (33c7031b).
    const mappedRows = await loadMappedRowsForImportWithRetry({
      supabase,
      tenantId,
      importId: latestImport.id,
      maxAttempts: 10,
      retryDelayMs: 300,
    });
    if (mappedRows.length === 0) {
      throw badRequest(
        "La source DPGF liée ne contient aucune ligne mappee exploitable."
      );
    }
    // Sous-lot 2.10a (A3) : sous une politique 3, lignes normalisées pour le moteur 3 comme l'import de l'affaire
    // (unité du référentiel, PU du moteur 3), aux coefficients choisis dans l'assistant, sinon ceux de la politique.
    linkedDpgfSaleCoefficients = await resolveImportSaleCoefficients({
      supabase,
      tenantId,
      rows: mappedRows,
      requested: {
        fo: input.version?.sale_coefficient_fo,
        mo: input.version?.sale_coefficient_mo,
      },
    });
    const normalized = normalizeMappedRowsForEstimateCreation(mappedRows, {
      marginMultiplier:
        input.version?.margin_multiplier ??
        latestProjectVersionDefaults?.margin_multiplier ??
        DEFAULT_MARGIN_MULTIPLIER,
      defaultTaxRateBp:
        input.version?.tax_rate_bp ??
        latestProjectVersionDefaults?.tax_rate_bp ??
        DEFAULT_TAX_RATE_BP,
      entry: "direct",
      ...v3LineContext(linkedDpgfSaleCoefficients),
    });
    // No preview in the wizard's DPGF source mode (P-16, E17).
    if (importRequiresPreview(normalized)) {
      throw badRequest(IMPORT_PREVIEW_REQUIRED_MESSAGE);
    }
    if (normalized.validLines.length === 0) {
      throw badRequest(
        "Aucune ligne DPGF valide à importer depuis la source liée."
      );
    }
    const latestMapping = await loadLatestDpgfMappingForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    });
    source = {
      kind: "import",
      importId: latestImport.id,
      mappingId: latestMapping?.id ?? null,
      filename: latestImport.filename,
      sectionTitle: toNullableText(latestImport.filename)
        ? `Import DPGF - ${latestImport.filename}`
        : "Import DPGF",
      items: toRpcImportItems(normalized.validItems, {
        importId: latestImport.id,
        mappingId: latestMapping?.id ?? null,
      }),
      ...(linkedDpgfSaleCoefficients ? { engine: 3 } : {}),
    };
  }

  const normalizedCurrency =
    requestedCurrency === undefined
      ? undefined
      : normalizeEstimateCurrencyOrThrow(requestedCurrency, {
          fallback: DEFAULT_CURRENCY,
        });
  const { expected_calc_engine_version: expectedCalcEngineVersion, ...versionOverrides } = input.version ?? {};
  const persisted = await persistCanonicalEstimateV2({
    supabase,
    tenantId,
    actorUserId: userId,
    expectedCalcEngineVersion,
    project: targetProjectId
      ? { kind: "existing", id: targetProjectId }
      : {
          kind: "new",
          name: input.project!.name,
          reference: toNullableText(input.project!.reference),
          clientName: toNullableText(input.project!.client_name),
          notes: toNullableText(input.project!.notes),
        },
    version: {
      ...versionOverrides,
      ...(normalizedCurrency === undefined
        ? {}
        : { currency: normalizedCurrency }),
      // The coefficients that priced the linked DPGF lines (2.10a, A3).
      ...(linkedDpgfSaleCoefficients
        ? {
            sale_coefficient_fo: linkedDpgfSaleCoefficients.fo,
            sale_coefficient_mo: linkedDpgfSaleCoefficients.mo,
          }
        : {}),
    },
    source,
  });

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: latestProjectVersionDefaults?.id ?? null,
    targetVersionId: persisted.version.id,
  });

  return {
    project: persisted.project,
    version: persisted.version,
  };
}

export async function patchEstimateVersion(
  versionId: string,
  input: PatchEstimateVersionInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  // Comme patchEstimateStatus : l'ecriture passe par le client service-role et
  // contourne donc la RLS. getVersionAccessOrThrow n'autorise que proprietaire
  // OU admin, ce qui laisserait un proprietaire retrograde (director/viewer)
  // modifier marge, remise, coefficient et conditions d'un devis.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  const lock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  const expectedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  const sessionId = normalizeEstimateDraftLockSessionId(lock.session_id);
  if (!expectedUpdatedAt || !sessionId) {
    throw conflict("Un verrou actif de cette page est requis pour enregistrer le devis.", { lock: null }, "LOCK_REQUIRED");
  }
  if (!Number.isSafeInteger(input.expected_content_revision) || input.expected_content_revision < 0) {
    throw badRequest("La révision initiale du devis est requise.");
  }

  const payload: EstimateVersionUpdate = {};

  if ("title" in input) {
    payload.title = toNullableText(input.title);
  }
  if ("exclusions" in input) {
    payload.exclusions = toNullableText(input.exclusions);
  }
  if ("date_devis" in input) {
    payload.date_devis = input.date_devis;
  }
  if ("validite_jours" in input) {
    payload.validite_jours = input.validite_jours;
  }
  if ("margin_multiplier" in input) {
    payload.margin_multiplier = input.margin_multiplier;
  }
  if ("margin_mode" in input) {
    payload.margin_mode = input.margin_mode;
  }
  if ("currency" in input && typeof input.currency === "string") {
    payload.currency = normalizeEstimateCurrencyOrThrow(input.currency);
  }
  if ("margin_bp" in input) {
    payload.margin_bp = input.margin_bp;
  }
  if ("discount_bp" in input) {
    payload.discount_bp = input.discount_bp;
  }
  if ("discount_amount_cents" in input) {
    payload.discount_amount_cents = input.discount_amount_cents;
  }
  if ("discount_mode" in input) {
    payload.discount_mode = input.discount_mode;
  }
  if ("discount_steps" in input) {
    payload.discount_steps = input.discount_steps;
  }
  if ("global_coefficient" in input) {
    payload.global_coefficient = input.global_coefficient;
  }
  if ("tax_rate_bp" in input) {
    payload.tax_rate_bp = input.tax_rate_bp;
  }
  if ("contractor_role" in input) {
    payload.contractor_role = input.contractor_role;
  }
  if ("rounding_mode" in input) {
    payload.rounding_mode = input.rounding_mode;
  }
  if ("rounding_step_cents" in input) {
    payload.rounding_step_cents = input.rounding_step_cents;
  }
  if ("max_section_depth" in input) {
    payload.max_section_depth = clampMaxSectionDepth(
      input.max_section_depth,
      DEFAULT_MAX_SECTION_DEPTH
    );
  }
  // Lot 2, sous-lot 2.5 (D5, D8) : réglages v3, refusés par leur nom sur une v1/v2.
  if ("sale_coefficient_fo" in input) payload.sale_coefficient_fo = input.sale_coefficient_fo;
  if ("sale_coefficient_mo" in input) payload.sale_coefficient_mo = input.sale_coefficient_mo;
  return persistAtomicEstimateSettings({
    applyTaxRateToLines: input.apply_tax_rate_to_lines === true,
    supabase,
    rpcClient: getServiceRoleSupabaseClient(),
    tenantId,
    actorUserId: userId,
    projectUserId: project.user_id,
    authorizedVersion: version,
    expectedUpdatedAt,
    expectedContentRevision: input.expected_content_revision,
    draftLockSessionId: sessionId,
    patch: payload,
  });
}

export async function getEstimateSendGating(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  const gating = await evaluateEstimateSendGating({
    supabase,
    tenantId,
    version,
    project,
  });

  return {
    gating,
  };
}

export async function freezeEstimateV2SnapshotForSend(
  versionId: string,
  concurrencyToken: string,
  options: { draftLockSessionId?: string | null } = {}
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  const requestedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  if (!requestedUpdatedAt) throw badRequest("Le devis doit être relu avant l'envoi.");
  const draftLockSessionId = normalizeEstimateDraftLockSessionId(options.draftLockSessionId);
  if (!draftLockSessionId) {
    throw conflict("Cette page doit détenir le verrou du devis avant l'envoi.", undefined, "LOCK_REQUIRED");
  }
  assertDraftStatus(version.status);
  try {
    await assertDraftLockOwnedByCurrentUser({
      supabase,
      tenantId,
      versionId,
      userId,
      draftLockSessionId,
    });
  } catch (error) {
    if (
      error instanceof ApiError && error.code === "CONFLICT" &&
      typeof error.details === "object" && error.details !== null && "lock" in error.details
    ) {
      const lock = error.details.lock;
      if (typeof lock === "object" && lock !== null && "is_current_session" in lock && lock.is_current_session === false) {
        throw conflict(error.message, undefined, "LOCK_REQUIRED");
      }
    }
    throw error;
  }
  // Lot 2, sous-lot 2.7 : la v3 fige aussi son document (freeze_estimate_v3_document_snapshot).
  if (!engineFreezesSnapshot(resolveEstimateEngineVersion(version))) {
    return version;
  }
  return freezeEstimateV2Snapshot({
    supabase,
    rpcClient: getServiceRoleSupabaseClient(),
    tenantId,
    versionId,
    expectedUpdatedAt: requestedUpdatedAt,
    expectedContentRevision: version.content_revision,
    actorUserId: userId,
    purpose: "document",
    draftLockSessionId,
  });
}

export async function patchEstimateStatus(
  versionId: string,
  input: PatchEstimateStatusInput,
  concurrencyToken: string | undefined,
  options: { draftLockSessionId?: string | null } = {}
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  // Les transitions de statut sont des écritures de workflow : réservées aux
  // rôles écrivains (admin/engineer). getVersionAccessOrThrow n'autorise que
  // propriétaire OU admin, ce qui laisserait un propriétaire rétrogradé
  // (director/viewer) sceller/accepter/archiver via le client service-role.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  let { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  const requestedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  if (!requestedUpdatedAt) {
    throw badRequest("Jeton de concurrence manquant.");
  }
  const draftLockSessionId = normalizeEstimateDraftLockSessionId(options.draftLockSessionId);
  if (version.status === "draft") {
    await assertDraftLockOwnedByCurrentUser({
      supabase,
      tenantId,
      versionId,
      userId,
      draftLockSessionId,
    });
  }

  if (version.status === input.status) {
    const { data, error } = await supabase
      .from("estimate_versions")
      .select("*")
      .eq("id", versionId)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de charger la version.");
      }
      throw notFound("Version de chiffrage introuvable.");
    }

    return {
      version: data,
    };
  }

  assertEstimateStatusTransition(version.status, input.status);

  let sealHash: string | null = null;
  let emittedDocument: DocumentProof1 | null = null;
  let emissionPayloadVersion: number | null = null;
  let forcedByAdmin = false;
  let forcedBlockingFlags: string[] = [];
  let transitionExpectedUpdatedAt = requestedUpdatedAt;

  if (version.status === "draft" && input.status === "sent") {
    if (!draftLockSessionId) {
      throw conflict("Le verrou de cette page est requis pour émettre le devis.", undefined, "LOCK_REQUIRED");
    }
    if (input.force === true && !isTenantAdmin(context.tenantRole)) {
      throw forbidden(
        "Le forcage d'envoi est réservé aux administrateurs.",
        undefined,
        "FORCE_SEND_FORBIDDEN"
      );
    }

    // Lot 2, sous-lot 2.7 : une v3 fige son document comme une v2 (gel v3, bail de la page).
    if (engineFreezesSnapshot(resolveEstimateEngineVersion(version))) {
      const frozen = await freezeEstimateV2Snapshot({
        supabase,
        rpcClient: getServiceRoleSupabaseClient(),
        tenantId,
        versionId,
        expectedUpdatedAt: requestedUpdatedAt,
        expectedContentRevision: version.content_revision,
        actorUserId: userId,
        purpose: "document",
        draftLockSessionId,
      });
      transitionExpectedUpdatedAt = frozen.updated_at;
      ({ version, project } = await getVersionAccessOrThrow(
        supabase,
        versionId,
        context
      ));
    }

    const gating = await evaluateEstimateSendGating({
      supabase,
      tenantId,
      version,
      project,
    });

    if (gating.blockingFlags.length > 0 && input.force !== true) {
      throw badRequest(
        "Envoi bloque: des anomalies bloquantes doivent être corrigees avant validation.",
        {
          gating,
        },
        "ESTIMATE_GATING_BLOCKED"
      );
    }

    if (gating.blockingFlags.length > 0 && input.force === true) {
      forcedByAdmin = true;
      forcedBlockingFlags = gating.blockingFlags.map((flag) => flag.key);
    }

    await generateEstimatePdfNow(versionId, {
      force: true,
      triggeredBy: "send",
    });

    const offer = await loadVerifiedOfferDocument({
      supabase,
      tenantId,
      versionId,
      requireSealed: false,
    });
    // Contrat 1 (v1/v2) ou contrat 2 (v3) : l'appariement au moteur est prouvé par la relecture.
    if (offer.proof.clientContractVersion === null) {
      throw badRequest("La nouvelle émission exige une copie commerciale complète.", undefined, "OFFER_DOCUMENT_CONTRACT_INVALID");
    }
    sealHash = offer.sealHash;
    emittedDocument = offer.proof;
    emissionPayloadVersion = 5;
  } else {
    const offer = await loadVerifiedOfferDocument({ supabase, tenantId, versionId });
    emittedDocument = offer.proof;
    emissionPayloadVersion = offer.sealPayloadVersion;
  }

  const statusEventType = resolveStatusEventType(input.status);
  if (!statusEventType) {
    throw badRequest(
      `Transition de statut invalide: ${version.status} -> ${input.status}.`
    );
  }

  const statusEventMetadata: Record<string, unknown> = {};
  if (forcedByAdmin) {
    statusEventMetadata.forced_by_admin = true;
    statusEventMetadata.forced_blocking_flags = forcedBlockingFlags;
  }

  const data = await transitionEstimateVersionStatusAtomically({
    versionId,
    tenantId,
    expectedUpdatedAt: transitionExpectedUpdatedAt,
    nextStatus: input.status,
    sealHash,
    actorUserId: userId,
    eventMetadata: statusEventMetadata as Json,
    occurredAt: new Date().toISOString(),
    sealPayloadVersion: emissionPayloadVersion,
    expectedDocumentContract: emittedDocument,
    draftLockSessionId: version.status === "draft" ? draftLockSessionId : null,
  });

  return {
    version: data,
  };
}

/** Charge de calcul de chaque schéma historique retrouvé par la vérification. */
const SEAL_SCHEME_PAYLOAD_VERSIONS = { v4: 4, v3: 3, v2: 2, v1_split: 1, v1_pre_split: 1 } as const;

export async function verifyEstimateSeal(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  await getVersionAccessOrThrow(supabase, versionId, context);

  const sealSource = await loadEstimateSealSource({
    supabase,
    tenantId,
    versionId,
  });
  if (sealSource.version.seal_payload_version === 5) {
    // Marker5 never enters the historical candidate/fallback path. The helper
    // also verifies the actual immutable PDF, not just the calculation hash.
    const offer = await loadVerifiedOfferDocument({ supabase, tenantId, versionId });
    await logEstimateVersionEvent({
      versionId, eventType: "seal_verified", actorUserId: userId,
      metadata: { valid: true, computed_hash: offer.sealHash, stored_hash: offer.sealHash, matched_seal_scheme: "v5" },
      occurredAt: new Date().toISOString(),
    });
    // Lot 2, sous-lot 2.7 : le contrat (1 ou 2) et la charge de calcul (4 ou 6) du marqueur 5.
    return { valid: true, computed_hash: offer.sealHash, stored_hash: offer.sealHash, seal_payload_version: 5,
      client_contract_version: offer.proof.clientContractVersion, calc_payload_version: offer.calculationPayloadVersion };
  }
  // Lot 2, sous-lot 2.7 (D14) : une v3 n'a aucun candidat historique (marqueur 5 seulement) ;
  // l'empreinte rendue est celle de sa charge 6, pour diagnostic.
  if (usesSaleCoefficients(resolveEstimateEngineVersion(sealSource.version))) {
    const computedV3Hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource));
    const storedV3Hash = sealSource.version.seal_hash?.trim().toLowerCase() || null;
    await logEstimateVersionEvent({
      versionId, eventType: "seal_verified", actorUserId: userId,
      metadata: { valid: false, computed_hash: computedV3Hash, stored_hash: storedV3Hash, matched_seal_scheme: null },
      occurredAt: new Date().toISOString(),
    });
    return { valid: false, computed_hash: computedV3Hash, stored_hash: storedV3Hash,
      seal_payload_version: sealSource.version.seal_payload_version ?? null, client_contract_version: null, calc_payload_version: null };
  }
  const currentSealCandidate = {
    scheme: "v4" as const,
    hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource)),
  };
  const previousSealCandidate = {
    scheme: "v2" as const,
    hash: computeEstimateSealHash(
      buildCanonicalEstimateSealPayload(sealSource, {
        payloadVersion: PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION,
      })
    ),
  };
  const unifiedSealCandidate = {
    scheme: "v3" as const,
    hash: computeEstimateSealHash(
      buildCanonicalEstimateSealPayload(sealSource, {
        payloadVersion: UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION,
      })
    ),
  };
  const legacySealCandidates = [
    {
      scheme: "v1_split" as const,
      hash: computeEstimateSealHash(
        buildCanonicalEstimateSealPayload(sealSource, {
          payloadVersion: LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
          includeCalcEngineVersion: false,
        })
      ),
    },
    {
      scheme: "v1_pre_split" as const,
      hash: computeEstimateSealHash(
        buildCanonicalEstimateSealPayload(sealSource, {
          payloadVersion: LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION,
          includeLaborSplit: false,
          includeCalcEngineVersion: false,
        })
      ),
    },
  ];
  // Les nouveaux sceaux engine v2 couvrent aussi la nature de ligne et
  // l'arrondi commercial explicite en v4. Les candidats v3/v2 conservent la
  // compatibilite des sceaux emis avant ce contrat.
  const sealCandidates =
    isUnifiedEngine(requireHistoricalEngine(resolveEstimateEngineVersion(sealSource.version)))
      ? [currentSealCandidate, unifiedSealCandidate, previousSealCandidate]
      : [previousSealCandidate, ...legacySealCandidates];
  const storedHash = sealSource.version.seal_hash?.trim().toLowerCase() || null;
  const matchedCandidate =
    storedHash === null
      ? null
      : sealCandidates.find((candidate) => candidate.hash === storedHash) ?? null;
  const isValid = matchedCandidate !== null;
  // Pour un sceau historique valide, restituer le hash effectivement comparé
  // conserve le contrat existant de l'API. Pour un échec, le hash v2 courant
  // reste le diagnostic de référence.
  const computedHash = matchedCandidate?.hash ?? sealCandidates[0].hash;

  await logEstimateVersionEvent({
    versionId,
    eventType: "seal_verified",
    actorUserId: userId,
    metadata: {
      valid: isValid,
      computed_hash: computedHash,
      stored_hash: storedHash,
      matched_seal_scheme: matchedCandidate?.scheme ?? null,
    },
    occurredAt: new Date().toISOString(),
  });

  return {
    valid: isValid,
    computed_hash: computedHash,
    stored_hash: storedHash,
    seal_payload_version: sealSource.version.seal_payload_version ?? null,
    client_contract_version: null,
    calc_payload_version: matchedCandidate ? SEAL_SCHEME_PAYLOAD_VERSIONS[matchedCandidate.scheme] : null,
  };
}

export async function bulkUpdateEstimateItems(
  versionId: string,
  input: BulkUpdateEstimateItemsInput,
  concurrencyToken?: string,
  versionPatch?: BulkUpdateEstimateVersionPatchInput
) {
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
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  // Nothing to write: the checks above are the whole call (the takeoff apply uses it
  // as its lock check), so it answers before resolving the engine, v3 included.
  if (input.length === 0 && !versionPatch) {
    return {
      updated_count: 0,
      version: {
        id: version.id,
        updated_at: version.updated_at,
      },
    };
  }

  // A structural mutation can commit before the editor refreshes its rows.
  // Reconcile v2 totals from those persisted rows, never its stale footer.
  const shouldProjectDraft = isUnifiedEngine(resolveCalcEngineVersion(version)) &&
    (version.margin_mode === "tiered" || versionPatch !== undefined);
  if (versionPatch && !shouldProjectDraft) {
    const persistedTotals: EstimateTotals = {
      total_ht_cents: version.total_ht_cents ?? null,
      total_tax_cents: version.total_tax_cents ?? null,
      total_ttc_cents: version.total_ttc_cents ?? null,
    };

    await assertEstimateTotalsInvariantForPatch({
      supabase,
      tenantId,
      versionId,
      userId,
      persistedTotals,
      patch: versionPatch,
    });
  }

  const updatesPayload = input.map((item) => ({ ...item }));
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });

  updatesPayload.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(item, "aid")) {
      return;
    }

    const nextAid = normalizeEstimateItemAid(
      (item as { aid?: string | null }).aid ?? null
    );
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
    (item as { aid?: string | null }).aid = nextAid;
  });

  const supplierPriceIdsToValidate = new Set<string | null>();
  const productIdsToValidate = new Set<string | null>();
  updatesPayload.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(item, "product_id")) {
      productIdsToValidate.add(item.product_id ?? null);
    }

    if (!Object.prototype.hasOwnProperty.call(item, "selected_supplier_price_id")) {
      return;
    }

    supplierPriceIdsToValidate.add(item.selected_supplier_price_id ?? null);
  });

  await Promise.all(
    [
      ...Array.from(productIdsToValidate).map((productId) =>
        ensureProductIsValid(supabase, productId, context)
      ),
      ...Array.from(supplierPriceIdsToValidate).map((supplierPriceId) =>
        ensureSupplierPriceIsValid(supabase, supplierPriceId, context)
      ),
    ]
  );

  const projection = shouldProjectDraft
    ? await projectDraftMutation({
        context,
        versionId,
        expectedUpdatedAt: version.updated_at,
        projectUserId: project.user_id,
        updates: updatesPayload,
      })
    : null;

  const { data: rpcUpdatedCount, error: bulkUpdateError } = await supabase.rpc(
    "bulk_update_estimate_items",
    {
      target_version_id: versionId,
      item_updates: (projection?.updates ?? updatesPayload) as Json,
      version_patch: projection?.versionPatch ?? versionPatch ?? null,
      expected_version_updated_at: version.updated_at,
    }
  );

  if (bulkUpdateError) {
    if (
      bulkUpdateError.code === "P0001" &&
      bulkUpdateError.message === STALE_BULK_UPDATE_ERROR_MESSAGE
    ) {
      const parsedDetails = parseBulkUpdateCountDetails(bulkUpdateError.details);
      throw conflict(
        "La liste de mise à jour est obsolete.",
        parsedDetails ?? {
          expected_count: projection?.updates.length ?? input.length,
        }
      );
    }

    throw mapSupabaseError(
      bulkUpdateError,
      "Impossible de mettre à jour les lignes."
    );
  }

  if (projection) {
    // Read the token and totals together: another committed mutation must not
    // pair its newer token with the totals calculated before this RPC.
    const { data: savedVersion, error: savedVersionError } = await supabase
      .from("estimate_versions")
      .select("id, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents")
      .eq("tenant_id", tenantId)
      .eq("id", versionId)
      .single();
    if (savedVersionError || !savedVersion) {
      throw mapSupabaseError(savedVersionError, "Impossible de relire les totaux sauvegardés.");
    }
    return {
      updated_count: rpcUpdatedCount ?? 0,
      version: { id: savedVersion.id, updated_at: savedVersion.updated_at },
      totals: {
        total_ht_cents: savedVersion.total_ht_cents,
        total_tax_cents: savedVersion.total_tax_cents,
        total_ttc_cents: savedVersion.total_ttc_cents,
      },
    };
  }

  return {
    updated_count: rpcUpdatedCount ?? 0,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId }),
  };
}

export async function claimEstimateBatchRevision(
  versionId: string,
  concurrencyToken: string | undefined
) {
  const normalizedToken = normalizeConcurrencyToken(concurrencyToken);
  if (!normalizedToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }
  if (!Number.isFinite(new Date(normalizedToken).getTime())) {
    throw badRequest("Jeton de concurrence invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "claim_estimate_batch_revision" as never,
    {
      p_version_id: versionId,
      p_expected_updated_at: normalizedToken,
    } as never
  );

  if (error) {
    if (
      error.code === "40001" ||
      error.message.includes("ESTIMATE_BATCH_REVISION_CONFLICT")
    ) {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: normalizedToken,
      }, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(
      error,
      "Impossible de réserver la révision du traitement par lot."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: normalizedToken,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as { id: string; updated_at: string };
}
