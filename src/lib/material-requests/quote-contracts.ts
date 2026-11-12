import { z } from "zod";

import {
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_PRICE_PER,
  type MaterialRequestFile,
  type MaterialRequestLine,
  type MaterialRequestPricePer,
} from "./contracts";

export { MATERIAL_REQUEST_PRICE_PER, type MaterialRequestPricePer };

/**
 * Consulting suppliers for a material request (TI-691, lot 2 « l'achat », delivery 2 « consultation »). The office
 * writes a short message, copies it into WhatsApp (MergeOne sends nothing) and records it here as a quote asked of
 * one supplier for some lines of the request: WITH the references for the usual supplier, WITHOUT them and with full
 * designations to put suppliers in competition. What the supplier answers is attached to the quote (PDF or photos)
 * and priced line by line; the office retains ONE quote, which closes the other open quotes sharing a line with it.
 * Closed quotes stay readable. The price later imputed to a line is its retained quote's (never a catalogue price).
 * This module is the contract shared by the server, the API and the screens; nothing here touches the network.
 *
 * Life of a quote, held by the database:
 *  - requested: recorded when the message is copied. Its supplier, lines, variant and message never change.
 *  - received: the supplier answered (`received: true`). Prices, total and notes stay editable while requested or
 *    received. A price is in whole cents for `price_per` units (1, 10, 100 or 1 000): 0,034 € a screw is 340 for 100.
 *  - retained: only through the retain route, from received, with every line priced and validated. Its lines take its
 *    supplier, their price and its quantity, and the quote (`MaterialRequestLine.unit_price_ht_cents`, `price_per`,
 *    `price_quote_id`), a validated line staying validated; a project line without its own material takes the
 *    request's presumed material, which must then be confirmed; every other requested or received quote sharing a line
 *    is closed. Final in this delivery: a priced line then keeps what it orders (409 MATERIAL_REQUEST_LINE_PRICED).
 *  - closed: by hand from requested or received, or by the retaining of a competitor. Final.
 * Retained and closed quotes are read-only, their files included. One supplier has at most one quote requested or
 * received per request; a retained or closed one does not keep it from being consulted again (lines added later).
 * Money is in integer cents, excluding tax (HT).
 */

export const MATERIAL_REQUEST_QUOTE_STATUSES = ["requested", "received", "retained", "closed"] as const;
export type MaterialRequestQuoteStatus = (typeof MATERIAL_REQUEST_QUOTE_STATUSES)[number];
export const MATERIAL_REQUEST_QUOTE_STATUS_LABELS: Record<MaterialRequestQuoteStatus, string> = {
  requested: "Demandé",
  received: "Reçu",
  retained: "Retenu",
  closed: "Clos",
};

/** Room for 300 lines with their designations and references. */
export const MATERIAL_REQUEST_QUOTE_MESSAGE_MAX = 20_000;
export const MATERIAL_REQUEST_QUOTE_NOTES_MAX = 2000;
/** Files attached to one quote (a PDF, or the photographed pages of a paper quote). Originals keep their own cap. */
export const MATERIAL_REQUEST_QUOTE_MAX_FILES = 10;
/** A quote's file is a PDF or an image; an original of the request stays an image. */
export const MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const MATERIAL_REQUEST_QUOTE_FILE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
/** What the quote file picker offers: PDF and the stored image types, plus HEIC, which the screen converts to JPEG. */
export const MATERIAL_REQUEST_QUOTE_PICKER_ACCEPT = [
  ...MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES,
  ".pdf",
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",");
/** The largest amount a column holds (PostgreSQL integer): 21 474 836,47 €. */
export const MATERIAL_REQUEST_QUOTE_MAX_CENTS = 2_147_483_647;

/** Error codes of the quote routes, beside the generic ones (FORBIDDEN, NOT_FOUND, VALIDATION_ERROR). */
/** 409: this supplier already has a quote of this request in progress (requested or received). */
export const MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN = "MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN";
/** 409: the quote is retained or closed: nothing about it changes, its files included. */
export const MATERIAL_REQUEST_QUOTE_READ_ONLY = "MATERIAL_REQUEST_QUOTE_READ_ONLY";
/** 422: retaining needs a received quote. */
export const MATERIAL_REQUEST_QUOTE_NOT_RECEIVED = "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED";
/** 422: retaining needs every line priced; details.positions names the others (line numbers of the request). */
export const MATERIAL_REQUEST_QUOTE_LINES_UNPRICED = "MATERIAL_REQUEST_QUOTE_LINES_UNPRICED";
/**
 * 422: a line already has a retained quote (a line belongs to one retained quote at most): at creation, or when
 * retaining; details.positions names them.
 */
export const MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED = "MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED";
/**
 * 422: a line of the quote is not validated: retaining freezes what a line orders, so every line must be complete
 * (its blocking alerts settled by the validation) first. details.positions names the drafts. A quote may still be
 * recorded and priced for lines not validated yet.
 */
export const MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED = "MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED";
/**
 * 422: a project line of the quote has no material of its own, so it was consulted in the request's presumed
 * material, and that material is not confirmed (or there is none): retaining writes it on the line, so it must be
 * confirmed first. details.positions names the lines.
 */
