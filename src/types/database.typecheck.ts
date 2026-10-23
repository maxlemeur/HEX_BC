import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database";

type Rule = Database["public"]["Tables"]["estimate_rules"]["Row"];
type Draft = Database["public"]["Tables"]["estimate_generated_ouvrage_drafts"]["Row"];

// Compiler regression only; this function never executes or sends a query.
// These real consumers previously needed an untyped client or `as never`.
export async function checkDatabaseContracts(client: SupabaseClient<Database>, rule: Rule, draft: Draft) {
  const threshold: number = rule.threshold_value;
  const sourceKind: string = draft.source_kind;
  const rules = await client.from("estimate_rules").select("id, threshold_value");
  const drafts = await client.from("estimate_generated_ouvrage_drafts").select("id, source_kind");
  client.from("estimate_rules").update({ threshold_value: threshold }).eq("id", rule.id);
  client.from("estimate_generated_ouvrage_drafts").update({ generation_metadata: {} }).eq("id", draft.id);

  // Both SQL overloads accept a root target; the second keeps its token field.
  client.rpc("apply_takeoff_job_guarded_atomic", {
    p_job_id: draft.id,
    p_mapping_plan: {},
    p_strategy: "append",
    p_target_section_id: null,
  });
  client.rpc("apply_takeoff_job_guarded_atomic", {
    p_job_id: draft.id,
    p_mapping_plan: {},
    p_strategy: "append",
    p_target_section_id: null,
    p_dpgf_authorization_token: null,
  });
  client.rpc("replace_purchase_order_draft", {
    p_order_id: draft.id,
    p_header_patch: {},
    p_items: null,
    p_expected_revision: 1,
  });
  const approvalSummary: Database["public"]["Functions"]["patch_estimate_contractor_role"]["Returns"]["approval_summary"] = null;
  const frozenApprovalSummary: Database["public"]["Functions"]["freeze_estimate_v3_snapshot"]["Returns"]["approval_summary"] = null;

  // @ts-expect-error A misspelled SQL column must never become an accepted write.
  client.from("estimate_rules").update({ threshold_cents: 100 });
  // @ts-expect-error SQL numeric values cannot be supplied as arbitrary text.
  client.from("estimate_rules").update({ threshold_value: "invalid" });
  // @ts-expect-error An unknown table must remain rejected.
  client.from("estimate_generated_ouvrage_draft_typo");
  // @ts-expect-error The RPC limit is a number, not a string.
  client.rpc("list_due_estimate_email_dispatches", { p_limit: "25" });
  // @ts-expect-error Read compatibility must not relax generated write constraints.
  client.from("estimate_versions").update({ approval_summary: null });

  return { rules: rules.data, drafts: drafts.data, threshold, sourceKind, approvalSummary, frozenApprovalSummary };
}
