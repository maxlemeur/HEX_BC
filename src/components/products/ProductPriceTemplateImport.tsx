"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";
import {
  TEMPLATE_FILE_URL,
  type ProductPriceTemplateIssue,
  type ProductPriceTemplateParseResult,
  type ProductTemplateRow,
  type SupplierPriceTemplateRow,
} from "@/lib/catalogue/product-price-template-client";

export type ProductPriceTemplateImportProps = {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
};

type TemplateImportSummary = {
  created_products: number;
  updated_products: number;
  created_prices: number;
  skipped_prices: number;
};

type TemplateImportResponse = {
  data?: TemplateImportSummary;
  error?: {
    message?: string;
    details?: unknown;
  };
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS_COUNT = 5;

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

export function ProductPriceTemplateImport({
  open,
  onClose,
  onImported,
}: Readonly<ProductPriceTemplateImportProps>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ProductPriceTemplateParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const isBusy = isReading || isImporting;
  const canImport =
    result !== null &&
    !result.hasBlockingIssues &&
    (result.products.length > 0 || result.prices.length > 0) &&
    !isBusy;

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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setResult(null);
    setSuccess(null);
    setError(null);

    if (!file) {
      setFileName(null);
      return;
    }

    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Sélectionnez un fichier au format XLSX.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Le fichier dépasse la taille maximale de 5 Mo.");
      return;
    }

    setIsReading(true);
    try {
      const { parseProductPriceTemplateWorkbook } = await import(
        "@/lib/catalogue/product-price-template"
      );
      const nextResult = await parseProductPriceTemplateWorkbook(await file.arrayBuffer());
      setResult(nextResult);
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "Impossible d'analyser le fichier XLSX."
      );
    } finally {
      setIsReading(false);
    }
  }

  async function importTemplate() {
    if (!canImport || !result) return;

    setError(null);
    setSuccess(null);
    setIsImporting(true);

    try {
      const response = await fetch("/api/catalogue/template-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: result.products, prices: result.prices }),
      });
      const payload = (await response.json().catch(() => null)) as TemplateImportResponse | null;

      if (!response.ok || !payload?.data) {
        throw new Error(formatApiError(payload));
      }

      const summary = payload.data;
      setSuccess(
        [
          `${summary.created_products} produit(s) créé(s)`,
          `${summary.updated_products} actualisé(s)`,
          `${summary.created_prices} tarif(s) créé(s)`,
          `${summary.skipped_prices} tarif(s) ignoré(s)`,
        ].join(" · ")
      );

      try {
        await onImported();
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? `L'import est terminé, mais l'actualisation a échoué : ${refreshError.message}`
            : "L'import est terminé, mais la liste n'a pas pu être actualisée."
        );
      }
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Impossible d'importer les produits et les tarifs."
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) onClose();
      }}
    >
      <Modal.Content
        className="max-w-6xl overflow-hidden p-0"
        closeOnEscapeKey={!isBusy}
        closeOnOverlayClick={!isBusy}
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <Modal.Header className="mb-0">
            <div>
              <Modal.Title>Importer des produits et tarifs</Modal.Title>
              <p className="mt-1 text-sm text-slate-500">
                Utilisez le modèle officiel pour ajouter votre catalogue en une seule opération.
              </p>
            </div>
            <Modal.Close disabled={isBusy} aria-label="Fermer l'import du catalogue" />
          </Modal.Header>
        </div>

        <Modal.Body className="max-h-[calc(90vh-76px)] overflow-y-auto p-6">
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">1. Préparer le fichier</h3>
                <p className="mt-1 max-w-2xl text-xs text-slate-500">
                  Complétez les feuilles Produits et Tarifs fournisseurs sans modifier leurs
                  en-têtes.
                </p>
              </div>
              <a
                href={TEMPLATE_FILE_URL}
                download
                className="inline-flex h-9 items-center justify-center rounded-button border border-primary/20 px-4 text-sm font-medium text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Télécharger le modèle
              </a>
            </div>
          </section>

          <section className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <label
              className="block text-sm font-semibold text-slate-800"
              htmlFor="product-price-template-file"
            >
              2. Sélectionner le fichier XLSX
            </label>
            <p id="product-price-template-help" className="mb-3 mt-1 text-xs text-slate-500">
              Fichier .xlsx uniquement, 5 Mo maximum. Le fichier est contrôlé avant tout import.
            </p>
            <input
              ref={fileInputRef}
              id="product-price-template-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-describedby="product-price-template-help"
              disabled={isBusy}
              onChange={handleFileChange}
              className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:font-medium file:text-primary-foreground hover:file:brightness-105"
            />
            {fileName ? <p className="mt-2 text-xs text-slate-500">Fichier : {fileName}</p> : null}
          </section>

          <div aria-live="polite" className="space-y-3">
            {isReading ? <ImportProgress label="Analyse du fichier…" value={45} /> : null}
            {isImporting ? <ImportProgress label="Enregistrement dans le catalogue…" value={75} /> : null}
            {error ? (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            ) : null}
            {success ? <div className="alert alert-success">Import terminé : {success}.</div> : null}
          </div>

          {result ? <TemplatePreview result={result} /> : null}

          <Modal.Footer className="border-t border-slate-200 pt-4">
            <Button type="button" variant="ghost" disabled={isBusy} onClick={onClose}>
              {success ? "Fermer" : "Annuler"}
            </Button>
            {!success ? (
              <Button
                type="button"
                loading={isImporting}
                disabled={!canImport}
                onClick={importTemplate}
              >
                {"Confirmer l'import"}
              </Button>
            ) : null}
          </Modal.Footer>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}

