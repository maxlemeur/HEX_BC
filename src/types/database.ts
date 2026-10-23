import type { Database as GeneratedDatabase, Json } from "./database.generated";

export type { Json } from "./database.generated";

type PublicSchema = GeneratedDatabase["public"];
type GeneratedTables = PublicSchema["Tables"];
type GeneratedFunctions = PublicSchema["Functions"];

// PostgreSQL CHECK constraints over text are not emitted as unions by the CLI.
// Keep the established domain refinements separate from the generated schema.
type CheckedColumnSpec<T extends {
  [K in keyof T]: K extends keyof GeneratedTables
    ? { [C in keyof T[K]]: C extends keyof GeneratedTables[K]["Row"] ? GeneratedTables[K]["Row"][C] : never }
    : never;
}> = T;
type CheckedColumns = CheckedColumnSpec<{
  profiles: { ui_mode: "simplified" | "expert" };
  procurement_storage_cleanup_outbox: { bucket_id: "devis" };
  supplier_pricebook: { transport_mode: "included" | "excluded" | null; zero_price_kind: "included" | "free" | null; purchase_rounding: "none" | "ceil" | null };
  product_reference_price_validations: { mode: "average" | "manual" };
  estimate_version_zero_lots: { status: "generated" | "partial" | "missing" };
  estimate_version_zero_lines: { review_status: "pending" | "accepted" | "edited" | "rejected" };
  estimate_terms_templates: { policy: "optional" | "default" | "required" };
  estimate_documents: { status: "processing" | "ready" | "failed"; generation_purpose: "manual" | "email" | "workflow" | null; published_purpose: "legacy" | "manual" | "email" | "workflow" | null };
  currency_rates: { source: "manual" | "api" };
  suggestion_learning_reviews: { status: "approved" | "rejected"; field_name: "description" | "category_id" | "k_fo" | "k_mo" | "labor_role_id" | "supply_type_id" };
  estimate_assembly_items: { cost_type: "material" | "labor" | "equipment" | "subcontract" };
  takeoff_price_suggestions: { status: "pending" | "applied" | "kept_current" | "rejected"; confidence_label: "low" | "medium" | "high"; selected_action: "apply_low" | "apply_target" | "apply_high" | "keep_current" | "reject" | null };
  estimate_version_zero_drafts: { status: "ia_a_revoir" | "ready_for_version" | "materialized" | "discarded" | "superseded" };
  measurement_units: { dimension: "count" | "set" | "lump_sum" | "length" | "area" | "volume" | "mass" | "time" | "inch" };
  suggestion_corrections: { field_name: "description" | "category_id" | "k_fo" | "k_mo" | "labor_role_id" | "supply_type_id" };
}>;

