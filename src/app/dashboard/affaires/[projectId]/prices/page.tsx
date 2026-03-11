import { notFound } from "next/navigation";

import { PricesManager } from "@/components/catalogue/PricesManager";
import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireProjectBasic } from "@/lib/affaires/server";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AffairePricesPage({ params }: Props) {
  const [{ projectId }, { tenantId }] = await Promise.all([
    params,
    getUserContext(),
  ]);

  if (!tenantId) {
    notFound();
  }

  const projectResult = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
  ]);
  const [projectSettled] = projectResult;

  if (projectSettled.status === "rejected") {
    const error = projectSettled.reason as unknown;
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "NOT_FOUND"
    ) {
      notFound();
    }

    throw error;
  }

  const project = projectSettled.value;

  return (
    <>
      <HubBreadcrumb
        hubHref="/dashboard/affaires"
        hubLabel="Mes affaires"
        intermediateHref={`/dashboard/affaires/${projectId}`}
        intermediateLabel={project.name}
        currentLabel="Prix fournisseurs"
      />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--slate-900)]">
          Prix fournisseurs
        </h1>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Importez un bordereau CSV fournisseur dans le pipeline canonique de
          cette affaire, puis reutilisez ces prix dans le chiffrage.
        </p>
      </div>

      <PricesManager projectId={projectId} embedded />
    </>
  );
}
