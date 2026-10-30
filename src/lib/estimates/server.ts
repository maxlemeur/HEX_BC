/** Compatibility entry point. Operations depend on domain modules, never on this facade. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EstimateVersionRow } from "@/lib/estimates/version-list-server";

export { listEstimateImportSources, listEstimateImportSections } from "@/lib/estimates/section-copy-read-server";

export { duplicateSection, duplicateSectionFromVersion, importSectionsFromVersion } from "@/lib/estimates/section-copy-server";

export { getAffaireLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-read-server";

export { importLinkedDpgfSourceIntoVersion } from "@/lib/estimates/linked-dpgf-import-server";

export type { EstimateImportSourceVersionItem, ListEstimateImportSourcesResult, EstimateImportSectionPreviewItem, ListEstimateImportSectionsResult, ImportEstimateSectionsResult } from "@/lib/estimates/section-copy-contracts";

export type { AffaireLinkedDpgfSourceResult, ImportLinkedDpgfSourceResult } from "@/lib/estimates/linked-dpgf-contracts";

export { normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";

export { createEstimateItem } from "@/lib/estimates/item-create-server";

export { updateEstimateItem } from "@/lib/estimates/item-update-server";

export { deleteEstimateItem, reorderEstimateItems, moveEstimateItem } from "@/lib/estimates/item-structure-server";

export {
  getEstimateVersionDetails,
  type EstimateItemRow,
  listEstimateItems,
  listEstimateItemRows,
  listEstimateVersionEvents,
  type EstimateVersionEvent,
} from "./version-read-server";

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

export {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
} from "./estimate-seal";

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

export type Supabase = SupabaseClient<Database>;

export type EstimateCategoryInsert = Database["public"]["Tables"]["estimate_categories"]["Insert"];

export type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];

export type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];

export type MarginTierInsert = Database["public"]["Tables"]["margin_tiers"]["Insert"];

export type MarginTierUpdate = Database["public"]["Tables"]["margin_tiers"]["Update"];

export type SuggestionRuleInsert =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"];

export type SuggestionRuleUpdate =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"];

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

export {
  createEstimate,
} from "@/lib/estimates/version-creation-server";
export {
  duplicateEstimateVersion,
  createEstimateVariant,
  promoteEstimateVariant,
} from "@/lib/estimates/version-variant-server";
export { patchEstimateVersion } from "@/lib/estimates/version-settings-server";
export { bulkUpdateEstimateItems } from "@/lib/estimates/item-bulk-server";
export { claimEstimateBatchRevision } from "@/lib/estimates/version-batch-revision-server";
export {
  getEstimateSendGating,
  freezeEstimateV2SnapshotForSend,
  patchEstimateStatus,
} from "@/lib/estimates/version-lifecycle-server";
export { loadEstimateSealSource } from "@/lib/estimates/version-lifecycle-repository";
export { verifyEstimateSeal } from "@/lib/estimates/version-seal-server";
