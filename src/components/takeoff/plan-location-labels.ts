import type { PlanLocationField, PlanLocationFieldView } from "@/lib/takeoff/plan-location";

type FieldAuthor = { by_name: string | null; at: string } | null;
type Correction = { fields: Record<PlanLocationField, FieldAuthor>; updated_by_name: string | null; updated_at: string } | null;

export const PLAN_LOCATION_FIELD_LABELS: Record<PlanLocationField, string> = { building: "Bâtiment", level: "Niveau" };

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const formatDate = (iso: string) => dateFormatter.format(new Date(iso));
const pages = (list: number[]) => `page${list.length > 1 ? "s" : ""} ${list.join(", ")}`;
const sourceLabel = (source: "title_block" | "file_name", onPages: number[]) =>
  source === "file_name" ? "nom du fichier" : `cartouche, ${pages(onPages)}`;

/** The value shown for a field, or what stands in for it. */
export function planLocationValueLabel(field: PlanLocationField, view: PlanLocationFieldView) {
  if (view.value !== null) return view.value;
  if (view.state === "multiple") return field === "level" ? "Plusieurs niveaux" : "Plusieurs bâtiments";
  return "À préciser";
}

/** Where the value comes from, and whether it still has to be checked. */
export function planLocationProvenanceLabel(field: PlanLocationField, view: PlanLocationFieldView, annotation: Correction, earlier: Correction) {
  const by = (correction: Correction) => {
    const author = correction?.fields[field] ?? (correction ? { by_name: correction.updated_by_name, at: correction.updated_at } : null);
    return author ? `${author.by_name ?? "un membre"} le ${formatDate(author.at)}` : "un membre";
  };
  switch (view.state) {
    case "confirmed": return `Confirmé par ${by(annotation)}`;
    // Against a title block that was not read here, the stored value is neither a confirmation nor a correction.
    case "corrected": return `${view.title_block_read ? "Corrigé" : "Enregistré"} par ${by(annotation)}`;
    case "multiple": return `Lu dans le plan : ${view.candidates.map((candidate) => `${candidate.value} (${sourceLabel(candidate.source, candidate.pages)})`).join(", ")}`;
    case "unknown": return view.title_block_read ? "Ni le cartouche ni le nom du fichier ne l’indiquent" : "Cartouche non lu";
    case "proposed":
      if (view.origin === "previous_revision") return `Repris de la correction d’une version précédente (${by(earlier)}) · à vérifier`;
      if (view.origin === "file_name") return "Lu dans le nom du fichier · à vérifier";
      return `Lu dans le cartouche, ${pages(view.pages)} · à vérifier`;
  }
}

/** The other values these bytes show for a field: a contradiction stays visible. */
export function planLocationOtherReadings(view: PlanLocationFieldView) {
  if (view.state === "multiple") return [];
  return view.candidates.filter((candidate) => candidate.value !== view.value)
    .map((candidate) => `${candidate.value} (${sourceLabel(candidate.source, candidate.pages)})`);
}

export function planLocationNeedsCheck(view: PlanLocationFieldView) {
  return view.state === "proposed" || view.state === "multiple" || view.state === "unknown";
}
