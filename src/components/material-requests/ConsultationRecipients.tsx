"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, Plus, RotateCcw, Send, TriangleAlert, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import type { MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import { competitionReferenceLeaks, consultationMessageProblem } from "@/lib/material-requests/consultation-template";
import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import type { MaterialRequestQuote, MaterialRequestQuoteStatus } from "@/lib/material-requests/quote-contracts";
import { plural } from "@/lib/text/plural";
import { cn } from "@/lib/utils";

import { CONSULTATION_TEMPLATE_ANCHOR } from "./ConsultationTemplateSettings";
import { formatDay, lineTitle } from "./format";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";
import { supplierAlreadyConsulted, type MaterialRequestQuotesApi, type QuotesStatus } from "./useMaterialRequestQuotes";

/*
 * The messages of a supplier consultation (TI-691, « Consultation » of the « devis » step): one per recipient, and the
 * list of the recipients beside them (mockup B, chosen by the owner on 2026-11-22).
 */

export const STATUS_VARIANT: Record<MaterialRequestQuoteStatus, "info" | "warning" | "success" | "neutral"> = {
  requested: "info",
  received: "warning",
  retained: "success",
  closed: "neutral",
};

/**
 * The consultation of this supplier in progress (requested or received): one at most per request. A retained or
 * closed quote frees the supplier, which may be asked again for other lines.
 */
export function liveQuoteOf(quotes: readonly MaterialRequestQuote[], supplierId: string): MaterialRequestQuote | null {
  return (
    quotes.find((quote) => quote.supplier_id === supplierId && (quote.status === "requested" || quote.status === "received"))
    ?? null
  );
}

/**
 * Where a supplier stands for these lines: asked for all of them, busy with others, or free to ask. `unread`: the
 * consultations already recorded are not read yet (or could not be): nothing may be recorded until they are, or a
 * consultation recorded meanwhile elsewhere would be offered again.
 */
export type SupplierConsultation = { sent: MaterialRequestQuote | null; busyElsewhere: boolean; unread: string | null };

const QUOTES_UNREAD: Record<Exclude<QuotesStatus, "ready">, string> = {
  loading: "Lecture des consultations déjà envoyées…",
  error: "Les consultations déjà envoyées n’ont pas pu être lues : rechargez les devis plus bas.",
};

