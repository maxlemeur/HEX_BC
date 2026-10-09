"use client";

import type { ReactNode, RefObject } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  CircleXIcon,
  Loader2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";

import { TabularPdfReviewPanel } from "@/components/imports/TabularPdfReviewPanel";
import { IMPORT_WIZARD_ACCEPTED_FILE_TYPES } from "@/components/imports/importWizardFileScan";
import type { FileStage } from "@/components/imports/useImportWizardFileStage";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ApprovedPdfTable, TabularPdfReviewPayload } from "@/hooks/useImportFlow";
import { cn } from "@/lib/utils";

type ImportWizardFileStageSectionProps = {
  approvedPdfTables: ApprovedPdfTable[];
  clearSelectedFile: () => void;
  detectedHeaderRow: number | null;
  detectedHeaders: string[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileStage: FileStage;
  formatError: string | null;
  handleDragLeave: () => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileSelection: (file: File | null) => void;
  handleFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleHeaderRowInputChange: (value: string) => void;
  handlePdfReviewSubmit: () => Promise<void>;
  handleTogglePdfTable: (table: ApprovedPdfTable) => void;
  headerRowError: string | null;
  headerRowInput: string;
  isDragOver: boolean;
  isSubmitting: boolean;
  lastMode: "worker" | "server" | "unknown" | null;
  modeMessage: string | null;
  pdfReview: TabularPdfReviewPayload | null;
  pdfReviewError: string | null;
  selectedFile: File | null;
  submitError: string | null;
  workerError: string | null;
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

type StageTone = "neutral" | "primary" | "success" | "warning" | "danger";

const STAGE_TONES: Record<StageTone, { panel: string; icon: string }> = {
  neutral: { panel: "border-border-strong bg-surface-subtle", icon: "bg-muted text-muted-foreground" },
  primary: { panel: "border-primary/40 bg-primary/5", icon: "bg-primary/10 text-primary" },
  success: { panel: "border-success-border bg-success-subtle", icon: "bg-surface text-success" },
  warning: { panel: "border-warning-border bg-warning-subtle", icon: "bg-surface text-warning" },
  danger: { panel: "border-danger-border bg-danger-subtle", icon: "bg-surface text-danger" },
};

/** One selected-file state: icon, name, status line and the action(s) on the right. */
function FileStagePanel({
  tone,
  icon,
  title,
  status,
  actions,
  children,
}: {
  tone: StageTone;
  icon: ReactNode;
  title: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("animate-fade-in rounded-lg border-2 p-4 sm:p-5", STAGE_TONES[tone].panel)}>
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
        <div
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5",
            STAGE_TONES[tone].icon
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <div className="mt-0.5 text-xs">{status}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

const spinner = <Loader2Icon className="animate-spin motion-reduce:animate-none" />;

export function ImportWizardFileStageSection({
  approvedPdfTables,
  clearSelectedFile,
  detectedHeaderRow,
  detectedHeaders,
  fileInputRef,
  fileStage,
  formatError,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleFileSelection,
  handleFormSubmit,
  handleHeaderRowInputChange,
  handlePdfReviewSubmit,
  handleTogglePdfTable,
  headerRowError,
  headerRowInput,
  isDragOver,
  isSubmitting,
  lastMode,
  modeMessage,
  pdfReview,
  pdfReviewError,
  selectedFile,
  submitError,
  workerError,
}: ImportWizardFileStageSectionProps) {
  const submitButton = (
    <Button type="submit" size="lg" loading={isSubmitting} rightIcon={<ArrowRightIcon aria-hidden="true" />}>
      Lancer l&apos;import
    </Button>
  );

  return (
    <Card>
      <CardContent>
        <form onSubmit={(event) => void handleFormSubmit(event)} className="space-y-4">
          {fileStage === "idle" && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={cn(
                  "relative rounded-lg border-2 border-dashed p-6 text-center transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15 sm:p-8",
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : "border-border-strong bg-surface-subtle hover:border-primary/40"
                )}
              >
                <div className="flex flex-col items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="flex size-12 items-center justify-center rounded-full bg-surface text-subtle-foreground ring-1 ring-border"
                  >
                    <UploadIcon className="size-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground-secondary">
                      Glissez-déposez votre fichier ici
                    </p>
                    <p id="import-file-hint" className="mt-1 text-xs text-muted-foreground">
                      ou cliquez pour parcourir — CSV, XLSX, XLS ou PDF tabulaire
                    </p>
                  </div>
                </div>
                <input
                  id="import-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept={IMPORT_WIZARD_ACCEPTED_FILE_TYPES}
                  aria-label="Fichier DPGF à importer"
                  aria-describedby="import-file-hint import-file-limit"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    handleFileSelection(event.target.files?.[0] ?? null);
                  }}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p id="import-file-limit" className="text-xs text-muted-foreground">
                  Taille maximale : 50 Mo.
                </p>
                <p className="text-xs text-muted-foreground">
                  Besoin d’aide ?{" "}
                  <a
                    href="/exemple-dpgf.xlsx"
                    download
                    className="font-medium text-primary underline underline-offset-2 hover:text-brand-blue-dark"
                  >
                    Télécharger un fichier exemple
                  </a>
                </p>
              </div>
            </>
          )}

          {fileStage === "validating" && selectedFile && (
            <FileStagePanel
              tone="neutral"
              icon={spinner}
              title={selectedFile.name}
              status={<p className="text-primary" role="status">Validation du format…</p>}
              actions={
                <Button variant="outline" size="md" onClick={clearSelectedFile}>
                  Annuler
                </Button>
              }
            />
          )}

          {fileStage === "scanning" && selectedFile && (
            <FileStagePanel
              tone="primary"
              icon={<CheckIcon />}
              title={
                <>
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-success">Format valide</span>
                </>
              }
              status={
                <p className="flex items-center gap-2 text-primary" role="status">
                  <Loader2Icon aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />
                  Analyse de la structure du fichier…
                </p>
              }
              actions={
                <Button variant="outline" size="md" onClick={clearSelectedFile}>
                  Annuler
                </Button>
              }
            />
          )}

          {fileStage === "reviewing_pdf" && selectedFile && (
            <FileStagePanel
              tone="primary"
              icon={spinner}
              title={selectedFile.name}
              status={
                <p className="text-primary" role="status">
                  Détection des tableaux puis validation explicite…
                </p>
              }
              actions={
                <Button variant="outline" size="md" onClick={clearSelectedFile}>
                  Annuler
                </Button>
              }
            />
          )}

          {fileStage === "invalid" && selectedFile && (
            <FileStagePanel
              tone="danger"
              icon={<CircleXIcon />}
              title={selectedFile.name}
              status={<p className="text-danger">{pdfReviewError ?? formatError}</p>}
              actions={
                <Button variant="outline" size="md" onClick={clearSelectedFile}>
                  Choisir un autre fichier
                </Button>
              }
            />
          )}

          {fileStage === "pdf_review" && selectedFile && pdfReview && (
            <TabularPdfReviewPanel
              fileName={selectedFile.name}
              fileSizeLabel={formatSize(selectedFile.size)}
              pdfReview={pdfReview}
              approvedTables={approvedPdfTables}
              onToggleTable={handleTogglePdfTable}
              onClearFile={clearSelectedFile}
              onSubmit={() => void handlePdfReviewSubmit()}
              isSubmitting={isSubmitting}
            />
          )}

          {fileStage === "ready" && selectedFile && (
            <FileStagePanel
              tone="success"
              icon={<CheckIcon />}
              title={
                <>
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formatSize(selectedFile.size)}
                  </span>
                </>
              }
              status={
                detectedHeaders.length > 0 ? (
                  <p className="text-success">
                    En-tête détectée
                    {detectedHeaderRow && detectedHeaderRow > 1
                      ? ` (ligne ${detectedHeaderRow})`
                      : ""}
                    {" "}— {detectedHeaders.length} colonnes trouvées
                  </p>
                ) : (
                  <p className="text-success">Fichier prêt pour l’import</p>
                )
              }
              actions={
                <>
                  <Button variant="outline" size="md" disabled={isSubmitting} onClick={clearSelectedFile}>
                    Retirer
                  </Button>
                  {submitButton}
                </>
              }
            >
              {detectedHeaders.length > 0 ? (
                <div className="mt-3 border-t border-success-border pt-3">
                  <p className="mb-2 text-xs font-medium text-foreground-secondary">
                    Colonnes détectées :
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedHeaders.slice(0, 12).map((header) => (
                      <Badge key={header} variant="outline" size="sm" className="max-w-full">
                        <span className="truncate">{header}</span>
                      </Badge>
                    ))}
                    {detectedHeaders.length > 12 ? (
                      <Badge variant="neutral" size="sm">
                        +{detectedHeaders.length - 12} autres
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </FileStagePanel>
          )}

          {fileStage === "header_needed" && selectedFile && (
            <FileStagePanel
              tone="warning"
              icon={<TriangleAlertIcon />}
              title={
                <>
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formatSize(selectedFile.size)}
                  </span>
                </>
              }
              status={<p className="text-warning">En-tête non détectée automatiquement</p>}
              actions={
                <Button variant="outline" size="md" onClick={clearSelectedFile}>
                  Retirer
                </Button>
              }
            >
              <div className="mt-3 border-t border-warning-border pt-3">
                <p id="header-row-hint" className="mb-2 text-xs text-foreground-secondary">
                  Indiquez le numéro de la ligne contenant les noms de colonnes, ou laissez vide pour
                  laisser le serveur détecter.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-32">
                    <label
                      htmlFor="header-row-input"
                      className="mb-1 block text-xs font-medium text-foreground-secondary"
                    >
                      Ligne d’en-tête
                    </label>
                    <Input
                      id="header-row-input"
                      size="sm"
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      aria-describedby="header-row-hint"
                      value={headerRowInput}
                      onChange={(event) => {
                        handleHeaderRowInputChange(event.target.value);
                      }}
                      placeholder="Ex. 3"
                      disabled={isSubmitting}
                    />
                  </div>
                  {submitButton}
                </div>
              </div>
            </FileStagePanel>
          )}
        </form>

        {isSubmitting ? (
          <div className="mt-4" role="status">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Envoi et traitement en cours…</p>
          </div>
        ) : null}

        <div aria-live="polite" className="sr-only">
          {modeMessage ?? ""}
        </div>

        <div className="mt-4 space-y-3 empty:hidden">
          {modeMessage ? (
            <Alert variant={lastMode === "worker" ? "success" : "info"} role="presentation">
              {modeMessage}
            </Alert>
          ) : null}

          {workerError ? (
            <Alert variant="info">Échec du traitement navigateur : {workerError}</Alert>
          ) : null}

          {submitError ? <Alert variant="danger">{submitError}</Alert> : null}

          {pdfReviewError ? <Alert variant="danger">{pdfReviewError}</Alert> : null}

          {headerRowError ? <Alert variant="danger">{headerRowError}</Alert> : null}
        </div>
      </CardContent>
    </Card>
  );
}
