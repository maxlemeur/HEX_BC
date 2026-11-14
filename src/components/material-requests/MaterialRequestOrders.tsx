"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, ExternalLink, Info, ShoppingCart } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MaterialRequestOrder } from "@/lib/material-requests/client";
import type { MaterialRequestOrderNotReadyReason } from "@/lib/material-requests/order-contracts";
import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";

import { formatQuantity, formatQuotedPrice, lineTitle, plural, purchaseOrderHref, purchaseOrderStatusLabel } from "./format";
import { REQUEST_STEP_KEYS, type RequestStepKey } from "./request-steps";
import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import type { MaterialRequestOrdersApi } from "./useMaterialRequestOrders";

/*
 * « Commandes » (TI-691, lot 2 « l'achat », delivery 3a): the validated lines priced by a retained quote become one
 * draft purchase order per supplier, overhead lines included in their supplier's draft. Nothing is sent.
 */

/** Said after the line's name, with what to do: « Ligne 4 · Té égal DN 50 : pas validée, réglez ses alertes… ». */
const NOT_READY_REASONS: Record<MaterialRequestOrderNotReadyReason, string> = {
  not_validated: "pas validée : réglez ses alertes, puis validez-la (étape Lignes)",
  not_priced: "sans devis retenu : consultez un fournisseur et retenez son devis (étape Devis)",
  no_supplier: "sans fournisseur : choisissez-le sur la ligne (étape Lignes)",
};

/** The step where each reason is settled. */
const REASON_STEP: Record<MaterialRequestOrderNotReadyReason, RequestStepKey> = {
  not_validated: "lignes",
  not_priced: "devis",
  no_supplier: "lignes",
};

/** The same reasons for several lines at once, in the reminder at the top of the request. */
const LEFT_BEHIND: Record<MaterialRequestOrderNotReadyReason | "ready", { one: string; several: string }> = {
  ready: {
    one: "prête, dans aucun bon : créez son brouillon de commande, ci-dessous",
    several: "prêtes, dans aucun bon : créez leurs brouillons de commande, ci-dessous",
  },
  no_supplier: {
    one: "sans fournisseur : choisissez-le sur la ligne, à l’étape Lignes",
    several: "sans fournisseur : choisissez-le sur chaque ligne, à l’étape Lignes",
  },
  not_priced: {
    one: "sans devis retenu : consultez un fournisseur et retenez son devis, à l’étape Devis",
    several: "sans devis retenu : consultez un fournisseur et retenez son devis, à l’étape Devis",
  },
  not_validated: {
    one: "pas validée : réglez ses alertes, puis validez-la, à l’étape Lignes",
    several: "pas validées : réglez leurs alertes, puis validez-les, à l’étape Lignes",
  },
};

/**
 * Once some lines of the request are in a purchase order, those that are in none are said at the top of the step,
 * by reason and with what to do (TI-691: on a long request, a line left behind is the one the technician waits for).
 * The head of the page counts them too, whatever the step shown.
 */