export function consultationOf(
  quotes: Pick<MaterialRequestQuotesApi, "items" | "status">,
  supplierId: string,
  lineIds: readonly string[],
): SupplierConsultation {
  const unread = quotes.status === "ready" ? null : QUOTES_UNREAD[quotes.status];
  const live = liveQuoteOf(quotes.items, supplierId);
  if (!live) return { sent: null, busyElsewhere: false, unread };
  const asked = new Set(live.lines.map((line) => line.line_id));
  return lineIds.every((id) => asked.has(id))
    ? { sent: live, busyElsewhere: false, unread }
    : { sent: null, busyElsewhere: true, unread };
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

/**
 * The message for one supplier, « Copier » and « Consultation envoyée » (TI-691). The text can be retouched before it
 * is copied: both buttons take the text as shown, never the generated one behind it. A retouch lives as long as the
 * page; when the generated text changes under it (lines, supplier, template), the retouch is kept and the block says
 * so, with the way back. An empty text, or one over the recorded bound, is neither copied nor recorded. In
 * competition, a known reference in the text is pointed out; the office may still go on.
 */
export function ConsultationMessageBlock({
  supplierName,
  message,
  consultation,
  onSend,
  knownReferences,
}: Readonly<{
  supplierName: string;
  message: string;
  /**
   * The supplier's consultation in progress: for these lines, it is recorded and not sent twice; for others, the
   * database takes one at a time, and the office is told why before trying.
   */
  consultation: SupplierConsultation;
  onSend: (message: string) => Promise<SaveResult>;
  /** A competition message: the references known for its lines, which it should not name. */
  knownReferences?: readonly (string | null)[];
}>) {
  const ids = useId();
  const unreadId = `${ids}-unread`;
  const problemId = `${ids}-problem`;
  const leakId = `${ids}-leak`;
  const { stateFor, copyText } = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The office's own text, and the generated text it started from. */
  const [retouch, setRetouch] = useState<{ text: string; from: string } | null>(null);
  const retouched = retouch !== null && retouch.text !== message;
  const shown = retouched ? retouch.text : message;
  const stale = retouched && retouch.from !== message;
  const problem = consultationMessageProblem(shown);
  const leaks = knownReferences ? competitionReferenceLeaks(shown, knownReferences) : [];
  const copyState = stateFor(shown);

  const send = async () => {
    if (problem) return;
    setBusy(true);
    setError(null);
    const result = await onSend(shown);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="min-w-0 space-y-2">
      <Textarea
        aria-label={`Message pour ${supplierName}`}
        aria-describedby={[problem ? problemId : null, leaks.length > 0 ? leakId : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={problem ? true : undefined}
        className="min-h-48 px-3 py-2 text-sm @xl:min-h-64"
        value={shown}
        onChange={(event) => {
          const text = event.target.value;
          setRetouch((current) => ({ text, from: current && current.text !== message ? current.from : message }));
        }}
      />
      {stale ? (
        <p className="text-sm font-medium text-warning">
          Le texte généré a changé depuis votre retouche (lignes, fournisseur ou modèle) : votre texte est gardé tel
          quel, vérifiez-le avant de le copier.
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} className="text-sm font-medium text-danger">{problem}</p>
      ) : null}
      {leaks.length > 0 ? (
        <p id={leakId} className="flex items-start gap-1.5 text-sm font-medium text-warning">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {`Ce message en concurrence cite une référence connue : ${leaks.join(", ")}. Le concurrent pourrait savoir qui vous fournit ; vous pouvez tout de même l’envoyer.`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={problem !== null}
          aria-label={`Copier le message pour ${supplierName}`}
          onClick={() => void copyText(shown)}
        >
          {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          Copier
        </Button>
        {consultation.sent ? (
          <p className="text-sm font-medium text-foreground">{quoteStage(consultation.sent)}</p>
        ) : consultation.busyElsewhere ? null : (
          <Button
            type="button"
            size="sm"
            loading={busy}
            disabled={consultation.unread !== null || problem !== null}
            aria-label={`Consultation envoyée à ${supplierName}`}
            aria-describedby={consultation.unread ? unreadId : problem ? problemId : undefined}
            onClick={() => void send()}
          >
            <Send aria-hidden="true" />
            Consultation envoyée
          </Button>
        )}
        {retouched ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setRetouch(null)}>
            <RotateCcw aria-hidden="true" />
            Rétablir le texte généré
          </Button>
        ) : null}
        {/* A new tab: the retouches of this page stay as they are. */}
        <Link
          href={`/dashboard/profile#${CONSULTATION_TEMPLATE_ANCHOR}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Modifier mon modèle
          <span className="sr-only"> (nouvel onglet)</span>
        </Link>
      </div>
      {consultation.unread && !consultation.sent && !consultation.busyElsewhere ? (
        <p id={unreadId} className="text-xs text-muted-foreground">
          {consultation.unread}
        </p>
      ) : null}
      {consultation.busyElsewhere ? (
        <p className="text-sm text-foreground">{supplierAlreadyConsulted(supplierName, true)}</p>
      ) : null}
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

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/** « 12/11 »: the day and the month, as a card has room for. */
function shortDay(value: string | null): string {
  return formatDay(value).slice(0, 5);
}

/**
 * Where a recipient stands, in words on its card (its colour only repeats them): the stages of `quoteStage`, or why
 * nothing can be recorded for it yet.
 */
function recipientStatus(consultation: SupplierConsultation): { label: string; variant: BadgeVariant } {
  const { sent } = consultation;
  if (sent) {
    switch (sent.status) {
      case "requested":
        return { label: `Envoyée le ${shortDay(sent.requested_at)}`, variant: STATUS_VARIANT.requested };
      case "received":
        return { label: `Devis reçu le ${shortDay(sent.received_at)}`, variant: STATUS_VARIANT.received };
      case "retained":
        return { label: `Devis retenu le ${shortDay(sent.retained_at)}`, variant: STATUS_VARIANT.retained };
      case "closed":
        return { label: `Devis clos le ${shortDay(sent.closed_at)}`, variant: STATUS_VARIANT.closed };
    }
  }
  if (consultation.busyElsewhere) return { label: "Consulté pour d’autres lignes", variant: "warning" };
  if (consultation.unread) return { label: "Lecture en cours", variant: "neutral" };
  return { label: "À envoyer", variant: "outline" };
}

type Recipient = { supplierId: string; name: string; usual: boolean };

/** Where the focus goes once the list changed: the card of a recipient, the search, or the card that opens it. */
type FocusTarget = { tab: string } | "search" | "entry";

/**
 * The recipients of one group's consultation beside the selected one's message (TI-691, mockup B chosen by the owner
 * on 2026-11-22): the group's supplier first, then each competitor, as a vertical tab list; under it, the card that
 * opens the search of a competitor, where a name the list does not hold can be created (admins and engineers, as in
 * the catalogue). Every message stays mounted while another is shown: a retouch lives as long as the page, on its own
 * recipient only.
 */
export function ConsultationRecipients({
  group,
  pendingCount,
  lineIds,
  needType,
  options,
  quotes,
  usualPanel,
  messageFor,
  knownReferences,
  onSend,
  onCreateSupplier,
}: Readonly<{
  /** The group's own supplier, which the lines are bought from. */
  group: { supplierId: string; supplierName: string };
  /** The lines the messages ask for. */
  pendingCount: number;
  /** The lines asked: a consultation in progress counts as sent only when it covers them all. */
  lineIds: readonly string[];
  /** Lines whose only words would leak a reference, or name nothing: a type is needed before competing. */
  needType: readonly MaterialRequestLine[];
  options: readonly MaterialRequestSupplierOption[];
  quotes: Pick<MaterialRequestQuotesApi, "items" | "status">;
  /** What the usual supplier's panel shows: its message, or why it is not offered yet. */
  usualPanel: ReactNode;
  /** Each competitor's own message: {fournisseur} names it (TI-691). */
  messageFor: (supplierName: string) => string;
  /** The references known for the lines, which no competition message should name. */
  knownReferences: readonly (string | null)[];
  onSend: (supplierId: string, supplierName: string, message: string) => Promise<SaveResult>;
  /** Adds a supplier the list does not hold, by its name; null for a member who may not add to the catalogue. */
  onCreateSupplier: MaterialRequestEditorApi["createSupplier"] | null;
}>) {
  const ids = useId();
  const searchId = `${ids}-search`;
  const searchBlockId = `${ids}-search-block`;
  const createErrorId = `${ids}-create-error`;
  const tabId = (supplierId: string) => `${ids}-tab-${supplierId}`;
  const panelId = (supplierId: string) => `${ids}-panel-${supplierId}`;
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [selected, setSelected] = useState(group.supplierId);
  const [searching, setSearching] = useState(false);
  /** Bumped to start the search field again: empty, or with a name whose creation was refused. */
  const [searchKey, setSearchKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [notCreated, setNotCreated] = useState<{ name: string; message: string } | null>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const entry = useRef<HTMLButtonElement>(null);

  const nameOf = (supplierId: string) => options.find((option) => option.id === supplierId)?.label ?? "Fournisseur";
  const recipients: Recipient[] = [
    { supplierId: group.supplierId, name: group.supplierName, usual: true },
    ...competitors.map((supplierId) => ({ supplierId, name: nameOf(supplierId), usual: false })),
  ];
  const active = recipients.some((recipient) => recipient.supplierId === selected) ? selected : group.supplierId;
  const others = options.filter((option) => option.id !== group.supplierId);
  // The whole list, searched as the office types (TI-691: twenty suppliers). The usual supplier and those already in
  // competition stay listed, not offered: their name is known, and must not be created again. Built once for the
  // same list: the combobox indexes what it is given.
  const entries = useMemo(
    () =>
      options.map((option) => {
        const usual = option.id === group.supplierId;
        const chosen = competitors.includes(option.id);
        return {
          value: option.id,
          label: usual ? `${option.label} (fournisseur habituel)` : chosen ? `${option.label} (déjà en concurrence)` : option.label,
          keywords: [option.name],
          disabled: usual || chosen,
        };
      }),
    [competitors, group.supplierId, options],
  );

  useEffect(() => {
    if (focus === null) return;
    if (focus === "search") document.getElementById(searchId)?.focus();
    else if (focus === "entry") entry.current?.focus();
    else tabs.current.get(focus.tab)?.focus();
    setFocus(null);
  }, [focus, searchId]);

  const add = (supplierId: string) => {
    setCompetitors((current) => (current.includes(supplierId) ? current : [...current, supplierId]));
    setSelected(supplierId);
    setSearching(false);
    setNotCreated(null);
    setSearchKey((current) => current + 1);
    setFocus({ tab: supplierId });
  };

  const withdraw = (supplierId: string) => {
    setCompetitors((current) => current.filter((entry) => entry !== supplierId));
    setSelected(group.supplierId);
    // The button leaves with its recipient: the focus goes back to the card that opens the search.
    setFocus("entry");
  };

  const create = async (name: string) => {
    if (!onCreateSupplier || creating) return;
    setCreating(true);
    setNotCreated(null);
    const result = await onCreateSupplier(name);
    setCreating(false);
    if (result.ok) {
      add(result.id);
      return;
    }
    // Refused: said under the field, which gives the name back to correct or retry.
    setNotCreated({ name, message: result.message });
    setSearchKey((current) => current + 1);
    setFocus("search");
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = recipients.length - 1;
    const next =
      event.key === "ArrowDown" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowUp" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = recipients[next].supplierId;
    setSelected(target);
    tabs.current.get(target)?.focus();
  };

  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 gap-3 @xl:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] @xl:gap-4">
        <div className="min-w-0 space-y-2">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label={`Destinataires de la consultation, ${group.supplierName}`}
            className="flex min-w-0 flex-col gap-2"
          >
            {recipients.map((recipient, index) => {
              const status = recipientStatus(consultationOf(quotes, recipient.supplierId, lineIds));
              const kind = recipient.usual ? "habituel" : "concurrence";
              const lines = plural(pendingCount, "ligne", "lignes");
              const isActive = recipient.supplierId === active;
              return (
                <button
                  key={recipient.supplierId}
                  ref={(node) => {
                    if (node) tabs.current.set(recipient.supplierId, node);
                    else tabs.current.delete(recipient.supplierId);
                  }}
                  type="button"
                  role="tab"
                  id={tabId(recipient.supplierId)}
                  aria-selected={isActive}
                  aria-controls={panelId(recipient.supplierId)}
                  aria-label={`${recipient.name}, ${kind}, ${lines}, ${status.label}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setSelected(recipient.supplierId)}
                  onKeyDown={(event) => move(event, index)}
                  className={cn(
                    "block w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isActive && "border-primary bg-primary/5 hover:bg-primary/5",
                  )}
                >
                  <span className="block min-w-0 break-words text-sm font-semibold text-foreground">{recipient.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{`${kind} · ${lines}`}</span>
                  <Badge variant={status.variant} size="sm" dot className="mt-1.5">
                    {status.label}
                  </Badge>
                </button>
              );
            })}
          </div>
          <button
            ref={entry}
            type="button"
            aria-label={`Mettre en concurrence les lignes de ${group.supplierName}`}
            aria-expanded={searching}
            aria-controls={searching ? searchBlockId : undefined}
            onClick={() => {
              const opening = !searching;
              setSearching(opening);
              if (opening) setFocus("search");
              else setNotCreated(null);
            }}
            className="flex w-full min-w-0 items-start gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Mettre en concurrence</span>
              <span className="block text-xs text-muted-foreground">
                {onCreateSupplier ? "Chercher ou créer un fournisseur" : "Chercher un fournisseur"}
              </span>
            </span>
          </button>
          {searching ? (
            <div id={searchBlockId} className="min-w-0 space-y-1 rounded-md border border-border bg-surface-subtle p-3">
              <p className="text-xs text-muted-foreground">
                Leur message ne donne aucune référence : seulement les désignations complètes.
              </p>
              {others.length === 0 && !onCreateSupplier ? (
                <p className="text-sm text-muted-foreground">Aucun autre fournisseur dans la liste.</p>
              ) : (
                <>
                  <label htmlFor={searchId} className="block pt-1 text-xs text-muted-foreground">
                    Ajouter un fournisseur
                  </label>
                  <Combobox
                    key={searchKey}
                    id={searchId}
                    aria-describedby={[notCreated ? createErrorId : null, `${searchId}-count`].filter(Boolean).join(" ")}
                    aria-invalid={notCreated ? true : undefined}
                    size="sm"
                    placeholder="Chercher un fournisseur…"
                    emptyMessage="Aucun fournisseur trouvé."
                    options={entries}
                    defaultInputValue={notCreated?.name}
                    isLoading={creating}
                    onCreate={onCreateSupplier ? (name) => void create(name) : undefined}
                    createLabel={(name) => `Créer le fournisseur « ${name} »`}
                    // Always empty: a pick adds the supplier to the list and selects its message.
                    value=""
                    onValueChange={(supplierId) => {
                      if (supplierId) add(supplierId);
                    }}
                  />
                  <p id={`${searchId}-count`} className="text-xs text-muted-foreground">
                    {`${plural(others.length, "fournisseur", "fournisseurs")} dans la liste, à chercher par leur nom${onCreateSupplier ? " ; un nom absent de la liste peut être créé" : ""}.`}
                  </p>
                  {notCreated ? (
                    <p id={createErrorId} role="alert" className="text-sm font-medium text-danger">
                      {`Non créé : ${notCreated.message}`}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">
          {recipients.map((recipient) => (
            <div
              key={recipient.supplierId}
              role="tabpanel"
              id={panelId(recipient.supplierId)}
              aria-labelledby={tabId(recipient.supplierId)}
              hidden={recipient.supplierId !== active}
              className="min-w-0 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h4 className="break-words text-sm font-semibold text-foreground">{recipient.name}</h4>
                  <p className="text-xs text-muted-foreground">
                    {recipient.usual
                      ? "Fournisseur habituel : son message donne ses références."
                      : "En concurrence : son message ne donne aucune référence, seulement les désignations complètes."}
                  </p>
                </div>
                {recipient.usual ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    aria-label={`Retirer ${recipient.name} de la mise en concurrence`}
                    onClick={() => withdraw(recipient.supplierId)}
                  >
                    <X aria-hidden="true" />
                    Retirer
                  </Button>
                )}
              </div>
              {recipient.usual ? (
                usualPanel
              ) : (
                <>
                  {needType.length > 0 ? (
                    <ul className="space-y-0.5 text-sm font-medium text-warning">
                      {needType.map((line) => (
                        // Such a line has no type to be named by: the technician's words name it, when it has some.
                        <li key={line.id}>{`${line.original_text?.trim() ? lineTitle(line) : "Une ligne sans désignation"} : donnez-lui un type, à l’étape Lignes, avant de la mettre en concurrence.`}</li>
                      ))}
                    </ul>
                  ) : null}
                  <ConsultationMessageBlock
                    supplierName={recipient.name}
                    message={messageFor(recipient.name)}
                    knownReferences={knownReferences}
                    consultation={consultationOf(quotes, recipient.supplierId, lineIds)}
                    onSend={(text) => onSend(recipient.supplierId, recipient.name, text)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