export const MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED = "MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED";
/** 422: retaining needs a quote that still asks for a line (its lines may have been deleted since). */
export const MATERIAL_REQUEST_QUOTE_WITHOUT_LINES = "MATERIAL_REQUEST_QUOTE_WITHOUT_LINES";
/** 422: more files than a quote keeps (MATERIAL_REQUEST_QUOTE_MAX_FILES). */
export const MATERIAL_REQUEST_QUOTE_FILE_LIMIT = "MATERIAL_REQUEST_QUOTE_FILE_LIMIT";
/**
 * 409, on the line routes (PATCH one, PATCH a selection, DELETE, article link, creation and unlink): the line is
 * priced by a retained quote. Its supplier is the quote's; what it orders (article, type, dimension, material,
 * precision, reference, unit, quantity) no longer changes; it is not deleted alone (the request can be). Its zone,
 * imputation, the technician's words, the quantity doubt and the duplicate acknowledgement stay editable.
 */
export const MATERIAL_REQUEST_LINE_PRICED = "MATERIAL_REQUEST_LINE_PRICED";

/** 409: another change was being written at the same moment (the database ended a deadlock): try again. */
export const MATERIAL_REQUEST_QUOTE_BUSY = "MATERIAL_REQUEST_QUOTE_BUSY";

/** A line asked in a quote: its price in whole cents excluding tax for `price_per` units, null until priced. */
export type MaterialRequestQuoteLine = { line_id: string; unit_price_ht_cents: number | null; price_per: MaterialRequestPricePer };

export type MaterialRequestQuote = {
  id: string;
  request_id: string;
  supplier_id: string;
  supplier_name: string;
  status: MaterialRequestQuoteStatus;
  /** The variant copied: with the references (usual supplier), or without them, with full designations. */
  with_references: boolean;
  /** The message as copied into WhatsApp. */
  message: string;
  requested_at: string;
  received_at: string | null;
  /** Total excluding tax as the supplier quotes it, in cents; informative, the cost is per line. */
  amount_ht_cents: number | null;
  notes: string | null;
  retained_at: string | null;
  closed_at: string | null;
  /** The lines asked, in the order of the request. */
  lines: MaterialRequestQuoteLine[];
  /** The supplier's answer: PDF or images, oldest first. */
  files: MaterialRequestFile[];
};

/** Answer of the retain route. */
export type MaterialRequestQuoteRetained = {
  item: MaterialRequestQuote;
  /** The quote's lines as they now read: its supplier, their unit price, the quote. */
  lines: MaterialRequestLine[];
  /** The other quotes this retaining closed (they shared a line with it). */
  closed_quote_ids: string[];
};

const uuid = z.string().uuid("Identifiant invalide.");
const cents = z
  .number()
  .int("Montant en centimes entiers.")
  .min(0, "Le montant ne peut pas être négatif.")
  .max(MATERIAL_REQUEST_QUOTE_MAX_CENTS, "Montant trop grand.");

export const createQuoteSchema = z
  .object({
    supplier_id: uuid,
    line_ids: z
      .array(uuid)
      .min(1, "Choisissez au moins une ligne.")
      .max(MATERIAL_REQUEST_MAX_LINES, `${MATERIAL_REQUEST_MAX_LINES} lignes au plus.`)
      .refine((ids) => new Set(ids).size === ids.length, { message: "Une ligne n’est nommée qu’une fois." }),
    with_references: z.boolean(),
    message: z
      .string()
      .max(MATERIAL_REQUEST_QUOTE_MESSAGE_MAX, `${MATERIAL_REQUEST_QUOTE_MESSAGE_MAX} caractères au plus.`)
      .refine((message) => message.trim().length > 0, { message: "Le message ne peut pas être vide." }),
  })
  .strict();
export type CreateQuoteInput = z.input<typeof createQuoteSchema>;
export type CreateQuoteData = z.output<typeof createQuoteSchema>;

/**
 * Prices, total and notes, editable while the quote is requested or received; `received: true` marks it received
 * (the database dates it). A key left out is left alone; null clears. Each priced line is one of the quote's;
 * `price_per` left out keeps the line's (1 for a line never given one).
 */
export const updateQuoteSchema = z
  .object({
    amount_ht_cents: z.union([cents, z.null()]).optional(),
    notes: z
      .union([z.string().max(MATERIAL_REQUEST_QUOTE_NOTES_MAX, `${MATERIAL_REQUEST_QUOTE_NOTES_MAX} caractères au plus.`), z.null()])
      .optional()
      .transform((value) => {
        if (value === undefined || value === null) return value;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }),
    lines: z
      .array(z.object({
        line_id: uuid,
        unit_price_ht_cents: z.union([cents, z.null()]),
        price_per: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]).optional(),
      }).strict())
      .min(1, "Aucune ligne à chiffrer.")
      .max(MATERIAL_REQUEST_MAX_LINES, `${MATERIAL_REQUEST_MAX_LINES} lignes au plus.`)
      .refine((lines) => new Set(lines.map((line) => line.line_id)).size === lines.length, {
        message: "Une ligne n’est nommée qu’une fois.",
      })
      .optional(),
    received: z.literal(true).optional(),
  })
  .strict()
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "Aucun champ à mettre à jour.",
  });
export type UpdateQuoteInput = z.input<typeof updateQuoteSchema>;
export type UpdateQuoteData = z.output<typeof updateQuoteSchema>;
