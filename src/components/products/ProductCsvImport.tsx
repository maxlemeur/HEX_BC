"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { controlSurface } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
          : "Les produits sont importés, mais la liste n’a pas pu être actualisée."
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isImporting) onClose();
      }}
    >
      <DialogContent size="xl" className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importer des produits</DialogTitle>
          <DialogDescription>Chargez un CSV séparé par une virgule ou un point-virgule.</DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-5">
          <section className="rounded-lg border border-dashed border-border-strong bg-surface-subtle p-4">
            <label className="block text-sm font-semibold text-foreground" htmlFor="product-csv-file">
              Fichier CSV
            </label>
            <p id="product-csv-help" className="mt-1 mb-3 text-xs text-muted-foreground">
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
              className={cn(
                controlSurface,
                "block w-full px-3 py-2.5 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-1.5 file:font-medium file:text-primary-foreground hover:file:brightness-105"
              )}
            />
            {fileName ? <p className="mt-2 break-all text-xs text-muted-foreground">Fichier : {fileName}</p> : null}
          </section>

          <div aria-live="polite" className="space-y-3 empty:hidden">
            {isReading ? <LoadingState label="Analyse du fichier…" className="justify-start py-0" /> : null}
            {error ? <Alert variant="danger">{error}</Alert> : null}
            {success ? <Alert variant="success">{success}</Alert> : null}
          </div>

          {result ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Lignes valides" value={result.acceptedRows.length} tone="success" />
                <SummaryCard label="Lignes rejetées" value={result.rejectedRows.length} tone="danger" />
                <SummaryCard label="Séparateur détecté" value={result.delimiter === ";" ? "Point-virgule" : "Virgule"} />
              </dl>

              {result.ignoredColumns.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Colonnes ignorées : {result.ignoredColumns.join(", ")}.
                </p>
              ) : null}

              {result.acceptedRows.length > 0 ? (
                <section aria-labelledby="product-csv-preview-title">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 id="product-csv-preview-title" className="text-sm font-semibold text-foreground">
                      Aperçu des lignes valides
                    </h3>
                    <span className="text-xs text-muted-foreground">10 premières lignes</span>
                  </div>
                  <div
                    className="relative overflow-x-auto rounded-lg border border-border"
                    role="region"
                    aria-label="Aperçu des lignes valides"
                    tabIndex={0}
                  >
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-semibold">Référence</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Désignation</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Famille</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Matière / nuance</th>
                          <th scope="col" className="px-3 py-2 text-right font-semibold">Prix HT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {result.acceptedRows.slice(0, 10).map((row, index) => (
                          <tr key={`${row.reference ?? row.designation}-${index}`}>
                            <td className="px-3 py-2 font-mono text-xs text-foreground-secondary">{row.reference ?? "—"}</td>
                            <td className="px-3 py-2 font-medium text-foreground">{row.designation}</td>
                            <td className="px-3 py-2 text-foreground-secondary">{row.category ?? "—"}</td>
                            <td className="px-3 py-2 text-foreground-secondary">
                              {[row.material, row.grade].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-foreground-secondary">
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
                  <h3 id="product-csv-rejected-title" className="mb-2 text-sm font-semibold text-danger">
                    Lignes rejetées
                  </h3>
                  <div
                    className="relative max-h-40 overflow-auto rounded-lg border border-danger-border"
                    role="region"
                    aria-label="Lignes rejetées"
                    tabIndex={0}
                  >
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-danger-subtle text-xs uppercase tracking-wide text-danger">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-semibold">Ligne</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Désignation</th>
                          <th scope="col" className="px-3 py-2 font-semibold">Motif</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-danger-border">
                        {result.rejectedRows.map((row) => (
                          <tr key={row.line}>
                            <td className="px-3 py-2 tabular-nums text-foreground-secondary">{row.line}</td>
                            <td className="px-3 py-2 text-foreground-secondary">{row.designation || "—"}</td>
                            <td className="px-3 py-2 text-danger">{row.reasons.join(" ; ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </DialogBody>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="outline" size="lg" disabled={isImporting} onClick={onClose}>
            {success ? "Fermer" : "Annuler"}
          </Button>
          {!success ? (
            <Button
              size="lg"
              loading={isImporting}
              disabled={!result || result.acceptedRows.length === 0 || isReading}
              onClick={importProducts}
            >
              Importer {result?.acceptedRows.length ? `(${result.acceptedRows.length})` : ""}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const valueClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}
