"use client";

import { useRouter } from "next/navigation";

import {
  EstimateCreationWizard,
  type EstimateCreationResult,
} from "@/components/estimates/EstimateCreationWizard";
import type { EstimateCreationEngine } from "@/components/estimates/estimate-creation-wizard/shared";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/components/ui-legacy/Toast";
import type { InstantiateEstimateTemplateConversion } from "@/lib/estimates/client";

const HOURS_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const LISTED_CONVERTED_LINES = 5;

/**
 * Sous-lot 2.10a (P-12, D-h) : rapport d'un modèle entré dans une v3, comme celui de son insertion : réglages du
 * modèle non repris par la v3, puis lignes dont les heures changent par h / Q.
 */
function describeTemplateConversion(conversion: InstantiateEstimateTemplateConversion) {
  const parts: string[] = [];
  if (conversion.droppedSettings.length > 0) {
    parts.push(`Réglages du modèle non repris : ${conversion.droppedSettings.map((entry) => entry.label).join(", ")}.`);
  }
  if (conversion.convertedLines.length > 0) {
    const listed = conversion.convertedLines.slice(0, LISTED_CONVERTED_LINES).map((line) =>
      `${line.title} : ${HOURS_FORMAT.format(line.templateHours)} h → ${HOURS_FORMAT.format(line.convertedHours)} h`);
    const others = conversion.convertedLines.length - listed.length;
    parts.push(`Lignes converties : ${listed.join(" ; ")}${others > 0 ? ` ; et ${others} autre${others > 1 ? "s" : ""}` : ""}.`);
  }
  return parts.join(" ");
}

export function NewEstimatePage({
  projectId,
  creationEngine,
}: Readonly<{ projectId?: string; creationEngine: EstimateCreationEngine }>) {
  const router = useRouter();
  const toast = useToast();

  function handleCreated(versionId: string, result?: EstimateCreationResult) {
    if (result?.templateConversion) {
      toast.warning({
        title: "Modèle converti au moteur de calcul 3",
        description: describeTemplateConversion(result.templateConversion),
        durationMs: 15_000,
      });
    }
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

      <EstimateCreationWizard onCreated={handleCreated} projectId={projectId} creationEngine={creationEngine} />
    </div>
  );
}
