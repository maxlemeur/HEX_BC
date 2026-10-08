"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { parseProductCsv } from "./product-csv";
import type { ProductCsvParseResult } from "./product-csv";

export type ProductCsvImportProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export function ProductCsvImport({ open, onClose, onImported }: Readonly<ProductCsvImportProps>) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ProductCsvParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFileName(null);
    setResult(null);
    setError(null);
    setSuccess(null);
    setIsReading(false);
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open]);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setSuccess(null);
    setError(null);

    if (!file) {
      setFileName(null);
      return;
    }

    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Sélectionnez un fichier au format CSV.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Le fichier dépasse la taille maximale de 5 Mo.");
      return;
    }

    setIsReading(true);
    try {
      setResult(parseProductCsv(await file.text()));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Impossible de lire le fichier CSV.");
    } finally {
      setIsReading(false);
    }
  }

  async function importProducts() {
    if (!result || result.acceptedRows.length === 0) return;

    setError(null);
    setSuccess(null);
    setIsImporting(true);

    // The generated database type can lag behind additive catalogue migrations.
    const { error: insertError } = await supabase
      .from("products")
      .insert(result.acceptedRows as never);

    if (insertError) {
      setError(insertError.message);
      setIsImporting(false);
      return;
    }

    try {
      await onImported();
      setSuccess(`${result.acceptedRows.length} produit(s) importé(s) avec succès.`);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Les produits sont importes, mais la liste n'a pas pu etre actualisee."
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isImporting) onClose();
      }}
    >
      <Modal.Content
        className="max-w-5xl overflow-hidden p-0"
        closeOnEscapeKey={!isImporting}
        closeOnOverlayClick={!isImporting}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>Importer des produits</Modal.Title>
              <p className="mt-1 text-sm text-slate-500">
                Chargez un CSV séparé par une virgule ou un point-virgule.
              </p>
            </div>
            <Modal.Close disabled={isImporting} />
          </Modal.Header>
        </div>

        <div className="max-h-[calc(90vh-76px)] space-y-5 overflow-y-auto p-6">
          <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <label className="block text-sm font-semibold text-slate-800" htmlFor="product-csv-file">
              Fichier CSV
            </label>
            <p id="product-csv-help" className="mb-3 mt-1 text-xs text-slate-500">
              La désignation est obligatoire. Colonnes reconnues : référence, famille, type,
              matière, nuance, dimensions, norme, unité, prix unitaire HT et TVA.
            </p>
            <input
              ref={fileInputRef}
              id="product-csv-file"
              type="file"
              accept=".csv,text/csv,application/csv,text/plain"
              aria-describedby="product-csv-help"
              disabled={isReading || isImporting}
              onChange={onFileChange}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-medium file:text-primary-foreground hover:file:brightness-105"
            />
            {fileName ? <p className="mt-2 text-xs text-slate-500">Fichier : {fileName}</p> : null}
          </section>

          <div aria-live="polite">
            {isReading ? <div className="alert alert-info">Analyse du fichier...</div> : null}
            {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
            {success ? <div className="alert alert-success">{success}</div> : null}
          </div>

          {result ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Lignes valides" value={result.acceptedRows.length} tone="success" />
                <SummaryCard label="Lignes rejetées" value={result.rejectedRows.length} tone="danger" />
                <SummaryCard label="Séparateur détecté" value={result.delimiter === ";" ? "Point-virgule" : "Virgule"} />
              </div>

              {result.ignoredColumns.length > 0 ? (
                <p className="text-xs text-slate-500">
                  Colonnes ignorées : {result.ignoredColumns.join(", ")}.
                </p>
              ) : null}

              {result.acceptedRows.length > 0 ? (
                <section aria-labelledby="product-csv-preview-title">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 id="product-csv-preview-title" className="text-sm font-semibold text-slate-800">
                      Aperçu des lignes valides
                    </h3>
                    <span className="text-xs text-slate-500">10 premières lignes</span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Référence</th>
                          <th className="px-3 py-2 font-semibold">Désignation</th>
                          <th className="px-3 py-2 font-semibold">Famille</th>
                          <th className="px-3 py-2 font-semibold">Matière / nuance</th>
                          <th className="px-3 py-2 text-right font-semibold">Prix HT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {result.acceptedRows.slice(0, 10).map((row, index) => (
                          <tr key={`${row.reference ?? row.designation}-${index}`}>
                            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.reference ?? "—"}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{row.designation}</td>
                            <td className="px-3 py-2 text-slate-600">{row.category ?? "—"}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {[row.material, row.grade].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                              {(row.unit_price_cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {result.rejectedRows.length > 0 ? (
                <section aria-labelledby="product-csv-rejected-title">
                  <h3 id="product-csv-rejected-title" className="mb-2 text-sm font-semibold text-red-800">
                    Lignes rejetées
                  </h3>
                  <div className="max-h-40 overflow-auto rounded-xl border border-red-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-red-50 text-xs uppercase tracking-wide text-red-700">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Ligne</th>
                          <th className="px-3 py-2 font-semibold">Désignation</th>
                          <th className="px-3 py-2 font-semibold">Motif</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100">
                        {result.rejectedRows.map((row) => (
                          <tr key={row.line}>
                            <td className="px-3 py-2 tabular-nums text-slate-600">{row.line}</td>
                            <td className="px-3 py-2 text-slate-700">{row.designation || "—"}</td>
                            <td className="px-3 py-2 text-red-700">{row.reasons.join(" ; ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <Modal.Footer className="border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" disabled={isImporting} onClick={onClose}>
              {success ? "Fermer" : "Annuler"}
            </Button>
            {!success ? (
              <Button
                type="button"
                loading={isImporting}
                disabled={!result || result.acceptedRows.length === 0 || isReading}
                onClick={importProducts}
              >
                Importer {result?.acceptedRows.length ? `(${result.acceptedRows.length})` : ""}
              </Button>
            ) : null}
          </Modal.Footer>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: Readonly<{
  label: string;
  value: number | string;
  tone?: "neutral" | "success" | "danger";
}>) {
  const valueClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
