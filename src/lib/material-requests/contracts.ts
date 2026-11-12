import { z } from "zod";

/**
 * Material requests ("demandes de matériel", TI-690): what a field technician asks the office for, on a
 * scrap of paper, in a text message or over the phone, rewritten by the office into clean lines.
 * A request always ends in a purchase; there is no stock. This module is the contract shared by the
 * server, the API and the screen: record shapes, accepted inputs, and nothing that touches the network.
 */

export const MATERIAL_REQUEST_DELIVERY_PLACES = ["site", "office", "counter"] as const;
export type MaterialRequestDeliveryPlace = (typeof MATERIAL_REQUEST_DELIVERY_PLACES)[number];
export const MATERIAL_REQUEST_DELIVERY_PLACE_LABELS: Record<MaterialRequestDeliveryPlace, string> = {
  site: "Chantier",
  office: "Bureau",
  counter: "Retrait au comptoir",
};

/** A line is cost for the request's affaire, or general overhead (PPE, small tooling). */
export const MATERIAL_REQUEST_IMPUTATIONS = ["project", "overhead"] as const;
export type MaterialRequestImputation = (typeof MATERIAL_REQUEST_IMPUTATIONS)[number];
export const MATERIAL_REQUEST_IMPUTATION_LABELS: Record<MaterialRequestImputation, string> = {
  project: "Affaire",
  overhead: "Frais généraux",
};

export const MATERIAL_REQUEST_LINE_STATUSES = ["draft", "validated"] as const;
export type MaterialRequestLineStatus = (typeof MATERIAL_REQUEST_LINE_STATUSES)[number];

export const MATERIAL_REQUEST_FILE_ROTATIONS = [0, 90, 180, 270] as const;
export type MaterialRequestFileRotation = (typeof MATERIAL_REQUEST_FILE_ROTATIONS)[number];

/** Originals are photographs of paper or screenshots of messages. */
export const MATERIAL_REQUEST_FILE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MATERIAL_REQUEST_FILE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
/**
 * What the photo pickers offer: the stored types, plus HEIC, which the screen converts to JPEG before
 * sending (the server and the bucket only ever receive the stored types).
 */
export const MATERIAL_REQUEST_PICKER_ACCEPT = [
  ...MATERIAL_REQUEST_FILE_MIME_TYPES,
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",");
export const MATERIAL_REQUEST_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const MATERIAL_REQUEST_MAX_FILES = 12;
export const MATERIAL_REQUEST_MAX_LINES = 300;
export const MATERIAL_REQUEST_SOURCE_TEXT_MAX = 20_000;
export const MATERIAL_REQUESTS_BUCKET = "material-requests";

export type MaterialRequestTechnician = {
  id: string;
  name: string;
  /** The site the technician is on at the moment; prefills the affaire of a new request. */
  current_project_id: string | null;
  is_active: boolean;
};

export type MaterialRequest = {
  id: string;
  project_id: string;
  technician_id: string | null;
  requested_on: string;
  needed_on: string | null;
  delivery_place: MaterialRequestDeliveryPlace | null;
  is_urgent: boolean;
  /** Presumed for every line that names no material. Never taken for granted: see material_confirmed. */
  presumed_material: string | null;
  material_confirmed: boolean;
  /** A supplier or brand written at the top of the sheet: a strong hint, to be confirmed. */
  presumed_supplier_id: string | null;
  supplier_confirmed: boolean;
  /** The pasted message, kept verbatim beside the lines. */
  source_text: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type MaterialRequestFile = {
  id: string;
  request_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  /** Display rotation chosen by the operator; the stored bytes are never rewritten. */
  rotation: MaterialRequestFileRotation;
  created_at: string;
};

export type MaterialRequestLine = {
  id: string;
  request_id: string;
  position: number;
  /** The technician's own words for this line, kept beside the rewritten columns. */
  original_text: string | null;
  quantity: number | null;
  /** The figure was overwritten or is hard to read on the original: a human must confirm it. */
  quantity_doubtful: boolean;
  unit: string | null;
  /** DN for piping, the useful size otherwise (M10, Ø 125, 110 x 60 mm). */
  dimension: string | null;
  /** The article has no meaningful size: silences the missing-dimension alert. */
  no_dimension: boolean;
  product_type: string | null;
  material: string | null;
  /** Precision or standard (EPDM, PN16, DIN...). */
  material_precision: string | null;
  /** A reference written by the technician. */
  reference: string | null;
  supplier_id: string | null;
  /** Free marker of the zone on site ("trémie", "R+3"). */
  zone: string | null;
  imputation: MaterialRequestImputation;
  overhead_category: string | null;
  /** The operator has looked at the possible duplicate and keeps this line. */
  duplicate_acknowledged: boolean;
  status: MaterialRequestLineStatus;
  validated_at: string | null;
};

export type MaterialRequestSummary = MaterialRequest & {
  technician_name: string | null;
  line_count: number;
  validated_line_count: number;
  file_count: number;
};

/**
 * Answer of a change to a request's header. Changing, clearing or un-confirming the presumed material
 * returns to draft every validated line that relied on it (no material of its own, not overhead):
 * their ids are listed, an empty array when there are none.
 */
export type MaterialRequestUpdateResult = {
  request: MaterialRequest;
  reopened_line_ids: string[];
};

export type MaterialRequestDetail = {
  request: MaterialRequest;
  technician: MaterialRequestTechnician | null;
  files: MaterialRequestFile[];
  lines: MaterialRequestLine[];
};

/*
 * Two types per accepted input. `...Input` is what a caller passes (z.input): a key left out is left
 * untouched. `...Data` is what the server holds after `.parse()` (z.output): text is trimmed, blank is
 * null, and a text key that was left out is present and undefined.
 */

const uuid = z.string().uuid("Identifiant invalide.");
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ).");