function TemplatePreview({ result }: Readonly<{ result: ProductPriceTemplateParseResult }>) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Produits prêts" value={result.products.length} tone="success" />
        <SummaryCard label="Tarifs prêts" value={result.prices.length} tone="success" />
        <SummaryCard
          label="Anomalies"
          value={result.issues.length}
          tone={result.hasBlockingIssues ? "danger" : "neutral"}
        />
      </div>

      {result.version ? (
        <p className="text-xs text-slate-500">Version du modèle détectée : {result.version}</p>
      ) : null}

      {result.products.length > 0 ? <ProductsPreview products={result.products} /> : null}
      {result.prices.length > 0 ? <PricesPreview prices={result.prices} /> : null}
      {result.issues.length > 0 ? <IssuesPreview issues={result.issues} /> : null}

      {result.hasBlockingIssues ? (
        <p className="text-sm font-medium text-red-700" role="status">
          {"Corrigez les anomalies bloquantes dans le fichier avant de confirmer l'import."}
        </p>
      ) : null}
    </div>
  );
}

function ProductsPreview({ products }: Readonly<{ products: ProductTemplateRow[] }>) {
  return (
    <section aria-labelledby="template-products-preview-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="template-products-preview-title" className="text-sm font-semibold text-slate-800">
          Aperçu des produits
        </h3>
        <span className="text-xs text-slate-500">5 premières lignes</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table
          aria-labelledby="template-products-preview-title"
          className="w-full min-w-[780px] text-left text-sm"
        >
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Référence</th>
              <th className="px-3 py-2 font-semibold">Désignation</th>
              <th className="px-3 py-2 font-semibold">Famille</th>
              <th className="px-3 py-2 font-semibold">Unité</th>
              <th className="px-3 py-2 text-right font-semibold">Prix HT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.slice(0, PREVIEW_ROWS_COUNT).map((product) => (
              <tr key={product.reference}>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{product.reference}</td>
                <td className="px-3 py-2 font-medium text-slate-800">{product.designation}</td>
                <td className="px-3 py-2 text-slate-600">{product.category ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{product.unit}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatEuro(product.unit_price_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PricesPreview({ prices }: Readonly<{ prices: SupplierPriceTemplateRow[] }>) {
  return (
    <section aria-labelledby="template-prices-preview-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 id="template-prices-preview-title" className="text-sm font-semibold text-slate-800">
          Aperçu des tarifs fournisseurs
        </h3>
        <span className="text-xs text-slate-500">5 premières lignes</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table
          aria-labelledby="template-prices-preview-title"
          className="w-full min-w-[820px] text-left text-sm"
        >
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Produit</th>
              <th className="px-3 py-2 font-semibold">Fournisseur</th>
              <th className="px-3 py-2 font-semibold">Réf. fournisseur</th>
              <th className="px-3 py-2 text-right font-semibold">Prix HT</th>
              <th className="px-3 py-2 font-semibold">Date du prix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prices.slice(0, PREVIEW_ROWS_COUNT).map((price, index) => (
              <tr key={`${price.product_reference}-${price.supplier_name}-${price.supplier_sku ?? index}`}>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">
                  {price.product_reference}
                </td>
                <td className="px-3 py-2 font-medium text-slate-800">{price.supplier_name}</td>
                <td className="px-3 py-2 text-slate-600">{price.supplier_sku ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatCurrency(price.unit_price_cents, price.currency)}
                </td>
                <td className="px-3 py-2 text-slate-600">{formatDate(price.valid_from)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IssuesPreview({ issues }: Readonly<{ issues: ProductPriceTemplateIssue[] }>) {
  return (
    <section aria-labelledby="template-issues-title">
      <h3 id="template-issues-title" className="mb-2 text-sm font-semibold text-red-800">
        Anomalies détectées
      </h3>
      <div className="max-h-48 overflow-auto rounded-xl border border-red-200">
        <table
          aria-labelledby="template-issues-title"
          className="w-full min-w-[640px] text-left text-sm"
        >
          <thead className="sticky top-0 bg-red-50 text-xs uppercase tracking-wide text-red-700">
            <tr>
              <th className="px-3 py-2 font-semibold">Feuille</th>
              <th className="px-3 py-2 font-semibold">Ligne</th>
              <th className="px-3 py-2 font-semibold">Message</th>
              <th className="px-3 py-2 font-semibold">Niveau</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {issues.map((issue, index) => (
              <tr key={`${issue.sheet}-${issue.row ?? "sheet"}-${issue.code}-${index}`}>
                <td className="px-3 py-2 text-slate-700">{issue.sheet}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{issue.row ?? "—"}</td>
                <td className="px-3 py-2 text-red-700">{issue.message}</td>
                <td className="px-3 py-2 font-medium text-red-700">
                  {issue.blocking ? "Bloquante" : "À vérifier"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: number;
  tone: "neutral" | "success" | "danger";
}>) {
  const valueClass =
    tone === "success"
      ? "text-emerald-700"
      : tone === "danger"
        ? "text-red-700"
        : "text-slate-800";

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

function ImportProgress({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-blue-800">
        <span>{label}</span>
        <span>{value} %</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-full bg-blue-100"
      >
        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function formatEuro(cents: number) {
  return currencyFormatter.format(cents / 100);
}

function formatCurrency(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${currency}`;
  }
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatApiError(payload: TemplateImportResponse | null) {
  const message = payload?.error?.message ?? "Impossible d'importer les produits et les tarifs.";
  const details = payload?.error?.details;
  if (typeof details === "string" && details.trim()) return `${message} ${details}`;
  return message;
}
