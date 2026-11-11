import { z } from "zod";

import type { TakeoffHypothesisCause } from "@/lib/takeoff/hypothesis";
import type { Json } from "@/types/database";

/**
 * TI-686 D10/D12: the marker the takeoff application writes on an estimate line built from a line an administrator
 * forced past the apply guard, or from a quantity entered as a hypothesis (private.takeoff_mark_provisions, migration
 * …_takeoff_apply_provisions.sql). TI-682 lot C (migration …_takeoff_hypothesis_provision_marker.sql): also from an
 * hypothesis its reviewer included without entering its quantity (an estimate, a quantity a plan cannot show), each
 * source saying why it is an hypothesis. It states facts, never a choice: the line prints to the client as an ordinary
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
  /**
   * TI-682 lot C: why the takeoff line is an hypothesis (public.takeoff_item_hypothesis_cause, src/lib/takeoff/
   * hypothesis.ts: entered_hypothesis, estimated, non_observable), null when it is none. Absent from the markers written
   * before, which read as they did: the marker stays version 1.
   */
  hypothesis_cause: z.string().nullable().optional(),
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
    || source.forced_reason === "priced_hypothesis" || (source.hypothesis_cause ?? null) !== null);
  return { kind: hypothesis ? "hypothesis" : "internal_provision", treatment: "internal_provision", readable: true, sources };
}

/**
 * What a hypothesis provision rests on, for its internal wording; null for an internal provision. A quantity entered as a
 * hypothesis first (its author says what it assumes), then an estimate, then a quantity a plan cannot show (TI-682 lot
 * C: both included without entry, or forced), then a line forced as a priced hypothesis; « other » for a cause this
 * reader does not know.
 */
export type TakeoffProvisionHypothesisBasis = Exclude<TakeoffHypothesisCause, "entered_hypothesis">
  | "entered" | "forced" | "other";

export function takeoffProvisionHypothesisBasis(provision: TakeoffProvision): TakeoffProvisionHypothesisBasis | null {
  if (provision.kind !== "hypothesis") return null;
  const causes = new Set(provision.sources.map((source) => source.hypothesis_cause ?? null));
  if (causes.has("entered_hypothesis") || provision.sources.some((source) => source.entry_category === "hypothesis")) {
    return "entered";
  }
  if (causes.has("estimated")) return "estimated";
  if (causes.has("non_observable")) return "non_observable";
  if (provision.sources.some((source) => source.forced_reason === "priced_hypothesis")) return "forced";
  return "other";
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
 * forced source or an unreadable marker, « Hypothèse » for a source resting on one (entered, estimated, not observable
 * on a plan, or forced as a priced hypothesis). Only the internal CSV exports (the
 * v3 server CSV and the v1/v2 editor CSV) write it; the DPGF, standard and BDC workbooks can reach a client or a
 * supplier and never do.
 */
export function takeoffProvisionExportLabel(sourceMetadata: unknown): string {
  const provision = readTakeoffProvision(sourceMetadata);
  return provision ? TAKEOFF_PROVISION_EXPORT_LABELS[provision.kind] : "";
}
