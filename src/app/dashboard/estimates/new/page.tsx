"use client";

import { useRouter, useSearchParams } from "next/navigation";

import {
  EstimateCreationWizard,
  type EstimateCreationResult,
} from "@/components/estimates/EstimateCreationWizard";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/ui-legacy/Toast";

export default function NewEstimatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const projectId = searchParams.get("projectId") ?? undefined;

  function handleCreated(versionId: string, result?: EstimateCreationResult) {
    if (result?.linkedDpgfImportWarning) {
      toast.warning({
        title: "Version créée avec avertissement",
        description: result.linkedDpgfImportWarning,
      });
    }
    router.push(`/dashboard/estimates/${versionId}/edit`);
    router.refresh();
  }

  const isExistingProject = Boolean(projectId);
  const title = isExistingProject ? "Nouvelle version" : "Nouveau chiffrage";

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          ...(projectId ? [{ label: "Affaire", href: `/dashboard/affaires/${projectId}` }] : []),
          { label: title },
        ]}
        title={title}
        description={
          isExistingProject
            ? "Ajoutez une version à cette affaire."
            : "Créez un nouveau projet avec l’assistant de création."
        }
      />

      <EstimateCreationWizard onCreated={handleCreated} projectId={projectId} />
    </div>
  );
}
