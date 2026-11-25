"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, ShoppingCart } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MaterialRequestOrder } from "@/lib/material-requests/client";
import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import type { MaterialRequestOrderNotReadyReason } from "@/lib/material-requests/order-contracts";
import { formatEUR } from "@/lib/money";
import { formatQuantity, formatQuotedPrice, lineNamesLabel, lineTitle, purchaseOrderHref, purchaseOrderStatusLabel } from "./format";
import { MaterialRequestWorkspace, MaterialRequestWorkspaceChoice } from "./MaterialRequestWorkspace";
import { REQUEST_STEP_KEYS, type RequestStepKey } from "./request-steps";
import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import type { MaterialRequestOrdersApi } from "./useMaterialRequestOrders";
import { plural } from "@/lib/text/plural";

/*
 * « Commandes » (TI-691, lot 2 « l'achat », delivery 3a): the validated lines priced by a retained quote become one
 * draft purchase order per supplier, overhead lines included in their supplier's draft. Nothing is sent.
 */

const NOT_READY_REASONS: Record<MaterialRequestOrderNotReadyReason, string> = {
  not_validated: "à valider",
  not_priced: "sans devis retenu",
  no_supplier: "sans fournisseur",
  waiting_quote: "attend la validation des autres lignes du devis remisé",
};

/** The step where each reason is settled. */
const REASON_STEP: Record<MaterialRequestOrderNotReadyReason, RequestStepKey> = {
  not_validated: "lignes",
  not_priced: "devis",
  no_supplier: "lignes",
  waiting_quote: "lignes",
};

/**
 * Once some lines of the request are in a purchase order, those that are in none are said at the top of the step,
 * by reason and with what to do (TI-691: on a long request, a line left behind is the one the technician waits for).
 * The head of the page counts them too, whatever the step shown.
 */
export function MaterialRequestToOrderReminder({
  editor,
  orders,
  children,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  orders: MaterialRequestOrdersApi;
  /** Where each of these lines is settled: the links to the steps, read under the reasons. */
  children?: ReactNode;
}>) {
  const { summary } = orders;
  if (!summary || summary.ordered.length === 0) return null;
  const { linesById } = editor;
  const groups = new Map<MaterialRequestOrderNotReadyReason | "ready", MaterialRequestLine[]>();
  const add = (reason: MaterialRequestOrderNotReadyReason | "ready", lineId: string) => {
    const line = linesById.get(lineId);
    if (line) groups.set(reason, [...(groups.get(reason) ?? []), line]);
  };
  for (const lineId of summary.ready_line_ids) add("ready", lineId);
  for (const entry of summary.not_ready) add(entry.reason, entry.line_id);
  const left = [...groups.values()].reduce((total, lines) => total + lines.length, 0);
  if (left === 0) return null;
  const order: Array<MaterialRequestOrderNotReadyReason | "ready"> = ["no_supplier", "not_priced", "not_validated", "waiting_quote", "ready"];
  return (
    <Alert variant="warning" className="px-3 py-2">
      <AlertTitle>
        {plural(left, "ligne sans bon de commande", "lignes sans bon de commande")}
      </AlertTitle>
      <AlertDescription>
        <ul aria-label="Lignes à commander encore" className="mt-1 list-disc space-y-0.5 pl-5">
          {order.flatMap((reason) => {
            // Named by what they ask, in the order of the request: no number shows on screen to point at.
            const lines = [...(groups.get(reason) ?? [])].sort((first, second) => first.position - second.position);
            if (lines.length === 0) return [];
            const explanation = reason === "ready"
              ? (lines.length > 1 ? "prêtes à commander" : "prête à commander")
              : reason === "waiting_quote" && lines.length > 1
                ? "attendent la validation des autres lignes de leur devis remisé"
                : NOT_READY_REASONS[reason];
            return [<li key={reason}>{`${lineNamesLabel(lines.map((line) => lineTitle(line)))}, ${explanation}.`}</li>];
          })}
        </ul>
        {children}
      </AlertDescription>
    </Alert>
  );
}

