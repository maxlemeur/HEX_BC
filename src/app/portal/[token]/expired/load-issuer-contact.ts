import type { PortalIssuerContact } from "@/components/portal/PortalContactBlock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UX67 : coordonnées de l'émetteur d'un devis dont le lien a expiré ou a été
 * révoqué. Lecture seule, limitée au jeton validé (organisation active) et aux
 * seuls champs de contact — les mêmes que ceux du devis affiché sur le portail
 * (`estimate_documents.generated_by`, à défaut le propriétaire de l'affaire).
 * Toute erreur retombe sur `null` : la page d'expiration ne doit jamais échouer.
 */
export async function loadExpiredPortalIssuerContact(
  token: string
): Promise<PortalIssuerContact | null> {
  if (!UUID_PATTERN.test(token)) return null;

  try {
    const supabase = createServiceRoleClient();

    const { data: portalToken, error: tokenError } = await supabase
      .from("portal_tokens")
      .select("tenant_id, version_id, tenants!inner(is_active)")
      .eq("token", token)
      .eq("tenants.is_active", true)
      .maybeSingle();
    if (tokenError || !portalToken) return null;

    const { data: document } = await supabase
      .from("estimate_documents")
      .select("generated_by")
      .eq("version_id", portalToken.version_id)
      .eq("tenant_id", portalToken.tenant_id)
      .maybeSingle();

    let issuerUserId: string | null = document?.generated_by ?? null;

    if (!issuerUserId) {
      const { data: version } = await supabase
        .from("estimate_versions")
        .select("estimate_projects ( user_id )")
        .eq("id", portalToken.version_id)
        .eq("tenant_id", portalToken.tenant_id)
        .maybeSingle();
      const project = Array.isArray(version?.estimate_projects)
        ? version.estimate_projects[0]
        : version?.estimate_projects;
      issuerUserId = project?.user_id ?? null;
    }

    if (!issuerUserId) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, job_title, phone, work_email")
      .eq("id", issuerUserId)
      .maybeSingle();
    if (!profile) return null;

    return {
      fullName: profile.full_name ?? null,
      jobTitle: profile.job_title ?? null,
      phone: profile.phone ?? null,
      email: profile.work_email ?? null,
    };
  } catch {
    return null;
  }
}
