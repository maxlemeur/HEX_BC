"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@base-ui/react/tabs";
import { ArrowRight, History, MessageSquareText, Trash2 } from "lucide-react";

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
import { MaterialRequestOrders } from "./MaterialRequestOrders";
import { MaterialRequestOriginal } from "./MaterialRequestOriginal";
import { MaterialRequestSteps, requestStepPanelId } from "./MaterialRequestSteps";
import { REQUEST_STEP_KEYS, requestSteps, type RequestStepKey } from "./request-steps";
import { TechnicianHistorySheet } from "./TechnicianHistorySheet";
import { useMaterialRequestEditor, type MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import { useMaterialRequestOrders } from "./useMaterialRequestOrders";
import { useMaterialRequestQuotes } from "./useMaterialRequestQuotes";

import "./material-request-workbench.css";

const STEP_PARAM = "etape";

/** The step named in the address, when it names one: a reload or a shared link opens the same step. */
function stepFromAddress(): RequestStepKey | null {
  if (typeof window === "undefined") return null;
  const named = new URLSearchParams(window.location.search).get(STEP_PARAM);
  return REQUEST_STEP_KEYS.find((key) => key === named) ?? null;
}

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
  const { data, canWrite, projectId, requestId, alertsByLine } = editor;
  const orders = useMaterialRequestOrders(editor);
  const quotes = useMaterialRequestQuotes(editor);

  const model = useMemo(
    () =>
      requestSteps({
        hasSourceText: Boolean(data.request.source_text?.trim()),
        lines: data.lines,
        blockingLineIds: new Set(
          data.lines
            .filter((line) => line.status === "draft" && (alertsByLine.get(line.id) ?? []).some((alert) => alert.blocking))
            .map((line) => line.id),
        ),
        quotes: quotes.status === "ready" ? quotes.items : null,
        orders: orders.summary
          ? {
              ready: orders.summary.ready_line_ids.length,
              ordered: new Set(orders.summary.ordered.map((entry) => entry.line_id)).size,
              canCreate: canWrite && orders.summary.can_create,
            }
          : null,
      }),
    [alertsByLine, canWrite, data.lines, data.request.source_text, orders.summary, quotes.items, quotes.status],
  );
  // Opened once, on the step that has work when the request is read (or the one the address names). It then moves
  // only when the office moves it: finishing a step never takes the screen away from under the hands.
  const [step, setStep] = useState<RequestStepKey>(() => stepFromAddress() ?? model.next.step);
  const [focusStep, setFocusStep] = useState<RequestStepKey | null>(null);

  const openStep = (next: RequestStepKey) => {
    setStep(next);
    const url = new URL(window.location.href);
    url.searchParams.set(STEP_PARAM, next);
    // The router's own state is kept: a foreign one would make Next restore the page.
    window.history.replaceState(window.history.state, "", url);
  };
  const goToStep = (next: RequestStepKey) => {
    openStep(next);
    setFocusStep(next);
  };
  // After « Aller à l’étape … », the focus follows to the step's panel, which is only shown once rendered.
  useEffect(() => {
    if (!focusStep) return;
    setFocusStep(null);
    // The step opens under its tabs: the page stays where the office reads the head.
    document.getElementById(requestStepPanelId(ids, focusStep))?.focus({ preventScroll: true });
  }, [focusStep, ids]);

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
  const panel = (key: RequestStepKey) => ({
    value: key,
    id: requestStepPanelId(ids, key),
    keepMounted: true,
    // What a step holds (a price being typed, a creation under way) stays while another step is shown.
    className: "min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
  });

  return (
    <Tabs.Root
      value={step}
      onValueChange={(value) => openStep(value as RequestStepKey)}
      className="material-request-editor space-y-0"
    >
      {canWrite ? null : (
        <Alert variant="info">
          <AlertDescription>Vous consultez cette demande en lecture seule.</AlertDescription>
        </Alert>
      )}
      {step === "lignes" ? <p className="mb-2 text-base text-foreground-secondary">Table de pilotage</p> : null}
      <MaterialRequestSteps model={model} active={step} canWrite={canWrite} idBase={ids} onGoTo={goToStep} />
      {/* Each step has the whole width of the page: the lines are a table, as in the estimate editor. */}
      <div className="min-w-0">
        <div className="min-w-0">
          <datalist id={materialListId}>
            {data.materialOptions.map((material) => (
              <option key={material} value={material} />
            ))}
          </datalist>
          <Tabs.Panel {...panel("lignes")}>
            <MaterialRequestHeader compact editor={editor} technicians={known} materialListId={materialListId} />
            <MaterialRequestLines
              editor={editor}
              materialListId={materialListId}
              headingId={`${ids}-lines`}
              orderedLine={orders.orderedLine}
              canEditCatalogue={canEditCatalogue}
              original={<MaterialRequestOriginal compact editor={editor} headingId={`${ids}-original`} />}
              nextAction={<Button type="button" onClick={() => goToStep("devis")}><ArrowRight aria-hidden="true" />Consulter les devis</Button>}
              toolbar={
                <>
                  <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1" onClick={() => setMessageOpen(true)}>
                    <MessageSquareText aria-hidden="true" />
                    Message au technicien
                  </Button>
                  {technician ? (
                    <Button type="button" variant="outline" size="sm" aria-label={`Demandes précédentes de ${technician.name}`} title={`Demandes précédentes de ${technician.name}`} className="h-auto min-h-8 max-w-full whitespace-normal py-1" onClick={() => setHistoryOpen(true)}>
                      <History aria-hidden="true" />
                      Historique
                    </Button>
                  ) : null}
                </>
              }
            />
          </Tabs.Panel>
          <Tabs.Panel {...panel("devis")}>
            <MaterialRequestConsultation
              editor={editor}
              quotes={quotes}
              affaireName={affaireName}
              headingId={`${ids}-consultation`}
              onGoToLines={() => goToStep("lignes")}
              onGoToOrders={() => goToStep("commande")}
            />
          </Tabs.Panel>
          <Tabs.Panel {...panel("commande")}>
            <MaterialRequestOrders
              editor={editor}
              orders={orders}
              headingId={`${ids}-orders`}
              onGoToStep={goToStep}
            />
          </Tabs.Panel>
        </div>
      </div>
      {canWrite ? (
        <details className="mr-request-actions border-t border-border py-3 text-sm"><summary role="button" className="w-fit cursor-pointer font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">Demande</summary><div className="mt-3">
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
        </div></details>
      ) : null}
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
    </Tabs.Root>
  );
}

/**
 * One material request (TI-690, TI-691): what the technician sent on one side, and on the other the purchase one
 * step at a time (lines, quotes, purchase orders), under a head that says what to do next. The operator types; the
 * screen keeps what is missing or doubtful in view and validates nothing by itself.
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
