"use client";

import { useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@base-ui/react/tabs";
import { MessageSquareText } from "lucide-react";

import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  deleteMaterialRequest,
  fetchMaterialRequestTechnicians,
  materialRequestErrorMessage,
} from "@/lib/material-requests/client";
import type { MaterialRequestTechnician } from "@/lib/material-requests/contracts";

import { ClarificationMessageDialog } from "./ClarificationMessageDialog";
import { materialRequestsHref } from "./format";
import { MaterialRequestConsultation } from "./MaterialRequestConsultation";
import { MaterialRequestHeader, MaterialRequestSummary, requestFieldsOpenAtStart } from "./MaterialRequestHeader";
import { MaterialRequestLines } from "./MaterialRequestLines";
import { MaterialRequestOptions } from "./MaterialRequestOptions";
import { MaterialRequestOrders } from "./MaterialRequestOrders";
import { MaterialRequestOriginalDialog } from "./MaterialRequestOriginal";
import { MaterialRequestSteps, requestStepPanelId } from "./MaterialRequestSteps";
import { REQUEST_STEP_KEYS, requestSteps, type RequestStepKey } from "./request-steps";
import { TechnicianHistorySheet } from "./TechnicianHistorySheet";
import { useMaterialRequestEditor, type MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import { useMaterialRequestOrders } from "./useMaterialRequestOrders";
import { useMaterialRequestQuotes } from "./useMaterialRequestQuotes";

import "./material-request-workbench.css";

const STEP_PARAM = "etape";
type RequestPageHeader = Pick<ComponentProps<typeof PageHeader>, "breadcrumbs" | "back">;

function requestHeader(pageHeader: RequestPageHeader, actions?: ReactNode) {
  return <PageHeader {...pageHeader} actions={actions} title="Demande de matériel" className="mb-2 sm:mb-2" />;
}

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
  canCreateSupplyType,
  pageHeader,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  affaireName: string;
  canEditCatalogue: boolean;
  canCreateSupplyType: boolean;
  pageHeader?: RequestPageHeader;
}>) {
  const router = useRouter();
  const ids = useId();
  const materialListId = `${ids}-materials`;
  const [technicians, setTechnicians] = useState<MaterialRequestTechnician[]>([]);
  const [messageOpen, setMessageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [materialFocusRequest, setMaterialFocusRequest] = useState(0);
  const { data, canWrite, projectId, requestId, alertsByLine } = editor;
  const requestFieldsId = `${ids}-request-fields`;
  const [requestFieldsOpen, setRequestFieldsOpen] = useState(() => requestFieldsOpenAtStart(data.request, canWrite));
  const [focusRequestFields, setFocusRequestFields] = useState(false);
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
  // After a navigation button is clicked, the focus follows to the step's panel once rendered.
  useEffect(() => {
    if (!focusStep) return;
    setFocusStep(null);
    // The step opens under its tabs: the page stays where the office reads the head.
    document.getElementById(requestStepPanelId(ids, focusStep))?.focus({ preventScroll: true });
  }, [focusStep, ids]);

  // « Modifier la demande », from any step: the fields open on the lines step, the focus on the first one a writer can
  // change (a reader gets the fields themselves).
  const editRequest = () => {
    openStep("lignes");
    setRequestFieldsOpen(true);
    setFocusRequestFields(true);
  };
  useEffect(() => {
    if (!focusRequestFields) return;
    setFocusRequestFields(false);
    const fields = document.getElementById(requestFieldsId);
    const first = fields?.querySelector<HTMLElement>("input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
    (first ?? fields)?.focus();
  }, [focusRequestFields, requestFieldsId]);

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
  const headerActions = (
    <div className="flex w-full min-w-0 items-start justify-between gap-3 md:max-w-[min(49vw,45rem)] md:items-center md:gap-6">
      <MaterialRequestSummary editor={editor} technicianName={technician?.name ?? null} />
      <MaterialRequestOptions
        canWrite={canWrite}
        technicianName={technician?.name ?? null}
        hasOrderedLines={(orders.summary?.ordered.length ?? 0) > 0}
        onEdit={editRequest}
        onHistory={() => setHistoryOpen(true)}
        onDelete={async () => {
          try {
            await deleteMaterialRequest(projectId, requestId);
            router.push(materialRequestsHref(projectId));
            return null;
          } catch (error) {
            return materialRequestErrorMessage(error, "La demande n’a pas pu être supprimée.");
          }
        }}
      />
    </div>
  );

  return (
    <Tabs.Root
      value={step}
      onValueChange={(value) => openStep(value as RequestStepKey)}
      className="material-request-editor space-y-0"
    >
      {pageHeader ? requestHeader(pageHeader, headerActions) : <div className="mb-3">{headerActions}</div>}
      {data.request.note ? (
        <dl className="mb-2 flex min-w-0 items-baseline gap-3">
          <dt className="text-xs text-muted-foreground">Note</dt>
          <dd className="min-w-0 break-words text-sm font-medium text-foreground">{data.request.note}</dd>
        </dl>
      ) : null}
      {canWrite ? null : (
        <Alert variant="info">
          <AlertDescription>Vous consultez cette demande en lecture seule.</AlertDescription>
        </Alert>
      )}
      <MaterialRequestSteps steps={model.steps} active={step} idBase={ids} />
      {/* Each step has the whole width of the page: the lines are a table, as in the estimate editor. */}
      <div className="min-w-0">
        <div className="min-w-0">
          <datalist id={materialListId}>
            {data.materialOptions.map((material) => (
              <option key={material} value={material} />
            ))}
          </datalist>
          <Tabs.Panel {...panel("lignes")}>
            <MaterialRequestHeader
              editor={editor}
              technicians={known}
              materialListId={materialListId}
              fieldsId={requestFieldsId}
              open={requestFieldsOpen}
              onOpenChange={setRequestFieldsOpen}
              materialFocusRequest={materialFocusRequest}
            />
            <MaterialRequestLines
              editor={editor}
              materialListId={materialListId}
              headingId={`${ids}-lines`}
              orderedLine={orders.orderedLine}
              orderStatusKnown={orders.status === "ready" && !orders.refreshing && !orders.creating}
              onReviewPresumedMaterial={() => {
                // The fields of the request open, then the focus goes to the confirmation of the material.
                setRequestFieldsOpen(true);
                setMaterialFocusRequest((current) => current + 1);
              }}
              canEditCatalogue={canEditCatalogue}
              canCreateSupplyType={canCreateSupplyType}
              toolbar={
                // The technician's previous requests are among the options of the request, behind its gear.
                <>
                  <MaterialRequestOriginalDialog editor={editor} />
                  <Button type="button" variant="outline" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal py-1" onClick={() => setMessageOpen(true)}>
                    <MessageSquareText aria-hidden="true" />
                    Message au technicien
                  </Button>
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
              canCreateSupplier={canEditCatalogue}
              visible={step === "devis"}
              onGoToLines={() => goToStep("lignes")}
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
  canCreateSupplyType = false,
  pageHeader,
}: Readonly<{
  projectId: string;
  requestId: string;
  /** Named in the message that asks a supplier for a price. */
  affaireName?: string;
  /** May set a supply type's preferred supplier from the request (admins and engineers). */
  canEditCatalogue?: boolean;
  /** May add a supply type from the article a line names (admins only). */
  canCreateSupplyType?: boolean;
  pageHeader?: RequestPageHeader;
}>) {
  const state = useMaterialRequestEditor(projectId, requestId);

  if (state.status === "loading") {
    return (
      <>
        {pageHeader ? requestHeader(pageHeader) : null}
        <LoadingState label="Chargement de la demande…" />
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        {pageHeader ? requestHeader(pageHeader) : null}
        <Alert variant="danger">
          <AlertTitle>La demande n’a pas pu être affichée.</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={state.retry}>
              Réessayer
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }
  return (
    <ReadyEditor
      editor={state.editor}
      affaireName={affaireName}
      canEditCatalogue={canEditCatalogue}
      canCreateSupplyType={canCreateSupplyType}
      pageHeader={pageHeader}
    />
  );
}
