import { notFound } from "next/navigation";

import { PricesManager } from "@/components/catalogue/PricesManager";
import { PageHeader } from "@/components/layout/page-header";
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
      <PageHeader
        title="Prix fournisseurs"
        description="Importez un bordereau CSV fournisseur dans le pipeline canonique de cette affaire, puis réutilisez ces prix dans le chiffrage."
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Prix fournisseurs" },
        ]}
      />

      <PricesManager embedded />
    </>
  );
}
