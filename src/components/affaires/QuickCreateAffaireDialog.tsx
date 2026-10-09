"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { quickCreateAffaire } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useImportFlow } from "@/hooks/useImportFlow";
import { cn } from "@/lib/utils";
import { InfoIcon, UploadIcon } from "lucide-react";


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);
const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TERMINAL_IMPORT_STATUSES = new Set(["parsed", "imported", "completed"]);
const PARSING_IMPORT_LOOKUP_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportOption = {
  id: string;
  fileName: string;
  rowsCount: number | null;
};

type DialogPhase =
  | "idle"
  | "uploading"
  | "parsing"
  | "fetching_suggestions"
  | "creating";

type QuickCreateAffaireDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractMappings(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  if (Array.isArray(root.mappings)) return root.mappings;
  const data = asRecord(root.data);
  if (data && Array.isArray(data.mappings)) return data.mappings;
  return [];
}

async function isImportMappingReady(importId: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ import_id: importId, limit: "1" });
    const response = await fetch(`/api/mappings?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return extractMappings(payload).length > 0;
  } catch {
    return false;
  }
}

function getFileExtension(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : null;
}

type RedirectErrorLike = Error & {
  digest?: string;
};

function isRedirectErrorLike(error: unknown): error is RedirectErrorLike {
  if (!(error instanceof Error)) return false;
  const digest = (error as RedirectErrorLike).digest;
  return (
    error.message.includes("NEXT_REDIRECT") ||
    error.message.includes("redirect") ||
    (typeof digest === "string" && digest.includes("NEXT_REDIRECT"))
  );
}

function extractRedirectUrl(error: RedirectErrorLike): string | null {
  if (typeof error.digest === "string") {
    const parts = error.digest.split(";");
    const candidate = parts[2]?.trim();
    if (
      candidate &&
      (candidate.startsWith("/") ||
        candidate.startsWith("http://") ||
        candidate.startsWith("https://"))
    ) {
      return candidate;
    }
  }

  const marker = "NEXT_REDIRECT:";
  const markerIndex = error.message.indexOf(marker);
  if (markerIndex === -1) return null;

  const candidate = error.message.slice(markerIndex + marker.length).trim();
  return candidate.length > 0 ? candidate : null;
}

const PHASE_MESSAGES: Record<DialogPhase, string> = {
  idle: "",
  uploading: "Envoi du fichier\u2026",
  parsing: "Analyse du fichier\u2026",
  fetching_suggestions: "Vérification du mapping\u2026",
  creating: "Création de l\u2019affaire\u2026",
};

// ---------------------------------------------------------------------------
// Sub-component: Mini Drop Zone
// ---------------------------------------------------------------------------

function MiniDropZone({
  selectedFile,
  fileError,
  disabled,
  onFileSelect,
  onFileClear,
}: {
  selectedFile: File | null;
  fileError: string | null;
  disabled: boolean;
  onFileSelect: (file: File) => void;
  onFileClear: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  if (selectedFile && !fileError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {selectedFile.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {(selectedFile.size / 1024).toFixed(1)} Ko
          </p>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            onFileClear();
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          disabled={disabled}
        >
          Retirer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        className={cn(
          "relative rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border-strong bg-surface-subtle hover:border-primary/40",
        )}
      >
        <div className="flex flex-col items-center gap-1.5">
          <UploadIcon className="size-5 text-subtle-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-xs font-medium text-foreground-secondary">
            Déposez un fichier DPGF (optionnel)
          </p>
          <p className="text-micro text-muted-foreground">
            CSV, XLSX ou XLS
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          aria-label="Fichier DPGF (CSV, XLSX ou XLS)"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelect(file);
          }}
          disabled={disabled}
        />
      </div>
      {fileError && (
        <p role="alert" className="text-xs text-danger">{fileError}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Phase Overlay
// ---------------------------------------------------------------------------

function PhaseOverlay({ phase }: { phase: DialogPhase }) {
  return (
    <div role="status" className="flex flex-col items-center gap-4 py-10" aria-live="polite">
      <div
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-[3px] border-border border-t-primary motion-reduce:animate-none"
      />
      <p className="text-sm font-medium text-foreground-secondary">
        {PHASE_MESSAGES[phase]}
      </p>
      <div aria-hidden="true" className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary motion-reduce:animate-none"
          style={{
            width: "100%",
            animation: "qcd-indeterminate 1.5s ease-in-out infinite",
          }}
        />
      </div>
      <style>{`@keyframes qcd-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCreateAffaireDialog({
  open,
  onOpenChange,
}: Readonly<QuickCreateAffaireDialogProps>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fieldId = useId();
  const projectNameRef = useRef<HTMLInputElement>(null);

  // Form state
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [reference, setReference] = useState("");

  // File upload state (simplified + expert upload tab)
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<DialogPhase>("idle");

  // Import flow hook (no projectId — project doesn't exist yet)
  const { imports, importFile, lastImportId } = useImportFlow();

  // Expert mode — existing import tab
  const [expertImports, setExpertImports] = useState<ImportOption[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"existing" | "upload">("upload");
  const [versionTitle, setVersionTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");

  // Errors
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Ref to track the importId we're waiting on for file upload flow
  const pendingImportIdRef = useRef<string | null>(null);
  const latestImportsRef = useRef(imports);
  const isCompletingParsingRef = useRef(false);

  useEffect(() => {
    latestImportsRef.current = imports;
  }, [imports]);

  // -- Load available existing imports --
  useEffect(() => {
    if (!open) return;

    let mounted = true;

    async function load() {
      setIsLoadingImports(true);
      try {
        const res = await fetch("/api/imports", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();

        const rawItems = Array.isArray(json?.data)
          ? (json.data as unknown[])
          : Array.isArray(json)
            ? (json as unknown[])
            : [];

        const candidateImports = rawItems.filter(
          (item): item is Record<string, unknown> => {
            const entry = asRecord(item);
            if (!entry) return false;
            const status =
              typeof entry.status === "string" ? entry.status : null;
            const projectId =
              typeof entry.project_id === "string"
                ? entry.project_id
                : typeof entry.projectId === "string"
                  ? entry.projectId
                  : null;
            const importId = typeof entry.id === "string" ? entry.id : null;
            return status === "completed" && !projectId && Boolean(importId);
          },
        );

        const readyCandidates = await Promise.all(
          candidateImports.map(async (item) => ({
            item,
            mappingReady: await isImportMappingReady(item.id as string),
          })),
        );

        const items: ImportOption[] = readyCandidates
          .filter(({ mappingReady }) => mappingReady)
          .map(({ item }) => ({
            id: item.id as string,
            fileName:
              typeof item.filename === "string"
                ? item.filename
                : typeof item.file_name === "string"
                  ? item.file_name
                  : typeof item.fileName === "string"
                    ? item.fileName
                    : "Import",
            rowsCount:
              typeof item.row_count === "number"
                ? item.row_count
                : typeof item.rows_count === "number"
                  ? item.rows_count
                  : typeof item.rowsCount === "number"
                    ? item.rowsCount
                    : null,
          }));
        if (mounted) setExpertImports(items);
      } catch {
        // Non-blocking
      } finally {
        if (mounted) setIsLoadingImports(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [open]);

  // Sync selectedImportId when imports list changes
  useEffect(() => {
    if (!selectedImportId) return;
    if (!expertImports.some((item) => item.id === selectedImportId)) {
      setSelectedImportId(null);
    }
  }, [expertImports, selectedImportId]);

  // -- Watch for parsing completion during file upload flow --
  useEffect(() => {
    if (phase !== "parsing" || !pendingImportIdRef.current) return;

    const pendingImportId = pendingImportIdRef.current;
    const match = imports.find((i) => i.id === pendingImportId);
    if (!match) return;
    if (isCompletingParsingRef.current) return;

    if (TERMINAL_IMPORT_STATUSES.has(match.status)) {
      isCompletingParsingRef.current = true;
      void (async () => {
        try {
          await handleParsingComplete(pendingImportId, { rethrowRedirect: false });
        } finally {
          isCompletingParsingRef.current = false;
        }
      })();
    } else if (match.status === "failed" || match.status === "error") {
      pendingImportIdRef.current = null;
      setPhase("idle");
      setServerError("Le fichier n\u2019a pas pu être analysé.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, imports]);

  // If upload succeeded but refresh never exposes the created import, recover.
  useEffect(() => {
    if (phase !== "parsing" || !pendingImportIdRef.current) return;

    const pendingImportId = pendingImportIdRef.current;
    const timeoutId = window.setTimeout(() => {
      if (pendingImportIdRef.current !== pendingImportId) return;

      const hasMatch = latestImportsRef.current.some(
        (item) => item.id === pendingImportId,
      );
      if (hasMatch) return;

      pendingImportIdRef.current = null;
      setPhase("idle");
      setServerError(
        "Import introuvable après l\u2019upload. Veuillez réessayer.",
      );
    }, PARSING_IMPORT_LOOKUP_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase]);

  // Update pending ref when lastImportId changes during upload
  useEffect(() => {
    if (phase === "uploading" && lastImportId) {
      pendingImportIdRef.current = lastImportId;
      setPhase("parsing");
    }
  }, [phase, lastImportId]);

  // -- File handling --

  const handleFileSelect = useCallback((file: File) => {
    setFileError(null);
    const ext = getFileExtension(file.name);
    if (!ext || !VALID_EXTENSIONS.has(ext)) {
      setFileError(
        `Le format .${ext ?? "inconnu"} n\u2019est pas pris en charge. Utilisez CSV, XLSX ou XLS.`,
      );
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleFileClear = useCallback(() => {
    setSelectedFile(null);
    setFileError(null);
  }, []);

  // -- Async flow: parsing complete → fetch suggestions → create --

  async function handleParsingComplete(
    importId: string,
    options?: { rethrowRedirect?: boolean },
  ) {
    const rethrowRedirect = options?.rethrowRedirect ?? true;
    setPhase("fetching_suggestions");

    try {
      const res = await fetch("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggestions", import_id: importId }),
      });

      if (!res.ok) {
        throw new Error("Impossible de charger les suggestions de mapping.");
      }

      const payload = await res.json();
      const record = asRecord(payload);
      const data = asRecord(record?.data) ?? record;
      const suggestions =
        data && typeof data.suggestions === "object" && data.suggestions
          ? (data.suggestions as Record<string, string>)
          : {};
      const autoValidation = asRecord(data?.auto_validation);
      const canAutoValidate = autoValidation?.can_auto_validate === true;

      setPhase("creating");

      if (canAutoValidate && Object.keys(suggestions).length > 0) {
        // Auto-mapping confident — create with import
        await quickCreateAffaire({
          projectName: projectName.trim(),
          clientName: clientName.trim() || null,
          reference: reference.trim() || null,
          importId,
          mapping: suggestions,
          versionTitle: versionTitle.trim() || null,
          sectionTitle: sectionTitle.trim() || null,
        });
      } else {
        // Low confidence — create empty project but keep uploaded import linked to the affaire
        await quickCreateAffaire({
          projectName: projectName.trim(),
          clientName: clientName.trim() || null,
          reference: reference.trim() || null,
          importId: null,
          linkImportId: importId,
        });
      }
    } catch (err) {
      if (isRedirectErrorLike(err)) {
        if (rethrowRedirect) {
          throw err;
        }
        const redirectUrl = extractRedirectUrl(err);
        if (redirectUrl) {
          router.push(redirectUrl);
        }
        return;
      }
      pendingImportIdRef.current = null;
      setPhase("idle");
      setServerError(
        err instanceof Error ? err.message : "Erreur lors de la création.",
      );
    }
  }

  // -- Submit handlers --

  async function handleSubmitWithFile() {
    setPhase("uploading");
    setServerError(null);
    pendingImportIdRef.current = null;

    const success = await importFile(selectedFile!);
    if (!success) {
      setPhase("idle");
      setServerError("Impossible d\u2019uploader le fichier.");
    }
    // If success, useEffect on lastImportId will transition to "parsing"
  }

  function handleSubmitWithExistingImport() {
    startTransition(async () => {
      try {
        if (selectedImportId) {
          const mappingReady = await isImportMappingReady(selectedImportId);
          if (!mappingReady) {
            setServerError(
              "Cet import n\u2019est pas prêt pour la création rapide. Finalisez le mapping puis réessayez.",
            );
            return;
          }
        }

        await quickCreateAffaire({
          projectName: projectName.trim(),
          clientName: clientName.trim() || null,
          reference: reference.trim() || null,
          importId: selectedImportId,
          versionTitle: versionTitle.trim() || null,
          sectionTitle: sectionTitle.trim() || null,
        });
      } catch (err) {
        if (isRedirectErrorLike(err)) {
          throw err;
        }
        setServerError(
          err instanceof Error
            ? err.message
            : "Impossible de créer l\u2019affaire.",
        );
      }
    });
  }

  function handleSubmitEmpty() {
    startTransition(async () => {
      try {
        await quickCreateAffaire({
          projectName: projectName.trim(),
          clientName: clientName.trim() || null,
          reference: reference.trim() || null,
          importId: null,
        });
      } catch (err) {
        if (isRedirectErrorLike(err)) {
          throw err;
        }
        setServerError(
          err instanceof Error
            ? err.message
            : "Impossible de créer l\u2019affaire.",
        );
      }
    });
  }

  function handleSubmit() {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setClientError("Le nom du projet est obligatoire.");
      return;
    }
    setClientError(null);
    setServerError(null);

    // Determine which submit path to take
    const hasUploadedFile = selectedFile && !fileError;

    if (hasUploadedFile && importTab === "upload") {
      // File upload path
      void handleSubmitWithFile();
    } else if (importTab === "existing" && selectedImportId) {
      // Existing import path
      handleSubmitWithExistingImport();
    } else {
      // No import — empty project
      handleSubmitEmpty();
    }
  }

  // -- Reset --

  function handleOpenChange(next: boolean) {
    if (!next && (phase !== "idle" || isPending)) {
      return;
    }

    if (!next) {
      setProjectName("");
      setClientName("");
      setReference("");
      setSelectedFile(null);
      setFileError(null);
      setPhase("idle");
      pendingImportIdRef.current = null;
      setSelectedImportId(null);
      setImportTab("upload");
      setVersionTitle("");
      setSectionTitle("");
      setClientError(null);
      setServerError(null);
    }
    onOpenChange(next);
  }

  // -- Computed --

  const isBusy = phase !== "idle" || isPending;
  const canSubmit = projectName.trim().length > 0 && !isBusy;

  const nameInputId = `${fieldId}-name`;
  const nameErrorId = `${fieldId}-name-error`;
  const importTabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-surface text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground-secondary",
    );

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal
    >
      <DialogContent size="md" initialFocus={projectNameRef} showCloseButton={!isBusy}>
        <DialogHeader>
          <DialogTitle>Nouvelle affaire</DialogTitle>
        </DialogHeader>

        <DialogBody>
          {phase !== "idle" ? (
            <PhaseOverlay phase={phase} />
          ) : (
            <>
              {/* Project name — always visible */}
              <Field data-invalid={clientError ? true : undefined}>
                <FieldLabel htmlFor={nameInputId}>Nom du projet *</FieldLabel>
                <Input
                  ref={projectNameRef}
                  id={nameInputId}
                  placeholder="Ex: Residence Les Jardins"
                  value={projectName}
                  onChange={(e) => {
                    setProjectName(e.target.value);
                    if (clientError) setClientError(null);
                  }}
                  aria-invalid={clientError ? true : undefined}
                  aria-describedby={clientError ? nameErrorId : undefined}
                  aria-required="true"
                />
                {clientError ? <FieldError id={nameErrorId}>{clientError}</FieldError> : null}
              </Field>

              {/* Client & Reference — always visible */}
              <Field>
                <FieldLabel htmlFor={`${fieldId}-client`}>Client</FieldLabel>
                <Input
                  id={`${fieldId}-client`}
                  placeholder="Nom du client (optionnel)"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${fieldId}-reference`}>Référence</FieldLabel>
                <Input
                  id={`${fieldId}-reference`}
                  placeholder="Réf. projet (optionnel)"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>

              {/* Import DPGF section — shared by both modes */}
              <details open className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground-secondary">
                  Import DPGF{" "}
                  <span className="ml-0.5 inline-flex cursor-help align-middle" title="Décomposition du Prix Global et Forfaitaire — fichier Excel décrivant les postes à chiffrer">
                    <InfoIcon aria-hidden="true" className="size-3.5 text-subtle-foreground" />
                  </span>{" "}
                  (optionnel)
                </summary>

                <div className="mt-3 space-y-3">
                  {/* Tab toggle */}
                  <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                    <button
                      type="button"
                      aria-pressed={importTab === "upload"}
                      className={importTabClass(importTab === "upload")}
                      onClick={() => setImportTab("upload")}
                    >
                      Nouveau fichier
                    </button>
                    <button
                      type="button"
                      aria-pressed={importTab === "existing"}
                      className={importTabClass(importTab === "existing")}
                      onClick={() => setImportTab("existing")}
                    >
                      Import existant
                    </button>
                  </div>

                  {/* Existing import select */}
                  {importTab === "existing" && (
                    <div className="space-y-3">
                      <Field>
                        <FieldLabel htmlFor="qc-import-select">
                          Import disponible
                        </FieldLabel>
                        {isLoadingImports ? (
                          <p role="status" className="text-xs text-muted-foreground">
                            Chargement…
                          </p>
                        ) : expertImports.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Aucun import terminé et mappé disponible.
                          </p>
                        ) : (
                          <NativeSelect
                            id="qc-import-select"
                            size="sm"
                            value={selectedImportId ?? ""}
                            onChange={(e) =>
                              setSelectedImportId(e.target.value || null)
                            }
                          >
                            <option value="">Sans import</option>
                            {expertImports.map((imp) => (
                              <option key={imp.id} value={imp.id}>
                                {imp.fileName}
                                {imp.rowsCount !== null
                                  ? ` (${imp.rowsCount} lignes)`
                                  : ""}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                      </Field>

                      {selectedImportId && (
                        <>
                          <Field>
                            <FieldLabel htmlFor={`${fieldId}-version-title`}>
                              Titre de la version
                            </FieldLabel>
                            <Input
                              id={`${fieldId}-version-title`}
                              placeholder="V1 (optionnel)"
                              value={versionTitle}
                              onChange={(e) =>
                                setVersionTitle(e.target.value)
                              }
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`${fieldId}-section-title`}>
                              Titre de la section
                            </FieldLabel>
                            <Input
                              id={`${fieldId}-section-title`}
                              placeholder="Section principale (optionnel)"
                              value={sectionTitle}
                              onChange={(e) =>
                                setSectionTitle(e.target.value)
                              }
                            />
                          </Field>
                        </>
                      )}
                    </div>
                  )}

                  {/* New file upload */}
                  {importTab === "upload" && (
                    <MiniDropZone
                      selectedFile={selectedFile}
                      fileError={fileError}
                      disabled={isBusy}
                      onFileSelect={handleFileSelect}
                      onFileClear={handleFileClear}
                    />
                  )}
                </div>
              </details>

              {/* Server error */}
              {serverError && <Alert variant="danger">{serverError}</Alert>}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {phase === "idle" && (
            <Link
              href="/dashboard/estimates/new"
              className="text-center text-xs text-muted-foreground hover:underline sm:mr-auto sm:text-left"
            >
              Création avancée
            </Link>
          )}
          <Button
            variant="outline"
            disabled={isBusy}
            onClick={() => handleOpenChange(false)}
          >
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={isBusy}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Créer l&apos;affaire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
