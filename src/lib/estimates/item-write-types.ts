import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Supabase = SupabaseClient<Database>;

export type EstimateItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"] & {
  h_mo_majoration?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
export type EstimateItemUpdate = Database["public"]["Tables"]["estimate_items"]["Update"] & {
  h_mo_majoration?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
