import type { EstimatePurchaseOrderDraftPreparation } from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

type PurchaseOrderDraftLinesTableProps = Pick<
  EstimatePurchaseOrderDraftPreparation["groups"][number],
  "supplierName" | "lines"
>;

export function PurchaseOrderDraftLinesTable({
  supplierName,
  lines,
}: PurchaseOrderDraftLinesTableProps) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm text-muted-foreground">
        <caption className="sr-only">
          Lignes à relire pour {supplierName}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-2 py-2">
              Ligne
            </th>
            <th scope="col" className="px-2 py-2">
              Quantité
            </th>
            <th scope="col" className="px-2 py-2">
              Coût unitaire HT
            </th>
            <th scope="col" className="px-2 py-2">
              HT
            </th>
            <th scope="col" className="px-2 py-2">
              TVA
            </th>
            <th scope="col" className="px-2 py-2">
              TTC
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.itemId}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-2 py-3 font-medium text-foreground"
              >
                {line.itemTitle}
                {line.supplierReference ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Réf. {line.supplierReference}
                  </span>
                ) : null}
              </th>
              <td className="whitespace-nowrap px-2 py-3">
                {line.quantity} {line.unit}
              </td>
              <td className="whitespace-nowrap px-2 py-3">
                {formatEUR(line.unitPriceHtCents)}
              </td>
              <td className="whitespace-nowrap px-2 py-3">
                {formatEUR(line.lineTotalHtCents)}
              </td>
              <td className="whitespace-nowrap px-2 py-3">
                {formatEUR(line.lineTaxCents)} (
                {line.taxRateBp / 100} %)
              </td>
              <td className="whitespace-nowrap px-2 py-3">
                {formatEUR(line.lineTotalTtcCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
