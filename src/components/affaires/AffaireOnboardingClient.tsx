"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AnimatePresence } from "motion/react";

import { initializeAffaireDraft } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import {
  AffaireProjectDetailsCard,
  type AffaireProjectDetailsValues,
} from "@/components/affaires/AffaireProjectDetailsCard";
import { BlueprintCreationAnimation } from "@/components/affaires/BlueprintCreationAnimation";
import { ProjectIconPicker, type ProjectIconKey } from "@/components/affaires/ProjectIconPicker";

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
  const [projectIcon, setProjectIcon] = useState<ProjectIconKey>("building");
  const [showAnimation, setShowAnimation] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const hasProjectName = metadata.projectName.trim().length > 0;

  async function handleCreate() {
    if (!hasProjectName) return;

    setSaveError(null);
    setSaveBusy(true);

    try {
      const result = await initializeAffaireDraft({
        projectName: metadata.projectName.trim(),
        clientName: metadata.clientName || null,
        reference: metadata.reference || null,
      });

      setRedirectUrl(result.redirectUrl);
      setShowAnimation(true);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Impossible de creer l'affaire."
      );
      setSaveBusy(false);
    }
  }

  const handleAnimationComplete = useCallback(() => {
    if (redirectUrl) {
      router.push(redirectUrl);
      router.refresh();
    }
  }, [redirectUrl, router]);

  return (
    <div className="animate-fade-in">
      <h1 className="sr-only">Nouvelle affaire</h1>
      <AnimatePresence>
        {showAnimation && (
          <BlueprintCreationAnimation
            projectName={metadata.projectName.trim()}
            onComplete={handleAnimationComplete}
          />
        )}
      </AnimatePresence>
      {/* Top bar: breadcrumb + actions */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <nav aria-label="Fil d'Ariane">
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

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => router.push("/dashboard/affaires")}
            disabled={saveBusy}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleCreate}
            disabled={!hasProjectName || saveBusy}
          >
            Creer l&apos;affaire
          </button>
        </div>
      </div>

      <AffaireProjectDetailsCard
        mode="edit"
        values={metadata}
        iconKey={projectIcon}
        iconSlot={
          <ProjectIconPicker value={projectIcon} onChange={setProjectIcon} />
        }
        projectNameError={saveError}
        onProjectNameChange={(v) => {
          setMetadata((c) => ({ ...c, projectName: v }));
          if (saveError) setSaveError(null);
        }}
        onClientNameChange={(v) =>
          setMetadata((c) => ({ ...c, clientName: v }))
        }
        onReferenceChange={(v) =>
          setMetadata((c) => ({ ...c, reference: v }))
        }
      />
    </div>
  );
}
