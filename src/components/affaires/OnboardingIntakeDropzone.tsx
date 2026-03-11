"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";
import { AffaireFileDropSurface } from "./AffaireFileDropSurface";

type FileResult = {
  documentId: string;
  fileName: string;
  status: "uploaded" | "rejected";
  rejectionReason: string | null;
};

type EnsureDraftResult = {
  projectId: string;
  versionId: string;
  redirectTo: string;
};

type OnboardingIntakeDropzoneProps = {
  ensureDraft: () => Promise<EnsureDraftResult>;
  onMissingProjectName: () => void;
};

type DropzoneState =
  | { phase: "idle" }
  | { phase: "uploading"; fileCount: number }
  | { phase: "error"; message: string }
  | { phase: "done"; results: FileResult[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFileResult(value: unknown): FileResult | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.documentId !== "string" ||
    typeof value.fileName !== "string" ||
    (value.status !== "uploaded" && value.status !== "rejected")
  ) {
    return null;
  }

  return {
    documentId: value.documentId,
    fileName: value.fileName,
    status: value.status,
    rejectionReason:
      typeof value.rejectionReason === "string" ? value.rejectionReason : null,
  };
}

function extractUploadResponseData(payload: unknown): {
  uploadId: string;
  files: FileResult[];
} | null {
  const candidate =
    isRecord(payload) && payload.ok === true && isRecord(payload.data)
      ? payload.data
      : payload;

  if (!isRecord(candidate) || typeof candidate.uploadId !== "string") {
    return null;
  }

  if (!Array.isArray(candidate.files)) {
    return null;
  }

  const files = candidate.files
    .map(normalizeFileResult)
    .filter((file): file is FileResult => file !== null);

  if (files.length !== candidate.files.length) {
    return null;
  }

  return {
    uploadId: candidate.uploadId,
    files,
  };
}

function extractUploadErrorMessage(payload: unknown, status: number) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }

    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }

  return `Erreur serveur (${status})`;
}

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (
    !AFFAIRE_INTAKE_ALLOWED_EXTENSIONS.includes(
      ext as (typeof AFFAIRE_INTAKE_ALLOWED_EXTENSIONS)[number]
    )
  ) {
    return `"${file.name}" : extension .${ext} non supportee.`;
  }
  if (file.size <= 0) {
    return `"${file.name}" est vide.`;
  }
  if (file.size > AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES) {
    return `"${file.name}" depasse ${AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}

export function OnboardingIntakeDropzone({
  ensureDraft,
  onMissingProjectName,
}: Readonly<OnboardingIntakeDropzoneProps>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [clientErrors, setClientErrors] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [state, setState] = useState<DropzoneState>({ phase: "idle" });

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const errors: string[] = [];
      const validFiles: File[] = [];

      for (const file of files) {
        const error = validateFile(file);
        if (error) {
          errors.push(error);
        } else {
          validFiles.push(file);
        }
      }

      setClientErrors(errors);

      if (validFiles.length === 0) {
        setAnnouncement(
          `${errors.length} fichier${errors.length > 1 ? "s" : ""} rejete${
            errors.length > 1 ? "s" : ""
          } localement.`
        );
        return;
      }

      setState({ phase: "uploading", fileCount: validFiles.length });
      setAnnouncement(
        `Upload de ${validFiles.length} fichier${validFiles.length > 1 ? "s" : ""} en cours...`
      );

      let draft: EnsureDraftResult;
      try {
        draft = await ensureDraft();
      } catch (error) {
        setState({ phase: "idle" });
        setAnnouncement("");
        if (error instanceof Error && error.message === "Nom projet requis.") {
          onMissingProjectName();
          return;
        }

        setState({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de creer l'affaire avant l'upload.",
        });
        return;
      }

      const formData = new FormData();
      for (const file of validFiles) {
        formData.append("files", file);
      }

      try {
        const response = await fetch(`/api/affaires/${draft.projectId}/intake/files`, {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setState({
            phase: "error",
            message: extractUploadErrorMessage(payload, response.status),
          });
          return;
        }

        const data = extractUploadResponseData(payload);
        if (!data) {
          setState({
            phase: "error",
            message: "Reponse upload invalide.",
          });
          return;
        }

        setState({ phase: "done", results: data.files });
        router.push(`${draft.redirectTo}#intake`);
        router.refresh();
      } catch {
        setState({
          phase: "error",
          message: "Erreur reseau. Verifiez votre connexion.",
        });
      }
    },
    [ensureDraft, onMissingProjectName, router]
  );

  return (
    <div className="space-y-3">
      <AffaireFileDropSurface
        inputId="affaire-onboarding-intake"
        inputRef={inputRef}
        onFilesSelected={(files) => {
          void handleFiles(files);
        }}
        uploadingFileCount={state.phase === "uploading" ? state.fileCount : null}
      />

      {clientErrors.length > 0 ? (
        <ul className="space-y-1" role="alert">
          {clientErrors.map((error, index) => (
            <li key={`${error}-${index}`} className="text-xs font-medium text-danger">
              {error}
            </li>
          ))}
        </ul>
      ) : null}

      {state.phase === "error" ? (
        <div
          className="rounded-lg border border-danger/20 bg-error-light px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {state.message}
        </div>
      ) : null}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
