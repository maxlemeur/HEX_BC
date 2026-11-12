import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

// TI-682 lot D4: what a DPGF line holds of the other takeoffs applied, by takeoff and page, and the total it will hold
// with this one. Shown whatever the unit: a line two takeoffs feed (an overview and its enlarged plan, say) is visible as
// such even where the zone rules see nothing. A line of this takeoff drawn again in a line it keeps is flagged, to check.

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

type Composition = NonNullable<TakeoffDpgfComparisonRow["composition"]>;

function takeoffName(entry: Composition["earlier"][number]) {
  const date = entry.job_created_at ? new Date(entry.job_created_at) : null;
  return `le métré du ${date && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : "—"}${entry.job_level ? ` (niveau ${entry.job_level})` : ""}`;
}

function pagesText(entry: Composition["earlier"][number]) {
  return entry.pages.map((page) => `${page.source_file_name ?? "plan sans nom"}, ${page.source_page === null ? "page inconnue" : `page ${page.source_page}`}`
    + (page.quantity === null ? "" : ` : ${quantityFormat.format(page.quantity)}`)).join(" ; ");
}

export function DpgfCompositionNote({ row }: Readonly<{ row: TakeoffDpgfComparisonRow }>) {
  const composition = row.composition;
  if (!composition) return null;
  const unit = row.quantity_unit ?? row.dpgf.unit ?? "";
  const takeoffs = new Set(composition.earlier.filter((entry) => !entry.read_again).map((entry) => entry.job_id)).size
    + (row.takeoff_quantity === null ? 0 : 1);
  return (
    <div role="group" aria-label={`Composition de ${row.line_label}`} className="space-y-1 rounded-2xl border border-border-subtle bg-surface p-3 text-sm">
      <p className="font-semibold text-foreground">
        {takeoffs > 1 ? `Alimentée par ${takeoffs} métrés` : "Déjà alimentée par un autre métré"} : total {quantityFormat.format(composition.total_quantity)} {unit}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground-secondary">
        {composition.earlier.map((entry) => (
          <li key={`${entry.job_id}:${entry.read_again}`}>
            {entry.read_again
              ? `Page relue par ce métré, ${takeoffName(entry)} : ${quantityFormat.format(entry.quantity)} ${unit} (${pagesText(entry)}), remplacée ou gardée à l’application`
              : `Déjà alimentée par ${takeoffName(entry)} : ${quantityFormat.format(entry.quantity)} ${unit} (${pagesText(entry)})`}
          </li>
        ))}
        {row.takeoff_quantity === null ? null : <li>Ce métré : {quantityFormat.format(row.takeoff_quantity)} {unit}</li>}
      </ul>
      {composition.double_counted.length > 0 ? (
        <p role="status" className="text-xs font-medium text-warning">
          Peut-être compté deux fois, à vérifier : {composition.double_counted.map((entry) => `${quantityFormat.format(entry.overlap_m)} m`).join(", ")} dessinés
          aussi dans une ligne d’un autre métré que cette ligne DPGF garde.
        </p>
      ) : null}
    </div>
  );
}
