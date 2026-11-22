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
 * the short name only on a line that actually writes its reference (today's rule: the reference names the article):
 * {référence} outside brackets, or in an optional part whose fields are all filled on that line. Otherwise it is the
 * full designation, size and material included.
 *
 * Fields may be written more than once (« Bonjour {fournisseur} … pour {fournisseur} »), except {lignes}: once at
 * most. The text written is checked against the recorded bound, never cut.
 */

export type ConsultationTemplate = { message: string; line: string };

export const DEFAULT_CONSULTATION_TEMPLATE: ConsultationTemplate = {
  message: "Bonjour, pouvez-vous me faire un prix[ pour l’affaire {affaire}] :\n{lignes}\n{livraison}\nMerci !",
  line: "- {quantité} {désignation}[ — réf. {référence}]",
};

/**
 * Bounds of the templates (the database holds the same). The recorded message keeps its own bound
 * (MATERIAL_REQUEST_QUOTE_MESSAGE_MAX): the text a template writes is measured before it is copied or recorded, and
 * the screen refuses one over the bound and says so, without cutting it.
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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

/**
 * Whether a template writes a field with these values: outside brackets on a line that stays, or in an optional
 * part whose fields are all filled.
 */
function rendersField(source: string, kind: TemplateKind, values: ReadonlyMap<string, string>, field: string): boolean {
  if (!values.get(field)) return false;
  return source.replace(/\r\n?/g, "\n").split("\n").some((line) => {
    const segments = lineSegments(line, kind);
    const outer = segments.flatMap((segment) => (segment.kind === "field" ? [segment.field] : []));
    if (outer.length > 0 && outer.every((name) => !values.get(name))) return false;
    return segments.some((segment) =>
      segment.kind === "field"
        ? segment.field === field
        : segment.kind === "optional" && segment.fields.includes(field) && segment.fields.every((name) => values.get(name)),
    );
  });
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
  const items = input.lines
    .map((line) => {
      const valuesOf = (writesReference: boolean) => {
        const parts = consultationLineParts(line, { withReferences: input.withReferences, writesReference });
        return new Map([
          ["quantité", parts.quantity ?? ""],
          ["désignation", parts.designation],
          ["référence", parts.reference ?? ""],
          ["ligne", String(line.position)],
        ]);
      };
      // The full designation first; the short one only where this very line writes the reference.
      const full = valuesOf(false);
      const values = rendersField(input.template.line, "line", full, "référence") ? valuesOf(true) : full;
      return renderTemplate(input.template.line, "line", values);
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
  /** {lignes} written more than once (refused: the lines are written once at most; other fields may repeat). */
  duplicated: string[];
  /**
   * The field this template must write outside any optional part: {lignes} in the message, {désignation} in a line
   * (refused without it: inside brackets it would vanish with an empty field, and the articles with it).
   */
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
    duplicated: [...seen.entries()]
      .filter(([field, count]) => field === "lignes" && count > 1)
      .map(([field]) => `{${field}}`),
    missing: writtenOutsideOptionalParts(source, kind, REQUIRED[kind]) ? [] : [`{${REQUIRED[kind]}}`],
  };
}

/** Whether a template writes this field outside every optional part, where no empty field can take it away. */
function writtenOutsideOptionalParts(source: string, kind: TemplateKind, field: string): boolean {
  return lineSegments(source, kind).some((segment) => segment.kind === "field" && segment.field === field);
}

/** Whether a template writes this field anywhere, optional parts included. */
function writtenAnywhere(source: string, kind: TemplateKind, field: string): boolean {
  return [...source.matchAll(FIELD)].some((match) => fieldOf(match[1], kind) === field);
}

/** What the editor flags (unknown fields) and what a save refuses ({lignes} twice, a required field missing). */
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
    if (missing.length > 0) {
      sentences.push(
        writtenAnywhere(template[kind], kind, REQUIRED[kind])
          ? `${label} doit écrire ${missing.join(", ")} hors des crochets : une partie entre crochets disparaît quand l’un de ses champs est vide.`
          : `${label} doit contenir ${missing.join(", ")}.`,
      );
    }
    if (duplicated.length > 0) {
      sentences.push(`${label} écrit ${duplicated.join(", ")} plusieurs fois : les lignes s’écrivent une fois au plus.`);
    }
  }
  return sentences;
}

/** Case and accents aside, letters and digits only: « NA–4471 », « na 4471 » and « NA-4471 » read the same. */
function foldedCode(value: string): string {
  return folded(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Separators a reference may be retyped with between its letter and digit chunks. */
const REFERENCE_SEPARATOR = "[\\s\\-–—./_]*";

/**
 * The references known for the lines (the technician's, the article's, the usual supplier's) that a competition
 * text names: a word the member typed in their template or in a retouch. Compared folded (case, accents aside), its
 * chunks of letters and digits joined by any separator or none (« NA 4471 », « na4471 », « NA–4471 » for
 * « NA-4471 »), whole words only. A reference shorter than 4 characters once folded, or without a digit, is not
 * looked for (« 50 » would match « DN 50 »). The screen warns and lets the member go on: retouching stays free.
 */
export function competitionReferenceLeaks(message: string, references: readonly (string | null | undefined)[]): string[] {
  const text = folded(message);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const known = consultationText(reference);
    if (!known) continue;
    const code = foldedCode(known);
    if (code.length < 4 || !/\p{N}/u.test(code) || seen.has(code)) continue;
    const chunks = folded(known).match(/\p{L}+|\p{N}+/gu) ?? [];
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${chunks.join(REFERENCE_SEPARATOR)}(?![\\p{L}\\p{N}])`, "u");
    if (pattern.test(text)) {
      seen.add(code);
      found.push(known);
    }
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
