"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, CheckCheck, FileText, Paperclip, TriangleAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { materialRequestFileUrl, type MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import { competitionNeedsType, consultationLineOf } from "@/lib/material-requests/consultation-message";
import { consultationMessage } from "@/lib/material-requests/consultation-template";
import type { MaterialRequestFile, MaterialRequestLine } from "@/lib/material-requests/contracts";
import {
  MATERIAL_REQUEST_QUOTE_MAX_FILES,
  MATERIAL_REQUEST_QUOTE_NOTES_MAX,
  MATERIAL_REQUEST_QUOTE_PICKER_ACCEPT,
  MATERIAL_REQUEST_QUOTE_STATUS_LABELS,
  type MaterialRequestQuote,
} from "@/lib/material-requests/quote-contracts";
import { formatEUR } from "@/lib/money";
import { PURCHASE_ORDER_PRICE_PER, type PurchaseOrderPricePer } from "@/lib/purchase-orders/line-kinds";
import { plural } from "@/lib/text/plural";
import { cn } from "@/lib/utils";

import { CentsField, CentsInput, useCentsDraft } from "./cents-field";
import { ConfirmButton, TextCell } from "./cells";
import { MaterialRequestWorkspace, MaterialRequestWorkspaceChoice } from "./MaterialRequestWorkspace";
import {
  ConsultationMessageBlock,
  ConsultationRecipients,
  STATUS_VARIANT,
  consultationOf,
  liveQuoteOf,
} from "./ConsultationRecipients";
import {
  checkQuoteFileSelection,
  formatDay,
  formatPricePer,
  formatQuantity,
  formatQuotedPrice,
  lineNamesLabel,
  lineTitle,
  quotedAmountCents,
} from "./format";
import { MaterialRequestQuoteComparison } from "./MaterialRequestQuoteComparison";
import { photoUploadStepLabel, type PhotoUploadStep } from "./photo-upload";
import { useConsultationTemplate, type ConsultationTemplateState } from "./useConsultationTemplate";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";
import {
  QUOTE_CHARGE_HELD,
  QUOTE_PRICE_HELD,
  linesNotValidated,
  type MaterialRequestQuotesApi,
  type QuoteChargeKind,
} from "./useMaterialRequestQuotes";

/*
 * « Consultation » (TI-691, lot 2 « l'achat », delivery 2): the office asks suppliers for a price with a short
 * message it copies into WhatsApp (MergeOne sends nothing), records that it was sent, attaches what comes back,
 * prices it line by line and retains one quote; the others are closed and stay readable.
 */

