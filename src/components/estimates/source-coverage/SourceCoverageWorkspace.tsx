"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sourceReferenceDate, type SourceReferenceScope } from "@/components/estimates/source-reference/source-reference-state";
import type { CoverageRequirementPayload, CoverageWorkspace } from "@/lib/estimates/source-coverage-contracts";

import { CoverageDecisionPanel } from "./CoverageDecisionPanel";
import { CoverageDecisionEvidence } from "./CoverageFacts";
import { CoverageRequirementForm } from "./CoverageRequirementForm";
import { treatmentLabels, validityLabels } from "./source-coverage-client";
import { useSourceCoverage } from "./useSourceCoverage";

const panel = "rounded-xl border border-border bg-surface p-5 sm:p-6";

export function SourceCoverageWorkspace({ scope, initialWorkspace }: Readonly<{ scope: SourceReferenceScope; initialWorkspace: CoverageWorkspace }>) {
  const controller = useSourceCoverage(scope, initialWorkspace);
  const workspace = controller.workspace;
  const selected = workspace.selectedRequirement;
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [navigation, setNavigation] = useState<{ action: "new" | "select" | "refresh"; id?: string } | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const viewerHeading = useRef<HTMLHeadingElement>(null);
  const busy = controller.busy !== null;
  const disabled = busy || !workspace.canWrite || Boolean(controller.pending) || Boolean(controller.storageError) || controller.workspaceUnavailable;
  const editorValue = creating ? null : selected;
  const editorId = creating ? newId : selected?.id;
  const created = creating && selected?.id === newId;
  const actualValue = created ? selected : editorValue;
  const referenceAvailable = workspace.activeCopyId !== null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { if (controller.viewer) viewerHeading.current?.focus(); }, [controller.viewer]);

  function navigate(next: NonNullable<typeof navigation>, discard = false) {
    if (dirty && !discard) { setNavigation(next); return; }
    setNavigation(null); setDirty(false); controller.invalidatePreview(); controller.closeViewer();
    if (next.action === "new") { setNewId(crypto.randomUUID()); setCreating(true); }
    else { setCreating(false); void controller.refresh(next.id); }
  }
  function save(payload: CoverageRequirementPayload) {
    if (!editorId) return;
    const shared = { requirementId: editorId, expectedReferenceRevision: workspace.referenceRevision, operationKey: crypto.randomUUID(), payload };
    void controller.mutate({ kind: "requirement", actorId: scope.actorId, versionId: scope.versionId, request: actualValue ? { ...shared, operation: "update", expectedRevision: actualValue.revision } : { ...shared, operation: "create", expectedRevision: 0 } });
  }

  return <div className="space-y-6">
    {controller.storageError ? <Alert variant="danger"><p>{controller.storageError}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={controller.retryStorage}>Réessayer la reprise</Button><Button variant="outline" disabled={busy} onClick={() => void controller.abandon()}>Abandonner la reprise locale et actualiser</Button></div></Alert> : null}
    {controller.failure || controller.workspaceUnavailable ? <Alert variant="danger"><p>Vérification indisponible : {controller.failure?.message ?? "Actualisez la revue avant une nouvelle décision."}</p><p className="mt-2">Les informations affichées restent celles de la dernière lecture réussie ; aucune nouvelle validité n’est déduite de cet échec.</p><Button className="mt-3" variant="outline" disabled={busy} onClick={() => navigate({ action: "refresh", id: selected?.id })}>Actualiser les exigences</Button></Alert> : null}
    {controller.pending ? <Alert variant="warning"><p>Un enregistrement attend son résultat. La même demande et sa clé sont conservées dans cet onglet. Aucun envoi n’a été relancé au chargement.</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy || Boolean(controller.storageError)} onClick={() => void controller.mutate()}>Reprendre l’enregistrement</Button><Button variant="outline" disabled={busy} onClick={() => void controller.abandon()}>Abandonner cette intention et actualiser</Button></div>
      <p className="mt-2 text-sm">Abandonner la reprise locale n’annule aucun enregistrement déjà réalisé sur le serveur.</p>
    </Alert> : null}
    {controller.receipt ? <Alert variant="success"><p>{controller.receipt.replayed ? "Enregistrement déjà réalisé : le même reçu a été retrouvé." : "Enregistrement confirmé par le serveur."}</p><p className="mt-1 text-sm">Le reçu concerne cette action. Le traitement et la validité courants restent ceux de la dernière lecture réussie ci-dessous.</p></Alert> : null}
    {!workspace.canWrite ? <Alert variant="info">Revue en lecture seule : {workspace.readOnlyReason === "version" ? "le devis n’est plus un brouillon." : workspace.readOnlyReason === "archived" ? "l’affaire est archivée." : "votre rôle ne permet pas de modifier cette revue."}</Alert> : null}
    {!referenceAvailable ? <Alert variant="info">Confirmez d’abord la <Link className="underline" href={`/dashboard/estimates/${scope.versionId}/source-review`} prefetch={false}>référence CCTP</Link> avant d’ajouter des exigences.</Alert> : null}
    {navigation ? <Alert variant="warning"><p>La saisie contient des modifications non enregistrées.</p><div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => setNavigation(null)}>Continuer la saisie</Button><Button onClick={() => navigate(navigation, true)}>Abandonner les modifications</Button></div></Alert> : null}

    <section aria-label="Exigences identifiées" className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Exigences identifiées</h2><p className="mt-1 text-sm text-muted-foreground">{workspace.counts.total} exigences actives · {workspace.counts.validities.needs_review} à revérifier. Ces compteurs ne mesurent pas l’exhaustivité du CCTP.</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => navigate({ action: "refresh", id: selected?.id })}>Actualiser les exigences</Button><Button disabled={disabled || !referenceAvailable} onClick={() => navigate({ action: "new" })}>Ajouter une exigence</Button></div></div>
      <div className="mt-4 flex flex-wrap gap-2">{Object.entries(treatmentLabels).map(([key, label]) => <Badge key={key} variant="outline">{label} : {workspace.counts.treatments[key as keyof typeof treatmentLabels]}</Badge>)}</div>
      <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Traitement et validité des exigences identifiées</caption><thead><tr className="border-b border-border"><th className="p-2">Prescription</th><th className="p-2">Périmètre</th><th className="p-2">Traitement</th><th className="p-2">Validité</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {workspace.requirements.map((requirement) => <tr key={requirement.id} data-testid={`coverage-requirement-${requirement.id}`} className="border-b border-border/60"><td className="max-w-sm p-2">{requirement.prescription}{requirement.archived ? <Badge className="ml-2">Archivée</Badge> : null}</td>
          <td className="p-2">{requirement.scope.mode === "whole_project" ? "Ensemble de l’affaire" : requirement.scope.mode === "unspecified" ? "Non précisé" : [requirement.scope.zoneId, requirement.scope.networkId].filter(Boolean).map((id) => workspace.dimensions.find((dimension) => dimension.id === id)?.label ?? "Périmètre indisponible").join(" · ")}</td>
          <td className="p-2">{treatmentLabels[requirement.treatment]}</td><td className="p-2"><Badge variant={controller.workspaceUnavailable ? "neutral" : requirement.validity === "current" ? "success" : requirement.validity === "needs_review" ? "warning" : "neutral"}>{controller.workspaceUnavailable ? "Dernière lecture : " : ""}{validityLabels[requirement.validity]}</Badge></td>
          <td className="p-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => navigate({ action: "select", id: requirement.id })}>Ouvrir l’exigence</Button></td></tr>)}
      </tbody></table></div>
      {workspace.requirements.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Aucune exigence enregistrée dans cette liste.</p> : null}
      {workspace.nextAfterId ? <Button className="mt-4" variant="outline" disabled={busy || dirty} onClick={() => void controller.more("list")}>Afficher les exigences suivantes</Button> : null}
    </section>

    {editorId ? <section aria-label="Exigence sélectionnée" data-testid={`coverage-editor-${editorId}`} className={panel}>
      <h2 className="mb-5 text-lg font-semibold">{actualValue ? "Revue de l’exigence" : "Nouvelle exigence"}</h2>
      <CoverageRequirementForm key={`${editorId}:${actualValue?.revision ?? "new"}`} versionId={scope.versionId} value={actualValue} activeCopyId={workspace.activeCopyId} dimensions={workspace.dimensions}
        disabled={disabled || Boolean(actualValue?.archived)} onSave={save} onDirty={setDirty} onChanged={controller.invalidatePreview}
        onDimension={(request) => void controller.mutate({ kind: "dimension", actorId: scope.actorId, versionId: scope.versionId, request })}
        onConsult={(citation) => { if (actualValue) void controller.consult(citation, actualValue.revision); }} />
      {actualValue ? <div className="mt-6 space-y-6"><CoverageDecisionPanel key={`${actualValue.id}:${actualValue.revision}:${workspace.referenceRevision}`} requirement={actualValue} preview={controller.preview} disabled={disabled || actualValue.archived} dirty={dirty} unavailable={controller.workspaceUnavailable}
        onPreview={() => void controller.prepareDecision(actualValue.id)} onDecide={(request) => void controller.mutate({ kind: "decision", actorId: scope.actorId, versionId: scope.versionId, request })} />
        <details className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium">{actualValue.archived ? "Réouvrir l’exigence" : "Archiver l’exigence"}</summary><p className="mt-2 text-sm text-muted-foreground">L’historique est conservé. Une exigence archivée sort des comptes actifs sans devenir une exclusion technique.</p>
          <label className="mt-3 block space-y-1 text-sm"><span>Motif d’archivage ou de réouverture</span><Textarea value={archiveReason} maxLength={1000} disabled={disabled || dirty} onChange={(event) => setArchiveReason(event.target.value)} /></label>
          <Button className="mt-3" variant="outline" disabled={disabled || dirty || !archiveReason.trim()} onClick={() => void controller.mutate({ kind: "requirement", actorId: scope.actorId, versionId: scope.versionId, request: {
            operation: actualValue.archived ? "reopen" : "archive", requirementId: actualValue.id, expectedRevision: actualValue.revision, expectedReferenceRevision: workspace.referenceRevision, operationKey: crypto.randomUUID(), reason: archiveReason.trim(),
          } })}>{actualValue.archived ? "Réouvrir avec ce motif" : "Archiver avec ce motif"}</Button></details>
      </div> : null}
    </section> : <p className="text-sm text-muted-foreground">Ouvrez une exigence pour examiner ses passages et ses liens, ou ajoutez une prescription identifiée.</p>}

    {controller.viewer ? <section aria-label="Consultation du passage cité" className={panel}>
      <div className="flex items-start justify-between gap-4"><h2 ref={viewerHeading} tabIndex={-1} className="text-lg font-semibold">Consultation du passage cité</h2><Button variant="ghost" onClick={controller.closeViewer}>Fermer la consultation</Button></div>
      <p className="mt-2 text-sm">{controller.viewer.fileName} · page physique {controller.viewer.page} · empreinte vérifiée {controller.viewer.sha256.slice(0, 12)}…</p>
      <iframe title="Copie conservée du CCTP" src={`${controller.viewer.url}#page=${controller.viewer.page}`} className="my-4 h-[65vh] w-full rounded-lg border border-border" />
      <a className="text-sm underline" href={`${controller.viewer.url}#page=${controller.viewer.page}`} target="_blank" rel="noopener noreferrer">Ouvrir cette copie dans un nouvel onglet</a>
      <p className="mt-3 text-sm text-muted-foreground">Le chargement vérifie les octets du document. Il ne confirme pas que vous avez examiné le passage.</p>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={disabled || dirty || controller.viewer.copyId !== workspace.activeCopyId} checked={controller.humanVerified} onChange={(event) => controller.setHumanVerified(event.target.checked)} /><span>J’ai vérifié ce passage dans cette copie</span></label>
      <Button className="mt-3" disabled={disabled || dirty || !controller.humanVerified || controller.viewer.copyId !== workspace.activeCopyId} onClick={() => { const citation = selected?.citations.find((value) => value.id === controller.viewer?.citationId); if (citation) void controller.verify(citation); }}>Vérifier la citation</Button>
    </section> : null}

    {selected ? <section aria-label="Historique de l’exigence" className={panel}><h2 className="mb-4 text-lg font-semibold">Historique de l’exigence</h2>
      {workspace.history.length ? <ol className="space-y-4">{workspace.history.map((event) => <li key={event.id} data-testid={`coverage-event-${event.id}`} className="border-l-2 border-border pl-3 text-sm"><p className="font-medium">{event.decision ? treatmentLabels[event.decision.treatment] : ({ "requirement.create": "Exigence créée", "requirement.update": "Exigence modifiée", "requirement.archive": "Exigence archivée", "requirement.reopen": "Exigence réouverte", "citation.verify": "Citation vérifiée", decision: "Décision" })[event.operation]}</p><p className="text-muted-foreground">{sourceReferenceDate(event.occurredAt)}</p>{event.reason ? <p>{event.reason}</p> : null}{event.decision ? <details className="mt-2"><summary className="cursor-pointer font-medium">Consulter les faits de cette décision</summary><div className="mt-3"><CoverageDecisionEvidence decision={event.decision} /></div></details> : null}</li>)}</ol> : <p className="text-sm text-muted-foreground">Aucun événement dans cette page de l’historique.</p>}
      {workspace.nextBeforeEvent ? <Button className="mt-4" variant="outline" disabled={busy || dirty} onClick={() => void controller.more("history")}>Afficher les événements précédents</Button> : null}
    </section> : null}
  </div>;
}
