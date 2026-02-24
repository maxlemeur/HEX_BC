"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import {
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import {
  createTakeoffJob,
  isTakeoffApiError,
} from "@/lib/takeoff/client";

const TAKEOFF_ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];
const TAKEOFF_ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const TAKEOFF_ACCEPT_ATTRIBUTE = [
  ".csv",
  ".xlsx",
  ".xls",
  ...TAKEOFF_ALLOWED_MIME_TYPES,
].join(",");

type SubmitState = "idle" | "loading" | "success" | "error";

type TakeoffUploadFormProps = {
  versionId: string;
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} Ko`;
  }

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

function resolveApiErrorMessage(error: unknown) {
  if (!isTakeoffApiError(error)) {
    return "Une erreur inattendue est survenue pendant le lancement.";
  }

  if (error.status === 400) {
    return "Requete invalide. Verifiez le fichier puis recommencez.";
  }

  if (error.status === 403) {
    return "Acces refuse. Le module Takeoff est peut-etre desactive pour ce tenant.";
  }

  if (error.status === 409) {
    return "Conflit detecte: ce job existe deja ou la cle d'idempotence est deja utilisee.";
  }

  if (error.status === 413) {
    return `Le fichier depasse ${MAX_FILE_SIZE_LABEL}.`;
  }

  if (error.status === 422) {
    return "Le fichier ou le niveau transmis est invalide.";
  }

  if (error.status === 0) {
    return "Erreur reseau pendant l'envoi du fichier.";
  }

  return error.message || "Impossible de lancer l'extraction.";
}

function validateTakeoffFile(file: File | null): string | null {
  if (!file) {
    return "Aucun fichier selectionne.";
  }

  const validation = validateFileForUpload(file, {
    allowedExtensions: TAKEOFF_ALLOWED_EXTENSIONS,
    allowedMimeTypes: TAKEOFF_ALLOWED_MIME_TYPES,
    allowEmptyMimeType: false,
  });

  if (validation.valid) {
    return null;
  }

  return validation.error;
}

export function TakeoffUploadForm({ versionId }: TakeoffUploadFormProps) {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const canSubmit = submitState !== "loading" && selectedFile !== null;

  const buttonLabel = (() => {
    if (submitState === "loading") {
      return `Envoi en cours (${uploadProgress}%)`;
    }

    if (submitState === "success") {
      return "Extraction lancee";
    }

    if (submitState === "error") {
      return "Reessayer l'extraction";
    }

    return "Lancer l'extraction";
  })();

  function resetTransientState() {
    setSubmitState("idle");
    setUploadProgress(0);
    setErrorMessage(null);
  }

  function handleFileSelection(file: File | null) {
    resetTransientState();

    const validationMessage = validateTakeoffFile(file);
    if (validationMessage) {
      setSelectedFile(null);
      setErrorMessage(validationMessage);
      setAnnouncement(validationMessage);
      return;
    }

    setSelectedFile(file);
    setAnnouncement(file ? `Fichier ${file.name} selectionne.` : "");
  }

  function openFilePicker() {
    if (submitState === "loading") return;
    fileInputRef.current?.click();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationMessage = validateTakeoffFile(selectedFile);
    if (validationMessage) {
      setSubmitState("error");
      setErrorMessage(validationMessage);
      setAnnouncement(validationMessage);
      return;
    }

    if (!selectedFile) {
      setSubmitState("error");
      setErrorMessage("Aucun fichier selectionne.");
      return;
    }

    setSubmitState("loading");
    setUploadProgress(0);
    setErrorMessage(null);
    setAnnouncement("Envoi du fichier en cours.");

    const idempotencyKey = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${selectedFile.name}`;

    try {
      const job = await createTakeoffJob({
        estimateVersionId: versionId,
        level: "A",
        file: selectedFile,
        idempotencyKey,
        onUploadProgress: (progress) => setUploadProgress(progress),
      });

      setSubmitState("success");
      setUploadProgress(100);
      setAnnouncement("Job takeoff cree avec succes. Redirection en cours.");
      router.push(`/dashboard/estimates/${versionId}/takeoff/${job.id}`);
    } catch (error) {
      const message = resolveApiErrorMessage(error);
      setSubmitState("error");
      setErrorMessage(message);
      setAnnouncement(message);
    }
  }

  return (
    <section className="dashboard-card p-6 sm:p-8">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">
          Nouveau job Takeoff
        </h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Importez un fichier metrage pour lancer une extraction Niveau A.
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept={TAKEOFF_ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            handleFileSelection(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
          disabled={submitState === "loading"}
          aria-describedby={errorMessage ? "takeoff-upload-error" : undefined}
        />

        <div>
          <label htmlFor={fileInputId} className="form-label">
            Fichier takeoff
          </label>
          <div
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragActive
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
            }`}
            role="button"
            tabIndex={submitState === "loading" ? -1 : 0}
            aria-label="Zone de depot takeoff. Glissez un fichier ou appuyez pour selectionner."
            aria-disabled={submitState === "loading"}
            onClick={openFilePicker}
            onKeyDown={(event) => {
              if (submitState === "loading") return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
              if (submitState === "loading") return;
              handleFileSelection(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p className="text-sm font-medium text-[var(--slate-700)]">
              {dragActive
                ? "Deposez le fichier ici"
                : "Glissez-deposez un fichier ou cliquez pour parcourir"}
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Formats supportes: CSV, XLSX, XLS - Max {MAX_FILE_SIZE_LABEL}
            </p>
          </div>
        </div>

        {selectedFile ? (
          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
            <h3 className="text-sm font-semibold text-[var(--slate-700)]">
              Recap fichier
            </h3>
            <dl className="mt-2 grid gap-2 text-sm text-[var(--slate-600)] sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                  Nom
                </dt>
                <dd className="mt-1 break-all">{selectedFile.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                  Taille
                </dt>
                <dd className="mt-1">{formatFileSize(selectedFile.size)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                  Type
                </dt>
                <dd className="mt-1">{selectedFile.type || "Type MIME inconnu"}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <fieldset>
          <legend className="form-label mb-2">Niveau d&apos;extraction</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 px-3 py-2">
              <input type="radio" name="takeoff-level" checked readOnly />
              <span className="text-sm font-medium text-[var(--slate-800)]">
                Niveau A
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-100)] px-3 py-2 opacity-70">
              <input type="radio" name="takeoff-level" disabled />
              <span className="text-sm text-[var(--slate-600)]">
                Niveau B (bientot)
              </span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-100)] px-3 py-2 opacity-70">
              <input type="radio" name="takeoff-level" disabled />
              <span className="text-sm text-[var(--slate-600)]">
                Niveau C (bientot)
              </span>
            </label>
          </div>
        </fieldset>

        {(submitState === "loading" || uploadProgress > 0) && (
          <div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]"
              aria-label={`Progression upload ${uploadProgress}%`}
            >
              <div
                className="h-full rounded-full bg-[var(--brand-blue)] transition-all duration-200"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Upload: {uploadProgress}%
            </p>
          </div>
        )}

        {errorMessage ? (
          <div
            id="takeoff-upload-error"
            className="alert alert-error"
            role="alert"
            aria-live="assertive"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {submitState === "loading" ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {buttonLabel}
              </>
            ) : (
              buttonLabel
            )}
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
