"use client";

import { ItemQuantityChoiceButtons } from "@/components/takeoff/item-table/ItemQuantityChoice";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { TakeoffItemDetail, type ItemDetailGestureRequest, type ItemDetailShown } from "@/components/takeoff/item-detail/TakeoffItemDetail";
import { forgetItemDetailOpener, rememberItemDetailOpener } from "@/components/takeoff/item-detail/ItemDetailOpenerFocus";
import { isRightRefusal, useCompletions } from "@/components/takeoff/item-detail/useCompletions";
import { AcceptMeasuredDialog, SetAsideDialog } from "@/components/takeoff/item-table/ItemTableGestureDialogs";
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
import { EntryDialog } from "@/components/takeoff/item-table/EntryDialog";
import { TAKEOFF_ITEM_UNIT_MAX_LENGTH } from "@/lib/takeoff/types";

/**
 * The detail of an item opened from the table of items, on the affaire's takeoff page: its address is the page's, its
 * lines are the table's (the table's routes, in the table's scope and filter), its rights the table's (any reader of the
 * affaire sees it, only an operator of the affaire's takeoff decides; the server decides each gesture again). A refused
 * read withdraws it, as the table withdraws itself. A decision goes through the table's own confirmations and its one
 * command (POST …/takeoff/items/review), on this one item in the table's scope: never a second writer.
 *
 * A confirmation belongs to what opened it: the item and the reading shown (`key`), the member and the table's scope. It
 * is dropped as soon as any of them changes or the gesture is no longer offered on it, and its command is built, when the
 * member confirms, from the item as the detail shows it then, named in the dialog. A command, once sent, follows the
 * detail's one rule of completions (useCompletions): it closes its own confirmation only, has its own item read again, and
 * says its outcome (or withdraws the screen) only while what started it is still shown. Its confirmation cannot be closed
 * while it is under way: closing would not cancel what is sent.
 */

