"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";

import { dossierDocumentState, type DossierDocument } from "@/lib/affaires/document-triage";

export type IntakeUploadResult = {
  documentId: string;
  fileName: string;
  status: "uploaded" | "rejected";
  rejectionReason: string | null;
};

export type IntakeUploadEvent =
  | { type: "started"; batchId: string; fileNames: string[]; rejectedFiles: { fileName: string; message: string }[] }
  | { type: "completed"; batchId: string; files: IntakeUploadResult[] }
  | { type: "failed"; batchId: string; message: string };

type UploadEntry = {
  key: string;
  projectId: string;
  batchId: string;
  fileName: string;
  phase: "uploading" | "integrating" | "failed";
  documentId?: string;
  message?: string;
};

const EMPTY_DOCUMENTS: DossierDocument[] = [];

export function useIntakeUploadFeedback(projectId: string, documents = EMPTY_DOCUMENTS) {
  const router = useRouter();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const integrated = new Set(documents.filter((document) => document.uploadStatus === "uploaded" && dossierDocumentState(document) !== "processing").map((document) => document.documentId));
  const files = entries.filter((entry) => entry.projectId === projectId && !(entry.phase === "integrating" && entry.documentId && integrated.has(entry.documentId))).map((entry) => ({ ...entry,
    label: entry.phase === "uploading" ? "Chargement en cours…" : entry.phase === "failed" ? entry.message ?? "Ajout impossible. Réessayez."
      : documents.some((document) => document.documentId === entry.documentId) ? "Analyse en cours…" : "Intégration au dossier…",
  }));
  const awaitingIntegration = files.some((entry) => entry.phase === "integrating");

  const onUploadEvent = useCallback((event: IntakeUploadEvent) => {
    setEntries((prior) => {
      if (event.type === "started") return [...prior, ...event.fileNames.map((fileName, index): UploadEntry => ({
        key: `${event.batchId}:${index}`, projectId, batchId: event.batchId, fileName, phase: "uploading",
      })), ...event.rejectedFiles.map((file, index): UploadEntry => ({
        key: `${event.batchId}:rejected:${index}`, projectId, batchId: `${event.batchId}:rejected`, fileName: file.fileName, phase: "failed", message: file.message,
      }))];
      if (event.type === "failed") return prior.map((entry) => entry.batchId === event.batchId ? { ...entry, phase: "failed", message: event.message } : entry);
      return [...prior.filter((entry) => entry.batchId !== event.batchId), ...event.files.map((file, index): UploadEntry => ({
        key: `${event.batchId}:${index}`, projectId, batchId: event.batchId, fileName: file.fileName, documentId: file.documentId,
        phase: file.status === "uploaded" ? "integrating" : "failed", message: file.rejectionReason ?? undefined,
      }))];
    });
  }, [projectId]);

  useEffect(() => {
    // Retire by server identity, so another file with the same name cannot finish an upload.
    const completed = new Set(documents.filter((document) => document.uploadStatus === "uploaded" && dossierDocumentState(document) !== "processing").map((document) => document.documentId));
    setEntries((prior) => {
      const next = prior.filter((entry) => !(entry.projectId === projectId && entry.phase === "integrating" && entry.documentId && completed.has(entry.documentId)));
      return next.length === prior.length ? prior : next;
    });
  }, [documents, entries, projectId]);

  // One refresh at a time. The router shows nothing new while a refresh is in flight, and a
  // refresh asked before the previous one has landed puts it back in flight: on a fixed
  // two-second rhythm, a server that answers in two seconds or more would never be shown.
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (!awaitingIntegration || refreshing) return;
    const timeout = setTimeout(() => startRefresh(() => router.refresh()), 2000);
    return () => clearTimeout(timeout);
  }, [awaitingIntegration, refreshing, router]);

  const dismissFailure = useCallback((key: string) => setEntries((prior) => prior.filter((entry) => entry.key !== key || entry.phase !== "failed")), []);
  return { files, onUploadEvent, dismissFailure };
}

export type IntakeUploadFeedbackState = ReturnType<typeof useIntakeUploadFeedback>;

export function IntakeUploadFeedback({ feedback }: { feedback: IntakeUploadFeedbackState }) {
  if (feedback.files.length === 0) return null;
  return <div className="mb-4 space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-label="Ajout de documents">
    <p className="text-sm font-medium" role="status">{feedback.files.some((file) => file.phase !== "failed") ? "Ajout des documents au dossier. Vous pouvez continuer à travailler." : "Certains documents n’ont pas pu être ajoutés."}</p>
    {feedback.files.map((file) => <div key={file.key} className="flex items-center gap-2 text-sm" role={file.phase === "failed" ? "alert" : undefined}>
      {file.phase !== "failed" ? <LoaderCircleIcon className="h-4 w-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /> : null}
      <span className="min-w-0 flex-1 break-words">{file.fileName} — {file.label}</span>
      {file.phase === "failed" ? <button type="button" className="text-xs underline" onClick={() => feedback.dismissFailure(file.key)}>Masquer</button> : null}
    </div>)}
  </div>;
}
