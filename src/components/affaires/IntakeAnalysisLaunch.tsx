"use client";

import { useState, useTransition } from "react";
import { launchAffaireIntakeAnalysis } from "@/app/dashboard/affaires/_actions/intake";
import type { IntakeAiChoice } from "@/lib/affaires/intake-ai-settings";
import { IntakeAiControls } from "./IntakeAiControls";
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
  if (!canLaunch && !workspace.briefOutdated && !workspace.launchConnectionUnavailable && !workspace.launchRunning && !workspace.launchBudgetNotice && !message) return null;

  function launch(choice: IntakeAiChoice) {
    startTransition(async () => {
      try {
        const result = await launchAffaireIntakeAnalysis(workspace.projectId, choice);
        setMessage(result.message);
      } catch {
        setMessage("Impossible de lancer l’analyse. Actualisez le dossier et vérifiez votre accès.");
      }
      await onReload();
    });
  }

  return <section aria-label="Analyse du dossier" className="my-4 space-y-2 rounded-xl border border-border p-4">
    {workspace.launchConnectionUnavailable && <p>Analyse interrompue. La connexion IA choisie au lancement n’est plus disponible.</p>}
    {workspace.launchBudgetNotice && <p role="status">{workspace.launchBudgetNotice}</p>}
    {workspace.briefOutdated && <p>Le brief ne tient pas compte des dernières modifications du dossier.</p>}
    {waiting > 0 && <p className="font-medium">{waiting} pièce{waiting > 1 ? "s" : ""} en attente de lancement</p>}
    {workspace.launchRunning ? <p>Analyse en cours. Attendez sa fin avant de confirmer le dossier.</p> :
      workspace.briefPreparationDue && !waiting ? <p>Lancez l’analyse pour actualiser le brief avant de confirmer.</p> :
      waiting > 0 && <p>Lancez l’analyse ou retirez les pièces en attente avant de confirmer.</p>}
    {canManage && canLaunch && <IntakeAiControls projectId={workspace.projectId}
      disabled={pending || workspace.launchRunning} submitLabel="Lancer l’analyse" onSubmit={launch} />}
    {message && <p role="status">{message}</p>}
  </section>;
}
