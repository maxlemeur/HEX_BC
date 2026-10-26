"use client";

import { useState } from "react";
import Link from "next/link";
import { HardDriveIcon, MonitorIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  AFFAIRE_INTAKE_ACCEPTED_FORMATS_LABEL,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";
import { dispatchCockpitOpenSurface } from "@/lib/cockpit/events";
import { cn } from "@/lib/utils";

import { buildAffaireWorkflowSteps } from "./affaire-workflow";
import { openGoogleDriveImport } from "./GoogleDriveImport";

// Without any document the dossier is the first unfinished step of the affaire's workflow.
const WORKFLOW = buildAffaireWorkflowSteps({
  hasDocs: false,
  briefConfirmed: false,
  hasDpgf: false,
  hasLines: false,
  approvalStatus: null,
  isSent: false,
});
const STEP_LABEL = `Étape 1 sur ${WORKFLOW.length} · ${WORKFLOW[0].label}`;

// A faint drawing-sheet grid behind the two sources.
const BLUEPRINT_GRID = {
  backgroundImage:
    "linear-gradient(to right, color-mix(in srgb, var(--primary) 7%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--primary) 7%, transparent) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};

/** Registration marks just outside a tile's corners, as on a printed plan sheet. */
function CropMarks({ className }: { className: string }) {
  const corner = cn("pointer-events-none absolute size-3", className);
  return (
    <>
      <span aria-hidden="true" className={cn(corner, "-left-1.5 -top-1.5 border-l-2 border-t-2")} />
      <span aria-hidden="true" className={cn(corner, "-right-1.5 -top-1.5 border-r-2 border-t-2")} />
      <span aria-hidden="true" className={cn(corner, "-bottom-1.5 -left-1.5 border-b-2 border-l-2")} />
      <span aria-hidden="true" className={cn(corner, "-bottom-1.5 -right-1.5 border-b-2 border-r-2")} />
    </>
  );
}

/** "ou" set on a dimension line: horizontal when the tiles stack, vertical between them. */
function DimensionDivider() {
  const segment = "relative flex-1 border-primary/40";
  const line =
    "absolute inset-x-0 top-1/2 h-px bg-primary/40 sm:inset-x-auto sm:inset-y-0 sm:left-1/2 sm:h-auto sm:w-px";
  return (
    <div aria-hidden="true" className="flex items-center gap-1.5 sm:flex-col">
      <span className={cn(segment, "h-2.5 border-l sm:h-auto sm:w-2.5 sm:border-l-0 sm:border-t")}>
        <span className={line} />
      </span>
      <span className="rounded-full border border-primary/25 bg-surface px-2 py-0.5 font-mono text-micro font-medium uppercase tracking-[0.2em] text-primary">
        ou
      </span>
      <span className={cn(segment, "h-2.5 border-r sm:h-auto sm:w-2.5 sm:border-b sm:border-r-0")}>
        <span className={line} />
      </span>
    </div>
  );
}

function SourceTag({ letter, label }: { letter: string; label: string }) {
  return (
    <span className="font-mono text-micro font-medium uppercase tracking-[0.18em] text-muted-foreground">
      <span className="text-brand-orange">{letter}</span> · {label}
    </span>
  );
}

export function AffaireEmptyDossierStep({
  projectId,
  manualEstimateHref,
  children,
}: {
  projectId: string;
  manualEstimateHref: string;
  /** Rare follow-ups the flow still offers without any document (e.g. the legacy takeoff). */
  children?: React.ReactNode;
}) {
  const [isDragActive, setIsDragActive] = useState(false);

  const openUpload = () => {
    dispatchCockpitOpenSurface({
      projectId,
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      triggerFilePicker: true,
    });
  };

  // The whole card takes the drop, so files released on the Drive tile never leave the page.
  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragActive(true);
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
        return;
      }
      setIsDragActive(false);
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragActive(false);
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      dispatchCockpitOpenSurface({
        projectId,
        actionId: "flow-empty-upload",
        surfaceId: "intake-upload",
        files,
      });
    },
  };

  return (
    <section
      aria-labelledby="empty-dossier-title"
      className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
      {...dragHandlers}
    >
      <div className="px-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-mono text-micro font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span aria-hidden="true" className="size-2 rotate-45 bg-brand-orange" />
            Prochaine étape
          </p>
          <Badge variant="info">{STEP_LABEL}</Badge>
        </div>
        <h2
          id="empty-dossier-title"
          className="mt-3 font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          Ajoutez le dossier de consultation
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          CCTP, DPGF, plans et courriers : chaque pièce est classée automatiquement pour préparer le brief.
        </p>

        <ol aria-label="Étapes de l'affaire" className="mt-5 grid grid-cols-7 gap-1.5 sm:grid-cols-6">
          {WORKFLOW.map((step, index) => {
            const current = index === 0;
            return (
              <li
                key={step.key}
                aria-current={current ? "step" : undefined}
                className={cn("min-w-0", current && "col-span-2 sm:col-span-1")}
              >
                <span
                  aria-hidden="true"
                  className={cn("block h-1 rounded-full", current ? "bg-brand-orange" : "bg-border")}
                />
                <span className="mt-2 flex min-w-0 items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-mono text-micro",
                      current ? "font-semibold text-foreground" : "text-subtle-foreground"
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "truncate text-xs",
                      current ? "font-semibold text-foreground" : "hidden text-muted-foreground sm:inline"
                    )}
                  >
                    {step.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div
        className="mx-4 mt-5 rounded-xl border border-primary/15 bg-surface-subtle p-4 sm:mx-6 sm:p-6"
        style={BLUEPRINT_GRID}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-5">
          <button
            type="button"
            onClick={openUpload}
            aria-label="Sélectionner les fichiers depuis l'ordinateur"
            className={cn(
              "group relative flex flex-col items-center rounded-lg border-2 border-dashed bg-surface px-4 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
              isDragActive ? "border-primary bg-primary/5" : "border-primary/30 hover:border-primary/60"
            )}
          >
            <CropMarks className="border-brand-orange" />
            <SourceTag letter="A" label="Ordinateur" />
            <MonitorIcon className="mt-4 size-7 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <span className="mt-2 font-display text-base font-semibold text-foreground">
              Depuis l&apos;ordinateur
            </span>
            <span className="mt-1 text-sm text-muted-foreground">
              {isDragActive ? "Relâchez pour importer vos pièces" : "Glissez les fichiers ici"}
            </span>
            <span className={cn(buttonVariants({ variant: "primary", size: "md" }), "mt-5")}>
              Sélectionner les fichiers
            </span>
          </button>

          <DimensionDivider />

          <div className="relative flex flex-col items-center rounded-lg border border-border-strong bg-surface px-4 py-6 text-center">
            <CropMarks className="border-border-strong" />
            <SourceTag letter="B" label="Google Drive" />
            <HardDriveIcon className="mt-4 size-7 text-primary" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-2 font-display text-base font-semibold text-foreground">Depuis Google Drive</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Copie dans l&apos;affaire, provenance conservée
            </p>
            <button
              type="button"
              onClick={() => openGoogleDriveImport(projectId)}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-5")}
            >
              Choisir dans Drive
            </button>
          </div>
        </div>
        <p className="mt-4 font-mono text-micro text-muted-foreground">
          Formats : {AFFAIRE_INTAKE_ACCEPTED_FORMATS_LABEL} · {AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL} max par fichier
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-dashed border-border-strong px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-muted-foreground">
          Pas de DPGF ? Ouvrez le devis et complétez la structure plus tard.
        </p>
        <Link
          href={manualEstimateHref}
          className={cn(buttonVariants({ variant: "outline", size: "md" }), "shrink-0")}
        >
          Continuer en manuel
        </Link>
      </div>

      {children ? <div className="px-4 pb-5 sm:px-6">{children}</div> : null}
    </section>
  );
}
