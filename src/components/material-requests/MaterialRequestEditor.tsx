"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { History, MessageSquareText, Trash2 } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  deleteMaterialRequest,
  fetchMaterialRequestTechnicians,
  materialRequestErrorMessage,
} from "@/lib/material-requests/client";
import type { MaterialRequestTechnician } from "@/lib/material-requests/contracts";

import { ConfirmButton } from "./cells";
import { ClarificationMessageDialog } from "./ClarificationMessageDialog";
import { materialRequestsHref } from "./format";
import { MaterialRequestConsultation } from "./MaterialRequestConsultation";
import { MaterialRequestHeader } from "./MaterialRequestHeader";
import { MaterialRequestLines } from "./MaterialRequestLines";
import { MaterialRequestOrders, MaterialRequestToOrderReminder } from "./MaterialRequestOrders";
import { MaterialRequestOriginal } from "./MaterialRequestOriginal";
import { TechnicianHistorySheet } from "./TechnicianHistorySheet";
import { useMaterialRequestEditor, type MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import { useMaterialRequestOrders } from "./useMaterialRequestOrders";

function ReadyEditor({
  editor,
  affaireName,
  canEditCatalogue,
}: Readonly<{ editor: MaterialRequestEditorApi; affaireName: string; canEditCatalogue: boolean }>) {
  const router = useRouter();
  const ids = useId();
  const materialListId = `${ids}-materials`;
  const [technicians, setTechnicians] = useState<MaterialRequestTechnician[]>([]);
  const [messageOpen, setMessageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data, canWrite, projectId, requestId } = editor;
  const orders = useMaterialRequestOrders(editor);

  useEffect(() => {
    const abort = new AbortController();
    fetchMaterialRequestTechnicians(abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setTechnicians(items);
      })
      .catch(() => {
        // The select then offers the request's own technician only.
      });
    return () => abort.abort();
  }, []);

  const known = data.technician ? [data.technician, ...technicians.filter((item) => item.id !== data.technician?.id)] : technicians;
  const technician = known.find((item) => item.id === data.request.technician_id) ?? null;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto">
        <MaterialRequestOriginal editor={editor} headingId={`${ids}-original`} />
      </div>
      <div className="min-w-0 space-y-6">
        {canWrite ? null : (
          <Alert variant="info">
            <AlertDescription>Vous consultez cette demande en lecture seule.</AlertDescription>
          </Alert>
        )}
        <MaterialRequestHeader editor={editor} technicians={known} materialListId={materialListId} />
        <MaterialRequestToOrderReminder editor={editor} orders={orders} />
        <datalist id={materialListId}>
          {data.materialOptions.map((material) => (
            <option key={material} value={material} />
          ))}
        </datalist>
        <MaterialRequestLines
          editor={editor}
          materialListId={materialListId}
          headingId={`${ids}-lines`}
          orderedLine={orders.orderedLine}
          canEditCatalogue={canEditCatalogue}
          toolbar={
            <>
              <Button type="button" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-1.5" onClick={() => setMessageOpen(true)}>
                <MessageSquareText aria-hidden="true" />
                Message au technicien
              </Button>
              {technician ? (
                <Button type="button" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-1.5" onClick={() => setHistoryOpen(true)}>
                  <History aria-hidden="true" />
                  Demandes précédentes de {technician.name}
                </Button>
              ) : null}
            </>
          }
        />
        <MaterialRequestConsultation editor={editor} affaireName={affaireName} headingId={`${ids}-consultation`} />
        <MaterialRequestOrders editor={editor} orders={orders} headingId={`${ids}-orders`} />
        {canWrite ? (
          <div className="border-t border-border pt-4">
            <ConfirmButton
              variant="outline"
              label="Supprimer la demande"
              confirmLabel="Confirmer la suppression de la demande"
              confirmText="Supprimer la demande et ses lignes ?"
              onConfirm={async () => {
                try {
                  await deleteMaterialRequest(projectId, requestId);
                  router.push(materialRequestsHref(projectId));
                } catch (error) {
                  setDeleteError(materialRequestErrorMessage(error, "La demande n’a pas pu être supprimée."));
                }
              }}
            >
              <Trash2 aria-hidden="true" />
              Supprimer la demande
            </ConfirmButton>
            {deleteError ? (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {deleteError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <ClarificationMessageDialog
        open={messageOpen}
        onOpenChange={setMessageOpen}
        technicianName={technician?.name ?? null}
        context={editor.alertContext}
      />
      {technician ? (
        <TechnicianHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          technician={technician}
          currentRequestId={requestId}
          canCopy={canWrite}
          onCopy={(line) => editor.addLines([line])}
        />
      ) : null}
    </div>
  );
}

/**
 * One material request (TI-690): the original on one side, its rewriting on the other. The operator
 * types; the screen keeps what is missing or doubtful in view and validates nothing by itself.
 */
export function MaterialRequestEditor({
  projectId,
  requestId,
  affaireName = "",
  canEditCatalogue = false,
}: Readonly<{
  projectId: string;
  requestId: string;
  /** Named in the message that asks a supplier for a price. */
  affaireName?: string;
  /** May set a supply type's preferred supplier from the request (admins and engineers). */
  canEditCatalogue?: boolean;
}>) {
  const state = useMaterialRequestEditor(projectId, requestId);

  if (state.status === "loading") return <LoadingState label="Chargement de la demande…" />;
  if (state.status === "error") {
    return (
      <Alert variant="danger">
        <AlertTitle>La demande n’a pas pu être affichée.</AlertTitle>
        <AlertDescription>
          <p>{state.message}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={state.retry}>
            Réessayer
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return <ReadyEditor editor={state.editor} affaireName={affaireName} canEditCatalogue={canEditCatalogue} />;
}
