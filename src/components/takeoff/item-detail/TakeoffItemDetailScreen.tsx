"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { TakeoffItemDetail, type ItemDetailGestureRequest } from "@/components/takeoff/item-detail/TakeoffItemDetail";
import { AcceptMeasuredDialog, EntryDialog, SetAsideDialog } from "@/components/takeoff/item-table/ItemTableGestureDialogs";
import { isTakeoffReadRefusal } from "@/components/takeoff/useTakeoffRequestActivity";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { ITEM_TABLE_PARAM_PREFIX, itemTableReturnHref, readItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import { ItemDetailPlanError, createItemDetailReader, itemTableDetailSource } from "@/lib/takeoff/item-detail-client";
import type { ItemDetailLine } from "@/lib/takeoff/item-detail";
import type { ItemSetAsideReason } from "@/lib/takeoff/item-table";
import { itemReviewStaleLines, sendItemReviewCommand } from "@/lib/takeoff/item-table-client";
import { ITEM_REVIEW_COMMAND_VERSION, type ItemReviewCommand, type ItemReviewResult } from "@/lib/takeoff/item-table-contracts";
import { ITEM_INELIGIBILITY_LABELS } from "@/lib/takeoff/item-table-labels";
import { readItemTableAddress } from "@/lib/takeoff/item-table-query";
import type { QuantityEntry } from "@/lib/takeoff/quantity-entry";
import { TAKEOFF_ITEM_UNIT_MAX_LENGTH } from "@/lib/takeoff/types";

/**
 * The detail of an item opened from the table of items, on the affaire's takeoff page: its address is the page's, its
 * lines are the table's (the table's routes, in the table's scope and filter), its rights the table's (any reader of the
 * affaire sees it, only an operator of the affaire's takeoff decides; the server decides each gesture again). A refused
 * read withdraws it, as the table withdraws itself. A decision goes through the table's own confirmations and its one
 * command (POST …/takeoff/items/review), on this one item in the table's scope: never a second writer.
 */

type Pending =
  | { gesture: "accept_measured" | "set_aside"; line: ItemDetailLine; intentKey: string }
  | { gesture: "enter_quantity"; line: ItemDetailLine; intentKey: string; value: { quantity: number; unit: string } | null; initial: string };

type Notice = { tone: "success" | "info" | "danger"; text: string };

const newIntent = () => crypto.randomUUID();

function parseDecimal(text: string) {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

function resultNotice(result: ItemReviewResult, done: string): Notice {
  if (result.applied.length) return { tone: "success", text: `Poste ${done}.` };
  const skipped = result.skipped[0];
  return { tone: "info", text: skipped ? `Rien n’a été appliqué : ${ITEM_INELIGIBILITY_LABELS[skipped.reason]}.` : "Rien n’a été appliqué." };
}

/** The value of an entry typed for the item shown: a quantity and its unit, the item's expected unit by default. */
function EntryValueDialog({ line, initial, onClose, onConfirm }: {
  line: ItemDetailLine; initial: string; onClose: () => void; onConfirm: (value: { quantity: number; unit: string }) => void;
}) {
  const quantityId = useId();
  const unitId = useId();
  const [quantity, setQuantity] = useState(initial);
  const [unit, setUnit] = useState(line.expectedUnit ?? "");
  const value = parseDecimal(quantity);
  const complete = value !== null && unit.trim() !== "";
  const confirm = () => { if (complete) onConfirm({ quantity: value!, unit: unit.trim() }); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Saisir une quantité</DialogTitle>
          <DialogDescription>« {line.label} » : la valeur saisie est écrite à part de la lecture, qui reste consultable.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-3" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); confirm(); } }}>
          <Field className="flex-1">
            <FieldLabel htmlFor={quantityId}>Quantité</FieldLabel>
            <Input id={quantityId} inputMode="decimal" autoFocus value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field className="w-24">
            <FieldLabel htmlFor={unitId}>Unité</FieldLabel>
            <Input id={unitId} value={unit} maxLength={TAKEOFF_ITEM_UNIT_MAX_LENGTH} onChange={(event) => setUnit(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!complete} onClick={confirm}>Continuer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TakeoffItemDetailScreen({ projectId, viewerKey }: {
  projectId: string;
  /** The member and their tenant: the detail's reads belong to them alone; another member starts from nothing. */
  viewerKey: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.toString();
  const detail = readItemDetailAddress(searchParams);
  const tableAddress = useMemo(() => readItemTableAddress(searchParams, ITEM_TABLE_PARAM_PREFIX), [searchParams]);
  // One reader per member, affaire and view of the table (scope, filter, page size): the queue is that view's pages.
  const tableView = JSON.stringify([tableAddress.scope, tableAddress.filter, tableAddress.limit]);
  const reader = useMemo(() => createItemDetailReader({ projectId, table: itemTableDetailSource(projectId, tableAddress) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new reader for a new member or a new view, not per item
    [projectId, viewerKey, tableView]);

  const [refusal, setRefusal] = useState<unknown>(null);
  const withdrawOnRefusal = useCallback((caught: unknown) => {
    // The table's reads (its list, an item, its journal) and a plan's resolution refused for the affaire itself.
    const refused = isTakeoffReadRefusal(caught) || (caught instanceof ItemDetailPlanError
      && (caught.status === 401 || caught.status === 403 || (caught.status === 404 && caught.code === "NOT_FOUND")));
    if (refused) setRefusal(caught);
    return refused;
  }, []);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const back = useCallback((href: string) => router.replace(href, { scroll: false }), [router]);
  const tableHref = itemTableReturnHref(projectId, query, detail.kind === "detail" ? { itemId: detail.address.itemId, offset: 0 } : null);

  const runCommand = async (command: ItemReviewCommand, done: string) => {
    setBusy(true);
    try {
      setNotice(resultNotice(await sendItemReviewCommand(projectId, command), done));
    } catch (caught) {
      if (withdrawOnRefusal(caught)) return;
      setNotice(itemReviewStaleLines(caught)
        ? { tone: "danger", text: "Rien n’a été appliqué : le poste a changé depuis son affichage. Il est relu : vérifiez-le, puis décidez de nouveau." }
        : { tone: "danger", text: isTakeoffApiError(caught) ? caught.message : "Impossible d’enregistrer la décision sur le poste." });
    } finally {
      setBusy(false);
      setPending(null);
      setVersion((value) => value + 1);
    }
  };

  const base = (line: ItemDetailLine, intentKey: string) => ({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: intentKey,
    scope: tableAddress.scope, targets: [line.targets] });
  const onGesture = (request: ItemDetailGestureRequest) => {
    setNotice(null);
    if (request.gesture === "include_entry") {
      void runCommand({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: newIntent(), scope: tableAddress.scope,
        gesture: "include_entry", targets: [request.line.targets] }, "inclus");
      return;
    }
    setPending(request.gesture === "enter_quantity"
      ? { gesture: "enter_quantity", line: request.line, intentKey: newIntent(), value: null, initial: request.initial ?? "" }
      : { gesture: request.gesture, line: request.line, intentKey: newIntent() });
  };

  if (refusal) {
    return (
      <div className="space-y-3" data-testid="poste-detail-refus">
        <Alert variant="danger">
          {isTakeoffApiError(refusal) ? refusal.message : "Accès refusé aux postes du métré."}
        </Alert>
        <Button variant="outline" size="sm" onClick={() => back(tableHref)}>Revenir aux postes</Button>
      </div>
    );
  }
  if (detail.kind !== "detail") {
    return (
      <div className="space-y-3">
        <Alert variant="danger">Ce lien ne désigne pas un poste de cette affaire.</Alert>
        <Button variant="outline" size="sm" onClick={() => back(tableHref)}>Revenir aux postes</Button>
      </div>
    );
  }
  // The command's scope is the table's (the whole affaire, or the plan it is filtered on), named as the table names it.
  const scope = tableAddress.scope;
  const scopeLabel = scope.kind === "affaire" ? "Portée : toute l’affaire"
    : `Portée : plan « ${pending?.line.readings.find(({ planKey }) => planKey === scope.planKey)?.planName ?? "choisi"} »`;

  return (
    <div className="space-y-2">
      {notice ? (
        <p role="status" data-testid="poste-detail-decision"
          className={`text-sm ${notice.tone === "danger" ? "text-danger" : notice.tone === "success" ? "text-success" : ""}`}>
          {notice.text}
        </p>
      ) : null}
      {/* A move inside replaces the address natively (history.replaceState), which the router's search parameters follow:
          no navigation, no server render per arrow. */}
      <TakeoffItemDetail projectId={projectId} address={detail.address} reader={reader} tableQuery={query} onBack={back}
        onGesture={onGesture} onRefused={withdrawOnRefusal} version={version} />
      {pending?.gesture === "accept_measured" ? (
        <AcceptMeasuredDialog scopeLabel={scopeLabel} busy={busy} total={1} eligible={1} onClose={() => setPending(null)}
          onConfirm={() => void runCommand({ ...base(pending.line, pending.intentKey), gesture: "accept_measured" }, "accepté")} />
      ) : null}
      {pending?.gesture === "set_aside" ? (
        <SetAsideDialog scopeLabel={scopeLabel} busy={busy} total={1} eligible={1} answers={pending.line.targets.answers.length}
          onClose={() => setPending(null)}
          onConfirm={(reason: ItemSetAsideReason, note: string | null) => void runCommand({ ...base(pending.line, pending.intentKey),
            gesture: "set_aside", reason, ...(note ? { note } : {}) }, "écarté")} />
      ) : null}
      {pending?.gesture === "enter_quantity" && !pending.value ? (
        <EntryValueDialog line={pending.line} initial={pending.initial} onClose={() => setPending(null)}
          onConfirm={(value) => setPending({ ...pending, value })} />
      ) : null}
      {pending?.gesture === "enter_quantity" && pending.value ? (
        <EntryDialog scopeLabel={scopeLabel} busy={busy} onClose={() => setPending(null)}
          values={[{ itemId: pending.line.itemId, label: pending.line.label, ...pending.value }]}
          onConfirm={(entry: QuantityEntry) => void runCommand({ ...base(pending.line, pending.intentKey), gesture: "enter_quantity",
            values: [{ item_id: pending.line.itemId, quantity: pending.value!.quantity, unit: pending.value!.unit }], entry }, "saisi")} />
      ) : null}
    </div>
  );
}
