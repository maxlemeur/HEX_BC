import type { MaterialRequestDeliveryPlace } from "./contracts";
import { MATERIAL_REQUEST_QUOTE_MESSAGE_MAX } from "./quote-contracts";
import {
  buildConsultationMessage,
  consultationDeliveryText,
  consultationLineParts,
  consultationText,
  type ConsultationLine,
} from "./consultation-message";

/**
 * A member's own layout of the consultation message (TI-691: « paramétrer le texte pour l’envoi fournisseur,
 * changer la mise en forme telle que l’on souhaite »). Each member keeps one template in their tenant; without one,
 * the message is today's, written by buildConsultationMessage. Pure: no network, no clock.
 *
 * Syntax, the same for both templates:
 *  - `{champ}` writes a field. Message fields: {affaire}, {fournisseur}, {lignes}, {livraison}. Line fields, written
 *    for each line in {lignes}: {quantité} (with its unit), {désignation}, {référence}, {ligne} (its number). With or
 *    without accents, in any case. Anything else between braces is left as typed (the editor flags it).
 *  - `[ … ]` on one line is an optional part: it disappears when one of its fields is empty, else it is written
 *    without its brackets (« [ — réf. {référence}] »). Brackets around no known field are left as typed.
 *  - A line of the template whose fields outside brackets are all empty disappears (« {livraison} » when the place is
 *    unknown, « Chantier : {affaire} » without an affaire). In a line that writes a field, runs of spaces are folded
 *    and the line's ends are trimmed (its own indentation kept), so an empty field leaves no double space. Lines
 *    without a field are left exactly as typed, blank ones included.
 *
 * The competition rule holds whatever the template says: without references, {référence} is always empty and
 * {désignation} is the reference-free designation (« Article à préciser (ligne N) » when nothing else names the
 * article). Only what the member typed in the template can say anything else. With references, {désignation} is
 * the short name only when the line template writes {référence} and the reference is known (today's rule: the
 * reference names the article); otherwise it is the full designation.
 */

export type ConsultationTemplate = { message: string; line: string };

export const DEFAULT_CONSULTATION_TEMPLATE: ConsultationTemplate = {
  message: "Bonjour, pouvez-vous me faire un prix[ pour l’affaire {affaire}] :\n{lignes}\n{livraison}\nMerci !",
  line: "- {quantité} {désignation}[ — réf. {référence}]",
};

/**
 * Bounds of the templates (the database holds the same). The recorded message keeps its own bound
 * (MATERIAL_REQUEST_QUOTE_MESSAGE_MAX): each field is written once at most, so a line adds at most the line
 * template's 300 characters to what today's message writes for it; the screen refuses to record a message over the
 * bound and says so.
 */
export const CONSULTATION_MESSAGE_TEMPLATE_MAX = 2000;
export const CONSULTATION_LINE_TEMPLATE_MAX = 300;

export const CONSULTATION_MESSAGE_FIELDS = ["affaire", "fournisseur", "lignes", "livraison"] as const;
export const CONSULTATION_LINE_FIELDS = ["quantité", "désignation", "référence", "ligne"] as const;
export type ConsultationMessageField = (typeof CONSULTATION_MESSAGE_FIELDS)[number];
export type ConsultationLineField = (typeof CONSULTATION_LINE_FIELDS)[number];
type TemplateKind = "message" | "line";

const FIELDS: Record<TemplateKind, readonly string[]> = {
  message: CONSULTATION_MESSAGE_FIELDS,
  line: CONSULTATION_LINE_FIELDS,
};
/** What each template must write once: the lines, and what each line asks for. */
const REQUIRED: Record<TemplateKind, string> = { message: "lignes", line: "désignation" };

/** Case and accents aside: « {Quantite} » is {quantité}. */
function folded(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function fieldOf(raw: string, kind: TemplateKind): string | null {
  const key = folded(raw);
  return FIELDS[kind].find((field) => folded(field) === key) ?? null;
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "field"; field: string }
  | { kind: "optional"; parts: Segment[]; fields: string[] };

const FIELD = /\{([^{}\n]+)\}/g;
const OPTIONAL = /\[([^[\]\n]*)\]/g;

/** Text and fields; an unknown field is text, as typed. */
function plainSegments(source: string, kind: TemplateKind): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of source.matchAll(FIELD)) {
    const field = fieldOf(match[1], kind);
    if (!field) continue;
    if (match.index > last) segments.push({ kind: "text", text: source.slice(last, match.index) });
    segments.push({ kind: "field", field });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ kind: "text", text: source.slice(last) });
  return segments;
}

