"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { EstimateCreationWizard } from "@/components/estimates/EstimateCreationWizard";

export default function NewEstimatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;

  function handleCreated(versionId: string) {
    router.push(`/dashboard/estimates/${versionId}/edit`);
    router.refresh();
  }

  const isExistingProject = Boolean(projectId);

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">
            {isExistingProject ? "Nouvelle version" : "Nouveau chiffrage"}
          </h1>
          <p className="page-description">
            {isExistingProject
              ? "Ajoutez une version a cette affaire."
              : "Creez un nouveau projet avec l\u0027assistant de creation."}
          </p>
        </div>
        <Link
          className="btn btn-secondary btn-lg"
          href={
            projectId
              ? `/dashboard/affaires/${projectId}`
              : "/dashboard/estimates"
          }
        >
          Retour
        </Link>
      </div>

      <EstimateCreationWizard onCreated={handleCreated} projectId={projectId} />
    </div>
  );
}