/** Blank becomes null; an omitted key stays omitted, so a partial update leaves the column alone. */
function optionalText(max: number) {
  return z
    .union([z.string().max(max, `${max} caractères au plus.`), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    });
}

const quantity = z
  .union([
    z
      .number()
      .positive("La quantité doit être supérieure à zéro.")
      .max(1_000_000, "Quantité trop grande.")
      .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, {
        message: "Trois décimales au plus.",
      }),
    z.null(),
  ])
  .optional();

const requestFields = {
  technician_id: z.union([uuid, z.null()]).optional(),
  requested_on: dateOnly.optional(),
  needed_on: z.union([dateOnly, z.null()]).optional(),
  delivery_place: z.union([z.enum(MATERIAL_REQUEST_DELIVERY_PLACES), z.null()]).optional(),
  is_urgent: z.boolean().optional(),
  presumed_material: optionalText(120),
  material_confirmed: z.boolean().optional(),
  presumed_supplier_id: z.union([uuid, z.null()]).optional(),
  supplier_confirmed: z.boolean().optional(),
  source_text: optionalText(MATERIAL_REQUEST_SOURCE_TEXT_MAX),
  note: optionalText(2000),
};

export const createMaterialRequestSchema = z.object(requestFields).strict();
export type CreateMaterialRequestInput = z.input<typeof createMaterialRequestSchema>;
export type CreateMaterialRequestData = z.output<typeof createMaterialRequestSchema>;

/**
 * A confirmation is about the value its author saw. Sent with the value (`presumed_material` and
 * `material_confirmed: true` together), the server confirms that value and no other. Sent alone, it
 * confirms what is stored, unless the caller says which value it has on screen with `expected_...`:
 * the server then confirms only if that is still the one stored, and answers 409
 * MATERIAL_REQUEST_PRESUMPTION_CHANGED otherwise. Both `expected_...` keys are optional.
 */
export const MATERIAL_REQUEST_PRESUMPTION_CHANGED = "MATERIAL_REQUEST_PRESUMPTION_CHANGED";

export const updateMaterialRequestSchema = z
  .object({
    ...requestFields,
    expected_presumed_material: z.string().trim().min(1, "Matière attendue requise.").max(120).optional(),
    expected_presumed_supplier_id: uuid.optional(),
  })
  .strict()
  // What the caller expects is a condition, not a change: alone, it updates nothing.
  .refine(
    (payload) => Object.entries(payload).some(([key, value]) => value !== undefined && !key.startsWith("expected_")),
    { message: "Aucun champ à mettre à jour." },
  )
  .refine(
    (payload) =>
      payload.expected_presumed_material === undefined
      || (payload.material_confirmed === true && payload.presumed_material === undefined),
    { message: "expected_presumed_material accompagne une confirmation seule de la matière.", path: ["expected_presumed_material"] },
  )
  .refine(
    (payload) =>
      payload.expected_presumed_supplier_id === undefined
      || (payload.supplier_confirmed === true && payload.presumed_supplier_id === undefined),
    { message: "expected_presumed_supplier_id accompagne une confirmation seule du fournisseur.", path: ["expected_presumed_supplier_id"] },
  );
export type UpdateMaterialRequestInput = z.input<typeof updateMaterialRequestSchema>;
export type UpdateMaterialRequestData = z.output<typeof updateMaterialRequestSchema>;

const lineFields = {
  original_text: optionalText(500),
  quantity,
  quantity_doubtful: z.boolean().optional(),
  unit: optionalText(20),
  dimension: optionalText(80),
  no_dimension: z.boolean().optional(),
  product_type: optionalText(200),
  material: optionalText(120),
  material_precision: optionalText(120),
  reference: optionalText(120),
  supplier_id: z.union([uuid, z.null()]).optional(),
  zone: optionalText(80),
  imputation: z.enum(MATERIAL_REQUEST_IMPUTATIONS).optional(),
  overhead_category: optionalText(80),
  duplicate_acknowledged: z.boolean().optional(),
};