/** One line of a template: its optional parts, then their fields and text. */
function lineSegments(source: string, kind: TemplateKind): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of source.matchAll(OPTIONAL)) {
    const parts = plainSegments(match[1], kind);
    const fields = parts.flatMap((part) => (part.kind === "field" ? [part.field] : []));
    if (fields.length === 0) continue;
    segments.push(...plainSegments(source.slice(last, match.index), kind));
    segments.push({ kind: "optional", parts, fields });
    last = match.index + match[0].length;
  }
  segments.push(...plainSegments(source.slice(last), kind));
  return segments;
}

/** Values are placed after the line is tidied, so that nothing a value says is read as syntax or folded. */
const SLOT = (index: number) => `\u0000${index}\u0000`;
const SLOTS = /\u0000(\d+)\u0000/g;

/** Writes one line of a template, or null when it disappears. */
function renderLine(source: string, kind: TemplateKind, values: ReadonlyMap<string, string>): string | null {
  const segments = lineSegments(source, kind);
  const outer = segments.filter((segment) => segment.kind === "field");
  if (outer.length === 0 && !segments.some((segment) => segment.kind === "optional")) return source;
  if (outer.length > 0 && outer.every((segment) => !values.get(segment.field))) return null;

  const placed: string[] = [];
  const slot = (value: string) => {
    placed.push(value);
    return SLOT(placed.length - 1);
  };
  const write = (parts: readonly Segment[]): string =>
    parts
      .map((part) => {
        if (part.kind === "text") return part.text;
        if (part.kind === "field") {
          const value = values.get(part.field) ?? "";
          return value ? slot(value) : "";
        }
        return part.fields.every((field) => values.get(field)) ? write(part.parts) : "";
      })
      .join("");

  const indentation = /^[ \t]*/.exec(source)?.[0] ?? "";
  const tidied = write(segments).slice(indentation.length).replace(/ {2,}/g, " ").trim();
  if (!tidied) return null;
  return `${indentation}${tidied}`.replace(SLOTS, (_, index: string) => placed[Number(index)] ?? "");
}

function renderTemplate(source: string, kind: TemplateKind, values: ReadonlyMap<string, string>): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => renderLine(line, kind, values))
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Whether a template writes a field anywhere, optional parts included. */
function writesField(source: string, kind: TemplateKind, field: string): boolean {
  return [...source.matchAll(FIELD)].some((match) => fieldOf(match[1], kind) === field);
}

/** The message a member's template writes. The lines are written in the order given. */
export function renderConsultationMessage(input: {
  template: ConsultationTemplate;
  affaireName: string;
  supplierName: string;
  lines: readonly ConsultationLine[];
  withReferences: boolean;
  deliveryPlace: MaterialRequestDeliveryPlace | null;
}): string {
  const writesReference = writesField(input.template.line, "line", "référence");
  const items = input.lines
    .map((line) => {
      const parts = consultationLineParts(line, { withReferences: input.withReferences, writesReference });
      return renderTemplate(
        input.template.line,
        "line",
        new Map([
          ["quantité", parts.quantity ?? ""],
          ["désignation", parts.designation],
          ["référence", parts.reference ?? ""],
          ["ligne", String(line.position)],
        ]),
      );
    })
    .filter((item) => item.trim().length > 0);
  return renderTemplate(
    input.template.message,
    "message",
    new Map([
      ["affaire", consultationText(input.affaireName) ?? ""],
      ["fournisseur", consultationText(input.supplierName) ?? ""],
      ["lignes", items.join("\n")],
      ["livraison", consultationDeliveryText(input.deliveryPlace) ?? ""],
    ]),
  )
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}

