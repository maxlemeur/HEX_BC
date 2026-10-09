import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError, conflict, forbidden, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  referencePriceProposalSchema, referencePriceResponseSchema,
  type ReferencePriceAction, type ReferencePriceQuery,
} from "@/lib/catalogue/reference-price-schemas";

function referencePriceError(error: { code: string; message: string }) {
  if (error.code === "PGRST202" || error.code === "42703" || error.code === "42P01") {
    return new ApiError({ status: 503, code: "REFERENCE_PRICE_NOT_READY",
      message: "Le calcul des prix de référence n’est pas encore activé sur cette base." });
  }
  if (error.message?.includes("REFERENCE_PRICE_PROPOSAL_CHANGED")) {
    return conflict("Les offres ou le produit ont changé. Actualisez la proposition avant de valider.");
  }
  if (error.message?.includes("PRODUCT_NOT_FOUND")) return notFound("Produit introuvable.");
  return mapSupabaseError(error, "Impossible de traiter le prix de référence.");
}

export async function getReferencePriceProposal(input: ReferencePriceQuery) {
  const { supabase, isTenantAdmin, tenantId } = await getAuthenticatedTenantContext();
  const { data, error } = await supabase.rpc("product_reference_price_proposal", {
    p_product_id: input.product_id,
    p_quantity: input.quantity,
    p_transport_mode: input.transport_mode,
  });
  if (error) throw referencePriceError(error);
  const proposal = referencePriceProposalSchema.parse(data);
  let latestValidation = null;
  if (proposal.validation_id) {
    const result = await supabase.from("product_reference_price_validations")
      .select("id, mode, validated_by, validated_at, unit_price_cents, justification")
      .eq("id", proposal.validation_id).eq("tenant_id", tenantId).eq("product_id", input.product_id).maybeSingle();
    if (result.error) throw referencePriceError(result.error);
    latestValidation = result.data;
  }
  return referencePriceResponseSchema.parse({ proposal, can_validate: isTenantAdmin, latest_validation: latestValidation });
}

export async function actOnReferencePrice(input: ReferencePriceAction) {
  const { supabase, isTenantAdmin, tenantId } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) throw forbidden("Seul un responsable autorisé peut valider un prix ou préciser ses conditions.");

  if (input.action === "set-transport") {
    const { data, error } = await supabase.from("supplier_pricebook")
      .update({ transport_mode: input.transport_mode })
      .eq("id", input.offer_id).eq("tenant_id", tenantId).eq("product_id", input.product_id)
      .eq("updated_at", input.expected_updated_at).select("id").maybeSingle();
    if (error) throw referencePriceError(error);
    if (!data) throw conflict("Cette offre a changé ou n’est plus accessible. Actualisez la proposition.");
    return { offer_id: data.id };
  }

  const { data, error } = await supabase.rpc("validate_product_reference_price", {
    p_product_id: input.product_id, p_quantity: input.quantity,
    p_transport_mode: input.transport_mode, p_fingerprint: input.fingerprint,
    p_manual_price_cents: input.manual_price_cents, p_justification: input.justification,
  });
  if (error) throw referencePriceError(error);
  return data;
}
