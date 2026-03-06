"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";

const ANALYSIS_LEVELS = [
  { id: "rapide", label: "Rapide", description: "Scan rapide des quantites principales", enabled: true },
  { id: "standard", label: "Standard", description: "Analyse standard avec recoupements", enabled: false },
  { id: "detaille", label: "Detaille", description: "Analyse approfondie poste par poste", enabled: false },
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
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the "Rester sur le hub" button when success state shows
  useEffect(() => {
    if (launchSuccess) {
      stayButtonRef.current?.focus();
    }
  }, [launchSuccess]);

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
      if (nextOpen) {
        setLaunchSuccess(false);
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
                  ref={stayButtonRef}
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
                      key={level.id}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        level.enabled
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 cursor-pointer"
                          : "border-[var(--slate-200)] cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="radio"
                        name="analysis-level"
                        value={level.id}
                        checked={level.enabled}
                        disabled={!level.enabled}
                        aria-disabled={!level.enabled}
                        readOnly={level.enabled}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-[var(--slate-800)]">
                          {level.label}
                          {!level.enabled && (
                            <span className="ml-1.5 text-xs font-normal text-[var(--slate-400)]">
                              (bientot)
                            </span>
                          )}
                        </span>
                        <p className="text-xs text-[var(--slate-500)]">
                          {level.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Upload form / fallback */}
              {draftVersionId ? (
                <TakeoffUploadForm
                  versionId={draftVersionId}
                  compact
                  onSubmittingChange={setIsUploading}
                  onSuccess={handleSuccess}
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