function quoteDates(quote: MaterialRequestQuote): string {
  return [
    `Demandé le ${formatDay(quote.requested_at)}`,
    quote.received_at ? `reçu le ${formatDay(quote.received_at)}` : null,
    quote.retained_at ? `retenu le ${formatDay(quote.retained_at)}` : null,
    quote.closed_at ? `clos le ${formatDay(quote.closed_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Why « Retenir ce devis » is not offered yet; null when it is. */
/** « Le prix de la ligne Coude 90° DN 50 n’est pas lisible. », or the plural: the lines are named by what they ask. */
function unreadableSentence(names: readonly string[]): string {
  return names.length === 1
    ? `Le prix de la ligne ${names[0]} n’est pas lisible.`
    : `Les prix des lignes ${lineNamesLabel(names)} ne sont pas lisibles.`;
}

function retainBlocker(
  quote: MaterialRequestQuote,
  refusedPrices: number,
  unreadableNames: readonly string[],
  draftNames: readonly string[],
  discountTooLarge = false,
): string | null {
  // What the fields show comes first: a retain applies the saved prices, never a text that cannot be read.
  if (unreadableNames.length > 0) return unreadableSentence(unreadableNames);
  if (refusedPrices > 0) return QUOTE_PRICE_HELD;
  const unpriced = quote.lines.filter((line) => line.unit_price_ht_cents === null).length;
  const missing = unpriced === 1 ? "il en manque 1" : `il en manque ${unpriced}`;
  if (quote.status === "requested") {
    return unpriced > 0
      ? `Pour retenir ce devis, marquez-le reçu et saisissez le prix de chaque ligne (${missing}).`
      : "Pour retenir ce devis, marquez-le reçu.";
  }
  if (unpriced > 0) return `Pour retenir ce devis, saisissez le prix de chaque ligne (${missing}).`;
  if (discountTooLarge) return "Pour retenir ce devis, ramenez sa remise au montant de ses lignes et de son port, hors taxes et TVA comprise, au plus.";
  return draftNames.length > 0 ? linesNotValidated(draftNames) : null;
}

/** The 20 % tax a purchase order line takes, rounded per line (a whole number of cents never ends in ,5 here). */
function orderLineTax(cents: number): number {
  return Math.round(cents / 5);
}

/**
 * The draft that carries the quote's discount would total less than zero, before or after tax (each line's tax
 * rounded on its own, as the order computes it; the database refuses the retain alike).
 */
function discountExceeds(lineAmounts: readonly number[], shipping: number, discount: number): boolean {
  const lines = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const tax = lineAmounts.reduce((sum, amount) => sum + orderLineTax(amount), 0);
  return discount > lines + shipping || orderLineTax(discount) > tax + orderLineTax(shipping);
}

/**
 * What a quote comes to: its lines, plus its shipping, minus its discount (the purchase order carries all three);
 * null while a line has no amount.
 */
function withCharges(quote: MaterialRequestQuote, linesTotal: number | null): number | null {
  return linesTotal === null ? null : linesTotal + (quote.shipping_ht_cents ?? 0) - (quote.discount_ht_cents ?? 0);
}

function lineAmount(
  line: MaterialRequestLine | undefined,
  cents: number | null,
  per: PurchaseOrderPricePer,
): number | null {
  return line ? quotedAmountCents(line.quantity, cents, per) : null;
}

function quantityText(line: MaterialRequestLine): string {
  if (line.quantity === null) return "Quantité à préciser";
  return [formatQuantity(line.quantity), line.unit?.trim() || null].filter(Boolean).join(" ");
}

function fileKind(file: MaterialRequestFile): string {
  return file.mime_type === "application/pdf" ? "PDF" : "photo";
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

type SupplierGroup = { supplierId: string; supplierName: string; lines: MaterialRequestLine[] };

function supplierGroups(
  lines: readonly MaterialRequestLine[],
  options: readonly MaterialRequestSupplierOption[],
  quotes: readonly MaterialRequestQuote[],
): { groups: SupplierGroup[]; without: MaterialRequestLine[] } {
  const byId = new Map<string, MaterialRequestLine[]>();
  const without: MaterialRequestLine[] = [];
  for (const line of lines) {
    if (!line.supplier_id) {
      without.push(line);
      continue;
    }
    byId.set(line.supplier_id, [...(byId.get(line.supplier_id) ?? []), line]);
  }
  const nameOf = (id: string) =>
    options.find((option) => option.id === id)?.label
    ?? quotes.find((quote) => quote.supplier_id === id)?.supplier_name
    ?? "Fournisseur retiré de la liste";
  return {
    groups: [...byId.entries()].map(([supplierId, grouped]) => ({ supplierId, supplierName: nameOf(supplierId), lines: grouped })),
    without,
  };
}


function SupplierGroupCard({
  editor,
  quotes,
  group,
  affaireName,
  template,
  canCreateSupplier,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  quotes: MaterialRequestQuotesApi;
  group: SupplierGroup;
  affaireName: string;
  /** The member's template in force (TI-691); its message is offered only once it is read. */
  template: ConsultationTemplateState;
  /** May add a supplier to the catalogue, by its name, from the competition's search (admins and engineers). */
  canCreateSupplier: boolean;
}>) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const { data, canWrite } = editor;
  // A line priced by a retained quote is bought: it is not asked again.
  const pending = group.lines.filter((line) => !line.price_quote_id);
  const priced = group.lines.length - pending.length;
  const referencesFailed = editor.supplierProposalsStatus === "error";
  const referencesRead = referencesFailed || pending.every((line) => editor.supplierReferenceKnown(line.id));
  const lines = (withReferences: boolean) =>
    pending.map((line) =>
      consultationLineOf(line, {
        request: data.request,
        supplierSku: withReferences ? (editor.supplierReferenceOf(line.id)?.supplier_sku ?? null) : null,
        // TI-690: what a template's {conditionnement} writes, in both variants (it names no reference).
        usualPackaging: line.product_id ? (editor.articles[line.product_id]?.usual_packaging ?? null) : null,
      }),
    );
  const message = (withReferences: boolean, supplierName: string) =>
    consultationMessage({
      template: template.status === "ready" ? template.template : null,
      affaireName,
      supplierName,
      lines: lines(withReferences),
      withReferences,
      deliveryPlace: data.request.delivery_place,
    });
  // What a competitor should not learn: the technician's reference, the article's, the usual supplier's.
  const knownReferences = pending.flatMap((line) => [
    line.reference,
    line.product_id ? (editor.articles[line.product_id]?.reference ?? null) : null,
    editor.supplierReferenceOf(line.id)?.supplier_sku ?? null,
  ]);
  const lineIds = pending.map((line) => line.id);
  const needType = pending.filter((line) =>
    competitionNeedsType(consultationLineOf(line, { request: data.request, supplierSku: null })),
  );
  const send = (supplierId: string, supplierName: string, withReferences: boolean, text: string) =>
    quotes.createQuote(
      { supplier_id: supplierId, line_ids: lineIds, with_references: withReferences, message: text },
      supplierName,
    );

  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 id={headingId} className="min-w-0 break-words text-base font-semibold text-foreground">
          {group.supplierName}
        </h3>
        <p className="text-sm text-muted-foreground">
          {plural(group.lines.length, "ligne", "lignes")}
          {priced > 0 ? ` · ${priced} au prix retenu` : ""}
        </p>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-foreground">Toutes ses lignes ont leur prix retenu.</p>
      ) : canWrite ? (
        <>
          {referencesFailed ? (
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <p>Références chez le fournisseur indisponibles : le message donne les désignations complètes.</p>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0"
                aria-label="Recharger les références chez les fournisseurs"
                onClick={editor.retrySupplierProposals}
              >
                Réessayer
              </Button>
            </div>
          ) : null}
          {template.status === "loading" ? (
            <p role="status" className="text-sm text-muted-foreground">Lecture de votre modèle de message…</p>
          ) : template.status === "error" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p role="alert" className="font-medium text-danger">
                {`Votre modèle de message n’a pas pu être lu (${template.message.replace(/\.$/, "")}). Aucun message n’est proposé à sa place.`}
              </p>
              <Button type="button" variant="outline" size="sm" aria-label="Relire le modèle de message" onClick={template.retry}>
                Réessayer
              </Button>
            </div>
          ) : (
            <ConsultationRecipients
              group={group}
              pendingCount={pending.length}
              lineIds={lineIds}
              needType={needType}
              options={data.supplierOptions}
              quotes={quotes}
              usualPanel={
                referencesRead ? (
                  <ConsultationMessageBlock
                    supplierName={group.supplierName}
                    message={message(true, group.supplierName)}
                    consultation={consultationOf(quotes, group.supplierId, lineIds)}
                    onSend={(text) => send(group.supplierId, group.supplierName, true, text)}
                  />
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">
                    Lecture des références chez {group.supplierName}…
                  </p>
                )
              }
              messageFor={(supplierName) => message(false, supplierName)}
              knownReferences={knownReferences}
              onSend={(supplierId, supplierName, text) => send(supplierId, supplierName, false, text)}
              onCreateSupplier={canCreateSupplier ? editor.createSupplier : null}
            />
          )}
        </>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
          {pending.map((line) => (
            <li key={line.id} className="break-words">{lineTitle(line)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteFiles({
  editor,
  quotes,
  quote,
  editable,
  visible,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  quotes: MaterialRequestQuotesApi;
  quote: MaterialRequestQuote;
  editable: boolean;
  visible: boolean;
}>) {
  const picker = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [progress, setProgress] = useState<PhotoUploadStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = quote.files.length >= MATERIAL_REQUEST_QUOTE_MAX_FILES;

  const add = async (selection: File[]) => {
    // One batch at a time: a second choice made while files travel is ignored, not queued.
    if (selection.length === 0 || sending.current) return;
    const refusal = checkQuoteFileSelection(selection, quote.files.length);
    if (refusal) {
      setError(refusal);
      return;
    }
    sending.current = true;
    setError(null);
    setProgress({ step: "preparing", total: selection.length });
    const result = await quotes.addFiles(quote.id, selection, setProgress);
    sending.current = false;
    setProgress(null);
    setError(result.ok ? null : result.message);
  };

  return (
    <div className="min-w-0 space-y-1.5">
      {/* Without a file, said on the title's own line. */}
      <p className="text-sm text-foreground">
        <span className="font-semibold">Pièces du devis</span>
        {quote.files.length === 0 ? <span className="text-muted-foreground"> · aucune pièce jointe</span> : null}
      </p>
      {quote.files.length === 0 ? null : (
        <ul className="space-y-1">
          {quote.files.map((file) => (
            <li key={file.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <a
                href={materialRequestFileUrl(editor.projectId, editor.requestId, file.id)}
                // Served as an attachment: the browser saves it under its own name and opens it from there.
                download={file.file_name}
                className="inline-flex min-w-0 items-center gap-1 break-all text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                <FileText aria-hidden="true" className="size-4 shrink-0" />
                {file.file_name}
              </a>
              <span className="text-xs text-muted-foreground">
                {fileKind(file)}, {fileSize(file.byte_size)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editor.canWrite && editor.data.photoAnalysis && quote.files.length > 0 ? (
        <MaterialRequestQuoteComparison
          projectId={editor.projectId}
          requestId={editor.requestId}
          quoteId={quote.id}
          files={quote.files}
          availability={editor.data.photoAnalysis}
          visible={visible}
        />
      ) : null}
      {editable ? (
        <>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={MATERIAL_REQUEST_QUOTE_PICKER_ACCEPT}
            aria-label={`Pièces à joindre au devis ${quote.supplier_name}`}
            disabled={progress !== null}
            onChange={(event) => {
              const selection = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void add(selection);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal py-1"
            loading={progress !== null}
            disabled={full}
            aria-label={`Joindre une pièce au devis ${quote.supplier_name} (PDF ou photo)`}
            onClick={() => picker.current?.click()}
          >
            <Paperclip aria-hidden="true" />
            Joindre une pièce (PDF ou photo)
          </Button>
          {full ? (
            <p className="text-xs text-muted-foreground">{`${MATERIAL_REQUEST_QUOTE_MAX_FILES} pièces au plus par devis.`}</p>
          ) : null}
          <p role="status" className="text-sm text-muted-foreground empty:hidden">
            {progress ? photoUploadStepLabel(progress) : ""}
          </p>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The price of one line of a quote, and the units it is for (« pour 100 »: a sub-cent price written exactly). Both
 * are sent together; a choice made before the price waits for it.
 */
function QuotePriceEntry({
  quotes,
  quote,
  entry,
  position,
}: Readonly<{
  quotes: MaterialRequestQuotesApi;
  quote: MaterialRequestQuote;
  entry: MaterialRequestQuote["lines"][number];
  position: number;
}>) {
  const ids = useId();
  const inputId = `${ids}-price`;
  const errorId = `${ids}-error`;
  const stored = entry.price_per;
  const [choice, setChoice] = useState<PurchaseOrderPricePer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const per = choice ?? stored;
  const supplier = quote.supplier_name;
  const { setPriceUnreadable } = quotes;
  const reportUnreadable = useCallback(
    (unreadable: boolean) => setPriceUnreadable(quote.id, entry.line_id, unreadable),
    [entry.line_id, quote.id, setPriceUnreadable],
  );

  // Escape on the price gives back the saved price and its lot: nothing unsaved is left on the line.
  const field = useCentsDraft(entry.unit_price_ht_cents, () => {
    quotes.forgetPriceFailure(quote.id, entry.line_id);
    setChoice(null);
  });
  useEffect(() => {
    reportUnreadable(field.unreadable);
  }, [field.unreadable, reportUnreadable]);
  useEffect(() => () => reportUnreadable(false), [reportUnreadable]);

  // A saved lot is no longer a choice to keep, unless another was chosen while it travelled: that one still waits.
  const settle = (lot: PurchaseOrderPricePer) => setChoice((current) => (current === lot ? null : current));
  const saveFor = (lot: PurchaseOrderPricePer) => async (cents: number | null) => {
    const result = await quotes.savePrice(quote.id, entry.line_id, cents, lot);
    if (result.ok) settle(lot);
    return result;
  };

  const choose = async (next: PurchaseOrderPricePer) => {
    setError(null);
    if (field.draft !== null) {
      // The lot goes with the price the field shows, never with the one saved before it: an unreadable text holds
      // both (its reason is said under it), a readable one is saved with the new lot, refused or not.
      setChoice(next);
      if (!field.unreadable) await field.commit(saveFor(next), true);
      return;
    }
    if (next === stored && error) {
      // The office gives back the stored choice after a refusal: nothing unsaved is left.
      quotes.forgetPriceFailure(quote.id, entry.line_id);
      setChoice(null);
      return;
    }
    setChoice(next);
    await saveLotOfShownPrice(next);
  };

  // The saved amount, which the field shows, sent for another lot.
  const saveLotOfShownPrice = async (lot: PurchaseOrderPricePer) => {
    if (entry.unit_price_ht_cents === null) return;
    const result = await quotes.savePrice(quote.id, entry.line_id, entry.unit_price_ht_cents, lot);
    if (result.ok) {
      // Saved, whoever sent it again (the select, or leaving the price field): its earlier refusal no longer holds.
      setError(null);
      settle(lot);
    } else setError(result.message);
  };

  // Leaving the field saves what it shows. A lot chosen while the text could not be read waits for the price: sent
  // with it even when the amount is the one saved, as what it is for changed; and sent alone when a save that
  // travelled meanwhile already wrote the amount shown (it gave the field back its saved amount).
  const commitShown = () => {
    if (field.draft === null) {
      if (per !== stored) void saveLotOfShownPrice(per);
      return;
    }
    void field.commit(saveFor(per), per !== stored);
  };

  const missing = quote.status === "received" && entry.unit_price_ht_cents === null;
  return (
    // From 768 px the price and its lot are two cells of the row, as a field of the lines sheet is (`sheet-cell`): no
    // box and no padding around them, the grid lines bound them; what a failed save says is read under the cell,
    // inside the row. Below, a card keeps its boxed fields.
    <div
      // A price still to type on a quote that was received is said as a missing value is in the lines sheet: by the
      // tint of its cell (a halo around the field in a card). A quote only asked for expects no price yet.
      title={missing ? "Prix à renseigner." : undefined}
      className={cn(
        "min-w-0 space-y-1 md:sheet-cell md:space-y-0 md:p-0! md:[&_p]:px-3 md:[&_p]:pb-1.5",
        missing && "rounded-md bg-warning-light max-md:-m-1.5 max-md:p-1.5 md:rounded-none",
      )}
    >
      {/* From 768 px the column « PU HT » names it: the label stays for a card and for a screen reader. */}
      <label htmlFor={inputId} className="block text-xs text-muted-foreground md:sr-only">
        Prix unitaire HT
      </label>
      <div className="flex min-w-0 items-start gap-1.5 md:items-stretch md:gap-0">
        <div className="min-w-0 flex-1">
          <CentsField
            id={inputId}
            label={`Prix unitaire HT, ligne ${position}, ${supplier}`}
            value={entry.unit_price_ht_cents}
            field={field}
            onCommit={commitShown}
          />
        </div>
        <NativeSelect
          size="sm"
          wrapperClassName="w-auto shrink-0 md:border-l md:border-border"
          className="pl-2"
          aria-label={`Prix donné pour, ligne ${position}, ${supplier}`}
          aria-describedby={error ? errorId : undefined}
          value={String(per)}
          onChange={(event) => void choose(Number(event.currentTarget.value) as PurchaseOrderPricePer)}
        >
          {PURCHASE_ORDER_PRICE_PER.map((option) => (
            <option key={option} value={String(option)}>
              {`pour ${formatPricePer(option)}`}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The draft of a shipping or discount field, told to the quotes: a quote is not retained while the field shows text
 * that cannot be read, nor, once refused, an amount that is not saved (until it is saved or given up with Escape).
 */
function useChargeField(quotes: MaterialRequestQuotesApi, quoteId: string, kind: QuoteChargeKind) {
  const { setChargeUnreadable, forgetChargeFailure } = quotes;
  const field = useCentsDraft(
    kind === "shipping_ht_cents"
      ? quotes.items.find((item) => item.id === quoteId)?.shipping_ht_cents ?? null
      : quotes.items.find((item) => item.id === quoteId)?.discount_ht_cents ?? null,
    () => forgetChargeFailure(quoteId, kind),
  );
  const { unreadable } = field;
  useEffect(() => {
    setChargeUnreadable(quoteId, kind, unreadable);
  }, [kind, quoteId, setChargeUnreadable, unreadable]);
  // A field that goes away (the quote retained or closed elsewhere) holds nothing back.
  useEffect(() => () => setChargeUnreadable(quoteId, kind, false), [kind, quoteId, setChargeUnreadable]);
  return field;
}

function QuoteCard({
  editor,
  quotes,
  quote,
  visible,
}: Readonly<{ editor: MaterialRequestEditorApi; quotes: MaterialRequestQuotesApi; quote: MaterialRequestQuote; visible: boolean }>) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const blockerId = `${ids}-blocker`;
  const [busy, setBusy] = useState<"received" | "retain" | "charge" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The office asked to retain a quote whose amount differs from its lines: it confirms the gap first. */
  const [confirmingGap, setConfirmingGap] = useState(false);
  const retainButton = useRef<HTMLButtonElement>(null);
  const editable = editor.canWrite && (quote.status === "requested" || quote.status === "received");
  const { linesById } = editor;
  const unreadable = new Set(quotes.unreadablePrices(quote.id));
  // Named by what they ask, in the order of the request: no number shows on screen to point at.
  const asked = quote.lines
    .map((entry) => linesById.get(entry.line_id))
    .filter((line): line is MaterialRequestLine => line !== undefined)
    .sort((left, right) => left.position - right.position);
  const unreadableNames = asked.filter((line) => unreadable.has(line.id)).map((line) => lineTitle(line));
  // As the lines table shows them now; checked again by the hook at the retain's turn in the queue.
  const draftNames = asked.filter((line) => line.status !== "validated").map((line) => lineTitle(line));
  const amounts = quote.lines.map((entry) =>
    lineAmount(linesById.get(entry.line_id), entry.unit_price_ht_cents, entry.price_per),
  );
  const total = amounts.every((amount) => amount !== null)
    ? amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
    : null;
  const shipping = quote.shipping_ht_cents ?? 0;
  const discount = quote.discount_ht_cents ?? 0;
  const hasCharges = shipping > 0 || discount > 0;
  const quoteTotal = withCharges(quote, total);
  // The order that carries the discount keeps a total of at least zero (the database refuses the retain otherwise).
  const discountTooLarge = total !== null && discountExceeds(amounts.map((amount) => amount ?? 0), shipping, discount);
  // The shipping and discount fields: what they show must be what is saved before the quote is retained.
  const shippingField = useChargeField(quotes, quote.id, "shipping_ht_cents");
  const discountField = useChargeField(quotes, quote.id, "discount_ht_cents");
  const chargeHeld = shippingField.shownError !== null || discountField.shownError !== null;
  const blocker = chargeHeld
    ? QUOTE_CHARGE_HELD
    : retainBlocker(quote, quotes.refusedPrices(quote.id), unreadableNames, draftNames, discountTooLarge);
  const supplier = quote.supplier_name;
  // TI-691: the amount the supplier wrote is free; the order is made from the line prices, plus the quote's shipping
  // and minus its discount. A gap left is said, can be counted as shipping or discount, and is confirmed at the retain.
  const gap = quote.amount_ht_cents !== null && quoteTotal !== null ? quote.amount_ht_cents - quoteTotal : null;
  const gapText =
    gap !== null && gap !== 0 && quoteTotal !== null && quote.amount_ht_cents !== null
      ? `Écart de ${formatEUR(Math.abs(gap))} entre le montant du devis (${formatEUR(quote.amount_ht_cents)} HT) et ${hasCharges ? "ses lignes, port et remise compris" : "le total des lignes"} (${formatEUR(quoteTotal)} HT).`
      : null;
  /** The gap left becomes shipping (the supplier asks more) or a discount (less), added to what the quote holds. */
  const countGap = async () => {
    if (gap === null || gap === 0) return;
    setBusy("charge");
    setError(null);
    const result = gap > 0
      ? await quotes.saveCharge(quote.id, "shipping_ht_cents", shipping + gap)
      : await quotes.saveCharge(quote.id, "discount_ht_cents", discount - gap);
    setBusy(null);
    if (!result.ok) setError(result.message);
  };
  // A gap that disappears (a price corrected) takes its pending confirmation with it.
  useEffect(() => {
    if (!gapText) setConfirmingGap(false);
  }, [gapText]);
  const closeGap = () => {
    setConfirmingGap(false);
    retainButton.current?.focus();
  };
  const retain = async () => {
    setBusy("retain");
    setError(null);
    const result = await quotes.retainQuote(quote.id, quote.lines.map((entry) => entry.line_id));
    setBusy(null);
    if (result.ok) {
      setConfirmingGap(false);
      return;
    }
    // Refused: the confirmation stays, with the reason below, and keeps the focus where it was.
    setError(result.message);
  };

  const act = async (kind: "received" | "retain", action: () => Promise<SaveResult>) => {
    setBusy(kind);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) setError(result.message);
  };

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "mr-quote-card min-w-0 bg-surface p-3 sm:p-4",
        quote.status === "closed" && "bg-surface-subtle",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 id={titleId} className="min-w-0 break-words font-display text-lg font-semibold text-foreground">
          Devis {supplier}
        </h4>
        <Badge variant={STATUS_VARIANT[quote.status]} dot>
          {MATERIAL_REQUEST_QUOTE_STATUS_LABELS[quote.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">{quote.with_references ? "avec références" : "mise en concurrence"}</span>
      </div>
      <p className="text-xs text-muted-foreground">{quoteDates(quote)}</p>

      <div>
      <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_5rem_minmax(0,0.8fr)_minmax(8rem,1fr)_8rem] rounded-t-lg border border-border bg-surface-subtle text-xs font-medium text-muted-foreground md:grid [&>*]:px-3 [&>*]:py-1.5 [&>*+*]:border-l [&>*+*]:border-border">
        <span>Ligne / Désignation</span><span>Quantité</span><span>Référence</span><span>PU HT</span><span className="text-right">Montant HT</span>
      </div>
      {/* One row per line and grid lines between the columns, as in the lines sheet; a card per line below 768 px. */}
      <ul className="divide-y divide-border border-b border-border bg-surface md:rounded-b-lg md:border-x">
        {quote.lines.map((entry, index) => {
          const line = linesById.get(entry.line_id);
          const amount = amounts[index];
          const sku = line && quote.with_references && line.supplier_id === quote.supplier_id ? editor.supplierReferenceOf(line.id)?.supplier_sku : null;
          return (
            <li key={entry.line_id} className="grid min-w-0 gap-x-3 gap-y-1.5 px-3 py-3 md:min-h-9 md:grid-cols-[minmax(0,1fr)_5rem_minmax(0,0.8fr)_minmax(8rem,1fr)_8rem] md:items-stretch md:gap-0 md:p-0 md:[&>*]:content-center md:[&>*]:px-3 md:[&>*]:py-1 md:[&>*+*]:border-l md:[&>*+*]:border-border">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground md:font-normal">
                  {line ? lineTitle(line) : "Ligne retirée de la demande"}
                </p>
              </div>
              <p className="text-sm">{line ? quantityText(line) : "—"}</p>
              {/* A card says a reference only when there is one; in the table the dash keeps the column. */}
              <p className={cn("min-w-0 break-all text-sm", !sku && "max-md:hidden")}>{sku || "—"}</p>
              {editable && line ? (
                <QuotePriceEntry quotes={quotes} quote={quote} entry={entry} position={line.position} />
              ) : (
                <p className="text-sm text-foreground">
                  <span className="sr-only">Prix unitaire HT : </span>
                  <span className="tabular-nums">
                    {entry.unit_price_ht_cents === null
                      ? "—"
                      : formatQuotedPrice(entry.unit_price_ht_cents, entry.price_per)}
                  </span>
                </p>
              )}
              <p className="text-sm tabular-nums text-foreground md:text-right">
                {amount === null ? "" : `${formatEUR(amount)} HT`}
              </p>
            </li>
          );
        })}
      </ul>
      </div>
      <div className="space-y-1 text-sm text-foreground">
        {total !== null ? (
          <p className={cn("flex flex-wrap justify-between gap-2", !hasCharges && "font-semibold")}><span>Total des lignes :</span> <span className="tabular-nums">{formatEUR(total)} HT</span></p>
        ) : null}
        {shipping > 0 ? (
          <p className="flex flex-wrap justify-between gap-2"><span>Port :</span> <span className="tabular-nums">+{formatEUR(shipping)} HT</span></p>
        ) : null}
        {discount > 0 ? (
          <p className="flex flex-wrap justify-between gap-2"><span>Remise :</span> <span className="tabular-nums">−{formatEUR(discount)} HT</span></p>
        ) : null}
        {hasCharges && quoteTotal !== null ? (
          <p className="flex flex-wrap justify-between gap-2 font-semibold"><span>Total du devis :</span> <span className="tabular-nums">{formatEUR(quoteTotal)} HT</span></p>
        ) : null}
      </div>

      {editable ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <label className="block min-w-0 space-y-1">
            <span className="block text-xs text-muted-foreground">Port HT</span>
            <CentsField
              label={`Port HT, devis ${supplier}`}
              value={quote.shipping_ht_cents}
              field={shippingField}
              onCommit={() => void shippingField.commit((cents) => quotes.saveCharge(quote.id, "shipping_ht_cents", cents))}
            />
          </label>
          <label className="block min-w-0 space-y-1">
            <span className="block text-xs text-muted-foreground">Remise HT</span>
            <CentsField
              label={`Remise HT, devis ${supplier}`}
              value={quote.discount_ht_cents}
              field={discountField}
              onCommit={() => void discountField.commit((cents) => quotes.saveCharge(quote.id, "discount_ht_cents", cents))}
            />
          </label>
          <label className="block min-w-0 space-y-1">
            <span className="block text-xs text-muted-foreground">Montant HT du devis (facultatif)</span>
            <CentsInput
              label={`Montant HT du devis (facultatif), ${supplier}`}
              value={quote.amount_ht_cents}
              onCommit={(cents) => quotes.saveDetails(quote.id, { amount_ht_cents: cents })}
            />
          </label>
          <label className="block min-w-0 space-y-1 sm:col-span-3">
            <span className="block text-xs text-muted-foreground">Remarques (délai…)</span>
            <TextCell
              label={`Remarques (délai…), devis ${supplier}`}
              value={quote.notes}
              maxLength={MATERIAL_REQUEST_QUOTE_NOTES_MAX}
              onCommit={(notes) => quotes.saveDetails(quote.id, { notes })}
            />
          </label>
        </div>
      ) : quote.amount_ht_cents !== null || quote.notes ? (
        <div className="space-y-0.5 text-sm text-foreground">
          {quote.amount_ht_cents !== null ? <p className="flex flex-wrap justify-between gap-2 font-semibold"><span>Montant annoncé :</span><span>{formatEUR(quote.amount_ht_cents)} HT</span></p> : null}
          {quote.notes ? <p className="break-words">Remarques : {quote.notes}</p> : null}
        </div>
      ) : null}
      {gapText ? (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm text-warning">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1"><p className="font-semibold">{gap !== null && gap > 0 ? "+" : ""}{formatEUR(gap ?? 0)} d’écart</p><p className="sr-only">{gapText}</p></div>
          {editable && gap !== null ? (
            <Button type="button" size="sm" variant="outline" loading={busy === "charge"} disabled={busy !== null} onClick={() => void countGap()}>
              {gap > 0 ? `Compter ${formatEUR(gap)} en port` : `Compter ${formatEUR(-gap)} en remise`}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="mr-quote-files"><QuoteFiles editor={editor} quotes={quotes} quote={quote} editable={editable} visible={visible} /></div>

      {editable ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {quote.status === "requested" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={busy === "received"}
                disabled={busy !== null}
                aria-label={`Marquer reçu le devis ${supplier}`}
                onClick={() => void act("received", () => quotes.markReceived(quote.id))}
              >
                <CheckCheck aria-hidden="true" />
                Marquer reçu
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              loading={busy === "retain"}
              disabled={blocker !== null || busy !== null}
              aria-label={`Retenir ce devis (${supplier})`}
              aria-describedby={blocker ? blockerId : undefined}
              ref={retainButton}
              onClick={() => (gapText ? setConfirmingGap(true) : void retain())}
            >
              <Check aria-hidden="true" />
              Retenir ce devis
            </Button>
            <ConfirmButton
              variant="outline"
              label={`Clore le devis ${supplier}`}
              confirmLabel={`Confirmer la clôture du devis ${supplier}`}
              confirmText="Clore ce devis ?"
              onConfirm={async () => {
                setError(null);
                const result = await quotes.closeQuote(quote.id);
                if (!result.ok) setError(result.message);
              }}
            >
              <X aria-hidden="true" />
              Clore
            </ConfirmButton>
          </div>
          {blocker ? (
            <p id={blockerId} className="text-xs text-muted-foreground">
              {blocker}
            </p>
          ) : null}
          {confirmingGap && gapText && blocker === null ? (
            <div role="alert" className="space-y-2 rounded-md border border-warning-border bg-warning-subtle p-2 text-sm text-foreground">
              <p>
                {hasCharges
                  ? `Le devis annonce ${formatEUR(quote.amount_ht_cents ?? 0)} HT ; ses lignes, port et remise compris, font ${formatEUR(quoteTotal ?? 0)} HT. Le bon de commande reprendra les lignes, le port et la remise, sans cet écart.`
                  : `Le devis annonce ${formatEUR(quote.amount_ht_cents ?? 0)} HT, ses lignes font ${formatEUR(quoteTotal ?? 0)} HT. Le bon de commande reprendra les prix des lignes, sans cet écart.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={busy === "retain"}
                  disabled={busy !== null}
                  aria-label={`Retenir avec cet écart (${supplier})`}
                  autoFocus
                  onClick={() => void retain()}
                >
                  Retenir avec cet écart
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={closeGap}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}

      <details className="border-t border-border pt-2 text-xs">
        <summary className="cursor-pointer font-medium text-foreground-secondary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          Message envoyé
        </summary>
        <p className="mt-1 whitespace-pre-line break-words text-foreground">{quote.message}</p>
      </details>
    </article>
  );
}

