import { estimateLineTakeoffItemIds } from "@/lib/takeoff/page-contributions";
import { lengthFactor, unitKey } from "@/lib/takeoff/page-replacement";
import type { TakeoffSendDestination, TakeoffSendBlocker } from "@/lib/takeoff/send-contracts";

// Lot 2, M2: what « Envoyer au tableau de chiffrage » proposes for a takeoff of an affaire, computed from what the server
// read. Pure: the server reads, this module decides, the send command checks the same facts again under its locks.

/** A version of the affaire, as the server reads it before the send. */
export type TakeoffSendVersion = {
  id: string;
  version_number: number;
  status: string;
  title: string | null;
  variant_label: string | null;
  updated_at: string;
  holds_dpgf_lines: boolean;
};

const ISSUED_STATUS_LABELS: Record<string, string> = {
  sending: "en cours d’envoi",
  sent: "envoyée",
  accepted: "acceptée",
  archived: "archivée",
};

export function takeoffSendVersionName(version: Pick<TakeoffSendVersion, "version_number" | "variant_label" | "title">) {
  const variant = version.variant_label?.trim() ? ` ${version.variant_label.trim()}` : "";
  const title = version.title?.trim() ? ` — ${version.title.trim()}` : "";
  return `V${version.version_number}${variant}${title}`;
}

export type TakeoffSendDestinationOption = {
  destination: TakeoffSendDestination;
  label: string;
  blocked: TakeoffSendBlocker | null;
};

/**
 * The destinations of a send. No version: the first draft, created at the confirmation. One draft: that draft,
 * preferred. Several drafts: each of them, and none preferred, the user chooses. Only issued versions: a copy of the
 * latest, which receives the lines while the original never changes. A version that holds DPGF lines is proposed but
 * blocked: its reconciliation needs the takeoff on the version, which only the send attaches.
 */
export function resolveTakeoffSendDestinations(versions: readonly TakeoffSendVersion[]): {
  options: TakeoffSendDestinationOption[];
  preferred: TakeoffSendDestination | null;
} {
  if (versions.length === 0) {
    const destination: TakeoffSendDestination = { kind: "first_draft" };
    return { options: [{ destination, label: "Créer le premier brouillon (V1)", blocked: null }], preferred: destination };
  }
  const byNumber = [...versions].sort((left, right) => right.version_number - left.version_number
    || left.id.localeCompare(right.id));
  const drafts = byNumber.filter((version) => version.status === "draft");
  if (drafts.length > 0) {
    const options = drafts.map((version): TakeoffSendDestinationOption => ({
      destination: { kind: "existing_draft", version_id: version.id },
      label: `${takeoffSendVersionName(version)} · brouillon`,
      blocked: version.holds_dpgf_lines ? "dpgf_reconciliation_required" : null,
    }));
    return { options, preferred: drafts.length === 1 ? options[0].destination : null };
  }
  const latest = byNumber[0];
  const destination: TakeoffSendDestination = { kind: "version_copy", source_version_id: latest.id };
  return {
    options: [{ destination,
      label: `Copie de la ${takeoffSendVersionName(latest)} (${ISSUED_STATUS_LABELS[latest.status] ?? latest.status}) : l’original reste inchangé`,
      blocked: latest.holds_dpgf_lines ? "dpgf_reconciliation_required" : null }],
    preferred: destination,
  };
}

export function sameTakeoffSendDestination(left: TakeoffSendDestination | null | undefined, right: TakeoffSendDestination | null | undefined) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "existing_draft" && right.kind === "existing_draft") return left.version_id.toLowerCase() === right.version_id.toLowerCase();
  if (left.kind === "version_copy" && right.kind === "version_copy") {
    return left.source_version_id.toLowerCase() === right.source_version_id.toLowerCase();
  }
  return left.kind === "first_draft";
}

/** The title of the section a new version (or a new section of a draft) receives. */
export function takeoffSendSectionTitle(planSetName: string | null | undefined) {
  const name = planSetName?.trim();
  return (name ? `Métré — ${name}` : "Métré").slice(0, 200);
}

/** A section of the draft as the server reads it. */
export type TakeoffSendSection = { id: string; parent_id: string | null; position: number | null; title: string | null };

/** The draft's sections in the editor's order (parent first, then position, title and id), each with its path. */
export function orderTakeoffSendSections(sections: readonly TakeoffSendSection[]) {
  const ids = new Set(sections.map((section) => section.id));
  const children = new Map<string | null, TakeoffSendSection[]>();
  for (const section of sections) {
    const parent = section.parent_id && ids.has(section.parent_id) ? section.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), section]);
  }
  const title = (section: TakeoffSendSection) => section.title?.trim() || "Section sans titre";
  for (const list of children.values()) {
    list.sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
      || title(left).localeCompare(title(right), "fr-FR") || left.id.localeCompare(right.id));
  }
  const ordered: Array<{ id: string; label: string }> = [];
  const visit = (parent: string | null, path: string[]) => {
    for (const section of children.get(parent) ?? []) {
      const label = [...path, title(section)];
      ordered.push({ id: section.id, label: label.join(" › ") });
      visit(section.id, label);
    }
  };
  visit(null, []);
  return ordered;
}

/**
 * The section a send to a draft proposes: the one asked for when it is a section of the draft; else the section the
 * last send of this affaire to this draft filled (so that plan B joins plan A's lines); else the draft's first section;
 * else a new one.
 */
