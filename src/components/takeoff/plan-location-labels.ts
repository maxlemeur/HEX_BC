import type { PlanLocationField, PlanLocationFieldView } from "@/lib/takeoff/plan-location";

type FieldAuthor = { set_by_name: string | null; set_at: string };
type Correction = Record<PlanLocationField, FieldAuthor> | null;
type EarlierCorrection = Record<PlanLocationField, FieldAuthor> | null;

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
export function planLocationProvenanceLabel(field: PlanLocationField, view: PlanLocationFieldView, annotation: Correction, earlier: EarlierCorrection) {
  const author = annotation?.[field];
  const by = author ? `${author.set_by_name ?? "un membre"} le ${formatDate(author.set_at)}` : "un membre";
  const earlierAuthor = earlier?.[field];
  const byEarlier = earlierAuthor ? `${earlierAuthor.set_by_name ?? "un membre"} le ${formatDate(earlierAuthor.set_at)}` : "un membre";
  switch (view.state) {
    case "confirmed": return `Confirmé par ${by}`;
    // Against a title block that was not read here, the stored value is neither a confirmation nor a correction.
    case "corrected": return `${view.title_block_read ? "Corrigé" : "Enregistré"} par ${by}`;
    case "multiple": return `Lu dans le plan : ${view.candidates.map((candidate) => `${candidate.value} (${sourceLabel(candidate.source, candidate.pages)})`).join(", ")}`;
    case "unknown":
      if (view.origin === "operator") return `Marqué à préciser par ${by}`;
      return view.title_block_read ? "Ni le cartouche ni le nom d’origine du fichier ne l’indiquent" : "Cartouche non lu";
    case "proposed":
      if (view.origin === "previous_revision") return `Repris de la correction d’une version précédente (${byEarlier}) · à vérifier`;
      if (view.origin === "file_name") return "Lu dans le nom du fichier · à vérifier";
      return `Lu dans le cartouche, ${pages(view.pages)} · à vérifier`;
  }
}

/** The other values these bytes show for a field: a contradiction, or a reading set aside, stays visible. */
export function planLocationOtherReadings(view: PlanLocationFieldView) {
  if (view.state === "multiple") return [];
  return view.candidates.filter((candidate) => candidate.value !== view.value)
    .map((candidate) => `${candidate.value} (${sourceLabel(candidate.source, candidate.pages)})`);
}

export function planLocationNeedsCheck(view: PlanLocationFieldView) {
  return view.state === "proposed" || view.state === "multiple" || view.state === "unknown";
}
