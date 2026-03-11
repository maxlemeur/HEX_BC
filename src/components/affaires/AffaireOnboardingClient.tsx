"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { initializeAffaireDraft } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import {
  AffaireProjectDetailsCard,
  type AffaireProjectDetailsValues,
} from "@/components/affaires/AffaireProjectDetailsCard";
import { AffaireImportBootstrapSection } from "@/components/affaires/AffaireImportBootstrapSection";
import { EmptyState } from "@/components/ui/EmptyState";
import { OnboardingIntakeDropzone } from "@/components/affaires/OnboardingIntakeDropzone";
import { AffairePilotagePanel } from "./AffairePilotagePanel";
import { AffaireWorkflowStepper } from "./AffaireWorkflowStepper";

const INITIAL_METADATA: AffaireProjectDetailsValues = {
  projectName: "",
  clientName: "",
  reference: "",
};

export function AffaireOnboardingClient() {
  const router = useRouter();
  const [metadata, setMetadata] =
    useState<AffaireProjectDetailsValues>(INITIAL_METADATA);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const requireProjectName = () => {
    setSaveError("Le nom du projet est obligatoire.");
  };

  async function handleSaveOnly() {
    const projectName = metadata.projectName.trim();
    if (!projectName) {
      requireProjectName();
      return;
    }

    setSaveError(null);
    setSaveBusy(true);

    try {
      const result = await initializeAffaireDraft({
        projectName,
        clientName: metadata.clientName || null,
        reference: metadata.reference || null,
      });

      router.push(result.redirectUrl);
      router.refresh();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Impossible de creer l'affaire."
      );
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="animate-fade-in">
      {/* Breadcrumb (matches hub layout) */}
      <nav aria-label="Fil d'Ariane" className="mb-4">
        <ol className="flex items-center gap-1.5 text-sm text-[var(--slate-500)]">
          <li>
            <Link
              href="/dashboard/affaires"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)]"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Retour a la liste
            </Link>
          </li>
          <li aria-hidden="true" className="text-[var(--slate-300)]">/</li>
          <li className="truncate font-medium text-[var(--slate-700)]">
            Nouvelle affaire
          </li>
        </ol>
      </nav>

      {/* Header (matches hub pattern) */}
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <h1 className="page-title">Nouvelle affaire</h1>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Demarrez directement dans le hub de cadrage, sans creer de brouillon avant action utile.
          </p>
        </div>
      </div>

      {/* Workflow stepper — ghost mode (all upcoming) */}
      <AffaireWorkflowStepper ghost />

      {/* Main grid (5 columns, matches hub) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <AffaireProjectDetailsCard
            mode="edit"
            description="Renseignez le contexte minimal avant de demarrer le dossier ou le flux DPGF."
            values={metadata}
            projectNameError={saveError}
            errorMessage={saveError}
            primaryAction={{
              label: "Enregistrer l'affaire",
              onClick: handleSaveOnly,
              loading: saveBusy,
            }}
            secondaryAction={{
              label: "Annuler",
              onClick: () => router.push("/dashboard/affaires"),
              disabled: saveBusy,
            }}
            onProjectNameChange={(value) => {
              setMetadata((current) => ({ ...current, projectName: value }));
              if (saveError) {
                setSaveError(null);
              }
            }}
            onClientNameChange={(value) => {
              setMetadata((current) => ({ ...current, clientName: value }));
              if (saveError) {
                setSaveError(null);
              }
            }}
            onReferenceChange={(value) => {
              setMetadata((current) => ({ ...current, reference: value }));
              if (saveError) {
                setSaveError(null);
              }
            }}
          />

          <OnboardingIntakeDropzone
            ensureDraft={async () => {
              const projectName = metadata.projectName.trim();
              if (!projectName) {
                throw new Error("Nom projet requis.");
              }

              const result = await initializeAffaireDraft({
                projectName,
                clientName: metadata.clientName || null,
                reference: metadata.reference || null,
              });

              return {
                projectId: result.projectId,
                versionId: result.versionId,
                redirectTo: result.redirectUrl,
              };
            }}
            onMissingProjectName={requireProjectName}
          />

          <AffaireImportBootstrapSection
            metadata={metadata}
            onProjectNameRequired={requireProjectName}
          />
        </div>

        <div className="space-y-4 lg:col-span-2">
          <AffairePilotagePanel
            ghost
            projectId=""
            projectName=""
            intakeWorkspace={null}
            dpgfSource={null}
            plansSummary={null}
            registerSummary={null}
            approvalSummary={null}
            currentVersion={null}
            lineCount={0}
          />

          <EmptyState
            icon={
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
                <path d="M12 18v-6" />
                <path d="m9 15 3-3 3 3" />
              </svg>
            }
            title="Devis non initialise"
            description="Le devis sera cree automatiquement au premier acte utile dans l'affaire."
            className="border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 py-10"
          />
        </div>
      </div>
    </div>
  );
}
