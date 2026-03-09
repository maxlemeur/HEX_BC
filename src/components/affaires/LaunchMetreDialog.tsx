"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";
import type { TakeoffLevel } from "@/lib/takeoff/client";
import {
  TAKEOFF_LEVEL_BUSINESS_LABELS,
  getTakeoffSelectionWarning,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";

const ANALYSIS_LEVELS = [
  { level: "B" as const, label: "Standard", description: "Analyse standard avec recoupements" },
  { level: "C" as const, label: "Detaille", description: "Analyse approfondie poste par poste" },
] as const;

type LaunchMetreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  draftVersionId: string | null;
  hasAnyVersion: boolean;
  plansSummary?: { planSetCount: number; planFileCount: number } | null;
  versionLabel?: string;
};

export function LaunchMetreDialog({
  open,
  ...props
}: LaunchMetreDialogProps) {
  if (!open) {
    return null;
  }

  return <LaunchMetreDialogContent {...props} open={open} />;
}

function LaunchMetreDialogContent({
  open,
  onOpenChange,
  projectId,
  draftVersionId,
  hasAnyVersion,
  plansSummary,
  versionLabel,
}: LaunchMetreDialogProps) {
  const toast = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<TakeoffLevel>("B");
  const [classification, setClassification] =
    useState<TakeoffDocumentRecommendation | null>(null);
  const [manuallySelectedLevel, setManuallySelectedLevel] = useState(false);
  const classifiedFileFingerprintRef = useRef("");
  const focusStayButton = useCallback((button: HTMLButtonElement | null) => {
    button?.focus();
  }, []);
  const selectionWarning = useMemo(
    () =>
      getTakeoffSelectionWarning({
        recommendation: classification,
        selectedLevel,
      }),
    [classification, selectedLevel]
  );

  const handleSuccess = useCallback(() => {
    setIsUploading(false);
    setLaunchSuccess(true);

    const planInfo = plansSummary
      ? ` — ${plansSummary.planFileCount} fichier(s)`
      : "";
    const versionInfo = versionLabel ? `Version cible : ${versionLabel}` : "";

    toast.success({
      title: "Analyse lancee",
      description: `${versionInfo}${planInfo}. Resultats disponibles sous peu.`,
      durationMs: 6000,
    });
  }, [toast, plansSummary, versionLabel]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isUploading) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [isUploading, onOpenChange],
  );

  const noDraft = !draftVersionId;

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content
        closeOnOverlayClick={!isUploading}
        closeOnEscapeKey={!isUploading}
      >
        <Modal.Header>
          <Modal.Title>Analyser les plans</Modal.Title>
          <Modal.Close disabled={isUploading} />
        </Modal.Header>
        <Modal.Body>
          {launchSuccess ? (
            <div aria-live="polite" className="space-y-4 py-4 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success)]/10">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                Analyse lancee avec succes
              </p>
              {versionLabel && (
                <p className="text-xs text-[var(--slate-500)]">
                  Version cible : {versionLabel}
                  {plansSummary
                    ? ` — ${plansSummary.planFileCount} fichier(s)`
                    : ""}
                </p>
              )}
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  ref={focusStayButton}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onOpenChange(false)}
                >
                  Rester sur le hub
                </button>
                <Link
                  href={`/dashboard/affaires/${projectId}/takeoff`}
                  className="btn btn-primary btn-sm inline-flex"
                >
                  Centre d&apos;activite
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Version target */}
              <div className={noDraft ? "opacity-50" : ""}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                  Version cible
                </p>
                {versionLabel ? (
                  <div className="flex items-center gap-2">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--success)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <Badge variant="info" size="sm">
                      {versionLabel}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--slate-400)]">
                    Aucune version
                  </p>
                )}
              </div>

              {/* Plans summary */}
              {plansSummary && (
                <div className={noDraft ? "opacity-50" : ""}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                    Plans disponibles
                  </p>
                  <p className="text-sm text-[var(--slate-700)]">
                    {plansSummary.planFileCount} fichier(s) dans{" "}
                    {plansSummary.planSetCount} jeu(x)
                  </p>
                </div>
              )}

              {/* Analysis level */}
              <fieldset className={noDraft ? "opacity-50" : ""}>
                <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                  Niveau d&apos;analyse
                </legend>
                <div className="space-y-2" role="radiogroup">
                  {ANALYSIS_LEVELS.map((level) => (
                    <label
                      key={level.level}
                      aria-label={level.label}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        selectedLevel === level.level
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 cursor-pointer"
                          : "border-[var(--slate-200)] bg-white cursor-pointer"
                      }`}
                    >
                      <input
                        type="radio"
                        name="analysis-level"
                        value={level.level}
                        checked={selectedLevel === level.level}
                        onChange={() => {
                          setManuallySelectedLevel(true);
                          setSelectedLevel(level.level);
                        }}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-[var(--slate-800)]">
                          {level.label}
                        </span>
                        <p className="text-xs text-[var(--slate-500)]">
                          {level.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                {classification ? (
                  <div className="mt-3 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-3 py-2">
                    <p className="text-xs text-[var(--slate-700)]">
                      Niveau recommande :{" "}
                      {classification.recommendedLevel ? (
                        <span className="font-semibold text-[var(--brand-blue)]">
                          {TAKEOFF_LEVEL_BUSINESS_LABELS[classification.recommendedLevel]}
                        </span>
                      ) : (
                        <span className="font-semibold text-[var(--warning)]">
                          Choix manuel requis
                        </span>
                      )}
                    </p>
                    {selectionWarning ? (
                      <p
                        className={`mt-1 text-xs ${
                          selectionWarning.severity === "critical"
                            ? "text-[var(--warning)]"
                            : "text-[var(--slate-600)]"
                        }`}
                      >
                        {selectionWarning.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>

              {/* Upload form / fallback */}
              {draftVersionId ? (
                <TakeoffUploadForm
                  versionId={draftVersionId}
                  level={selectedLevel}
                  allowedLevels={["B", "C"]}
                  compact
                  onSubmittingChange={setIsUploading}
                  onSuccess={handleSuccess}
                  onClassificationChange={(nextClassification, context) => {
                    const isNewFileSelection =
                      context.fileFingerprint !==
                      classifiedFileFingerprintRef.current;

                    classifiedFileFingerprintRef.current =
                      context.fileFingerprint;
                    setClassification(nextClassification);

                    if (isNewFileSelection) {
                      setManuallySelectedLevel(false);
                    }

                    if (
                      (isNewFileSelection || !manuallySelectedLevel) &&
                      (nextClassification?.recommendedLevel === "B" ||
                        nextClassification?.recommendedLevel === "C")
                    ) {
                      setSelectedLevel(nextClassification.recommendedLevel);
                    }
                  }}
                />
              ) : hasAnyVersion ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-[var(--slate-600)]">
                    La version courante n&apos;est pas un brouillon.
                  </p>
                  <Link
                    href={`/dashboard/estimates/new?projectId=${projectId}`}
                    className="btn btn-secondary btn-sm mt-4 inline-flex"
                  >
                    Creer une nouvelle version
                  </Link>
                </div>
              ) : (
                <div className="py-4 text-center">
                  <p className="text-sm text-[var(--slate-600)]">
                    Aucune version trouvee.
                  </p>
                  <Link
                    href={`/dashboard/estimates/new?projectId=${projectId}`}
                    className="btn btn-secondary btn-sm mt-4 inline-flex"
                  >
                    Creer une premiere version
                  </Link>
                </div>
              )}
            </div>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