export function MaterialRequestToOrderReminder({
  editor,
  orders,
}: Readonly<{ editor: MaterialRequestEditorApi; orders: MaterialRequestOrdersApi }>) {
  const { summary } = orders;
  if (!summary || summary.ordered.length === 0) return null;
  const positionOf = new Map(editor.data.lines.map((line) => [line.id, line.position]));
  const groups = new Map<MaterialRequestOrderNotReadyReason | "ready", number[]>();
  const add = (reason: MaterialRequestOrderNotReadyReason | "ready", lineId: string) => {
    const position = positionOf.get(lineId);
    if (position !== undefined) groups.set(reason, [...(groups.get(reason) ?? []), position]);
  };
  for (const lineId of summary.ready_line_ids) add("ready", lineId);
  for (const entry of summary.not_ready) add(entry.reason, entry.line_id);
  const left = [...groups.values()].reduce((total, positions) => total + positions.length, 0);
  if (left === 0) return null;
  const order: Array<MaterialRequestOrderNotReadyReason | "ready"> = ["no_supplier", "not_priced", "not_validated", "ready"];
  return (
    <Alert variant="warning">
      <AlertTitle>
        {left > 1
          ? `${left} lignes de cette demande ne sont dans aucun bon de commande`
          : "1 ligne de cette demande n’est dans aucun bon de commande"}
      </AlertTitle>
      <AlertDescription>
        <ul aria-label="Lignes à commander encore" className="mt-1 list-disc space-y-0.5 pl-5">
          {order.flatMap((reason) => {
            const positions = [...(groups.get(reason) ?? [])].sort((first, second) => first - second);
            if (positions.length === 0) return [];
            const several = positions.length > 1;
            const named = several
              ? `Lignes ${positions.slice(0, -1).join(", ")} et ${positions[positions.length - 1]}`
              : `Ligne ${positions[0]}`;
            return [<li key={reason}>{`${named}, ${several ? LEFT_BEHIND[reason].several : LEFT_BEHIND[reason].one}.`}</li>];
          })}
        </ul>
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
    <li className="min-w-0 border-b border-border last:border-b-0">
      <button type="button" aria-label={`Afficher le bon ${order.reference}`} aria-pressed={selected} onClick={onSelect}
        className={cn("block w-full min-w-0 border-l-4 border-l-transparent px-5 py-5 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-ring", selected && "border-l-brand-orange bg-warning-subtle")}>
        <span className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words font-semibold text-foreground">{order.reference} <span className="ml-1">{order.supplier_name}</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className="tabular-nums text-muted-foreground">{formatEUR(order.total_ht_cents)} HT</span><span aria-hidden="true">·</span><span className="text-muted-foreground">{plural(order.line_count, "ligne", "lignes")}</span><Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{purchaseOrderStatusLabel(order.status)}</Badge></span>
      </button>
    </li>
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
  const { data, canWrite } = editor;
  const { summary, status } = orders;
  // The server says who may create: a writer of the request who may also buy. Until it answers, the request's rights.
  const canCreate = canWrite && (summary ? summary.can_create : true);
  const linesById = new Map(data.lines.map((line) => [line.id, line]));
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
  const assignedIds = new Set(summary?.ordered.map((entry) => entry.line_id));
  const allAssigned = data.lines.length > 0 && data.lines.every((line) => assignedIds.has(line.id));
  const selectedLines = summary?.ordered.filter((entry) => entry.purchase_order_id === selectedOrder?.id)
    .flatMap((entry) => { const line = linesById.get(entry.line_id); return line ? [line] : []; }) ?? [];


  const creation = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm font-medium">{ready === 0 ? "Aucune ligne prête à commander." : `${plural(ready, "ligne prête", "lignes prêtes")} à commander.`}</p>
        {canCreate ? <Button type="button" className="h-auto min-h-9 max-w-full whitespace-normal py-1.5" loading={orders.creating} disabled={ready === 0 || orders.refreshing || status !== "ready"} onClick={() => void orders.createDrafts()}><ShoppingCart aria-hidden="true" />Créer les brouillons de commande ({ready})</Button> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{canCreate ? "Un brouillon de bon de commande par fournisseur, au prix du devis retenu ; les lignes de frais généraux suivent dans le brouillon de leur fournisseur. Rien n’est envoyé au fournisseur." : "Les bons de commande faits depuis cette demande."}</p>
    </div>
  );
  return (
    <section aria-labelledby={headingId} className="mr-orders min-w-0 space-y-5">
      <div>
        <p className="mb-1 text-sm text-muted-foreground">Dossier de commande</p>
        <div className="flex flex-wrap items-center gap-4"><h2 id={headingId} className="font-display text-2xl font-semibold text-foreground">Bons de commande</h2>
          {allAssigned ? <Badge variant="success"><Check aria-hidden="true" />Toutes les lignes ont un bon · {plural(drafts.filter((order) => order.status !== "canceled").length, "bon créé", "bons créés")}</Badge> : null}
        </div>
      </div>
      <MaterialRequestToOrderReminder editor={editor} orders={orders} />
      {summary === null ? status === "error" ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Les bons de commande n’ont pas pu être chargés.</p><Button type="button" variant="outline" size="sm" aria-label="Recharger les bons de commande" onClick={orders.retry}>Réessayer</Button></div> : <p role="status" className="text-sm text-muted-foreground">Chargement des bons de commande…</p> : (
        <>
          {drafts.length > 0 ? <div className="mr-order-workspace grid min-w-0 overflow-hidden rounded-xl border border-border bg-surface xl:grid-cols-[26rem_minmax(0,1fr)]">
            <div className="min-w-0 border-b border-border xl:border-r xl:border-b-0"><h3 className="sr-only">Bons de cette demande</h3><ul aria-label="Bons de commande de la demande">{drafts.map((order) => <OrderItem key={order.id} order={order} selected={selectedOrder?.id === order.id} onSelect={() => setSelectedOrderId(order.id)} />)}</ul></div>
            {selectedOrder ? <div role="region" aria-label={`Détail du bon ${selectedOrder.reference}`} className="min-w-0 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-display text-2xl font-semibold">Bon {selectedOrder.reference}</h3><p className="mt-2 text-sm text-muted-foreground">Fournisseur : <span className="font-semibold text-foreground">{selectedOrder.supplier_name}</span> <Badge variant={STATUS_VARIANT[selectedOrder.status] ?? "neutral"}>{purchaseOrderStatusLabel(selectedOrder.status)}</Badge></p></div><div className="text-right"><p className="font-display text-2xl font-semibold tabular-nums">{formatEUR(selectedOrder.total_ht_cents)} HT</p><p className="mt-1 text-sm text-muted-foreground">{plural(selectedOrder.line_count, "ligne", "lignes")}</p></div></div>
              {selectedLines.length > 0 ? <div className="mt-8"><div aria-hidden="true" className="flex justify-between gap-3 border-b border-border pb-3 text-xs font-medium text-muted-foreground"><span>Lignes de la demande</span><span>Source</span></div><ul className="divide-y divide-border">{selectedLines.map((line) => <li key={line.id} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><span>{lineTitle(line)} · {formatQuantity(line.quantity)} {line.unit} · {line.unit_price_ht_cents === null ? "Prix non renseigné" : `${formatQuotedPrice(line.unit_price_ht_cents, line.price_per)} HT`}</span><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Prix du devis retenu</span></li>)}</ul></div> : <p className="mt-6 text-sm text-muted-foreground">Consultez le bon pour le détail de ses lignes.</p>}
              <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground"><Info aria-hidden="true" className="size-4 shrink-0" />Pour la confirmation fournisseur et la réception, ouvrez le bon.</p>
              {selectedOrder.can_open ? <Link href={purchaseOrderHref(selectedOrder.id)} aria-label={`Ouvrir le bon ${selectedOrder.reference}`} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ExternalLink aria-hidden="true" className="size-4" />Ouvrir le bon<span className="sr-only"> {selectedOrder.reference}</span></Link> : <p className="mt-4 text-sm text-muted-foreground">Vous pouvez consulter son résumé ici ; l’ouverture du bon est réservée à son auteur et aux administrateurs.</p>}
              {ready === 0 ? <p className="mt-7 flex items-center gap-2 border-t border-border pt-5 text-base font-semibold"><Check aria-hidden="true" className="size-5 text-success" />Aucune nouvelle ligne à commander</p> : null}
              <details open={ready > 0} className="mt-5 rounded-lg bg-surface-subtle p-4"><summary role="button" className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring">Création de brouillons · {plural(ready, "ligne éligible", "lignes éligibles")}</summary><div className="mt-4">{creation}</div></details>
            </div> : null}
          </div> : <div className="space-y-5 rounded-xl border border-border bg-surface p-5"><p className="text-sm text-muted-foreground">Aucun bon de commande pour le moment.</p>{creation}</div>}
          {orders.createError ? <p role="alert" className="text-sm font-medium text-danger">{orders.createError}</p> : null}
          {status === "error" ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Les bons de commande n’ont pas pu être relus.</p><Button type="button" variant="outline" size="sm" aria-label="Recharger les bons de commande" onClick={orders.retry}>Réessayer</Button></div> : null}
          {notReady.length > 0 ? <div className="space-y-2 rounded-lg border border-dashed border-border p-4"><p className="text-sm font-medium">Pas encore à commander :</p><ul aria-label="Lignes pas encore à commander" className="list-disc space-y-1 pl-5 text-sm">{notReady.map((entry) => { const line = linesById.get(entry.line_id); return <li key={entry.line_id}>{line ? `Ligne ${line.position} · ${lineTitle(line)} : ${NOT_READY_REASONS[entry.reason] ?? entry.reason}` : "Une ligne qui n’est plus affichée : rechargez la page."}</li>; })}</ul>{canWrite && onGoToStep ? <div className="flex flex-wrap gap-4">{REQUEST_STEP_KEYS.filter((key) => notReady.some((entry) => REASON_STEP[entry.reason] === key)).map((key) => <Button key={key} type="button" variant="link" size="sm" onClick={() => onGoToStep(key)}>{key === "lignes" ? "Régler les lignes, à l’étape Lignes" : "Faire chiffrer, à l’étape Devis"}</Button>)}</div> : null}</div> : null}
        </>
      )}
      {onGoToStep ? <Button type="button" variant="link" className="px-0" onClick={() => onGoToStep("devis")}><ArrowLeft aria-hidden="true" />Retour aux devis</Button> : null}
    </section>
  );
}
