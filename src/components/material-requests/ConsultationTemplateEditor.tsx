"use client";

import { useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { RotateCcw, SaveIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ConsultationLine } from "@/lib/material-requests/consultation-message";
import {
  CONSULTATION_LINE_TEMPLATE_MAX,
  CONSULTATION_MESSAGE_TEMPLATE_MAX,
  consultationTemplateIssues,
  consultationTemplateRefusals,
  renderConsultationMessage,
  type ConsultationTemplate,
} from "@/lib/material-requests/consultation-template";

/**
 * The editor of a consultation message template (TI-691), shared by « Mon profil » (the member's own) and the
 * administration (the company's): the two texts, buttons that insert a field where the cursor is, a preview of both
 * variants on invented lines, a reset and a save that says how it went.
 */

const MESSAGE_FIELDS = [
  { token: "{affaire}", label: "Affaire" },
  { token: "{fournisseur}", label: "Fournisseur" },
  { token: "{lignes}", label: "Lignes" },
  { token: "{livraison}", label: "Livraison" },
] as const;

const LINE_FIELDS = [
  { token: "{quantité}", label: "Quantité" },
  { token: "{désignation}", label: "Désignation" },
  { token: "{référence}", label: "Référence" },
  { token: "{ligne}", label: "N° de ligne" },
] as const;

function sample(partial: Partial<ConsultationLine>): ConsultationLine {
  return {
    position: 1, quantity: null, unit: "u", designation: null, dimension: null, material: null, precision: null,
    originalText: null, reference: null, supplierSku: null, ...partial,
  };
}

/** Invented lines: a reference known at the supplier, one unknown, one without a quantity. */
const SAMPLE_LINES: ConsultationLine[] = [
  sample({ position: 1, quantity: 10, designation: "Coude 90°", dimension: "DN 50", material: "Inox 316L", supplierSku: "CD-50-316" }),
  sample({ position: 2, quantity: 4, designation: "Té égal", dimension: "DN 50", material: "Inox 316L" }),
  sample({ position: 3, quantity: null, unit: null, designation: "Collier isophonique", dimension: "Ø 22" }),
];
const SAMPLE = { affaireName: "Résidence des Tilleuls", deliveryPlace: "site" as const, lines: SAMPLE_LINES };

export type TemplateSaveResult = { ok: true } | { ok: false; message: string };

export function ConsultationTemplateEditor({
  initial,
  unavailable,
  savedAs,
  canReset,
  resetLabel,
  resetDone,
  onSave,
  onReset,
}: Readonly<{
  /** What the editor starts from: the template in force. */
  initial: ConsultationTemplate;
  /** Why nothing can be saved (the templates are not installed yet), or null. */
  unavailable?: string | null;
  /**
   * The template a save would only copy (the member has none of their own and has not changed the one in force):
   * « Enregistrer » waits for a change, so no copy of the company's template is frozen as theirs.
   */
  savedAs?: ConsultationTemplate | null;
  /** A template of this level is saved: « Rétablir » removes it. */
  canReset: boolean;
  resetLabel: string;
  /** What the success line says once reset. */
  resetDone: string;
  onSave: (template: ConsultationTemplate) => Promise<TemplateSaveResult>;
  /** Removes the saved template and answers the template then in force, shown in the editor. */
  onReset: () => Promise<({ ok: true; template: ConsultationTemplate }) | { ok: false; message: string }>;
}>) {
  const ids = useId();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const lineRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState(initial.message);
  const [line, setLine] = useState(initial.line);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [status, setStatus] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const draft: ConsultationTemplate = { message, line };
  const issues = consultationTemplateIssues(draft);
  const refusals = [
    ...consultationTemplateRefusals(draft),
    ...(message.trim() ? [] : ["Le modèle du message ne peut pas être vide."]),
    ...(line.trim() ? [] : ["Le modèle de ligne ne peut pas être vide."]),
    ...(message.length > CONSULTATION_MESSAGE_TEMPLATE_MAX ? [`Le modèle du message : ${CONSULTATION_MESSAGE_TEMPLATE_MAX} caractères au plus.`] : []),
    ...(line.length > CONSULTATION_LINE_TEMPLATE_MAX ? [`Le modèle de ligne : ${CONSULTATION_LINE_TEMPLATE_MAX} caractères au plus.`] : []),
  ];
  const unknown = [...issues.message.unknown, ...issues.line.unknown];
  const unchanged = savedAs ? savedAs.message === message && savedAs.line === line : false;

  /** Where the caret goes once an inserted field is rendered: right after it, in the same field. */
  const caret = useRef<{ field: HTMLTextAreaElement; position: number } | null>(null);
  useLayoutEffect(() => {
    const pending = caret.current;
    if (!pending) return;
    caret.current = null;
    pending.field.focus();
    pending.field.setSelectionRange(pending.position, pending.position);
  }, [message, line]);

  function insert(target: RefObject<HTMLTextAreaElement | null>, value: string, set: (next: string) => void, token: string) {
    const field = target.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    if (field) caret.current = { field, position: start + token.length };
    set(`${value.slice(0, start)}${token}${value.slice(end)}`);
    setStatus(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refusals.length > 0 || unavailable || unchanged) return;
    setBusy("save");
    setStatus(null);
    const result = await onSave(draft);
    setBusy(null);
    setStatus(result.ok ? { kind: "success", text: "Modèle enregistré. Il s’applique aux prochains messages." } : { kind: "danger", text: result.message });
  }

  async function reset() {
    setBusy("reset");
    setStatus(null);
    const result = await onReset();
    setBusy(null);
    if (!result.ok) {
      setStatus({ kind: "danger", text: result.message });
      return;
    }
    setMessage(result.template.message);
    setLine(result.template.line);
    setStatus({ kind: "success", text: resetDone });
  }

  const preview = (withReferences: boolean, supplierName: string, deliveryPlace: "site" | null) =>
    renderConsultationMessage({ ...SAMPLE, deliveryPlace, template: draft, withReferences, supplierName });

  return (
    <form noValidate onSubmit={(event) => void save(event)} className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel htmlFor={`${ids}-message`}>Modèle du message</FieldLabel>
        <FieldButtons label="Insérer dans le message" fields={MESSAGE_FIELDS} onInsert={(token) => insert(messageRef, message, setMessage, token)} />
        <Textarea
          ref={messageRef}
          id={`${ids}-message`}
          className="min-h-36 px-3 py-2 font-mono text-sm"
          value={message}
          aria-describedby={`${ids}-message-count ${ids}-syntax`}
          onChange={(event) => {
            setMessage(event.target.value);
            setStatus(null);
          }}
        />
        <p id={`${ids}-message-count`} className="text-xs text-muted-foreground">
          {message.length} / {CONSULTATION_MESSAGE_TEMPLATE_MAX} caractères · doit contenir {"{lignes}"}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel htmlFor={`${ids}-line`}>Modèle de chaque ligne</FieldLabel>
        <FieldButtons label="Insérer dans la ligne" fields={LINE_FIELDS} onInsert={(token) => insert(lineRef, line, setLine, token)} />
        <Textarea
          ref={lineRef}
          id={`${ids}-line`}
          className="min-h-16 px-3 py-2 font-mono text-sm"
          value={line}
          aria-describedby={`${ids}-line-count ${ids}-syntax`}
          onChange={(event) => {
            setLine(event.target.value);
            setStatus(null);
          }}
        />
        <p id={`${ids}-line-count`} className="text-xs text-muted-foreground">
          {line.length} / {CONSULTATION_LINE_TEMPLATE_MAX} caractères · doit contenir {"{désignation}"}
        </p>
      </div>

      <div id={`${ids}-syntax`} className="space-y-1 rounded-md bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
        <p>
          Un champ entre accolades est remplacé par sa valeur ; {"{lignes}"} s’écrit une fois. Entre crochets, une partie
          disparaît quand son champ est vide : <code className="text-foreground">[ — réf. {"{référence}"}]</code>.
        </p>
        <p>
          Une ligne dont les champs sont vides disparaît (la livraison quand elle n’est pas connue). En concurrence, la
          référence reste toujours vide.
        </p>
      </div>

      {unknown.length > 0 ? (
        <Alert variant="warning">
          {`Champ inconnu, laissé tel quel dans le message : ${unknown.join(", ")}.`}
        </Alert>
      ) : null}
      {refusals.length > 0 ? (
        <ul aria-label="À corriger avant d’enregistrer" className="list-disc space-y-0.5 pl-5 text-sm font-medium text-danger">
          {refusals.map((sentence) => <li key={sentence}>{sentence}</li>)}
        </ul>
      ) : null}

      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <Preview title="Aperçu au fournisseur habituel (avec références)" text={preview(true, "Négoce Alpha", "site")} />
        <Preview title="Aperçu en concurrence (sans référence)" text={preview(false, "Comptoir Bêta", null)} />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Lignes d’exemple, inventées. Livraison sur chantier dans le premier aperçu, lieu de livraison inconnu dans le
        second.
      </p>

      {status ? <Alert variant={status.kind}>{status.text}</Alert> : null}
      {unchanged && !unavailable ? (
        <p className="text-xs text-muted-foreground">Modifiez le modèle pour enregistrer le vôtre.</p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || !canReset || Boolean(unavailable)}
          loading={busy === "reset"}
          onClick={() => void reset()}
        >
          <RotateCcw aria-hidden="true" />
          {resetLabel}
        </Button>
        <Button
          type="submit"
          disabled={busy !== null || refusals.length > 0 || Boolean(unavailable) || unchanged}
          loading={busy === "save"} leftIcon={<SaveIcon aria-hidden="true" />}>
          Enregistrer le modèle
        </Button>
      </div>
    </form>
  );
}

function FieldButtons({
  label,
  fields,
  onInsert,
}: Readonly<{ label: string; fields: readonly { token: string; label: string }[]; onInsert: (token: string) => void }>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {fields.map((field) => (
        <Button
          key={field.token}
          type="button"
          variant="outline"
          size="xs"
          aria-label={`${label} : ${field.label}`}
          // Keeps the cursor where it was in the text.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onInsert(field.token)}
        >
          + {field.label}
        </Button>
      ))}
    </div>
  );
}

function Preview({ title, text }: Readonly<{ title: string; text: string }>) {
  const id = useId();
  return (
    <figure aria-labelledby={id} className="min-w-0 rounded-md border border-border bg-surface p-3">
      <figcaption id={id} className="mb-2 text-xs font-semibold text-foreground">{title}</figcaption>
      <pre aria-labelledby={id} className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">{text}</pre>
    </figure>
  );
}
