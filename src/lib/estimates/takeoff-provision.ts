import { z } from "zod";

import type { Json } from "@/types/database";

/**
 * TI-686 D10/D12: the marker the takeoff application writes on an estimate line built from a line an administrator
 * forced past the apply guard, or from a quantity entered as a hypothesis (private.takeoff_mark_provisions, migration
 * …_takeoff_apply_provisions.sql). It states facts, never a choice: the line prints to the client as an ordinary
 * priced line whose amount is the provision (H9), and only the internal estimate shows it.
 *
 * H18: TI-682's explicit choice (a reserve in the offer) will be stored outside the marker, under the reserved
 * source_metadata key `offer_treatment`, which nothing writes or reads yet. Until then the treatment is the default one.
 */
export const TAKEOFF_PROVISION_KEY = "takeoff_provision";

const sourceSchema = z.object({
  takeoff_item_id: z.string(),
  forced: z.boolean(),
  /** The coded override reason of a forced source (D10, migration …_takeoff_apply_force_reasons.sql); null otherwise,
   * and on the markers written before the override carried one per line. */
  forced_reason: z.string().nullable(),
  /** The quantity entry category of the takeoff line (D12), null when its quantity was not entered. */
  entry_category: z.string().nullable(),
});

const markerSchema = z.object({
  version: z.literal(1),
  job_id: z.string(),
  sources: z.array(sourceSchema).min(1),
});

export type TakeoffProvisionSource = z.infer<typeof sourceSchema>;

export type TakeoffProvision = {
  /** What the internal estimate shows: a hypothesis when a source rests on one, else an internal provision. */
  kind: "internal_provision" | "hypothesis";
  /** How the line reaches the offer: always the default internal provision until TI-682 (H18). */
  treatment: "internal_provision";
  /** False for a marker that cannot be read: it still counts as an internal provision, never as no marker. */
  readable: boolean;
  sources: TakeoffProvisionSource[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The takeoff provision of an estimate line, from its source_metadata; null when the line carries no marker. */
export function readTakeoffProvision(sourceMetadata: unknown): TakeoffProvision | null {
  if (!isRecord(sourceMetadata)) return null;
  const marker = sourceMetadata[TAKEOFF_PROVISION_KEY];
  if (marker === undefined || marker === null) return null;
  const parsed = markerSchema.safeParse(marker);
  if (!parsed.success) return { kind: "internal_provision", treatment: "internal_provision", readable: false, sources: [] };
  const { sources } = parsed.data;
  const hypothesis = sources.some((source) => source.entry_category === "hypothesis"
    || source.forced_reason === "priced_hypothesis");
  return { kind: hypothesis ? "hypothesis" : "internal_provision", treatment: "internal_provision", readable: true, sources };
}

/**
 * The marker of a line as an object to spread into a source_metadata that a read projection rebuilds (AI structure or
 * generated ouvrage provenance), so that the editor, its line truth and its CSV still read it; empty without a marker.
 */
export function keepTakeoffProvision(sourceMetadata: Json | null | undefined): { [TAKEOFF_PROVISION_KEY]?: Json } {
  if (!isRecord(sourceMetadata)) return {};
  const marker = sourceMetadata[TAKEOFF_PROVISION_KEY];
  return marker === undefined || marker === null ? {} : { [TAKEOFF_PROVISION_KEY]: marker };
}

/** TI-682 lot C: header of the internal CSV column that names the takeoff provision of each line (H12 lifted). */
export const TAKEOFF_PROVISION_EXPORT_HEADER = "Provision métré";

const TAKEOFF_PROVISION_EXPORT_LABELS: Readonly<Record<TakeoffProvision["kind"], string>> = {
  internal_provision: "Provision interne",
  hypothesis: "Hypothèse",
};

/**
 * The cell of an estimate line in the « Provision métré » column: empty without a marker, « Provision interne » for a
 * forced source or an unreadable marker, « Hypothèse » for a source resting on one. Only the internal CSV exports (the
 * v3 server CSV and the v1/v2 editor CSV) write it; the DPGF, standard and BDC workbooks can reach a client or a
 * supplier and never do.
 */
export function takeoffProvisionExportLabel(sourceMetadata: unknown): string {
  const provision = readTakeoffProvision(sourceMetadata);
  return provision ? TAKEOFF_PROVISION_EXPORT_LABELS[provision.kind] : "";
}
