"use client";

import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dossierPreviewFormat,
  type DossierDocument,
} from "@/lib/affaires/document-triage";
import { IntakePdfPreview } from "./IntakePdfPreview";

export function IntakeDocumentPreview({
  projectId,
  document,
}: {
  projectId: string;
  document: DossierDocument;
}) {
  const [resource, setResource] = useState<{
    url: string;
    format: "pdf" | "image" | "text";
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const format = dossierPreviewFormat(document);
  const endpoint = `/api/affaires/${projectId}/intake/files/${document.documentId}/preview`;
  useEffect(() => {
    if (
      !format ||
      document.uploadStatus !== "uploaded" ||
      document.isBeingDeleted
    )
      return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setResource(null);
    setError("");
    void fetch(endpoint, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error?.message ?? "Impossible d’ouvrir ce document.",
          );
        }
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResource({ url: objectUrl, format });
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Aperçu indisponible.",
          );
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    endpoint,
    format,
    document.uploadStatus,
    document.isBeingDeleted,
    attempt,
  ]);

  function canvas(large = false) {
    if (error)
      return (
        <div className="document-preview-empty" role="alert">
          <FileText size={28} />
          <p>{error}</p>
          <button
            className="document-desk-button"
            onClick={() => setAttempt((prior) => prior + 1)}
          >
            <RefreshCw size={14} />
            Réessayer
          </button>
        </div>
      );
    if (
      !format ||
      document.uploadStatus !== "uploaded" ||
      document.isBeingDeleted
    )
      return (
        <div className="document-preview-empty">
          <FileText size={30} />
          <p>
            {document.uploadStatus !== "uploaded"
              ? "Ce fichier n’est pas disponible."
              : "Ouvrez ce format dans son application pour le consulter."}
          </p>
        </div>
      );
    if (!resource)
      return (
        <div className="document-preview-empty" role="status">
          <LoaderCircle className="animate-spin" size={24} />
          <p>Ouverture du document…</p>
        </div>
      );
    if (resource.format === "pdf")
      return <IntakePdfPreview url={resource.url} name={document.fileName} />;
    if (resource.format === "image") {
      // A private object URL is deliberately rendered without the public image optimizer.
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="document-preview-image"
          src={resource.url}
          alt={document.fileName}
        />
      );
    }
    return (
      <iframe
        className={
          large
            ? "document-preview-frame document-preview-frame-large"
            : "document-preview-frame"
        }
        src={resource.url}
        title={`Aperçu de ${document.fileName}`}
        sandbox=""
      />
    );
  }

  return (
    <>
      <div className="document-preview-heading">
        <div>
          <span>Aperçu du document</span>
          <h2 title={document.fileName}>{document.fileName}</h2>
        </div>
        <button
          className="document-desk-icon"
          disabled={!resource}
          aria-label="Agrandir le document"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={17} />
        </button>
      </div>
      <div className="document-preview-canvas">{canvas()}</div>
      <div className="document-preview-footer">
        <p>
          {document.driveSource
            ? "Fichier lié depuis Google Drive"
            : "Fichier déposé dans l’affaire"}
          {document.sizeBytes
            ? ` · ${(document.sizeBytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`
            : ""}
        </p>
        <div>
          {resource && (
            <button
              className="document-desk-button"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 size={14} />
              Agrandir
            </button>
          )}
          {document.uploadStatus === "uploaded" && !document.isBeingDeleted && (
            <a className="document-desk-button" href={`${endpoint}?download=1`}>
              <Download size={14} />
              Télécharger
            </a>
          )}
          {document.driveSource && (
            <a
              className="document-desk-button"
              href={document.driveSource.sourceUrl}
              aria-label={`Ouvrir ${document.fileName} dans Google Drive`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
              Ouvrir dans Drive
            </a>
          )}
        </div>
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent size="xl" className="document-preview-dialog">
          <DialogHeader>
            <DialogTitle className="break-all">{document.fileName}</DialogTitle>
            <DialogDescription>
              Aperçu de la pièce du dossier.
            </DialogDescription>
          </DialogHeader>
          {canvas(true)}
        </DialogContent>
      </Dialog>
    </>
  );
}
