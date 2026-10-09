"use client";

import { useEffect, useRef, useState } from "react";

import { DownloadIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
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
          : "Impossible d’importer les produits et les tarifs."
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isBusy) onClose();
      }}
    >
      <DialogContent size="full" className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Importer des produits et tarifs</DialogTitle>
          <DialogDescription>
            Utilisez le modèle officiel pour ajouter votre catalogue en une seule opération.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-5">
          <section className="rounded-lg border border-border bg-surface-subtle p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">1. Préparer le fichier</h3>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  Complétez les feuilles Produits et Tarifs fournisseurs sans modifier leurs
                  en-têtes.
                </p>
              </div>
              <a
                href={TEMPLATE_FILE_URL}
                download
                className={buttonVariants({ variant: "secondary", size: "md" })}
              >
                <DownloadIcon aria-hidden="true" />
                Télécharger le modèle
              </a>
            </div>
          </section>

          <section className="rounded-lg border border-dashed border-border-strong bg-surface p-4">
            <label
              className="block text-sm font-semibold text-foreground"
              htmlFor="product-price-template-file"
            >
              2. Sélectionner le fichier XLSX
            </label>
            <p id="product-price-template-help" className="mb-3 mt-1 text-xs text-muted-foreground">
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
              className={cn(
                controlSurface,
                "block w-full px-3 py-2.5 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-1.5 file:font-medium file:text-primary-foreground hover:file:brightness-105"
              )}
            />
            {fileName ? <p className="mt-2 text-xs text-muted-foreground">Fichier : {fileName}</p> : null}
          </section>

          <div aria-live="polite" className="space-y-3 empty:hidden">
            {isReading ? <ImportProgress label="Analyse du fichier…" value={45} /> : null}
            {isImporting ? <ImportProgress label="Enregistrement dans le catalogue…" value={75} /> : null}
            {error ? <Alert variant="danger">{error}</Alert> : null}
            {success ? <Alert variant="success">Import terminé : {success}.</Alert> : null}
          </div>

          {result ? <TemplatePreview result={result} /> : null}
        </DialogBody>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="outline" size="lg" disabled={isBusy} onClick={onClose}>
            {success ? "Fermer" : "Annuler"}
          </Button>
          {!success ? (
            <Button size="lg" loading={isImporting} disabled={!canImport} onClick={importTemplate}>
              {"Confirmer l'import"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatePreview({ result }: Readonly<{ result: ProductPriceTemplateParseResult }>) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Produits prêts" value={result.products.length} tone="success" />
        <SummaryCard label="Tarifs prêts" value={result.prices.length} tone="success" />
        <SummaryCard
          label="Anomalies"
          value={result.issues.length}
          tone={result.hasBlockingIssues ? "danger" : "neutral"}
        />
      </dl>

      {result.version ? (
        <p className="text-xs text-muted-foreground">Version du modèle détectée : {result.version}</p>
      ) : null}

      {result.products.length > 0 ? <ProductsPreview products={result.products} /> : null}
      {result.prices.length > 0 ? <PricesPreview prices={result.prices} /> : null}
      {result.issues.length > 0 ? <IssuesPreview issues={result.issues} /> : null}

      {result.hasBlockingIssues ? (
        <p className="text-sm font-medium text-danger" role="status">
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
        <h3 id="template-products-preview-title" className="text-sm font-semibold text-foreground">
          Aperçu des produits
        </h3>
        <span className="text-xs text-muted-foreground">5 premières lignes</span>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-border" role="region" tabIndex={0} aria-labelledby="template-products-preview-title">
        <table
          aria-labelledby="template-products-preview-title"
          className="w-full min-w-[780px] text-left text-sm"
        >
          <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Référence</th>
              <th scope="col" className="px-3 py-2 font-semibold">Désignation</th>
              <th scope="col" className="px-3 py-2 font-semibold">Famille</th>
              <th scope="col" className="px-3 py-2 font-semibold">Unité</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Prix HT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {products.slice(0, PREVIEW_ROWS_COUNT).map((product) => (
              <tr key={product.reference}>
                <td className="px-3 py-2 font-mono text-xs text-foreground-secondary">{product.reference}</td>
                <td className="px-3 py-2 font-medium text-foreground">{product.designation}</td>
                <td className="px-3 py-2 text-foreground-secondary">{product.category ?? "—"}</td>
                <td className="px-3 py-2 text-foreground-secondary">{product.unit}</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground-secondary">
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
        <h3 id="template-prices-preview-title" className="text-sm font-semibold text-foreground">
          Aperçu des tarifs fournisseurs
        </h3>
        <span className="text-xs text-muted-foreground">5 premières lignes</span>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-border" role="region" tabIndex={0} aria-labelledby="template-prices-preview-title">
        <table
          aria-labelledby="template-prices-preview-title"
          className="w-full min-w-[820px] text-left text-sm"
        >
          <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Produit</th>
              <th scope="col" className="px-3 py-2 font-semibold">Fournisseur</th>
              <th scope="col" className="px-3 py-2 font-semibold">Réf. fournisseur</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Prix HT</th>
              <th scope="col" className="px-3 py-2 font-semibold">Date du prix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {prices.slice(0, PREVIEW_ROWS_COUNT).map((price, index) => (
              <tr key={`${price.product_reference}-${price.supplier_name}-${price.supplier_sku ?? index}`}>
                <td className="px-3 py-2 font-mono text-xs text-foreground-secondary">
                  {price.product_reference}
                </td>
                <td className="px-3 py-2 font-medium text-foreground">{price.supplier_name}</td>
                <td className="px-3 py-2 text-foreground-secondary">{price.supplier_sku ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-foreground-secondary">
                  {formatCurrency(price.unit_price_cents, price.currency)}
                </td>
                <td className="px-3 py-2 text-foreground-secondary">{formatDate(price.valid_from)}</td>
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
      <h3 id="template-issues-title" className="mb-2 text-sm font-semibold text-danger">
        Anomalies détectées
      </h3>
      <div className="relative max-h-48 overflow-auto rounded-lg border border-danger-border" role="region" tabIndex={0} aria-label="Anomalies détectées">
        <table
          aria-labelledby="template-issues-title"
          className="w-full min-w-[640px] text-left text-sm"
        >
          <thead className="sticky top-0 bg-danger-subtle text-xs uppercase tracking-wide text-danger">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Feuille</th>
              <th scope="col" className="px-3 py-2 font-semibold">Ligne</th>
              <th scope="col" className="px-3 py-2 font-semibold">Message</th>
              <th scope="col" className="px-3 py-2 font-semibold">Niveau</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-danger-border">
            {issues.map((issue, index) => (
              <tr key={`${issue.sheet}-${issue.row ?? "sheet"}-${issue.code}-${index}`}>
                <td className="px-3 py-2 text-foreground-secondary">{issue.sheet}</td>
                <td className="px-3 py-2 tabular-nums text-foreground-secondary">{issue.row ?? "—"}</td>
                <td className="px-3 py-2 text-danger">{issue.message}</td>
                <td className="px-3 py-2 font-medium text-danger">
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
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-foreground";

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold ${valueClass}`}>{value}</dd>
    </div>
  );
}

function ImportProgress({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-lg border border-info-border bg-info-subtle p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-info">
        <span>{label}</span>
        <span>{value} %</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-full bg-info-light"
      >
        <div className="h-full rounded-full bg-info transition-all motion-reduce:transition-none" style={{ width: `${value}%` }} />
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
  const message = payload?.error?.message ?? "Impossible d’importer les produits et les tarifs.";
  const details = payload?.error?.details;
  if (typeof details === "string" && details.trim()) return `${message} ${details}`;
  return message;
}
