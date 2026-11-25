"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { driveFileUrl, isDrivePdfExport, type DriveFile } from "@/lib/affaires/google-drive/contracts";
import { IntakePdfPreview } from "./IntakePdfPreview";

export async function fetchGoogleDriveFile(endpoint: string, signal?: AbortSignal) {
  const response = await fetch(endpoint, { cache: "no-store", signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? "Impossible de lire le fichier Google Drive.");
  }
  const encodedName = response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const blob = await response.blob();
  return { blob, name: encodedName ? decodeURIComponent(encodedName) : "document" };
}

export function GoogleDriveFilePreview({ file, endpoint, close }: {
  file: DriveFile;
  endpoint: string;
  close: () => void;
}) {
  const [preview, setPreview] = useState<{ url: string; type: string; name: string }>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    void fetchGoogleDriveFile(endpoint, abort.signal)
      .then(({ blob, name }) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, type: blob.type, name });
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Aperçu indisponible.");
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint]);

  let content;
  if (error) content = <p role="alert" className="p-4 text-sm text-warning">{error}</p>;
  else if (!preview) content = <p role="status" className="p-4 text-sm">Lecture du document…</p>;
  else if (preview.type === "application/pdf") content = <IntakePdfPreview url={preview.url} name={preview.name} />;
  else if (preview.type.startsWith("image/")) {
    // Private object URLs are read directly by the browser.
    // eslint-disable-next-line @next/next/no-img-element
    content = <img src={preview.url} alt={preview.name} className="mx-auto max-h-[60vh] max-w-full object-contain" />;
  } else if (preview.type.startsWith("text/plain")) {
    content = <iframe src={preview.url} title={preview.name} sandbox="" className="h-[55vh] w-full" />;
  } else {
    content = <p className="p-4 text-sm">Le format actuel du fichier est disponible en téléchargement.</p>;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-all">{file.name}</DialogTitle>
          <DialogDescription>{isDrivePdfExport(file) ? "Aperçu PDF du document Google." : "Aperçu du fichier Google Drive."}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-24 flex-col overflow-auto">{content}</div>
        <DialogFooter>
          <a className="btn btn-secondary" href={driveFileUrl(file.id)} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Ouvrir dans Drive
          </a>
          {preview && <a className="btn btn-primary" href={preview.url} download={preview.name}>
            <Download size={16} aria-hidden="true" /> {preview.type === "application/pdf" && isDrivePdfExport(file) ? "Télécharger le PDF" : "Télécharger"}
          </a>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
