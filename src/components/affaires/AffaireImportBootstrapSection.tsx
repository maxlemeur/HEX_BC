"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startAffaireFromImport } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import type { AffaireProjectDetailsValues } from "@/components/affaires/AffaireProjectDetailsCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useImportFlow } from "@/hooks/useImportFlow";

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
  uploading: "Upload en cours...",
  parsing: "Analyse du fichier...",
  fetching_suggestions: "Verification du mapping...",
  creating: "Creation de l'affaire...",
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
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--slate-800)]">
            {selectedFile.name}
          </p>
          <p className="text-xs text-[var(--slate-500)]">
            {(selectedFile.size / 1024).toFixed(1)} Ko
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-[var(--slate-500)] hover:text-[var(--slate-700)]"
          onClick={() => {
            onFileClear();
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }}
          disabled={disabled}
        >
          Retirer
        </button>
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
        className={`relative rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
          isDragOver
            ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
            : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
        }`}
      >
        <div className="flex flex-col items-center gap-1.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--slate-400)"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <p className="text-xs font-medium text-[var(--slate-600)]">
            Deposez un fichier DPGF
          </p>
          <p className="text-[10px] text-[var(--slate-400)]">CSV, XLSX ou XLS</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
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
      {fileError ? <p className="text-xs text-[var(--error)]">{fileError}</p> : null}
    </div>
  );
}

function PhaseOverlay({ phase }: { phase: DialogPhase }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
      <p className="text-sm font-medium text-[var(--slate-700)]">
        {PHASE_MESSAGES[phase]}
      </p>
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-[var(--slate-200)]">
        <div
          className="h-full rounded-full bg-[var(--brand-blue)]"
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
      setServerError("Le fichier n'a pas pu etre analyse.");
    }
  }, [imports, phase]);

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
      setServerError("Import introuvable apres l'upload. Veuillez reessayer.");
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
        `Le format .${ext ?? "inconnu"} n'est pas supporte. Utilisez CSV, XLSX ou XLS.`
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

  async function handleParsingComplete(importId: string) {
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
        await finalizeImport(importId, suggestions);
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
        error instanceof Error ? error.message : "Erreur lors de la creation."
      );
    }
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
              "Cet import n'est pas pret pour la creation rapide. Finalisez le mapping puis reessayez."
            );
            return;
          }
        }

        await finalizeImport(selectedImportId!);
      } catch (error) {
        setServerError(
          error instanceof Error
            ? error.message
            : "Impossible de creer l'affaire."
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

    setServerError("Selectionnez un import existant ou deposez un fichier DPGF.");
  }

  return (
    <section className="dashboard-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Demarrer depuis un DPGF ou un import existant
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Parcours expert pour amorcer directement la structure du devis.
          </p>
        </div>
      </div>

      {phase !== "idle" ? (
        <PhaseOverlay phase={phase} />
      ) : (
        <div className="mt-5 space-y-4">
          <details open className="rounded-lg border border-[var(--slate-200)] p-3">
            <summary className="cursor-pointer text-sm font-medium text-[var(--slate-700)]">
              Import DPGF
            </summary>

            <div className="mt-3 space-y-3">
              <div className="flex gap-0.5 rounded-lg bg-[var(--slate-100)] p-0.5">
                <button
                  type="button"
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    importTab === "upload"
                      ? "bg-white text-[var(--slate-800)] shadow-sm"
                      : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
                  }`}
                  onClick={() => setImportTab("upload")}
                >
                  Nouveau fichier
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    importTab === "existing"
                      ? "bg-white text-[var(--slate-800)] shadow-sm"
                      : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
                  }`}
                  onClick={() => setImportTab("existing")}
                >
                  Import existant
                </button>
              </div>

              {importTab === "existing" ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="affaire-bootstrap-import-select"
                      className="block text-xs font-semibold text-[var(--slate-700)]"
                    >
                      Import disponible
                    </label>
                    {isLoadingImports ? (
                      <p className="text-xs text-[var(--slate-500)]">Chargement...</p>
                    ) : expertImports.length === 0 ? (
                      <p className="text-xs text-[var(--slate-500)]">
                        Aucun import termine et mappe disponible.
                      </p>
                    ) : (
                      <select
                        id="affaire-bootstrap-import-select"
                        className="form-input form-select text-sm"
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
                      </select>
                    )}
                  </div>

                  {selectedImportId ? (
                    <>
                      <Input
                        label="Titre de la version"
                        placeholder="V1 (optionnel)"
                        value={versionTitle}
                        onChange={(event) => setVersionTitle(event.target.value)}
                      />
                      <Input
                        label="Titre de la section"
                        placeholder="Section principale (optionnel)"
                        value={sectionTitle}
                        onChange={(event) => setSectionTitle(event.target.value)}
                      />
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

          {serverError ? (
            <div role="alert" className="alert alert-error text-sm">
              {serverError}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={isBusy}
              loading={isBusy}
            >
              Lancer le flux expert
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