export function defaultTakeoffSendSection(input: {
  requested: { kind: "new" } | { kind: "existing"; id: string } | undefined;
  ordered: ReadonlyArray<{ id: string; label: string }>;
  lastSentSectionId: string | null;
}): { kind: "new" } | { kind: "existing"; id: string } {
  const known = (id: string | null | undefined) => (id ? input.ordered.find((section) => section.id.toLowerCase() === id.toLowerCase()) : undefined);
  if (input.requested?.kind === "new") return { kind: "new" };
  if (input.requested?.kind === "existing") {
    const asked = known(input.requested.id);
    if (asked) return { kind: "existing", id: asked.id };
  }
  const sent = known(input.lastSentSectionId);
  if (sent) return { kind: "existing", id: sent.id };
  return input.ordered[0] ? { kind: "existing", id: input.ordered[0].id } : { kind: "new" };
}

// The title as the writer of engine 3 compares it (private.takeoff_apply_v3_lines: lower, whitespace reduced, trimmed),
// read on its ASCII part only: two titles equal here are equal for the database too, never the reverse.
const fineTitle = (value: string | null | undefined) => (value ?? "").replace(/^ +| +$/g, "").replace(/[ \t\n\v\f\r]+/g, " ")
  .replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** A line the send hands the writer, and whether it may be added to an earlier line. */
export type TakeoffSendLine = {
  takeoff_item_id: string;
  designation: string;
  unit: string;
  quantity: number;
  /** Measured by the takeoff, not typed nor estimated, not forced, not on a page already in the estimate. */
  accumulable: boolean;
};

/** A line directly under the target section of the draft. */
export type TakeoffSendSectionLine = {
  id: string;
  title: string | null;
  unit_code: string | null;
  pricing_status: string | null;
  description: string | null;
  quantity: number;
  updated_at: string;
  source_provider: string | null;
  source_job_id: string | null;
  source_metadata: unknown;
};

const thousandths = (value: number) => Math.round(value * 1000);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/**
 * Which lines of this takeoff add to an earlier takeoff line of the section instead of a new line: plan A sent 3
 * washbasins, plan B adds its 2 to that line (5). On both engines (engine 2 sums the takeoffs a line keeps, as its DPGF
 * lines do), onto a line fed by takeoffs alone that names them and whose quantity is still their sum (a quantity typed by
 * hand is never changed by a send), of the same title and unit (an engine 2 line keeps its unit in its description),
 * with neither a length rounded nor an hypothesis on either side, and only when the title and unit name one line of the
 * section (two homonyms stay two lines). `sourceQuantities` holds the quantity of each takeoff line the section's lines
 * name. The send command checks each of these facts again under the draft's lock, and its dry run shows what it does.
 */
export function proposeTakeoffSendAccumulations(input: {
  sent: readonly TakeoffSendLine[];
  sectionLines: readonly TakeoffSendSectionLine[];
  sourceQuantities: ReadonlyMap<string, number>;
  /** Earlier lines of pages this takeoff reads: their page decision says what they become. */
  pageLineIds: ReadonlySet<string>;
}): Map<string, TakeoffSendSectionLine> {
  const targets = new Map<string, TakeoffSendSectionLine>();
  const byKey = new Map<string, TakeoffSendSectionLine[]>();
  // The unit as the send's outcome reads it: the unit code on engine 3; on engine 2 (no unit code) the description as the
  // writer stored it, which is the takeoff line's unit as written.
  for (const line of input.sectionLines) {
    const unit = line.unit_code !== null ? `code:${line.unit_code}` : line.description?.trim() ? `text:${line.description.trim()}` : null;
    if (!line.title?.trim() || unit === null) continue;
    const key = `${fineTitle(line.title)}\u0000${unit}`;
    byKey.set(key, [...(byKey.get(key) ?? []), line]);
  }
  for (const sent of input.sent) {
    const unit = unitKey(sent.unit);
    if (!sent.accumulable || unit === null || lengthFactor({ unit_code: unit, description: sent.unit }) !== null) continue;
    const title = fineTitle(sent.designation);
    const same = [...(byKey.get(`${title}\u0000code:${unit}`) ?? []), ...(byKey.get(`${title}\u0000text:${sent.unit.trim()}`) ?? [])];
    if (same.length !== 1) continue;
    const line = same[0];
    const metadata = record(line.source_metadata);
    if (line.source_provider !== "takeoff" || input.pageLineIds.has(line.id) || "takeoff_length_rounding" in metadata
      || "takeoff_provision" in metadata) continue;
    const sources = estimateLineTakeoffItemIds(line.source_metadata, line.source_job_id);
    if (sources.length === 0 || sources.some((id) => !input.sourceQuantities.has(id))) continue;
    const measured = sources.reduce((sum, id) => sum + thousandths(input.sourceQuantities.get(id) ?? 0), 0);
    if (measured !== thousandths(line.quantity)) continue;
    targets.set(sent.takeoff_item_id, line);
  }
  return targets;
}

/**
 * What a confirmation does once its preview is computed again: a retry whose request committed meanwhile (a timeout,
 * then « Réessayer ») gets that receipt whatever the preview says — a takeoff already sent, a destination gone, an
 * error — never « rien n’a été écrit »; otherwise the preview's own answer stands.
 */
export async function previewOrReplay<T, R>(steps: { preview: () => Promise<T>; committed: () => Promise<boolean>;
  replay: () => Promise<R>; settled: (preview: T) => boolean }): Promise<{ preview: T } | { replayed: R }> {
  let preview: T;
  try {
    preview = await steps.preview();
  } catch (error) {
    if (await steps.committed()) return { replayed: await steps.replay() };
    throw error;
  }
  if (!steps.settled(preview) && await steps.committed()) return { replayed: await steps.replay() };
  return { preview };
}
