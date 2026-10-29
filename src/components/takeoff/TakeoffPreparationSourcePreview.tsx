"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import { useState } from "react";

import { getTakeoffPreparationSourcePreviewAction } from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import { buttonVariants } from "@/components/ui/button";

export function TakeoffPreparationSourcePreview({ projectId, documentId, name, page, localPreviewUrl }: {
  projectId: string;
  documentId: string;
  name: string;
  page?: number | null;
  localPreviewUrl?: string | null;
}) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function openPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(localPreviewUrl ? { url: `${localPreviewUrl}${page ? `#page=${page}` : ""}`, name } : unwrapTakeoffActionResult(await getTakeoffPreparationSourcePreviewAction({ projectId, documentId, ...(page ? { page } : {}) })));
    } catch (cause) { setError(cause instanceof TakeoffActionError ? cause.message : "L'aperçu n'est pas disponible. Les réponses sont conservées."); }
    finally { setBusy(false); }
  }
  if (documentId.startsWith("upload:") && !localPreviewUrl) return null;
  return <div className="space-y-2">
    <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} disabled={busy} onClick={() => void openPreview()}>{busy ? "Ouverture de la source…" : `Voir ${name}${page ? ` — page ${page}` : ""}`}</button>
    {error && <p role="status" className="text-xs text-warning">{error}</p>}
    {preview && <div className="space-y-2 rounded-lg border border-border bg-surface p-2">
      <div className="flex items-center justify-between gap-2 text-xs"><a href={preview.url} target="_blank" rel="noreferrer" className="text-primary underline">Ouvrir {preview.name}{page ? ` — page ${page}` : ""} dans un onglet</a><button type="button" className="text-muted-foreground underline" onClick={() => setPreview(null)}>Fermer l&apos;aperçu</button></div>
      <iframe src={preview.url} title={`Aperçu de ${preview.name}${page ? `, page ${page}` : ""}`} className="h-80 w-full rounded border-0" />
      <p className="text-xs text-muted-foreground">L&apos;aperçu permet de vérifier la source ; il ne constitue pas une mesure validée.</p>
    </div>}
  </div>;
}
