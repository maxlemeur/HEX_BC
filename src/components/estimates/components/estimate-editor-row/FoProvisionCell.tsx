"use client";

import { foTransportLabel } from "@/lib/estimates/fo-price-origin";

import {
  FO_PROVISION_CELL_TITLE,
  formatFoProvision,
} from "@/components/estimates/components/estimate-editor-row/shared";

/** TI-534 : provision FO d'une ligne v3, en lecture seule (dérivée de son type FO). */
export function FoProvisionCell({ value, origin }: { value: number | string | null | undefined; origin?: unknown }) {
  return (
    <div
      data-estimate-column="fo_provision"
      role="gridcell"
      className="estimate-cell estimate-cell--readonly estimate-col--fo"
      title={`${FO_PROVISION_CELL_TITLE}${foTransportLabel(origin) ? ` Transport FO : ${foTransportLabel(origin)}.` : ""}`}
      data-testid="estimate-line-fo-provision"
    >
      <span>{formatFoProvision(value)}</span>
    </div>
  );
}
