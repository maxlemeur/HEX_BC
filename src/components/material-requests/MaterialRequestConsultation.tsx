"use client";

import { useId, useRef, useState } from "react";
import { Check, CheckCheck, Copy, FileText, Paperclip, Send, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { materialRequestFileUrl, type MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import { buildConsultationMessage, consultationLineOf } from "@/lib/material-requests/consultation-message";
import type { MaterialRequestFile, MaterialRequestLine } from "@/lib/material-requests/contracts";
import {
  MATERIAL_REQUEST_QUOTE_MAX_CENTS,
  MATERIAL_REQUEST_QUOTE_MAX_FILES,
  MATERIAL_REQUEST_QUOTE_NOTES_MAX,
  MATERIAL_REQUEST_QUOTE_PICKER_ACCEPT,
  MATERIAL_REQUEST_QUOTE_STATUS_LABELS,
  type MaterialRequestQuote,
  type MaterialRequestQuoteStatus,
} from "@/lib/material-requests/quote-contracts";
import { formatEUR } from "@/lib/money";
import { parseAmountCents } from "@/lib/numeric-input/parsers";
import { cn } from "@/lib/utils";

import { CellMessages, ConfirmButton, TextCell, usePendingWrites } from "./cells";
import { checkQuoteFileSelection, formatDay, formatQuantity, lineTitle, plural } from "./format";
import { photoUploadStepLabel, type PhotoUploadStep } from "./photo-upload";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";
import { QUOTE_PRICE_HELD, useMaterialRequestQuotes, type MaterialRequestQuotesApi } from "./useMaterialRequestQuotes";

/*
 * « Consultation » (TI-691, lot 2 « l'achat », delivery 2): the office asks suppliers for a price with a short
 * message it copies into WhatsApp (MergeOne sends nothing), records that it was sent, attaches what comes back,
 * prices it line by line and retains one quote; the others are closed and stay readable.
 */

const STATUS_VARIANT: Record<MaterialRequestQuoteStatus, "info" | "warning" | "success" | "neutral"> = {
  requested: "info",
  received: "warning",
  retained: "success",
  closed: "neutral",
};

const CONTROL =
  "h-9 w-full min-w-0 rounded-control border border-input bg-surface px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15";

const AMOUNT_UNREADABLE = "Montant illisible : en euros, avec une virgule et deux décimales au plus (12,50).";

/** The quote of this supplier that is not closed: one at most per request (a retained one counts). */
function liveQuoteOf(quotes: readonly MaterialRequestQuote[], supplierId: string): MaterialRequestQuote | null {
  return quotes.find((quote) => quote.supplier_id === supplierId && quote.status !== "closed") ?? null;
}

/** Where a supplier's consultation stands, in one sentence. */
function quoteStage(quote: MaterialRequestQuote): string {
  switch (quote.status) {
    case "requested":
      return `Consultation envoyée le ${formatDay(quote.requested_at)}.`;
    case "received":
      return `Devis reçu le ${formatDay(quote.received_at)}.`;
    case "retained":
      return `Devis retenu le ${formatDay(quote.retained_at)}.`;
    case "closed":
      return `Devis clos le ${formatDay(quote.closed_at)}.`;
  }
}

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
function retainBlocker(quote: MaterialRequestQuote, refusedPrices: number): string | null {
  if (refusedPrices > 0) return QUOTE_PRICE_HELD;
  const unpriced = quote.lines.filter((line) => line.unit_price_ht_cents === null).length;
  const missing = unpriced === 1 ? "il en manque 1" : `il en manque ${unpriced}`;
  if (quote.status === "requested") {
    return unpriced > 0
      ? `Pour retenir ce devis, marquez-le reçu et saisissez le prix de chaque ligne (${missing}).`
      : "Pour retenir ce devis, marquez-le reçu.";
  }
  return unpriced > 0 ? `Pour retenir ce devis, saisissez le prix de chaque ligne (${missing}).` : null;
}

function lineAmount(line: MaterialRequestLine | undefined, cents: number | null): number | null {
  if (!line || line.quantity === null || cents === null) return null;
  return Math.round(line.quantity * cents);
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

/** Copy to the clipboard, as the message to the technician does; refused copies are said, not hidden. */
function useCopy() {
  const [copy, setCopy] = useState<{ text: string; state: "copied" | "refused" } | null>(null);
  return {
    stateFor: (text: string) => (copy && copy.text === text ? copy.state : null),
    copyText: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopy({ text, state: "copied" });
      } catch {
        setCopy({ text, state: "refused" });
      }
    },
  };
}

/** The message for one supplier, « Copier » and « Consultation envoyée ». */
function MessageBlock({
  supplierName,
  message,
  live,
  onSend,
}: Readonly<{
  supplierName: string;
  message: string;
  /** The supplier's quote that is not closed: the consultation is recorded, it is not sent twice. */
  live: MaterialRequestQuote | null;
  onSend: (message: string) => Promise<SaveResult>;
}>) {
  const { stateFor, copyText } = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyState = stateFor(message);

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await onSend(message);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="min-w-0 space-y-2">
      <Textarea
        readOnly
        aria-label={`Message pour ${supplierName}`}
        className="min-h-28 px-3 py-2 text-sm"
        value={message}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Copier le message pour ${supplierName}`}
          onClick={() => void copyText(message)}
        >
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Copier
        </Button>
        {live ? (
          <p className="text-sm font-medium text-foreground">{quoteStage(live)}</p>
        ) : (
          <Button
            type="button"
            size="sm"
            loading={busy}
            aria-label={`Consultation envoyée à ${supplierName}`}
            onClick={() => void send()}
          >
            <Send aria-hidden="true" />
            Consultation envoyée
          </Button>
        )}
      </div>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {copyState === "copied" ? "Message copié." : null}
        {copyState === "refused"
          ? "La copie a été refusée par le navigateur : sélectionnez le texte et copiez-le à la main."
          : null}
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}
    </div>
  );
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
    options.find((option) => option.id === id)?.name
    ?? quotes.find((quote) => quote.supplier_id === id)?.supplier_name
    ?? "Fournisseur retiré de la liste";
  return {
    groups: [...byId.entries()].map(([supplierId, grouped]) => ({ supplierId, supplierName: nameOf(supplierId), lines: grouped })),
    without,
  };
}

function CompetitionPanel({
  id,
  group,
  options,
  quotes,
  message,
  onSend,
}: Readonly<{
  id: string;
  group: SupplierGroup;
  options: readonly MaterialRequestSupplierOption[];
  quotes: readonly MaterialRequestQuote[];
  message: string;
  onSend: (supplierId: string, message: string) => Promise<SaveResult>;
}>) {
  const [chosen, setChosen] = useState<string[]>([]);
  const others = options.filter((option) => option.id !== group.supplierId);

  return (
    <div id={id} className="min-w-0 space-y-3 rounded-md border border-dashed border-border p-3">
      <fieldset className="min-w-0">
        <legend className="text-sm font-semibold text-foreground">Fournisseurs à mettre en concurrence</legend>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Leur message ne donne aucune référence : seulement les désignations complètes.
        </p>
        {others.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Aucun autre fournisseur dans la liste.</p>
        ) : (
          <div className="mt-2 grid max-h-56 gap-x-3 overflow-y-auto sm:grid-cols-2">
            {others.map((option) => (
              <label key={option.id} className="flex min-h-9 min-w-0 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={chosen.includes(option.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setChosen((current) =>
                      checked ? [...current, option.id] : current.filter((entry) => entry !== option.id),
                    );
                  }}
                />
                <span className="min-w-0 break-words">{option.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {chosen.map((supplierId) => {
        const name = others.find((option) => option.id === supplierId)?.name ?? "Fournisseur";
        return (
          <div key={supplierId} className="min-w-0 space-y-1.5 border-t border-border pt-3">
            <h4 className="text-sm font-semibold text-foreground">{name}</h4>
            <MessageBlock
              supplierName={name}
              message={message}
              live={liveQuoteOf(quotes, supplierId)}
              onSend={(text) => onSend(supplierId, text)}
            />
          </div>
        );
      })}
    </div>
  );
}

function SupplierGroupCard({
  editor,
  quotes,
  group,
  affaireName,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  quotes: MaterialRequestQuotesApi;
  group: SupplierGroup;
  affaireName: string;
}>) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const panelId = `${ids}-competition`;
  const [competing, setCompeting] = useState(false);
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
      }),
    );
  const message = (withReferences: boolean) =>
    buildConsultationMessage({
      affaireName,
      lines: lines(withReferences),
      withReferences,
      deliveryPlace: data.request.delivery_place,
    });
  const send = (supplierId: string, withReferences: boolean, text: string) =>
    quotes.createQuote({
      supplier_id: supplierId,
      line_ids: pending.map((line) => line.id),
      with_references: withReferences,
      message: text,
    });

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
          {referencesRead ? (
            <MessageBlock
              supplierName={group.supplierName}
              message={message(true)}
              live={liveQuoteOf(quotes.items, group.supplierId)}
              onSend={(text) => send(group.supplierId, true, text)}
            />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Lecture des références chez {group.supplierName}…
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal py-1"
            aria-expanded={competing}
            aria-controls={competing ? panelId : undefined}
            aria-label={`Mettre en concurrence les lignes de ${group.supplierName}`}
            onClick={() => setCompeting((current) => !current)}
          >
            <Users aria-hidden="true" />
            Mettre en concurrence
          </Button>
          {competing ? (
            <CompetitionPanel
              id={panelId}
              group={group}
              options={data.supplierOptions}
              quotes={quotes.items}
              message={message(false)}
              onSend={(supplierId, text) => send(supplierId, false, text)}
            />
          ) : null}
        </>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
          {pending.map((line) => (
            <li key={line.id} className="break-words">{`Ligne ${line.position} · ${lineTitle(line)}`}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function readCents(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cents = parseAmountCents(trimmed);
  return cents !== null && cents >= 0 && cents <= MATERIAL_REQUEST_QUOTE_MAX_CENTS ? cents : undefined;
}

function centsText(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * An amount in euros, typed with the house grammar (« 12,50 », « 1 250 »), saved on leaving the field or Enter;
 * Escape gives back the saved amount. A refused save keeps what was typed, with the reason under it.
 */
function CentsInput({
  label,
  value,
  onCommit,
  onAbandon,
}: Readonly<{
  label: string;
  value: number | null;
  onCommit: (next: number | null) => Promise<SaveResult>;
  onAbandon?: () => void;
}>) {
  const messagesId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writes = usePendingWrites<number | null>(value);
  const unreadable = draft !== null && readCents(draft) === undefined;
  const shownError = unreadable ? AMOUNT_UNREADABLE : error;

  const commit = async () => {
    if (draft === null) return;
    const next = readCents(draft);
    if (next === undefined) return;
    if (next === writes.expected()) {
      if (writes.idle()) {
        if (error) onAbandon?.();
        setDraft(null);
        setError(null);
      }
      return;
    }
    const result = await writes.send(next, () => onCommit(next));
    if (result === null) return;
    if (result.ok) {
      setError(null);
      setDraft((current) => (current !== null && readCents(current) === next ? null : current));
    } else {
      setError(result.message);
    }
  };

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={Boolean(shownError) || undefined}
        aria-describedby={shownError ? messagesId : undefined}
        className={cn(CONTROL, "text-right tabular-nums", shownError && "border-danger")}
        value={draft ?? centsText(value)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape" && (draft !== null || error)) {
            event.preventDefault();
            if (error) onAbandon?.();
            setDraft(null);
            setError(null);
          }
        }}
      />
      <CellMessages id={messagesId} error={shownError} />
    </>
  );
}

function QuoteFiles({
  editor,
  quotes,
  quote,
  editable,
}: Readonly<{
  editor: MaterialRequestEditorApi;
  quotes: MaterialRequestQuotesApi;
  quote: MaterialRequestQuote;
  editable: boolean;
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
      <p className="text-sm font-semibold text-foreground">Pièces du devis</p>
      {quote.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune pièce jointe.</p>
      ) : (
        <ul className="space-y-1">
          {quote.files.map((file) => (
            <li key={file.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <a
                href={materialRequestFileUrl(editor.projectId, editor.requestId, file.id)}
                target="_blank"
                rel="noopener noreferrer"
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
            {progress ? photoUploadStepLabel(progress, "quote") : ""}
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

function QuoteCard({
  editor,
  quotes,
  quote,
}: Readonly<{ editor: MaterialRequestEditorApi; quotes: MaterialRequestQuotesApi; quote: MaterialRequestQuote }>) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const blockerId = `${ids}-blocker`;
  const [busy, setBusy] = useState<"received" | "retain" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = editor.canWrite && (quote.status === "requested" || quote.status === "received");
  const linesById = new Map(editor.data.lines.map((line) => [line.id, line]));
  const blocker = retainBlocker(quote, quotes.refusedPrices(quote.id));
  const amounts = quote.lines.map((entry) => lineAmount(linesById.get(entry.line_id), entry.unit_price_ht_cents));
  const total = amounts.every((amount) => amount !== null)
    ? amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
    : null;
  const supplier = quote.supplier_name;

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
        "min-w-0 space-y-3 rounded-lg border p-3",
        quote.status === "retained" ? "border-success-border bg-success-subtle" : "border-border bg-surface",
        quote.status === "closed" && "bg-surface-subtle",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h4 id={titleId} className="min-w-0 break-words text-base font-semibold text-foreground">
          Devis {supplier}
        </h4>
        <Badge variant={STATUS_VARIANT[quote.status]} dot>
          {MATERIAL_REQUEST_QUOTE_STATUS_LABELS[quote.status]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {quote.with_references ? "avec références" : "mise en concurrence"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{quoteDates(quote)}</p>

      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {quote.lines.map((entry, index) => {
          const line = linesById.get(entry.line_id);
          const amount = amounts[index];
          return (
            <li key={entry.line_id} className="grid min-w-0 gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_10rem_8rem] sm:items-start">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">
                  {line ? `Ligne ${line.position} · ${lineTitle(line)}` : "Ligne retirée de la demande"}
                </p>
                {line ? <p className="text-xs text-muted-foreground">{quantityText(line)}</p> : null}
              </div>
              {editable && line ? (
                <label className="block min-w-0 space-y-1">
                  <span className="text-xs text-muted-foreground">Prix unitaire HT</span>
                  <CentsInput
                    label={`Prix unitaire HT, ligne ${line.position}, ${supplier}`}
                    value={entry.unit_price_ht_cents}
                    onCommit={(cents) => quotes.savePrice(quote.id, entry.line_id, cents)}
                    onAbandon={() => quotes.forgetPriceFailure(quote.id, entry.line_id)}
                  />
                </label>
              ) : (
                <p className="text-sm text-foreground">
                  <span className="text-xs text-muted-foreground">Prix unitaire HT : </span>
                  <span className="tabular-nums">
                    {entry.unit_price_ht_cents === null ? "—" : formatEUR(entry.unit_price_ht_cents)}
                  </span>
                </p>
              )}
              <p className="text-sm tabular-nums text-foreground sm:pt-5 sm:text-right">
                {amount === null ? "" : `${formatEUR(amount)} HT`}
              </p>
            </li>
          );
        })}
      </ul>
      {total !== null ? (
        <p className="text-sm font-semibold text-foreground">Total des lignes : {formatEUR(total)} HT</p>
      ) : null}

      {editable ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <label className="block min-w-0 space-y-1">
            <span className="text-xs text-muted-foreground">Montant HT du devis (facultatif)</span>
            <CentsInput
              label={`Montant HT du devis (facultatif), ${supplier}`}
              value={quote.amount_ht_cents}
              onCommit={(cents) => quotes.saveDetails(quote.id, { amount_ht_cents: cents })}
            />
          </label>
          <label className="block min-w-0 space-y-1">
            <span className="text-xs text-muted-foreground">Remarques (délai, port…)</span>
            <TextCell
              label={`Remarques (délai, port…), devis ${supplier}`}
              value={quote.notes}
              maxLength={MATERIAL_REQUEST_QUOTE_NOTES_MAX}
              onCommit={(notes) => quotes.saveDetails(quote.id, { notes })}
            />
          </label>
        </div>
      ) : quote.amount_ht_cents !== null || quote.notes ? (
        <div className="space-y-0.5 text-sm text-foreground">
          {quote.amount_ht_cents !== null ? <p>Montant HT du devis : {formatEUR(quote.amount_ht_cents)}</p> : null}
          {quote.notes ? <p className="break-words">Remarques : {quote.notes}</p> : null}
        </div>
      ) : null}

      <QuoteFiles editor={editor} quotes={quotes} quote={quote} editable={editable} />

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
              onClick={() => void act("retain", () => quotes.retainQuote(quote.id))}
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
        </div>
      ) : quote.status === "retained" ? (
        <p className="text-sm text-foreground">Devis retenu : ses prix unitaires sont ceux des lignes.</p>
      ) : quote.status === "closed" ? (
        <p className="text-sm text-muted-foreground">Devis clos : il reste lisible, rien n’y change.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-foreground-secondary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          Message envoyé
        </summary>
        <p className="mt-1 whitespace-pre-line break-words text-foreground">{quote.message}</p>
      </details>
    </article>
  );
}

/**
 * The « Consultation » section of a request: below the lines, the lines grouped by their supplier, the message to
 * copy for each, the competition, then the quotes. A reader sees the groups and the quotes, and nothing that writes.
 */
export function MaterialRequestConsultation({
  editor,
  affaireName,
  headingId,
}: Readonly<{ editor: MaterialRequestEditorApi; affaireName: string; headingId: string }>) {
  const quotes = useMaterialRequestQuotes(editor);
  const { data, canWrite } = editor;
  const { groups, without } = supplierGroups(data.lines, data.supplierOptions, quotes.items);
  // Oldest consultation first, whatever order a read or a write answered in: a card never jumps.
  const ordered = [...quotes.items].sort(
    (left, right) => Date.parse(left.requested_at) - Date.parse(right.requested_at) || left.id.localeCompare(right.id),
  );

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <div className="min-w-0">
        <h2 id={headingId} className="typo-h3 text-foreground">
          Consultation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {canWrite
            ? "Copiez le message dans WhatsApp, puis appuyez sur « Consultation envoyée » : le devis attendu s’ajoute à la liste. MergeOne n’envoie rien."
            : "Les fournisseurs consultés pour cette demande et leurs devis."}
        </p>
      </div>

      {data.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune ligne à consulter pour le moment.</p>
      ) : null}
      {groups.map((group) => (
        <SupplierGroupCard key={group.supplierId} editor={editor} quotes={quotes} group={group} affaireName={affaireName} />
      ))}
      {without.length > 0 ? (
        <div className="min-w-0 space-y-1 rounded-lg border border-dashed border-border p-3">
          <p className="text-sm font-medium text-foreground">
            {canWrite ? "Sans fournisseur : choisissez-en un dans la colonne Fournisseur." : "Sans fournisseur :"}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {without.map((line) => (
              <li key={line.id} className="break-words">{`Ligne ${line.position} · ${lineTitle(line)}`}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-w-0 space-y-3">
        <h3 className="text-base font-semibold text-foreground">Devis</h3>
        {quotes.status === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Chargement des devis…
          </p>
        ) : quotes.status === "error" ? (
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <p>Les devis n’ont pas pu être chargés.</p>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0"
              aria-label="Recharger les devis"
              onClick={quotes.retry}
            >
              Réessayer
            </Button>
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune consultation envoyée pour le moment.</p>
        ) : (
          ordered.map((quote) => <QuoteCard key={quote.id} editor={editor} quotes={quotes} quote={quote} />)
        )}
      </div>
    </section>
  );
}
