"use client";

import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { mappingRuleEffect } from "./shared";

type PreviewItem = TakeoffPreviewConversionResponse["items"][number];

export const LINES_TITLE = "Lignes envoyées";

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

function provenance(source: TakeoffJobItem | undefined) {
  if (!source) return "Provenance non renseignée";
  const file = source.source_file_name ?? "Fichier non renseigné";
  return `${file}, ${source.source_page !== null ? `page ${source.source_page}` : "page non renseignée"}`;
}

/**
 * The takeoff's lines as the estimate will receive them, read-only: designation (and the new one a rule gives), quantity
 * and unit, source file and page, and what an administrator's mapping rule did, by its name. The lines excluded at the
 * review are not sent and not listed.
 */
export function TakeoffApplyLinesList({
  items,
  sourceByItemId,
}: {
  items: PreviewItem[];
  sourceByItemId: ReadonlyMap<string, TakeoffJobItem>;
}) {
  const sent = items.filter((item) => !item.original.is_excluded);
  return (
    <section aria-labelledby="takeoff-apply-lines-title" className="space-y-2">
      <h3 id="takeoff-apply-lines-title" className="text-sm font-semibold text-foreground">
        {LINES_TITLE} ({sent.length})
      </h3>
      <div
        role="region"
        aria-label={`${LINES_TITLE}, défilement`}
        tabIndex={0}
        className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border"
      >
        <ul aria-label={LINES_TITLE} className="divide-y divide-border text-sm">
          {sent.map((item) => {
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
