import { NewEstimatePage } from "@/components/estimates/NewEstimatePage";
import { fetchAffaireProjectBasic } from "@/lib/affaires/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";

type NewEstimateRoutePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Lot 2, sous-lot 2.10a (N1) : enveloppe serveur de l'assistant. Elle lit la politique de calcul de l'entreprise
 * active et transmet son moteur et ses coefficients par défaut : chaque création de l'assistant les déclare comme
 * attente (D3). Une politique changée après ce rendu donne CONTEXT_CHANGED, et recharger la page relit la
 * nouvelle politique.
 */
export default async function NewEstimateRoutePage({ searchParams }: Readonly<NewEstimateRoutePageProps>) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const projectIdValue = resolvedSearchParams.projectId;
  const projectId = (Array.isArray(projectIdValue) ? projectIdValue[0] : projectIdValue) || undefined;
  const { supabase, tenantId } = await getAuthenticatedContext();
  const [policy, project] = await Promise.all([
    readTenantCalcPolicy(supabase, tenantId),
    // The breadcrumb names the affaire; one that cannot be read keeps the generic label.
    projectId ? fetchAffaireProjectBasic(projectId).catch(() => null) : null,
  ]);

  return (
    <NewEstimatePage
      projectId={projectId}
      projectName={project?.name ?? null}
      creationEngine={{
        engine: policy.engine,
        saleCoefficientFo: policy.defaultSaleCoefficientFo,
        saleCoefficientMo: policy.defaultSaleCoefficientMo,
      }}
    />
  );
}