const STATUS_VARIANT: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  sent: "info",
  confirmed: "info",
  received: "success",
  canceled: "danger",
};

function OrderItem({ order, selected, onSelect }: Readonly<{ order: MaterialRequestOrder; selected: boolean; onSelect: () => void }>) {
  return (
    <MaterialRequestWorkspaceChoice
      label={`Afficher le bon ${order.reference}`}
      title={<><span>{order.reference}</span>{" "}<span>{order.supplier_name}</span></>}
      status={<Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{purchaseOrderStatusLabel(order.status)}</Badge>}
      scope={plural(order.line_count, "ligne", "lignes")}
      amount={`${formatEUR(order.total_ht_cents)} HT`}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

/**
 * The « Bons de commande » step of a request, after the quotes: how many lines are ready, the creation, why the
 * others are not, and the drafts made. A reader sees all of it but the creation.
 */
export function MaterialRequestOrders({
  editor,
  orders,
  headingId,
  onGoToStep,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  orders: MaterialRequestOrdersApi;
  headingId: string;
  /** Opens the step where a line that is not ready is settled. */
  onGoToStep?: (step: RequestStepKey) => void;
}>) {
  const { canWrite } = editor;
  const { summary, status } = orders;
  // The server says who may create: a writer of the request who may also buy. Until it answers, the request's rights.
  const canCreate = canWrite && (summary ? summary.can_create : true);
  const { linesById } = editor;
  const ready = summary?.ready_line_ids.length ?? 0;
  const notReady = [...(summary?.not_ready ?? [])].sort(
    (left, right) =>
      (linesById.get(left.line_id)?.position ?? Number.MAX_SAFE_INTEGER)
      - (linesById.get(right.line_id)?.position ?? Number.MAX_SAFE_INTEGER),
  );
  // Keep the next work first, with a stable order within each status; canceled orders remain readable.
  const drafts = [...(summary?.orders ?? [])].sort((left, right) => Number(left.status !== "draft") - Number(right.status !== "draft"));
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const selectedOrder = drafts.find((order) => order.id === selectedOrderId)
    ?? drafts.find((order) => order.status === "draft" && order.can_open)
    ?? drafts.find((order) => order.status === "draft")
    ?? drafts[0];
  const selectedLines = summary?.ordered.filter((entry) => entry.purchase_order_id === selectedOrder?.id)
    .flatMap((entry) => { const line = linesById.get(entry.line_id); return line ? [line] : []; }) ?? [];


  // Once orders exist, the lines left behind are said in the reminder over them, with their reasons: not a second
  // time under the orders.
  const reminded = (summary?.ordered.length ?? 0) > 0 && ready + notReady.length > 0;
  const stepLinks = canWrite && onGoToStep && notReady.length > 0 ? (
    <div className="flex flex-wrap gap-x-4">
      {REQUEST_STEP_KEYS.filter((key) => notReady.some((entry) => REASON_STEP[entry.reason] === key)).map((key) => (
        <Button key={key} type="button" variant="link" size="sm" className="px-0" onClick={() => onGoToStep(key)}>
          {key === "lignes" ? "Régler les lignes, à l’étape Lignes" : "Faire chiffrer, à l’étape Devis"}
        </Button>
      ))}
    </div>
  ) : null;
  return (
    <section aria-labelledby={headingId} className="mr-orders min-w-0 space-y-3">
      <h2 id={headingId} className="sr-only">Bons de commande</h2>
      {ready > 0 && canCreate ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-1.5" loading={orders.creating} disabled={orders.refreshing || status !== "ready"} onClick={() => void orders.createDrafts()}>
            <ShoppingCart aria-hidden="true" />
            Créer les brouillons de commande ({ready})
          </Button>
        </div>
      ) : ready > 0 && canWrite ? <p className="text-sm text-muted-foreground">Faites créer les bons de commande</p> : null}
      <MaterialRequestToOrderReminder editor={editor} orders={orders}>{reminded ? stepLinks : null}</MaterialRequestToOrderReminder>
      {summary === null ? status === "error" ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Les bons de commande n’ont pas pu être chargés.</p><Button type="button" variant="outline" size="sm" aria-label="Recharger les bons de commande" onClick={orders.retry}>Réessayer</Button></div> : <p role="status" className="text-sm text-muted-foreground">Chargement des bons de commande…</p> : (
        <>
          {drafts.length > 0 ? <MaterialRequestWorkspace label="Bons de commande de la demande" choices={drafts.map((order) => <OrderItem key={order.id} order={order} selected={selectedOrder?.id === order.id} onSelect={() => setSelectedOrderId(order.id)} />)}>
            {selectedOrder ? <div role="region" aria-label={`Détail du bon ${selectedOrder.reference}`} className="min-w-0 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div>
                  <h3 className="font-display text-lg font-semibold">Bon {selectedOrder.reference}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="break-words">{selectedOrder.supplier_name}</span>
                    <Badge variant={STATUS_VARIANT[selectedOrder.status] ?? "neutral"}>{purchaseOrderStatusLabel(selectedOrder.status)}</Badge>
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums">{formatEUR(selectedOrder.total_ht_cents)} HT</p>
              </div>
              {selectedLines.length > 0 ? (
                // One row per line and grid lines between the columns, as in every table of the application
                // (`sheet-table`); where the prices come from is said once, over them.
                <div className="mt-3 overflow-hidden rounded-lg border border-border">
                  <table className="sheet-table w-full table-fixed border-collapse text-left text-sm">
                    <colgroup><col /><col className="w-18 sm:w-24" /><col className="w-28 sm:w-44" /></colgroup>
                    <thead className="border-b border-border text-xs">
                      <tr>
                        <th scope="col" className="px-3 py-1.5 text-left">Lignes de la demande</th>
                        <th scope="col" className="px-3 py-1.5 text-right">Quantité</th>
                        <th scope="col" className="px-3 py-1.5 text-right">Prix<span className="max-sm:hidden"> du devis</span> retenu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedLines.map((line) => (
                        <tr key={line.id} className="h-9">
                          <th scope="row" className="break-words px-3 py-1 text-left font-normal">{lineTitle(line)}</th>
                          <td className="px-3 py-1 text-right tabular-nums">{formatQuantity(line.quantity)} {line.unit}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{line.unit_price_ht_cents === null ? "Prix non renseigné" : `${formatQuotedPrice(line.unit_price_ht_cents, line.price_per)} HT`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-3 text-sm text-muted-foreground">{plural(selectedOrder.line_count, "ligne", "lignes")}</p>}
              {selectedOrder.can_open ? <Link href={purchaseOrderHref(selectedOrder.id)} aria-label={`Ouvrir le bon ${selectedOrder.reference}`} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ExternalLink aria-hidden="true" className="size-4" />Ouvrir le bon<span className="sr-only"> {selectedOrder.reference}</span></Link> : <p className="mt-4 text-sm text-muted-foreground">Vous pouvez consulter son résumé ici ; l’ouverture du bon est réservée à son auteur et aux administrateurs.</p>}
            </div> : null}
          </MaterialRequestWorkspace> : <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Aucun bon de commande pour le moment.</p>}
          {orders.createError ? <p role="alert" className="text-sm font-medium text-danger">{orders.createError}</p> : null}
          {status === "error" ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Les bons de commande n’ont pas pu être relus.</p><Button type="button" variant="outline" size="sm" aria-label="Recharger les bons de commande" onClick={orders.retry}>Réessayer</Button></div> : null}
          {notReady.length > 0 && !reminded ? <div className="space-y-2 rounded-lg border border-dashed border-border p-4"><p className="text-sm font-medium">Pas encore à commander :</p><ul aria-label="Lignes pas encore à commander" className="list-disc space-y-1 pl-5 text-sm">{notReady.map((entry) => { const line = linesById.get(entry.line_id); return <li key={entry.line_id}>{line ? `${lineTitle(line)} : ${NOT_READY_REASONS[entry.reason] ?? entry.reason}` : "Une ligne qui n’est plus affichée : rechargez la page."}</li>; })}</ul>{stepLinks}</div> : null}
        </>
      )}
    </section>
  );
}
