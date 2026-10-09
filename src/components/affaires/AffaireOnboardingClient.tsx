"use client";

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
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

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
          : "Impossible de créer l'affaire."
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
    <div className="mx-auto max-w-5xl animate-fade-in">
      <AnimatePresence>
        {showAnimation && (
          <BlueprintCreationAnimation
            projectName={metadata.projectName.trim()}
            onComplete={handleAnimationComplete}
          />
        )}
      </AnimatePresence>
      <PageHeader
        title="Nouvelle affaire"
        description="Nommez l'affaire pour la créer : vous ajouterez ensuite les pièces (DPGF, plans, CCTP)."
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: "Nouvelle affaire" },
        ]}
        actions={
          <>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => router.push("/dashboard/affaires")}
              disabled={saveBusy}
            >
              Annuler
            </Button>
            <Button
              size="lg"
              onClick={handleCreate}
              disabled={!hasProjectName}
              loading={saveBusy}
            >
              Créer l&apos;affaire
            </Button>
          </>
        }
      />

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