/** The message for one supplier: the member's template when they have one, today's message otherwise. */
export function consultationMessage(input: {
  template: ConsultationTemplate | null;
  affaireName: string;
  supplierName: string;
  lines: readonly ConsultationLine[];
  withReferences: boolean;
  deliveryPlace: MaterialRequestDeliveryPlace | null;
}): string {
  if (!input.template) {
    return buildConsultationMessage({
      affaireName: input.affaireName,
      lines: input.lines,
      withReferences: input.withReferences,
      deliveryPlace: input.deliveryPlace,
    });
  }
  return renderConsultationMessage({ ...input, template: input.template });
}

export type ConsultationTemplateIssues = {
  /** Fields not known in this template, as typed: left as they are in the message. */
  unknown: string[];
  /** Fields written more than once (refused: a field is written once at most). */
  duplicated: string[];
  /** The field this template must write: {lignes} in the message, {désignation} in a line (refused without it). */
  missing: string[];
};

function issuesOf(source: string, kind: TemplateKind): ConsultationTemplateIssues {
  const unknown: string[] = [];
  const seen = new Map<string, number>();
  for (const match of source.matchAll(FIELD)) {
    const field = fieldOf(match[1], kind);
    if (!field) {
      if (!unknown.includes(match[0])) unknown.push(match[0]);
      continue;
    }
    seen.set(field, (seen.get(field) ?? 0) + 1);
  }
  return {
    unknown,
    duplicated: [...seen.entries()].filter(([, count]) => count > 1).map(([field]) => `{${field}}`),
    missing: seen.has(REQUIRED[kind]) ? [] : [`{${REQUIRED[kind]}}`],
  };
}

/** What the editor flags (unknown fields) and what a save refuses (a field twice, a required one missing). */
export function consultationTemplateIssues(template: ConsultationTemplate): {
  message: ConsultationTemplateIssues;
  line: ConsultationTemplateIssues;
} {
  return { message: issuesOf(template.message, "message"), line: issuesOf(template.line, "line") };
}

/** The refusals of a save, in the editor's words; empty when the template can be saved. */
export function consultationTemplateRefusals(template: ConsultationTemplate): string[] {
  const issues = consultationTemplateIssues(template);
  const sentences: string[] = [];
  for (const [kind, label] of [["message", "Le modèle du message"], ["line", "Le modèle de ligne"]] as const) {
    const { duplicated, missing } = issues[kind];
    if (missing.length > 0) sentences.push(`${label} doit contenir ${missing.join(", ")}.`);
    if (duplicated.length > 0) {
      sentences.push(`${label} écrit ${duplicated.join(", ")} plusieurs fois : chaque champ s’écrit une fois au plus.`);
    }
  }
  return sentences;
}

/** Whether a template is the default one: it is then not kept, and the member follows today's message. */
export function isDefaultConsultationTemplate(template: ConsultationTemplate): boolean {
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n");
  return (
    normalize(template.message) === DEFAULT_CONSULTATION_TEMPLATE.message
    && normalize(template.line) === DEFAULT_CONSULTATION_TEMPLATE.line
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The references known for the lines (the technician's, the article's, the usual supplier's) that a competition
 * text names: a word the member typed in their template or in a retouch. Whole words only, case aside. The screen
 * warns and lets the member go on: the owner wants retouching free.
 */
export function competitionReferenceLeaks(message: string, references: readonly (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const reference of references) {
    const known = consultationText(reference);
    if (!known || found.some((entry) => entry.toLowerCase() === known.toLowerCase())) continue;
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(known)}(?![\\p{L}\\p{N}])`, "iu").test(message)) found.push(known);
  }
  return found;
}

/**
 * Why the text shown cannot be copied nor recorded, or null. Counted as the API counts it
 * (MATERIAL_REQUEST_QUOTE_MESSAGE_MAX, in UTF-16 units: an emoji counts two), never cut.
 */
export function consultationMessageProblem(message: string): string | null {
  if (message.trim().length === 0) return "Le message est vide : écrivez-le ou rétablissez le texte généré.";
  if (message.length > MATERIAL_REQUEST_QUOTE_MESSAGE_MAX) {
    return `Le message dépasse ${MATERIAL_REQUEST_QUOTE_MESSAGE_MAX.toLocaleString("fr-FR").replace(/\s/g, " ")} caractères (${message.length.toLocaleString("fr-FR").replace(/\s/g, " ")}) : raccourcissez-le ou votre modèle, ou consultez ce fournisseur en deux fois.`;
  }
  return null;
}
