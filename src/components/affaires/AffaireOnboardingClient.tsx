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
import { OnboardingIntakeDropzone } from "@/components/affaires/OnboardingIntakeDropzone";

const INITIAL_METADATA: AffaireProjectDetailsValues = {
  projectName: "",
  clientName: "",
  reference: "",
};

const PLACEHOLDER_STEPS = [
  {
    title: "Brief affaire",
    description:
      "Le brief sera genere automatiquement apres le traitement des pieces deposees.",
  },
  {
    title: "Source DPGF",
    description:
      "Le flux expert DPGF peut pre-remplir la structure du devis sans quitter cette page.",
  },
  {
    title: "Devis",
    description:
      "Une V1 brouillon sera creee au premier acte, puis vous reprendrez dans le hub ou l'editeur.",
  },
  {
    title: "Validation",
    description:
      "Les controles de sortie et d'approbation restent disponibles une fois l'affaire creee.",
  },
];

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
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Nouvelle affaire</h1>
          <p className="page-description">
            Demarrez directement dans le hub de cadrage, sans creer de brouillon avant action utile.
          </p>
        </div>
        <Link className="btn btn-secondary btn-lg" href="/dashboard/affaires">
          Retour
        </Link>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
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
          <section className="dashboard-card p-5">
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Suite du parcours
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Le hub final garde la meme logique metier. Cette page anticipe simplement le premier acte.
            </p>

            <ol className="mt-5 space-y-3">
              {PLACEHOLDER_STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--slate-300)] bg-white text-xs font-semibold text-[var(--slate-500)]">
                      {index + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-[var(--slate-800)]">
                        {step.title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-500)]">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
