"use client";

import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { mappingRuleEffect } from "./shared";

type PreviewItem = TakeoffPreviewConversionResponse["items"][number];

export const LINES_TITLE = "Lignes envoyées";
/** On a DPGF version: the application also leaves out the lines decided out of scope, which this list cannot tell apart. */
export const DPGF_LINES_TITLE = "Lignes retenues avant le rapprochement DPGF";
export const DPGF_OUT_OF_SCOPE_NOTE = "Ce compte inclut les lignes que le rapprochement DPGF a classées hors périmètre : elles ne sont "
  + "pas envoyées, et cette liste ne les distingue pas.";
export const SKIPPED_LINES_TITLE = "Laissées de côté par une règle";

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

function provenance(source: TakeoffJobItem | undefined) {
  if (!source) return "Provenance non renseignée";
  const file = source.source_file_name ?? "Fichier non renseigné";
  return `${file}, ${source.source_page !== null ? `page ${source.source_page}` : "page non renseignée"}`;
}

function LinesSection({ id, title, note, items, sourceByItemId }: {
  id: string;
  title: string;
  /** Said beside the count, before the list, which it describes. */
  note?: string;
  items: PreviewItem[];
  sourceByItemId: ReadonlyMap<string, TakeoffJobItem>;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="space-y-1">
        <h3 id={id} className="text-sm font-semibold text-foreground">
          {title} ({items.length})
        </h3>
        {note ? <p id={noteId} className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <div
        role="region"
        aria-label={`${title}, défilement`}
        tabIndex={0}
        className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border"
      >
        <ul aria-label={title} aria-describedby={noteId} className="divide-y divide-border text-sm">
          {items.map((item) => {
            const effect = mappingRuleEffect(item);
            const renamed = item.transformed.designation !== item.original.designation;
            return (
              <li key={item.item_id} aria-label={item.original.designation} className="space-y-0.5 px-3 py-2">
                <p className="break-words font-medium text-foreground">
                  {item.original.designation}
                  {renamed ? <span className="font-normal text-foreground-secondary"> → {item.transformed.designation}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {quantityFormat.format(item.transformed.quantity)} {item.transformed.unit} · {provenance(sourceByItemId.get(item.item_id))}
                </p>
                {effect ? <p className="text-xs font-medium text-foreground-secondary">{effect}</p> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * The takeoff's lines as the estimate will receive them, read-only: designation (and the new one a rule gives), quantity
 * and unit, source file and page, and what an administrator's mapping rule did, by its name. A line a rule replaces by an
 * ouvrage is sent as that ouvrage; a line a rule leaves aside is listed apart, with that rule. The lines excluded at the
 * review are neither sent nor listed.
 *
 * On a DPGF version the application also leaves aside the lines the reconciliation decided out of scope, which this
 * preview does not compute (it applies the mapping rules only; telling them apart would need the server to return them,
 * and the read that knows them has side effects): the list is named for what it is, the lines retained before the
 * reconciliation, and its count says so beside it (the re-check of 0fd09a20, finding 4: « Lignes envoyées (2) » named a
 * line out of scope, the caveat came after the list).
 */
export function TakeoffApplyLinesList({
  items,
  sourceByItemId,
  reconcilesDpgf,
}: {
  items: PreviewItem[];
  sourceByItemId: ReadonlyMap<string, TakeoffJobItem>;
  reconcilesDpgf: boolean;
}) {
  const retained = items.filter((item) => !item.original.is_excluded);
  const sent = retained.filter((item) => item.action !== "skip");
  const skipped = retained.filter((item) => item.action === "skip");
  return (
    <div className="space-y-4">
      <LinesSection id="takeoff-apply-lines-title" title={reconcilesDpgf ? DPGF_LINES_TITLE : LINES_TITLE}
        note={reconcilesDpgf ? DPGF_OUT_OF_SCOPE_NOTE : undefined} items={sent} sourceByItemId={sourceByItemId} />
      {skipped.length > 0 ? (
        <LinesSection id="takeoff-apply-skipped-title" title={SKIPPED_LINES_TITLE} items={skipped} sourceByItemId={sourceByItemId} />
      ) : null}
    </div>
  );
}
