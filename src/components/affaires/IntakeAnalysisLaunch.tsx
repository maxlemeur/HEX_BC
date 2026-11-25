"use client";

import { useState, useTransition } from "react";
import { launchAffaireIntakeAnalysis } from "@/app/dashboard/affaires/_actions/intake";
import { Button } from "@/components/ui/button";
import { dossierDocumentState } from "@/lib/affaires/document-triage";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";

export function IntakeAnalysisLaunch({ workspace, canManage, onReload }: {
  workspace: AffaireIntakeWorkspace;
  canManage: boolean;
  onReload: () => Promise<unknown>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const waiting = workspace.documents.filter(doc => dossierDocumentState(doc) === "awaiting_launch").length;
  const canLaunch = waiting > 0 || workspace.briefPreparationDue;
  if (!canLaunch && !workspace.launchRunning && !message) return null;

  function launch() {
    startTransition(async () => {
      try {
        const result = await launchAffaireIntakeAnalysis(workspace.projectId);
        setMessage(result.message);
      } catch {
        setMessage("Impossible de lancer l’analyse. Actualisez le dossier et vérifiez votre accès.");
      }
      await onReload();
    });
  }

  return <section aria-label="Analyse du dossier" className="my-4 space-y-2 rounded-xl border border-border p-4">
    {waiting > 0 && <p className="font-medium">{waiting} pièce{waiting > 1 ? "s" : ""} en attente de lancement</p>}
    {workspace.launchRunning ? <p>Analyse en cours. Attendez sa fin avant de confirmer le dossier.</p> :
      workspace.briefPreparationDue && !waiting ? <p>Lancez l’analyse pour actualiser le brief avant de confirmer.</p> :
      waiting > 0 && <p>Lancez l’analyse ou retirez les pièces en attente avant de confirmer.</p>}
    {canManage && canLaunch && <>
      {waiting > 0 && <p className="text-sm text-muted-foreground">Les images et les PDF scannés seront lus avec votre forfait ChatGPT si votre connexion est disponible.</p>}
      {waiting > 0 && workspace.analysisAvailability?.provider === "decisions" && workspace.analysisAvailability.available &&
        <p className="text-sm text-muted-foreground">Le classement des pièces utilise l’API Decisions du serveur.</p>}
      <Button type="button" disabled={pending || workspace.launchRunning} onClick={launch}>Lancer l’analyse</Button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
