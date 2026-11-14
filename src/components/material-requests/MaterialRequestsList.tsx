"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchMaterialRequests } from "@/lib/material-requests/client";
import type { MaterialRequestListItem, MaterialRequestSummary } from "@/lib/material-requests/contracts";

import { formatDateOnly, materialRequestHref, plural } from "./format";
import { LoadFailure } from "./LoadFailure";
import { NewMaterialRequestDialog } from "./NewMaterialRequestDialog";
import { useRetryableLoad } from "./useRetryableLoad";

function validationProgress(request: MaterialRequestSummary): string {
  if (request.line_count === 0) return "Aucune ligne";
  return `${plural(request.validated_line_count, "ligne validée", "lignes validées")} sur ${request.line_count}`;
}

/**
 * What is left to order (TI-691): said plainly once some lines are in an order, so that a request whose last line
 * stayed behind does not read as done.
 */
function OrderingProgress({ request }: Readonly<{ request: MaterialRequestListItem }>) {
  if (request.line_count === 0 || request.to_order_line_count === null) return null;
  // « Commandé » is said of a confirmed order only (the supply cost's word): here, a line is in a purchase order or not.
  if (request.to_order_line_count === 0) {
    return <span className="font-medium text-success">Toutes les lignes ont leur bon de commande</span>;
  }
  const lines = plural(request.to_order_line_count, "ligne", "lignes");
  return request.has_orders ? (
    <Badge variant="warning">{`${lines} sans bon de commande`}</Badge>
  ) : (
    <span>{`${lines} à commander`}</span>
  );
}

/**
 * Where the request stands in the purchase, in a few words, from what the list knows. It numbers a step only when
 * it is sure of it (the lines): past them, the list does not know whether a line is priced, so it says what is left
 * rather than a step the request's own page could contradict. Nothing is said when the orders could not be read.
 */
function requestStage(request: MaterialRequestListItem): { label: string; variant: "neutral" | "warning" | "info" | "success" } | null {
  if (request.line_count === 0) return { label: "Lignes à saisir", variant: "neutral" };
  if (request.validated_line_count < request.line_count) return { label: "Étape 1 · Lignes", variant: "warning" };
  if (request.to_order_line_count == null) return null;
  if (request.to_order_line_count === 0) return { label: "Bons de commande faits", variant: "success" };
  return { label: "À chiffrer ou à commander", variant: "info" };
}

function RequestRow({ projectId, request }: Readonly<{ projectId: string; request: MaterialRequestListItem }>) {
  const done = request.line_count > 0 && request.validated_line_count === request.line_count;
  const stage = requestStage(request);
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
            {stage ? <Badge variant={stage.variant}>{stage.label}</Badge> : null}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className={done ? "font-medium text-success" : undefined}>{validationProgress(request)}</span>
            <OrderingProgress request={request} />
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
  const { data: list, setData: setList, error, reload } = useRetryableLoad(
    fetchMaterialRequests, projectId, "Les demandes de matériel n’ont pas pu être chargées.",
  );
  const [creating, setCreating] = useState(false);
  /**
   * One dialog instance per opening. The dialog stays mounted once closed, and what it holds (the form,
   * a request created without its photos, the guard against a double submit) must never greet the next
   * request: a new key gives the next opening a blank dialog. The closed instance cannot be creating,
   * since the dialog refuses to close while it is.
   */
  const [opening, setOpening] = useState(0);
  const headingId = useId();

  if (error && !list) {
    return <LoadFailure title="Les demandes de matériel n’ont pas pu être affichées." message={error} onRetry={reload} />;
  }
  if (!list) return <LoadingState label="Chargement des demandes de matériel…" />;

  const newRequest = list.canWrite ? (
    <Button
      type="button"
      onClick={() => {
        setOpening((current) => current + 1);
        setCreating(true);
      }}
    >
      <Plus aria-hidden="true" />
      Nouvelle demande
    </Button>
  ) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="typo-h3 text-foreground">
            Demandes de matériel
          </h2>
          {list.items.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {`${plural(list.items.length, "demande", "demandes")} · chacune avance en trois étapes : lignes, devis, bons de commande.`}
            </p>
          ) : null}
        </div>
        {list.items.length > 0 ? newRequest : null}
      </div>
      {list.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="Aucune demande de matériel"
          headingLevel={3}
          description={
            list.canWrite
              ? "Recopiez ici le papier, le SMS ou l’appel d’un technicien : l’original reste à côté des lignes."
              : "Aucune demande n’a encore été saisie pour cette affaire."
          }
          action={newRequest}
        />
      ) : (
        <>
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
          key={opening}
          open={creating}
          onRequestCreated={reload}
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
    </section>
  );
}
