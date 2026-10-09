"use client";

import type { PriceBookValidationResult } from "@/lib/catalogue/csv-import";

export function PriceBookPreviewTable({
  validation,
}: Readonly<{
  validation: PriceBookValidationResult;
}>) {
  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-sm font-semibold text-slate-800">Aperçu - 10 premières lignes</h3>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ligne</th>
              <th>Fournisseur</th>
              <th>Produit</th>
              <th>Prix</th>
              <th>Devise</th>
              <th>Statut</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {validation.previewRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground">
                  Aucun aperçu disponible.
                </td>
              </tr>
            ) : (
              validation.previewRows.map((row) => {
                const supplierCsv = row.values.supplier_name;
                const productCsv = row.values.product_reference || row.values.product_designation;
                const supplierResolved = row.resolved?.supplier_name;
                const productResolved = row.resolved?.product_name;

                const badgeClass =
                  row.status === "valid"
                    ? "status-badge status-confirmed"
                    : row.status === "ignored"
                      ? "status-badge"
                      : "status-badge status-canceled";

                const badgeLabel =
                  row.status === "valid"
                    ? "Valide"
                    : row.status === "ignored"
                      ? "Ignoree (hors perimetre)"
                      : "À corriger";

                return (
                  <tr key={`${row.lineNumber}-${row.values.unit_price}-${row.values.supplier_name}`}>
                    <td>{row.lineNumber}</td>
                    <td className="text-sm">
                      {supplierResolved ? (
                        <span className="text-slate-800">
                          {supplierResolved}
                          <span className="ml-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
                          {row.metadata?.autofilledSupplier ? (
                            <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Auto</span>
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
                        <span className="text-slate-800">
                          {productResolved}
                          <span className="ml-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
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
                      <span className={badgeClass}>{badgeLabel}</span>
                    </td>
                    <td className="text-sm text-slate-600">{row.reason ?? "-"}</td>
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