type Pending = {
  gesture: "accept_measured" | "set_aside" | "enter_quantity";
  intentKey: string;
  key: string;
  viewerKey: string;
  scopeKey: string;
  value: { quantity: number; unit: string } | null;
  initial: string;
};

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
        <div
          className="flex gap-3"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              confirm();
            }
          }}
        >
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
  /** The last command's item, read again when it ends (`version` counts the commands). */
  const [refresh, setRefresh] = useState<{ version: number; itemId: string } | null>(null);
  const refreshItem = (itemId: string) => setRefresh((current) => ({ version: (current?.version ?? 0) + 1, itemId }));
  const [shown, setShown] = useState<ItemDetailShown | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const scopeKey = JSON.stringify(tableAddress.scope);
  const screenKey = `${viewerKey}|${scopeKey}`;
  const begin = useCompletions({ screen: screenKey, item: shown?.key ?? null });
  // The confirmation open now: the one asked on what is shown, by this member, in this scope, for a gesture still offered.
  const active = useMemo(() => (pending && shown && pending.key === shown.key && pending.viewerKey === viewerKey
    && pending.scopeKey === scopeKey && shown.offered.includes(pending.gesture) ? { ...pending, line: shown.line } : null),
  [pending, shown, viewerKey, scopeKey]);
  useEffect(() => {
    if (pending && !active) setPending(null);
  }, [pending, active]);
  /** The confirmations whose command is under way: each waits for its own answer. */
  const [inFlight, setInFlight] = useState<readonly Pending[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  // The line whose « Détail » opened this detail: the browser's back gives it the keyboard again (ItemDetailOpenerFocus).
  // « Revenir aux postes » names the item last shown itself, and forgets it.
  const opened = useRef(detail.kind === "detail" ? { query, itemId: detail.address.itemId } : null);
  useEffect(() => {
    if (opened.current) rememberItemDetailOpener(projectId, viewerKey, opened.current.query, opened.current.itemId);
  }, [projectId, viewerKey]);
  const back = useCallback((href: string) => {
    forgetItemDetailOpener(projectId, viewerKey);
    router.replace(href, { scroll: false });
  }, [projectId, router, viewerKey]);
  const tableHref = itemTableReturnHref(projectId, query, detail.kind === "detail" ? { itemId: detail.address.itemId, offset: 0 } : null);

  /** Sends a command from what is shown; `own`, the confirmation it was confirmed in (none for an inclusion). */
  const runCommand = async (command: ItemReviewCommand, done: string, own: Pending | null) => {
    // Addressed to what is shown now: this member, this scope, this item and reading.
    const completion = begin({ screen: screenKey, item: shown?.key ?? null });
    if (own) setInFlight((current) => [...current, own]);
    try {
      const result = await sendItemReviewCommand(projectId, command);
      if (completion.current()) setNotice(resultNotice(result, done));
    } catch (caught) {
      // A refusal of the member's right withdraws this screen at once, whatever item is shown now; any other failure is
      // said only while what started the command is shown.
      if (isRightRefusal(caught) && completion.ownScreen() && withdrawOnRefusal(caught)) return;
      if (!completion.current() || withdrawOnRefusal(caught)) return;
      setNotice(itemReviewStaleLines(caught)
        ? { tone: "danger", text: "Rien n’a été appliqué : le poste a changé depuis son affichage. Il est relu : vérifiez-le, puis décidez de nouveau." }
        : { tone: "danger", text: isTakeoffApiError(caught) ? caught.message : "Impossible d’enregistrer la décision sur le poste." });
    } finally {
      if (own) setInFlight((current) => current.filter((entry) => entry !== own));
      // Its own confirmation only: what the member opened or typed since, on another item, stays.
      if (own) setPending((current) => (current === own ? null : current));
      // The command's item, not the one shown now, read again in the screen that sent it.
      const itemId = command.targets[0]!.itemId;
      if (completion.ownScreen()) refreshItem(itemId);
    }
  };

  const base = (line: ItemDetailLine, intentKey: string) => ({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: intentKey,
    scope: tableAddress.scope, targets: [line.targets] });
  const onGesture = (request: ItemDetailGestureRequest) => {
    setNotice(null);
    // Asked on what is shown now, and offered on it: otherwise nothing is opened nor sent.
    if (!shown || request.key !== shown.key || !shown.offered.includes(request.gesture)) return;
    if (request.gesture === "accept_measured" && request.quantityChoice && shown.line.quantityOptions) {
      void runCommand({ ...base(shown.line, newIntent()), gesture: "accept_measured", quantity_choice: request.quantityChoice }, "accepté", null);
      return;
    }
    if (request.gesture === "include_entry") {
      void runCommand({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: newIntent(), scope: tableAddress.scope,
        gesture: "include_entry", targets: [shown.line.targets] }, "inclus", null);
      return;
    }
    setPending({ gesture: request.gesture, intentKey: newIntent(), key: shown.key, viewerKey, scopeKey, value: null,
      initial: request.initial ?? "" });
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
  const busy = pending !== null && active !== null && inFlight.includes(pending);
  // A confirmation under way is not closed: its command is sent, closing it would not cancel it.
  const close = () => {
    if (!busy) setPending(null);
  };
  // The item confirmed, and the command's scope: the table's (the whole affaire, or the plan it is filtered on), named as
  // the table names it.
  const scope = tableAddress.scope;
  const scopeLabel = `« ${active?.line.label ?? ""} » · ${scope.kind === "affaire" ? "Portée : toute l’affaire"
    : `Portée : plan « ${active?.line.readings.find(({ planKey }) => planKey === scope.planKey)?.planName ?? "choisi"} »`}`;

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
      <TakeoffItemDetail viewerKey={viewerKey} projectId={projectId} address={detail.address} reader={reader} tableQuery={query} onBack={back}
        onGesture={onGesture} onRefused={withdrawOnRefusal} refresh={refresh} onMeasureChanged={refreshItem} onShown={setShown} />
      {active?.gesture === "accept_measured" && active.line.quantityOptions ? (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
          <DialogContent><DialogHeader><DialogTitle>Quantité de ce poste sur le plan</DialogTitle></DialogHeader>
            <ItemQuantityChoiceButtons options={active.line.quantityOptions} disabled={busy} onChoose={(choice) => void runCommand({
              ...base(active.line, active.intentKey), gesture: "accept_measured", quantity_choice: choice }, "accepté", pending)} />
          </DialogContent>
        </Dialog>
      ) : active?.gesture === "accept_measured" ? (
        <AcceptMeasuredDialog scopeLabel={scopeLabel} busy={busy} total={1} eligible={1} onClose={close}
          onConfirm={() => void runCommand({ ...base(active.line, active.intentKey), gesture: "accept_measured" }, "accepté", pending)} />
      ) : null}
      {active?.gesture === "set_aside" ? (
        <SetAsideDialog scopeLabel={scopeLabel} busy={busy} total={1} eligible={1} answers={active.line.targets.answers.length}
          onClose={close}
          onConfirm={(reason: ItemSetAsideReason, note: string | null) => void runCommand({ ...base(active.line, active.intentKey),
            gesture: "set_aside", reason, ...(note ? { note } : {}) }, "écarté", pending)} />
      ) : null}
      {active?.gesture === "enter_quantity" && !active.value ? (
        <EntryValueDialog line={active.line} initial={active.initial} onClose={close}
          onConfirm={(value) => setPending({ ...pending!, value })} />
      ) : null}
      {active?.gesture === "enter_quantity" && active.value ? (
        <EntryDialog key={active.intentKey} projectId={projectId} viewScope={scope} onRefused={withdrawOnRefusal}
          onClose={close} values={[{ line: active.line, ...active.value }]}
          onFinished={(result, error) => {
            setPending(null);
            setNotice(error ? { tone: "danger", text: itemReviewStaleLines(error)
              ? "Le poste a changé. Vérifiez la saisie après relecture."
              : "La saisie n’a pas été confirmée. Vérifiez le poste après relecture." } : resultNotice(result, "saisi"));
            refreshItem(active.line.itemId);
          }} />
      ) : null}
    </div>
  );
}
