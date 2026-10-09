"use client";

import type { PriceBookValidationResult } from "@/lib/catalogue/csv-import";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const COLUMN_COUNT = 7;

function statusBadge(status: string): { label: string; variant: NonNullable<BadgeProps["variant"]> } {
  if (status === "valid") return { label: "Valide", variant: "success" };
  if (status === "ignored") return { label: "Ignorée (hors périmètre)", variant: "neutral" };
  return { label: "À corriger", variant: "danger" };
}

export function PriceBookPreviewTable({
  validation,
}: Readonly<{
  validation: PriceBookValidationResult;
}>) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-foreground">Aperçu — 10 premières lignes</h3>
      </div>

      <div className="table-scroll relative overflow-x-auto" role="region" aria-label="Aperçu des lignes du fichier" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Ligne</th>
              <th scope="col">Fournisseur</th>
              <th scope="col">Produit</th>
              <th scope="col">Prix</th>
              <th scope="col">Devise</th>
              <th scope="col">Statut</th>
              <th scope="col">Motif</th>
            </tr>
          </thead>
          <tbody>
            {validation.previewRows.length === 0 ? (
              <EmptyTableRow colSpan={COLUMN_COUNT} variant="compact" title="Aucun aperçu disponible" />
            ) : (
              validation.previewRows.map((row) => {
                const supplierCsv = row.values.supplier_name;
                const productCsv = row.values.product_reference || row.values.product_designation;
                const supplierResolved = row.resolved?.supplier_name;
                const productResolved = row.resolved?.product_name;
                const badge = statusBadge(row.status);

                return (
                  <tr key={`${row.lineNumber}-${row.values.unit_price}-${row.values.supplier_name}`}>
                    <td>{row.lineNumber}</td>
                    <td className="text-sm">
                      {supplierResolved ? (
                        <span className="inline-flex flex-wrap items-center gap-1 text-foreground">
                          {supplierResolved}
                          <Badge variant="success" size="sm">
                            OK
                          </Badge>
                          {row.metadata?.autofilledSupplier ? (
                            <Badge variant="warning" size="sm">
                              Auto
                            </Badge>
                          ) : null}
                        </span>
                      ) : supplierCsv ? (
                        <span className="text-danger">{supplierCsv}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="text-sm">
                      {productResolved ? (
                        <span className="inline-flex flex-wrap items-center gap-1 text-foreground">
                          {productResolved}
                          <Badge variant="success" size="sm">
                            OK
                          </Badge>
                        </span>
                      ) : productCsv ? (
                        <span className="text-danger">{productCsv}</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{row.values.unit_price || "-"}</td>
                    <td>{row.values.currency || "EUR"}</td>
                    <td>
                      <Badge variant={badge.variant} size="sm">
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="text-sm text-foreground-secondary">{row.reason ?? "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
