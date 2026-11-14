"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MaterialRequestOrder } from "@/lib/material-requests/client";
import type { MaterialRequestOrderNotReadyReason } from "@/lib/material-requests/order-contracts";
import { formatEUR } from "@/lib/money";

import { lineTitle, plural, purchaseOrderHref, purchaseOrderStatusLabel } from "./format";
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

function OrderItem({ order }: Readonly<{ order: MaterialRequestOrder }>) {
  return (
    <li className="min-w-0 space-y-1 rounded-lg border border-border bg-surface p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {order.can_open ? (
          <Link
            href={purchaseOrderHref(order.id)}
            className="font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            {order.reference}
          </Link>
        ) : (
          // Orders are read by their author and the admins: the others see its reference, not a page they cannot open.
          <span className="font-mono text-sm font-semibold text-foreground">{order.reference}</span>
        )}
        <span className="min-w-0 break-words text-sm font-medium text-foreground">{order.supplier_name}</span>
        <Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{purchaseOrderStatusLabel(order.status)}</Badge>
      </div>
      <p className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground">
        <span className="tabular-nums text-foreground">{`${formatEUR(order.total_ht_cents)} HT`}</span>
        <span aria-hidden="true">·</span>
        <span>{plural(order.line_count, "ligne", "lignes")}</span>
      </p>
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
  // Oldest first, as the server lists them, canceled ones included.
  const drafts = summary?.orders ?? [];

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <div className="min-w-0">
        <h2 id={headingId} className="typo-h3 text-foreground">
          Bons de commande
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {canCreate
            ? "Un brouillon de bon de commande par fournisseur, au prix du devis retenu ; les lignes de frais généraux suivent dans le brouillon de leur fournisseur. Rien n’est envoyé au fournisseur."
            : "Les bons de commande faits depuis cette demande."}
        </p>
      </div>

      <MaterialRequestToOrderReminder editor={editor} orders={orders} />

      {summary === null ? (
        status === "error" ? (
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <p>Les bons de commande n’ont pas pu être chargés.</p>
            <Button type="button" variant="link" size="xs" className="h-auto px-0" aria-label="Recharger les bons de commande" onClick={orders.retry}>
              Réessayer
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Chargement des bons de commande…
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm font-medium text-foreground">
              {ready === 0 ? "Aucune ligne prête à commander." : `${plural(ready, "ligne prête", "lignes prêtes")} à commander.`}
            </p>
            {canCreate ? (
              <Button
                type="button"
                variant="primary"
                className="h-auto min-h-9 max-w-full whitespace-normal py-1.5"
                loading={orders.creating}
                disabled={ready === 0 || orders.refreshing || status !== "ready"}
                onClick={() => void orders.createDrafts()}
              >
                <ShoppingCart aria-hidden="true" />
                Créer les brouillons de commande ({ready})
              </Button>
            ) : null}
          </div>
          {orders.createError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {orders.createError}
            </p>
          ) : null}
          {status === "error" ? (
            <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <p>Les bons de commande n’ont pas pu être relus.</p>
              <Button type="button" variant="link" size="xs" className="h-auto px-0" aria-label="Recharger les bons de commande" onClick={orders.retry}>
                Réessayer
              </Button>
            </div>
          ) : null}

          {notReady.length > 0 ? (
            <div className="min-w-0 space-y-1 rounded-lg border border-dashed border-border p-3">
              <p className="text-sm font-medium text-foreground">Pas encore à commander :</p>
              <ul aria-label="Lignes pas encore à commander" className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
                {notReady.map((entry) => {
                  const line = linesById.get(entry.line_id);
                  return (
                    <li key={entry.line_id} className="break-words">
                      {line
                        ? `Ligne ${line.position} · ${lineTitle(line)} : ${NOT_READY_REASONS[entry.reason] ?? entry.reason}`
                        : "Une ligne qui n’est plus affichée : rechargez la page."}
                    </li>
                  );
                })}
              </ul>
              {canWrite && onGoToStep ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  {REQUEST_STEP_KEYS.filter((key) => notReady.some((entry) => REASON_STEP[entry.reason] === key)).map((key) => (
                    <Button key={key} type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => onGoToStep(key)}>
                      {key === "lignes" ? "Régler les lignes, à l’étape Lignes" : "Faire chiffrer, à l’étape Devis"}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-w-0 space-y-2">
            <h3 className="text-base font-semibold text-foreground">Bons de cette demande</h3>
            {drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun bon de commande pour le moment.</p>
            ) : (
              <ul aria-label="Bons de commande de la demande" className="grid min-w-0 gap-2 sm:grid-cols-2">
                {drafts.map((order) => (
                  <OrderItem key={order.id} order={order} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
