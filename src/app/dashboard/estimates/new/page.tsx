"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { EstimateCreationWizard } from "@/components/estimates/EstimateCreationWizard";

export default function NewEstimatePage() {
  const router = useRouter();

  function handleCreated(versionId: string) {
    router.push(`/dashboard/estimates/${versionId}/edit`);
    router.refresh();
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Nouveau chiffrage</h1>
          <p className="page-description">
            Creez un nouveau projet avec l&apos;assistant de creation.
          </p>
        </div>
        <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates">
          Retour
        </Link>
      </div>

      <EstimateCreationWizard onCreated={handleCreated} />
    </div>
  );
}