/**
 * The « Devis » step of a request: the lines grouped by their supplier, the message to copy for each, the
 * competition, then the quotes. A reader sees the groups and the quotes, and nothing that writes.
 */
export function MaterialRequestConsultation({ editor, quotes, affaireName, headingId, canCreateSupplier = false, visible = true, onGoToLines }: Readonly<{
  editor: MaterialRequestEditorApi;
  quotes: MaterialRequestQuotesApi;
  affaireName: string;
  headingId: string;
  /**
   * May add a supplier the list does not hold from the competition's search: the catalogue's own rule (admins and
   * engineers, `canAddToCatalogue`), which its route and policies enforce.
   */
  canCreateSupplier?: boolean;
  visible?: boolean;
  onGoToLines?: () => void;
}>) {
  const { data, canWrite } = editor;
  const template = useConsultationTemplate(canWrite);
  const { groups, without } = supplierGroups(data.lines, data.supplierOptions, quotes.items);
  const ordered = [...quotes.items].sort((left, right) => Date.parse(left.requested_at) - Date.parse(right.requested_at) || left.id.localeCompare(right.id));
  const pendingGroups = groups.filter((group) => group.lines.some((line) => !line.price_quote_id));
  const freshGroups = pendingGroups.filter((group) => !liveQuoteOf(ordered, group.supplierId));
  const [selected, setSelected] = useState<string | null>(null);
  // Only this workspace's successful creation changes the selection; external refreshes never take it away.
  const workspaceQuotes: MaterialRequestQuotesApi = {
    ...quotes,
    createQuote: async (input, supplierName) => {
      const result = await quotes.createQuote(input, supplierName);
      if (result.ok) setSelected(`quote:${result.quoteId}`);
      return result;
    },
    closeQuote: async (quoteId) => {
      setSelected(`quote:${quoteId}`);
      return quotes.closeQuote(quoteId);
    },
  };
  const fallbackQuote = ordered.findLast((quote) => quote.status === "retained") ?? ordered[0];
  const choices = [...ordered.map((quote) => `quote:${quote.id}`), ...freshGroups.map((group) => `supplier:${group.supplierId}`)];
  const active = selected && choices.includes(selected) ? selected : freshGroups[0] ? `supplier:${freshGroups[0].supplierId}` : fallbackQuote ? `quote:${fallbackQuote.id}` : null;
  const activeQuote = ordered.find((quote) => active === `quote:${quote.id}`);
  const activeSupplierId = activeQuote?.supplier_id ?? freshGroups.find((group) => active === `supplier:${group.supplierId}`)?.supplierId;
  const totalOf = (quote: MaterialRequestQuote) => {
    const amounts = quote.lines.map((entry) => lineAmount(editor.linesById.get(entry.line_id), entry.unit_price_ht_cents, entry.price_per));
    return withCharges(quote, amounts.every((amount) => amount !== null) ? amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) : null);
  };
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h2 id={headingId} className="sr-only">Dossier fournisseur</h2>
      {quotes.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">Chargement des devis…</p> : null}
      {quotes.status === "error" ? <div className="flex flex-wrap items-center gap-2 text-sm"><p>Les devis n’ont pas pu être chargés.</p><Button type="button" variant="outline" size="sm" aria-label="Recharger les devis" onClick={quotes.retry}>Réessayer</Button></div> : null}
      {quotes.status === "ready" && choices.length === 0 && without.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {data.lines.length === 0 ? "Aucune ligne à faire chiffrer." : "Aucune consultation envoyée."}
        </p>
      ) : null}
      {choices.length > 0 ? <MaterialRequestWorkspace label="Dossiers fournisseurs" choices={<>
        {ordered.map((quote) => {
          const key = `quote:${quote.id}`;
          const total = totalOf(quote);
          const status = MATERIAL_REQUEST_QUOTE_STATUS_LABELS[quote.status];
          const gap = total !== null && quote.amount_ht_cents !== null ? quote.amount_ht_cents - total : null;
          const scope = quote.lines.map((entry) => editor.linesById.get(entry.line_id)?.product_type || "Ligne retirée").join(", ");
          const amount = total === null ? (quote.status === "closed" ? undefined : "Prix à renseigner") : `${formatEUR(total)} HT`;
          return <MaterialRequestWorkspaceChoice key={key}
            label={`Consulter le devis ${quote.supplier_name} du ${formatDay(quote.requested_at)} (${status})`}
            title={quote.supplier_name}
            status={<Badge variant={STATUS_VARIANT[quote.status]}>{status}</Badge>}
            scope={scope ? `${plural(quote.lines.length, "ligne", "lignes")} · ${scope}` : plural(quote.lines.length, "ligne", "lignes")}
            scopeTitle={scope || undefined}
            amount={amount}
            warning={gap ? `Écart ${gap > 0 ? "+" : ""}${formatEUR(gap)}` : undefined}
            selected={active === key}
            onSelect={() => setSelected(key)}
          />;
        })}
        {freshGroups.map((group) => {
          const key = `supplier:${group.supplierId}`;
          const count = group.lines.filter((line) => !line.price_quote_id).length;
          return <MaterialRequestWorkspaceChoice key={key}
            label={canWrite ? `Préparer une consultation pour ${group.supplierName}` : `Consulter les lignes de ${group.supplierName}`}
            title={group.supplierName}
            status={<Badge variant="neutral">{canWrite ? "À consulter" : "Sans devis"}</Badge>}
            scope={plural(count, "ligne", "lignes")}
            selected={active === key}
            onSelect={() => setSelected(key)}
          />;
        })}
      </>}>
        {pendingGroups.map((group) => <div key={group.supplierId} hidden={activeSupplierId !== group.supplierId} className="border-b border-border p-4"><SupplierGroupCard editor={editor} quotes={workspaceQuotes} group={group} affaireName={affaireName} template={template} canCreateSupplier={canWrite && canCreateSupplier} /></div>)}
        {ordered.map((quote) => {
          const selected = activeQuote?.id === quote.id;
          return (
            <div key={quote.id} hidden={!selected}>
              <QuoteCard editor={editor} quotes={workspaceQuotes} quote={quote} visible={visible && selected} />
            </div>
          );
        })}
        {groups.filter((group) => group.lines.length > 0 && group.lines.every((line) => line.price_quote_id)).map((group) => <div key={`priced:${group.supplierId}`} hidden={activeSupplierId !== group.supplierId} role="group" aria-label={group.supplierName} className="border-t border-border px-6 py-3 text-sm text-muted-foreground">Toutes ses lignes ont leur prix retenu.</div>)}
      </MaterialRequestWorkspace> : null}
      {without.length > 0 ? <div className="rounded-lg border border-dashed border-border p-4"><p className="text-sm font-medium">{canWrite ? "Sans fournisseur : choisissez-le sur la ligne, à l’étape Lignes." : "Sans fournisseur :"}</p><ul className="mt-2 list-disc pl-5 text-sm">{without.map((line) => <li key={line.id}>{lineTitle(line)}</li>)}</ul>{canWrite && onGoToLines ? <Button type="button" variant="link" size="sm" onClick={onGoToLines}>Choisir les fournisseurs, à l’étape Lignes</Button> : null}</div> : null}
    </section>
  );
}