export const materialRequestLineInputSchema = z.object(lineFields).strict();
export type MaterialRequestLineInput = z.input<typeof materialRequestLineInputSchema>;
export type MaterialRequestLineData = z.output<typeof materialRequestLineInputSchema>;

export const createMaterialRequestLinesSchema = z
  .object({ lines: z.array(materialRequestLineInputSchema).min(1).max(MATERIAL_REQUEST_MAX_LINES) })
  .strict();

export const updateMaterialRequestLineSchema = materialRequestLineInputSchema.refine(
  (payload) => Object.values(payload).some((value) => value !== undefined),
  { message: "Aucun champ à mettre à jour." },
);

/** What may be applied to a selection at once: often one material or one zone holds for a whole sheet. */
export const bulkUpdateMaterialRequestLinesSchema = z
  .object({
    ids: z.array(uuid).min(1).max(MATERIAL_REQUEST_MAX_LINES),
    patch: z
      .object({
        material: lineFields.material,
        material_precision: lineFields.material_precision,
        unit: lineFields.unit,
        supplier_id: lineFields.supplier_id,
        zone: lineFields.zone,
        imputation: lineFields.imputation,
        overhead_category: lineFields.overhead_category,
      })
      .strict()
      .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
        message: "Aucun champ à appliquer.",
      }),
  })
  .strict();
export type BulkUpdateMaterialRequestLinesInput = z.input<typeof bulkUpdateMaterialRequestLinesSchema>;
export type BulkUpdateMaterialRequestLinesData = z.output<typeof bulkUpdateMaterialRequestLinesSchema>;

export const materialRequestLineIdsSchema = z
  .object({ ids: z.array(uuid).min(1).max(MATERIAL_REQUEST_MAX_LINES) })
  .strict();

export const updateMaterialRequestFileSchema = z
  .object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) })
  .strict();

/**
 * Originals go from the browser straight to storage: the application never carries the bytes (a request
 * body is capped well below one phone photo by the proxy and by the host).
 *  1. prepare: the server checks what is declared, records the rows (not visible yet) and answers one
 *     signed upload per file;
 *  2. the browser sends each file with `uploadToSignedUrl(path, token, file)` on MATERIAL_REQUESTS_BUCKET;
 *  3. complete: the server checks what was really stored and only then makes the files visible.
 */
export const prepareMaterialRequestFilesSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            name: z.string().min(1, "Nom de fichier requis.").max(255, "255 caractères au plus."),
            mime_type: z.string().max(120),
            byte_size: z.number().int().positive("Le fichier est vide."),
          })
          .strict(),
      )
      .min(1)
      .max(MATERIAL_REQUEST_MAX_FILES),
  })
  .strict();
export type PrepareMaterialRequestFilesInput = z.input<typeof prepareMaterialRequestFilesSchema>;

export type MaterialRequestFileUploads = {
  uploads: Array<{
    file: Pick<MaterialRequestFile, "id" | "file_name" | "mime_type" | "byte_size">;
    /** Object path in MATERIAL_REQUESTS_BUCKET, to pass to `uploadToSignedUrl` with the token. */
    path: string;
    token: string;
  }>;
};

export const completeMaterialRequestFilesSchema = z
  .object({ ids: z.array(uuid).min(1).max(MATERIAL_REQUEST_MAX_FILES) })
  .strict();
export type CompleteMaterialRequestFilesInput = z.input<typeof completeMaterialRequestFilesSchema>;

/** Error code of `complete` when what was stored is not what was declared: the whole batch is discarded. */
export const MATERIAL_REQUEST_FILE_REJECTED = "MATERIAL_REQUEST_FILE_REJECTED";
export const MATERIAL_REQUEST_FILE_REJECTION_REASONS = ["missing", "size", "type"] as const;
export type MaterialRequestFileRejection = {
  id: string;
  /** missing: no bytes were stored; size: not the declared size; type: not the declared image type. */
  reason: (typeof MATERIAL_REQUEST_FILE_REJECTION_REASONS)[number];
};

const technicianName = z
  .string()
  .trim()
  .min(1, "Le nom du technicien est requis.")
  .max(120, "120 caractères au plus.");

export const createMaterialRequestTechnicianSchema = z
  .object({ name: technicianName, current_project_id: z.union([uuid, z.null()]).optional() })
  .strict();

export const updateMaterialRequestTechnicianSchema = z
  .object({
    name: technicianName.optional(),
    current_project_id: z.union([uuid, z.null()]).optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "Aucun champ à mettre à jour.",
  });
