"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startAffaireFromImport } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import type { AffaireProjectDetailsValues } from "@/components/affaires/AffaireProjectDetailsCard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useImportFlow } from "@/hooks/useImportFlow";
import { cn } from "@/lib/utils";
import { UploadIcon } from "lucide-react";

const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);
const ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TERMINAL_IMPORT_STATUSES = new Set(["parsed", "imported", "completed"]);
const PARSING_IMPORT_LOOKUP_TIMEOUT_MS = 12000;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
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

const PHASE_MESSAGES: Record<DialogPhase, string> = {
  idle: "",
  uploading: "Envoi du fichier…",
  parsing: "Analyse du fichier…",
  fetching_suggestions: "Vérification du mapping…",
  creating: "Création de l’affaire…",
};

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
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
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
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
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
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        className={cn(
          "relative rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-border-strong bg-surface-subtle hover:border-primary/40"
        )}
      >
        <div className="flex flex-col items-center gap-1.5">
          <UploadIcon className="size-5 text-subtle-foreground" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-xs font-medium text-foreground-secondary">
            Déposez un fichier DPGF
          </p>
          <p className="text-micro text-muted-foreground">CSV, XLSX ou XLS</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          aria-label="Fichier DPGF (CSV, XLSX ou XLS)"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelect(file);
            }
          }}
          disabled={disabled}
        />
      </div>
      {fileError ? <p role="alert" className="text-xs text-danger">{fileError}</p> : null}
    </div>
  );
}

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
            animation: "affaire-bootstrap-indeterminate 1.5s ease-in-out infinite",
          }}
        />
      </div>
      <style>{`@keyframes affaire-bootstrap-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
    </div>
  );
}

type AffaireImportBootstrapSectionProps = {
  metadata: AffaireProjectDetailsValues;
  onProjectNameRequired: () => void;
};

export function AffaireImportBootstrapSection({
  metadata,
  onProjectNameRequired,
}: Readonly<AffaireImportBootstrapSectionProps>) {
  const router = useRouter();
  const fieldId = useId();
  const [isPending, startTransition] = useTransition();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [phase, setPhase] = useState<DialogPhase>("idle");
  const { imports, importFile, lastImportId } = useImportFlow();
  const [expertImports, setExpertImports] = useState<ImportOption[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"existing" | "upload">("upload");
  const [versionTitle, setVersionTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const pendingImportIdRef = useRef<string | null>(null);
  const latestImportsRef = useRef(imports);
  const isCompletingParsingRef = useRef(false);

  useEffect(() => {
    latestImportsRef.current = imports;
  }, [imports]);

  useEffect(() => {
    let mounted = true;

    async function loadImports() {
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
          }
        );

        const readyCandidates = await Promise.all(
          candidateImports.map(async (item) => ({
            item,
            mappingReady: await isImportMappingReady(item.id as string),
          }))
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

        if (mounted) {
          setExpertImports(items);
        }
      } catch {
        // Ignore loading issues here; submit still validates server-side.
      } finally {
        if (mounted) {
          setIsLoadingImports(false);
        }
      }
    }

    void loadImports();

    return () => {
      mounted = false;
    };
  }, []);

  const handleParsingComplete = useCallback(
    async (importId: string) => {
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
          const result = await startAffaireFromImport({
            projectName: metadata.projectName.trim(),
            clientName: metadata.clientName.trim() || null,
            reference: metadata.reference.trim() || null,
            importId,
            mapping: suggestions,
            versionTitle: versionTitle.trim() || null,
            sectionTitle: sectionTitle.trim() || null,
          });
          router.push(result.redirectUrl);
          router.refresh();
          return;
        }

        const result = await startAffaireFromImport({
          projectName: metadata.projectName.trim(),
          clientName: metadata.clientName.trim() || null,
          reference: metadata.reference.trim() || null,
          importId: null,
          linkImportId: importId,
        });

        router.push(result.redirectUrl);
        router.refresh();
      } catch (error) {
        pendingImportIdRef.current = null;
        setPhase("idle");
        setServerError(
          error instanceof Error ? error.message : "Erreur lors de la création."
        );
      }
    },
    [
      metadata.clientName,
      metadata.projectName,
      metadata.reference,
      router,
      sectionTitle,
      versionTitle,
    ]
  );

  useEffect(() => {
    if (!selectedImportId) {
      return;
    }
    if (!expertImports.some((item) => item.id === selectedImportId)) {
      setSelectedImportId(null);
    }
  }, [expertImports, selectedImportId]);

  useEffect(() => {
    if (phase !== "parsing" || !pendingImportIdRef.current) {
      return;
    }

    const pendingImportId = pendingImportIdRef.current;
    const match = imports.find((item) => item.id === pendingImportId);
    if (!match || isCompletingParsingRef.current) {
      return;
    }

    if (TERMINAL_IMPORT_STATUSES.has(match.status)) {
      isCompletingParsingRef.current = true;
      void (async () => {
        try {
          await handleParsingComplete(pendingImportId);
        } finally {
          isCompletingParsingRef.current = false;
        }
      })();
    } else if (match.status === "failed" || match.status === "error") {
      pendingImportIdRef.current = null;
      setPhase("idle");
      setServerError("Le fichier n'a pas pu être analyse.");
    }
  }, [handleParsingComplete, imports, phase]);

  useEffect(() => {
    if (phase !== "parsing" || !pendingImportIdRef.current) {
      return;
    }

    const pendingImportId = pendingImportIdRef.current;
    const timeoutId = window.setTimeout(() => {
      if (pendingImportIdRef.current !== pendingImportId) {
        return;
      }

      const hasMatch = latestImportsRef.current.some(
        (item) => item.id === pendingImportId
      );
      if (hasMatch) {
        return;
      }

      pendingImportIdRef.current = null;
      setPhase("idle");
      setServerError("Import introuvable après l'upload. Veuillez réessayer.");
    }, PARSING_IMPORT_LOOKUP_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  useEffect(() => {
    if (phase === "uploading" && lastImportId) {
      pendingImportIdRef.current = lastImportId;
      setPhase("parsing");
    }
  }, [lastImportId, phase]);

  const isBusy = phase !== "idle" || isPending;

  const handleFileSelect = useCallback((file: File) => {
    setFileError(null);
    setServerError(null);
    const ext = getFileExtension(file.name);
    if (!ext || !VALID_EXTENSIONS.has(ext)) {
      setFileError(
        `Le format .${ext ?? "inconnu"} n’est pas pris en charge. Utilisez CSV, XLSX ou XLS.`
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

  const ensureMetadataReady = () => {
    if (!metadata.projectName.trim()) {
      setServerError("Le nom du projet est obligatoire.");
      onProjectNameRequired();
      return false;
    }

    return true;
  };

  async function finalizeImport(importId: string, mapping?: Record<string, string>) {
    const result = await startAffaireFromImport({
      projectName: metadata.projectName.trim(),
      clientName: metadata.clientName.trim() || null,
      reference: metadata.reference.trim() || null,
      importId,
      mapping,
      versionTitle: versionTitle.trim() || null,
      sectionTitle: sectionTitle.trim() || null,
    });

    router.push(result.redirectUrl);
    router.refresh();
  }

  async function handleSubmitWithFile() {
    setPhase("uploading");
    setServerError(null);
    pendingImportIdRef.current = null;

    const success = await importFile(selectedFile!);
    if (!success) {
      setPhase("idle");
      setServerError("Impossible d'uploader le fichier.");
    }
  }

  function handleSubmitWithExistingImport() {
    startTransition(async () => {
      try {
        if (selectedImportId) {
          const mappingReady = await isImportMappingReady(selectedImportId);
          if (!mappingReady) {
            setServerError(
              "Cet import n'est pas prêt pour la création rapide. Finalisez le mapping puis réessayez."
            );
            return;
          }
        }

        await finalizeImport(selectedImportId!);
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : "Impossible de créer l'affaire."
        );
      }
    });
  }

  function handleSubmit() {
    if (!ensureMetadataReady()) {
      return;
    }

    setServerError(null);
    const hasUploadedFile = selectedFile && !fileError;

    if (hasUploadedFile && importTab === "upload") {
      void handleSubmitWithFile();
      return;
    }

    if (importTab === "existing" && selectedImportId) {
      handleSubmitWithExistingImport();
      return;
    }

    setServerError("Sélectionnez un import existant ou déposez un fichier DPGF.");
  }

  const tabClass = (active: boolean) =>
    cn(
      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-surface text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground-secondary"
    );

  return (
    <Card className="p-5">
      <div>
        <CardTitle className="text-sm">
          Démarrer depuis un DPGF ou un import existant
        </CardTitle>
        <CardDescription className="mt-1 text-sm">
          Parcours expert pour amorcer directement la structure du devis.
        </CardDescription>
      </div>

      {phase !== "idle" ? (
        <PhaseOverlay phase={phase} />
      ) : (
        <div className="mt-5 space-y-4">
          <details open className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground-secondary">
              Import DPGF
            </summary>

            <div className="mt-3 space-y-3">
              <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  aria-pressed={importTab === "upload"}
                  className={tabClass(importTab === "upload")}
                  onClick={() => setImportTab("upload")}
                >
                  Nouveau fichier
                </button>
                <button
                  type="button"
                  aria-pressed={importTab === "existing"}
                  className={tabClass(importTab === "existing")}
                  onClick={() => setImportTab("existing")}
                >
                  Import existant
                </button>
              </div>

              {importTab === "existing" ? (
                <div className="space-y-3">
                  <Field>
                    <FieldLabel htmlFor="affaire-bootstrap-import-select">
                      Import disponible
                    </FieldLabel>
                    {isLoadingImports ? (
                      <p role="status" className="text-xs text-muted-foreground">Chargement…</p>
                    ) : expertImports.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aucun import terminé et mappé disponible.
                      </p>
                    ) : (
                      <NativeSelect
                        id="affaire-bootstrap-import-select"
                        size="sm"
                        value={selectedImportId ?? ""}
                        onChange={(event) =>
                          setSelectedImportId(event.target.value || null)
                        }
                      >
                        <option value="">Sans import</option>
                        {expertImports.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.fileName}
                            {item.rowsCount !== null ? ` (${item.rowsCount} lignes)` : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </Field>

                  {selectedImportId ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor={`${fieldId}-version-title`}>Titre de la version</FieldLabel>
                        <Input
                          id={`${fieldId}-version-title`}
                          placeholder="V1 (optionnel)"
                          value={versionTitle}
                          onChange={(event) => setVersionTitle(event.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${fieldId}-section-title`}>Titre de la section</FieldLabel>
                        <Input
                          id={`${fieldId}-section-title`}
                          placeholder="Section principale (optionnel)"
                          value={sectionTitle}
                          onChange={(event) => setSectionTitle(event.target.value)}
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : (
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

          {serverError ? <Alert variant="danger">{serverError}</Alert> : null}

          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={isBusy}
              loading={isBusy}
            >
              Lancer le flux expert
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
