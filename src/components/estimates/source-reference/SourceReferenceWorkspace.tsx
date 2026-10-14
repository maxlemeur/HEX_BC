"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { SourceReferenceCopy, SourceReferenceReview } from "@/lib/estimates/source-reference-contracts";

import { sourceReferenceDate, type SourceReferenceDocuments, type SourceReferenceScope } from "./source-reference-state";
import { useSourceReference } from "./useSourceReference";

const panel = "rounded-xl border border-border bg-surface p-5 sm:p-6";

function CopyFacts({ copy }: { copy: SourceReferenceCopy }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="break-words font-semibold">{copy.fileName}</p>
      <p className="text-muted-foreground">Conservée le {sourceReferenceDate(copy.createdAt)}</p>
      {copy.state === "verified" ? <>
        <p>{copy.pageCount} pages · {copy.byteSize.toLocaleString("fr-FR")} octets</p>
        <details>
          <summary className="cursor-pointer text-muted-foreground">Empreinte {copy.sha256.slice(0, 12)}…</summary>
          <p className="mt-2 break-all font-mono text-xs">{copy.sha256}</p>
        </details>
      </> : <p>Préparation interrompue ou en cours. Cette copie ne peut pas être confirmée.</p>}
    </div>
  );
}

export function SourceReferenceWorkspace({ scope, initialReview, documents, canReplay }: Readonly<{
  scope: SourceReferenceScope;
  initialReview: SourceReferenceReview;
  documents: SourceReferenceDocuments;
  canReplay: boolean;
}>) {
  const controller = useSourceReference(scope, initialReview);
  const router = useRouter();
  const [documentId, setDocumentId] = useState("");
  const [reason, setReason] = useState("");
  const viewerHeading = useRef<HTMLHeadingElement>(null);
  const busy = controller.busy !== null;
  const pendingConfirmation = controller.intent.confirmation;
  const interruptedPreparation = Boolean(controller.intent.preparation && !controller.prepared);
  const canPrepare = documents.state === "ready";
  const reviewedPreparedCopy = controller.prepared?.state === "verified" && controller.consultedCopyId === controller.prepared.copyId;
  const isCurrentCopy = controller.prepared?.copyId === controller.review.activeReference?.copyId;
  const reasonValue = pendingConfirmation?.reason ?? reason;
  const reasonLength = [...reasonValue.trim()].length;
  const history = controller.history;

  useEffect(() => {
    if (controller.viewer) viewerHeading.current?.focus();
  }, [controller.viewer]);

  return (
    <div className="space-y-6">
      {controller.storageError ? <Alert variant="danger"><p>{controller.storageError}</p>
        <p className="mt-2">Abandonner la reprise locale ne supprime aucune copie et n’annule aucune confirmation déjà enregistrée.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void controller.refresh()}>Réessayer la reprise</Button>
          <Button variant="outline" disabled={busy} onClick={() => void controller.discardStoredIntent()}>Abandonner la reprise locale et actualiser</Button>
        </div>
      </Alert> : null}
      {controller.failure ? <Alert variant="danger">
        <p>{controller.failure.message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void controller.retry()}>Réessayer</Button>
          {(controller.intent.preparation || pendingConfirmation) && canPrepare ? <Button variant="outline" disabled={busy} onClick={() => void controller.newDecision()}>Abandonner cette intention et actualiser</Button> : null}
        </div>
      </Alert> : null}
      {controller.confirmation ? <Alert variant="success">
        <p>{controller.confirmation.replayed ? "Confirmation déjà enregistrée : le reçu a été récupéré." : "La référence a été confirmée."}</p>
        {controller.confirmation.activation.revision < controller.confirmation.currentRevision ? <p>Ce reçu correspond à une ancienne confirmation. La référence actuelle est affichée séparément ci-dessous.</p> : null}
        {controller.review.revision < controller.confirmation.currentRevision ? <p>La confirmation est enregistrée. Actualisez pour lire la référence actuelle ; les informations ci-dessous sont celles de la dernière lecture réussie.</p> : null}
      </Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Référence actuelle" className={panel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Référence actuelle</h2>
            <Button variant="ghost" disabled={busy} onClick={() => void controller.refresh()}>Actualiser la référence</Button>
          </div>
          {controller.review.activeReference ? <>
            <CopyFacts copy={controller.review.activeReference} />
            <Button className="mt-4" variant="outline" disabled={busy} onClick={() => void controller.consult(controller.review.activeReference!.copyId)}>Consulter la copie</Button>
          </> : <p className="text-muted-foreground">Aucune référence confirmée</p>}
          <p className="mt-4 text-sm text-muted-foreground">Préparer ou consulter une copie ne change pas la référence.</p>
        </section>

        <section aria-label="Copie préparée" className={panel}>
          <h2 className="mb-4 text-lg font-semibold">Copie préparée</h2>
          {controller.prepared ? <>
            <p className="mb-3 text-sm font-medium text-primary">{controller.prepared.state === "verified" ? "Copie prête à consulter" : "Copie en attente de vérification"}</p>
            <CopyFacts copy={controller.prepared} />
            {controller.prepared.state === "verified" ? <Button className="mt-4" variant="outline" disabled={busy} onClick={() => void controller.consult(controller.prepared!.copyId)}>Consulter la copie</Button> : null}
          </> : <p className="text-muted-foreground">{interruptedPreparation ? "Une préparation a été interrompue. Reprenez la même demande pour en vérifier le résultat." : "Choisissez un document CCTP pour préparer sa copie conservée."}</p>}
          {controller.intent.preparation && (interruptedPreparation || controller.prepared?.state === "pending") && canReplay ? <Button className="mt-4" loading={controller.busy === "prepare"} disabled={busy || Boolean(controller.storageError)} onClick={() => void controller.prepare()}>Reprendre la préparation</Button> : null}
        </section>
      </div>

      {documents.state === "error" ? <Alert variant="danger">
        <p>Les documents CCTP ne peuvent pas être chargés. La référence et son historique restent consultables.</p>
        <Button className="mt-3" variant="outline" disabled={busy} onClick={() => router.refresh()}>Réessayer les documents</Button>
      </Alert> : documents.state === "readonly" ? <Alert>La consultation est disponible. Votre rôle ou le statut de ce chiffrage ne permet pas de préparer une nouvelle référence.</Alert> : <section aria-label="Documents CCTP du dossier" className={panel}>
        <h2 className="mb-2 text-lg font-semibold">Documents CCTP du dossier</h2>
        <p className="mb-4 text-sm text-muted-foreground">Choisissez le document à conserver. Son nom et sa date de dépôt ne valent pas confirmation.</p>
        {documents.items.length ? <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
          <div className="w-full min-w-0 flex-1">
            <label htmlFor="source-reference-document" className="mb-2 block text-sm font-medium">Document CCTP</label>
            <select id="source-reference-document" value={documentId} disabled={busy || Boolean(pendingConfirmation) || interruptedPreparation}
              onChange={(event) => setDocumentId(event.target.value)} className="w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm">
              <option value="">Choisir un document</option>
              {documents.items.map((document) => <option key={document.id} value={document.id} data-testid={`source-reference-document-${document.id}`}>
                {document.fileName} · {sourceReferenceDate(document.createdAt)} · {document.byteSize.toLocaleString("fr-FR")} octets
              </option>)}
            </select>
          </div>
          <Button loading={controller.busy === "prepare"} disabled={busy || !documentId || Boolean(pendingConfirmation) || interruptedPreparation || Boolean(controller.storageError)}
            onClick={() => void controller.prepare(documentId)}>Préparer une copie</Button>
        </div> : <p>Aucun document CCTP PDF disponible sur cette page. Ajoutez ou classez les documents dans le dossier de l’affaire.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={`/dashboard/affaires/${controller.review.projectId}`} className={buttonVariants({ variant: "link" })}>Ouvrir le dossier de l’affaire</a>
          {documents.page > 1 ? <a href={`?documentsPage=${documents.page - 1}`} className={buttonVariants({ variant: "outline" })}>Documents précédents</a> : null}
          {documents.hasNext && documents.page < 9999 ? <a href={`?documentsPage=${documents.page + 1}`} className={buttonVariants({ variant: "outline" })}>Documents suivants</a> : null}
        </div>
      </section>}

      {controller.viewer ? <section aria-label="Consultation du CCTP" className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 ref={viewerHeading} tabIndex={-1} className="text-lg font-semibold outline-none">Consultation du CCTP</h2>
          <Button variant="outline" onClick={controller.closeViewer}>Fermer la consultation</Button>
        </div>
        <p className="mb-3 break-words text-sm">{controller.viewer.fileName} — copie conservée vérifiée</p>
        <iframe src={controller.viewer.url} title="Copie conservée du CCTP" className="h-[65vh] min-h-80 w-full rounded-lg border border-border" />
        <a href={controller.viewer.url} target="_blank" rel="noopener noreferrer" className={`${buttonVariants({ variant: "link" })} mt-3`}>Ouvrir la copie dans un nouvel onglet</a>
      </section> : null}

      {(controller.prepared || pendingConfirmation) ? <section aria-label="Confirmation de la référence" className={panel}>
        <h2 className="mb-4 text-lg font-semibold">Confirmation de la référence</h2>
        {pendingConfirmation ? <Alert variant="warning"><p>Une confirmation attend son résultat. La reprise conserve exactement la copie, le motif et la révision de cette demande.</p>
          {controller.review.confirmationReceipt ? <p>Un reçu est disponible. Reprenez la confirmation pour récupérer son résultat.</p> : null}</Alert> : isCurrentCopy ? <Alert>Cette copie est déjà la référence actuelle.</Alert> : null}
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input type="checkbox" checked={controller.humanReviewed} disabled={busy || !reviewedPreparedCopy || Boolean(pendingConfirmation) || !canPrepare || isCurrentCopy}
            onChange={(event) => controller.setHumanReviewed(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
          <span>J’ai consulté cette copie</span>
        </label>
        <p className="mt-2 text-sm text-muted-foreground">La vérification du fichier confirme ses octets. Votre lecture et votre décision restent nécessaires.</p>
        <label htmlFor="source-reference-reason" className="mb-2 mt-4 block text-sm font-medium">Motif de confirmation</label>
        <Textarea id="source-reference-reason" value={reasonValue} onChange={(event) => setReason(event.target.value)}
          readOnly={Boolean(pendingConfirmation)} disabled={busy || (!canPrepare && !pendingConfirmation)} aria-describedby="source-reference-reason-help" />
        <p id="source-reference-reason-help" className="mt-2 text-sm text-muted-foreground">Expliquez le choix de cette référence. {reasonLength}/1000 caractères.</p>
        {pendingConfirmation ? <Button className="mt-4" loading={controller.busy === "confirm"} disabled={busy || !canReplay || Boolean(controller.storageError)} onClick={() => void controller.confirm()}>Reprendre la confirmation</Button> : <Button className="mt-4" loading={controller.busy === "confirm"}
          disabled={busy || !canPrepare || !reviewedPreparedCopy || !controller.humanReviewed || reasonLength < 1 || reasonLength > 1000 || isCurrentCopy || Boolean(controller.storageError)}
          onClick={() => void controller.confirm(reason)}>Confirmer la référence</Button>}
      </section> : null}

      <section aria-label="Historique des références" className={panel}>
        <h2 className="mb-4 text-lg font-semibold">Historique des références</h2>
        {history.length ? <ol className="divide-y divide-border">
          {history.map((entry) => <li key={entry.id} data-testid={`source-reference-event-${entry.id}`} className="py-4 first:pt-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{sourceReferenceDate(entry.occurredAt)} · {entry.actorName || "Auteur non renseigné"}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">{entry.copyId === controller.review.activeReference?.copyId && entry.revision === controller.review.revision ? "Référence actuelle" : "Ancienne confirmation"}</p>
              </div>
              <Button variant="outline" disabled={busy} onClick={() => void controller.consult(entry.copyId)}>{entry.revision === controller.review.revision ? "Consulter cette copie" : "Consulter cette ancienne copie"}</Button>
            </div>
          </li>)}
        </ol> : <p className="text-sm text-muted-foreground">Aucune confirmation enregistrée.</p>}
        {controller.nextCursor ? <Button className="mt-4" variant="outline" loading={controller.busy === "history"} disabled={busy} onClick={() => void controller.moreHistory()}>Charger les références précédentes</Button> : null}
      </section>
    </div>
  );
}
