"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchMaterialRequests,
  materialRequestErrorMessage,
  type MaterialRequestList,
} from "@/lib/material-requests/client";
import type { MaterialRequestSummary } from "@/lib/material-requests/contracts";

import { formatDateOnly, materialRequestHref, plural } from "./format";
import { NewMaterialRequestDialog } from "./NewMaterialRequestDialog";

function validationProgress(request: MaterialRequestSummary): string {
  if (request.line_count === 0) return "Aucune ligne";
  return `${plural(request.validated_line_count, "ligne validée", "lignes validées")} sur ${request.line_count}`;
}

function RequestRow({ projectId, request }: Readonly<{ projectId: string; request: MaterialRequestSummary }>) {
  const done = request.line_count > 0 && request.validated_line_count === request.line_count;
  return (
    <li>
      <Link
        href={materialRequestHref(projectId, request.id)}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
            <span>Demande du {formatDateOnly(request.requested_on)}</span>
            <span className="font-normal text-muted-foreground">·</span>
            <span>{request.technician_name ?? "Technicien non renseigné"}</span>
            {request.is_urgent ? <Badge variant="danger">Urgent</Badge> : null}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className={done ? "font-medium text-success" : undefined}>{validationProgress(request)}</span>
            {request.needed_on ? <span>Pour le {formatDateOnly(request.needed_on)}</span> : null}
            {request.file_count > 0 ? <span>{plural(request.file_count, "photo", "photos")}</span> : null}
          </p>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** The material requests of one affaire, most recent first as the server returns them. */
export function MaterialRequestsList({ projectId }: Readonly<{ projectId: string }>) {
  const [list, setList] = useState<MaterialRequestList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    fetchMaterialRequests(projectId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setList(next);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setError(materialRequestErrorMessage(cause, "Les demandes de matériel n’ont pas pu être chargées."));
        }
      });
    return () => abort.abort();
  }, [projectId, attempt]);

  if (error && !list) {
    return (
      <Alert variant="danger">
        <AlertTitle>Les demandes de matériel n’ont pas pu être affichées.</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setError(null);
              setAttempt((current) => current + 1);
            }}
          >
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!list) return <LoadingState label="Chargement des demandes de matériel…" />;

  const newRequest = list.canWrite ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      Nouvelle demande
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      {list.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="Aucune demande de matériel"
          headingLevel={2}
          description={
            list.canWrite
              ? "Recopiez ici le papier, le SMS ou l’appel d’un technicien : l’original reste à côté des lignes."
              : "Aucune demande n’a encore été saisie pour cette affaire."
          }
          action={newRequest}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{plural(list.items.length, "demande", "demandes")}</p>
            {newRequest}
          </div>
          <ul
            aria-label="Demandes de matériel"
            className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface"
          >
            {list.items.map((request) => (
              <RequestRow key={request.id} projectId={projectId} request={request} />
            ))}
          </ul>
        </>
      )}
      {list.canWrite ? (
        <NewMaterialRequestDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={projectId}
          technicians={list.technicians}
          onTechnicianCreated={(technician) =>
            setList((current) =>
              current ? { ...current, technicians: [...current.technicians, technician] } : current,
            )
          }
        />
      ) : null}
    </div>
  );
}