// A SQL function argument has no NOT NULL catalog attribute. These existing
// call contracts accept explicit null (defaults, clear operations or conditional
// branches); required argument names and all non-null value types stay generated.
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type NullableArgumentSpec<T extends {
  [K in keyof T]: K extends keyof GeneratedFunctions ? KeysOfUnion<GeneratedFunctions[K]["Args"]> : never;
}> = T;
type NullableArguments = NullableArgumentSpec<{
  get_estimate_source_coverage: "p_requirement_id" | "p_after_id" | "p_before_event" | "p_operation_key";
  get_estimate_source_coverage_targets: "p_after_id";
  get_estimate_source_review: "p_copy_id" | "p_before_revision" | "p_confirmation_key";
  create_estimate_purchase_order_drafts: "p_groups";
  replace_purchase_order_draft: "p_items";
  claim_procurement_storage_cleanup: "p_tenant_id";
  catalogue_products_page: "p_q";
  price_lookup_options: "p_q" | "p_selected_id";
  persist_estimate_creation_atomic: "p_project_id" | "p_project_payload" | "p_import_id";
  set_tenant_calc_policy: "p_default_sale_coefficient_fo" | "p_default_sale_coefficient_mo" | "p_allowed_tax_rates_bp";
  open_estimate_review_cycle: "p_submission_message";
  supplier_prices_page: "p_q" | "p_product_id" | "p_supplier_id";
  supplier_prices_summary: "p_product_id" | "p_supplier_id";
  update_supplier_catalog_item: "p_supplier_sku" | "p_product_url";
  commit_estimate_batch: "p_draft_lock_session_id";
  persist_generated_ouvrage_review: "p_expected_review_token";
  commit_generated_ouvrages: "p_draft_lock_session_id";
  reject_generated_ouvrage_candidate: "p_reason";
  get_affaires_counters: "p_owner_user_id" | "p_search" | "p_statuses" | "p_favorites_only";
  begin_estimate_pdf_generation: "p_dispatch_id";
  publish_estimate_pdf_generation: "p_terms_snapshot";
  reserve_estimate_email_dispatch: "p_cc";
  reserve_estimate_email_dispatch_with_session: "p_cc" | "p_draft_lock_session_id";
  fail_estimate_email_dispatch: "p_lease_token";
  reconcile_estimate_email_dispatch: "p_provider_id" | "p_note";
  create_affaire_from_import_lines: "p_project_client" | "p_project_reference" | "p_version_title" | "p_section_title" | "p_lines";
  create_estimate_template_from_version: "p_description";
  create_estimate_version_from_import_lines: "p_version_title" | "p_section_title";
  instantiate_estimate_from_template: "p_version_title" | "p_date_devis" | "p_validite_jours";
  instantiate_estimate_template_into_project: "p_version_title" | "p_date_devis" | "p_validite_jours";
  insert_estimate_template_with_receipt: "p_after_item_id";
  insert_estimate_assembly_with_receipt: "p_after_item_id";
  insert_estimate_assembly_into_version: "p_after_item_id";
  log_estimate_version_event: "p_created_by";
  move_estimate_item: "source_parent_id" | "target_parent_id";
  reorder_estimate_items: "target_parent_id";
  list_affaires_page: "p_owner_user_id" | "p_search" | "p_statuses" | "p_cursor_updated_at" | "p_cursor_name" | "p_cursor_total_ht_cents" | "p_cursor_project_id" | "p_sort_by" | "p_sort_dir" | "p_favorites_only";
  get_chiffreur_analytics_kpis: "p_owner_user_id";
  list_chiffreur_analytics_trend: "p_owner_user_id";
  claim_portal_estimate_decision: "p_client_ip" | "p_reject_reason";
  finish_affaire_intake_upload_attempt: "p_next_retry_at" | "p_last_error";
  persist_takeoff_provider_batch_snapshot: "p_provider_batch_id" | "p_provider_batch_state" | "p_provider_batch_updated_at" | "p_provider_state_raw" | "p_message";
  persist_takeoff_provider_batch_snapshot_fenced: "p_provider_batch_id" | "p_provider_batch_state" | "p_provider_batch_updated_at" | "p_provider_state_raw" | "p_message" | "p_processing_lease_token" | "p_provider_reconcile_lease_token";
  record_estimate_review_correction_action: "p_note";
  record_takeoff_dispatch_outcome: "p_status_code";
  save_takeoff_dpgf_manual_links: "p_linked_by";
  apply_takeoff_job_guarded_atomic: "p_target_section_id" | "p_dpgf_authorization_token";
  transition_estimate_draft_to_sent: "p_seal_hash";
  transition_estimate_version_status: "p_seal_hash";
  update_affaire_register_entry_with_event: "p_reason" | "p_before_payload" | "p_after_payload" | "p_actor_user_id";
}>;

type RefineColumns<Row, Overrides> = {
  [K in keyof Row]: K extends keyof Overrides ? Overrides[K] : Row[K];
};

// A NOT NULL jsonb column can still contain the JSON value `null`. Keep that
// read value distinct from SQL NULL; Insert/Update retain the CLI's constraints.
type JsonReadColumns<Row> = {
  [K in keyof Row]: NonNullable<Json> extends Row[K] ? Json : Row[K];
};

type JsonReadResult<Result> = NonNullable<Json> extends Result ? Json
  : Result extends (infer Row)[] ? JsonReadColumns<Row>[]
  : Result extends object ? JsonReadColumns<Result> : Result;

type NullableRpcArgs<Args, Names> = Args extends unknown ? {
  [K in keyof Args]: K extends Names ? Args[K] | null : Args[K];
} : never;

// Distribute across overloads so their own arguments and result metadata survive.
type RefineRpc<Rpc, NullableNames> = Rpc extends { Args: infer Args; Returns: infer Result }
  ? Omit<Rpc, "Args" | "Returns"> & { Args: NullableRpcArgs<Args, NullableNames>; Returns: JsonReadResult<Result> }
  : Rpc;

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<PublicSchema, "Tables" | "Functions"> & {
    Tables: {
      [K in keyof GeneratedTables]: K extends keyof CheckedColumns
        ? Omit<GeneratedTables[K], "Row" | "Insert" | "Update"> & {
          Row: JsonReadColumns<RefineColumns<GeneratedTables[K]["Row"], CheckedColumns[K]>>;
          Insert: RefineColumns<GeneratedTables[K]["Insert"], CheckedColumns[K]>;
          Update: RefineColumns<GeneratedTables[K]["Update"], CheckedColumns[K]>;
        }
        : Omit<GeneratedTables[K], "Row"> & { Row: JsonReadColumns<GeneratedTables[K]["Row"]> };
    };
    Functions: {
      [K in keyof GeneratedFunctions]: RefineRpc<GeneratedFunctions[K], K extends keyof NullableArguments ? NullableArguments[K] : never>;
    };
  };
};

export type EstimatePurchaseReceipt = {
  source_version_id: string;
  idempotency_key: string;
  replayed: boolean;
  summary: { draft_orders_created: number; draft_lines_created: number };
  orders: Array<{
    purchase_order_id: string;
    reference: string;
    supplier_id: string;
    supplier_name: string;
    delivery_site_id: string;
    item_count: number;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    ordered_source_item_ids: string[];
    current_status: "draft" | "sent" | "confirmed" | "received" | "canceled" | "deleted";
    can_open: boolean;
  }>;
};
