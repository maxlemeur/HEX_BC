"use client";

import { startTransition, useCallback, useEffect, useId, useRef, useState } from "react";

import { listResumableGeneratedOuvrageDrafts } from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { GeneratedOuvrageDraftPage } from "@/lib/estimates/generated-ouvrages";

const SOURCE_LABELS = {
  free_text: "Texte libre",
  cctp_excerpt: "Extrait CCTP",
  internal_note: "Note interne",
} as const;
const SUMMARY_KEYS = [
  "totalCandidates", "certainCount", "plausibleCount", "questionCount",
  "pendingCount", "insertedCount", "rejectedCount",
] as const;
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

function isDraftPage(value: unknown, versionId: string): value is GeneratedOuvrageDraftPage {
  if (!value || typeof value !== "object") return false;
  const page = value as GeneratedOuvrageDraftPage;
  if (
    page.versionId !== versionId || !Array.isArray(page.items) || page.items.length > 20 ||
    !(page.nextCursor === null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0)) ||
    (page.nextCursor !== null && page.items.length !== 20)
  ) return false;
  const ids = new Set<string>();
  return page.items.every((item) => {
    if (
      !item || typeof item !== "object" || typeof item.draftId !== "string" ||
      !item.draftId || ids.has(item.draftId) || typeof item.createdAt !== "string" ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      !Object.hasOwn(SOURCE_LABELS, item.sourceKind) ||
      (item.status !== "pending" && item.status !== "partially_applied") ||
      !item.summary || typeof item.summary !== "object"
    ) return false;
    ids.add(item.draftId);
    const summary = item.summary;
    return SUMMARY_KEYS.every((key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0) &&
      summary.totalCandidates <= 12 &&
      summary.certainCount + summary.plausibleCount + summary.questionCount === summary.totalCandidates &&
      summary.pendingCount + summary.insertedCount + summary.rejectedCount === summary.totalCandidates;
  });
}

type GeneratedOuvrageDraftPickerProps = {
  versionId: string;
  disabled: boolean;
  resumingDraftId: string | null;
  resumeError: { draftId: string; message: string } | null;
  onResume: (draftId: string) => void;
};

export function GeneratedOuvrageDraftPicker(props: GeneratedOuvrageDraftPickerProps) {
  return <GeneratedOuvrageDraftPickerSession key={props.versionId} {...props} />;
}

function GeneratedOuvrageDraftPickerSession({
  versionId, disabled, resumingDraftId, resumeError, onResume,
}: GeneratedOuvrageDraftPickerProps) {
  const headingId = useId();
  const requestRef = useRef(0);
  const itemsRef = useRef<GeneratedOuvrageDraftPage["items"]>([]);
  const [page, setPage] = useState<{
    items: GeneratedOuvrageDraftPage["items"];
    nextCursor: string | null;
    requestedCursor: string | null;
    status: "loading" | "ready" | "error";
    error: string | null;
  }>({ items: [], nextCursor: null, requestedCursor: null, status: "loading", error: null });

  const loadPage = useCallback(async (cursor: string | null) => {
    const requestId = ++requestRef.current;
    setPage((previous) => ({ ...previous, status: "loading", error: null, requestedCursor: cursor }));
    try {
      const result = await listResumableGeneratedOuvrageDrafts({
        versionId,
        ...(cursor ? { cursor } : {}),
      });
      if (requestRef.current !== requestId) return;
      if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
        throw new Error("La liste reçue est invalide. Réessayez.");
      }
      if (!result.ok) throw new Error(result.error.message);
      if (!isDraftPage(result.data, versionId) || (cursor && result.data.nextCursor === cursor)) {
        throw new Error("La liste reçue est invalide. Réessayez.");
      }
      const existing = cursor ? itemsRef.current : [];
      const existingIds = new Set(existing.map((item) => item.draftId));
      if (result.data.items.some((item) => existingIds.has(item.draftId))) {
        throw new Error("La liste a changé. Actualisez-la pour reprendre un brouillon.");
      }
      const items = [...existing, ...result.data.items];
      itemsRef.current = items;
      setPage({ items, nextCursor: result.data.nextCursor, requestedCursor: cursor, status: "ready", error: null });
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setPage((previous) => ({
        ...previous,
        status: "error",
        error: error instanceof Error ? error.message : "Impossible de charger les brouillons.",
      }));
    }
  }, [versionId]);

  useEffect(() => {
    startTransition(() => { void loadPage(null); });
    return () => { requestRef.current += 1; };
  }, [loadPage]);

  const requestPage = (cursor: string | null) => {
    startTransition(() => { void loadPage(cursor); });
  };
  const busy = disabled || resumingDraftId !== null;

  return (
    <section aria-labelledby={headingId} className="mb-5 space-y-3 border-b border-border pb-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="text-sm font-semibold">Reprendre un brouillon</h3>
        <Button type="button" variant="ghost" size="sm" disabled={busy || page.status === "loading"} onClick={() => requestPage(null)}>
          Actualiser la liste
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Retrouvez vos propositions sauvegardées pour ce devis.</p>
      {page.status === "loading" ? <p role="status" className="text-sm text-muted-foreground">Chargement des brouillons…</p> : null}
      {page.status === "error" ? (
        <Alert variant="danger">
          <p>Impossible de charger les brouillons. {page.error}</p>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => requestPage(page.requestedCursor)}>Réessayer</Button>
        </Alert>
      ) : null}
      {page.status === "ready" && page.items.length === 0 ? <p className="text-sm text-muted-foreground">Aucun brouillon à reprendre.</p> : null}
      {resumeError ? (
        <Alert variant="danger">
          <p>Impossible de reprendre ce brouillon. {resumeError.message}</p>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onResume(resumeError.draftId)}>Réessayer la reprise</Button>
        </Alert>
      ) : null}
      {page.items.length > 0 ? (
        <ul aria-label="Brouillons à reprendre" className="divide-y divide-border rounded-lg border border-border">
          {page.items.map((item) => {
            const date = dateFormatter.format(new Date(item.createdAt));
            return (
              <li key={item.draftId} data-testid={`generated-ouvrage-draft-${item.draftId}`} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium">{SOURCE_LABELS[item.sourceKind]} · {date}</p>
                  <p className="text-muted-foreground">{item.summary.pendingCount === 0 ? "Aucune proposition disponible" : `${item.summary.pendingCount} proposition${item.summary.pendingCount > 1 ? "s" : ""} à traiter`} · {item.summary.insertedCount} déjà insérée{item.summary.insertedCount > 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground">{item.status === "partially_applied" ? "Partiellement inséré" : "En attente"}</p>
                </div>
                <Button type="button" variant="secondary" size="sm" disabled={busy || page.status === "loading" || item.summary.pendingCount === 0} onClick={() => onResume(item.draftId)}>
                  {resumingDraftId === item.draftId ? "Reprise…" : "Reprendre"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {page.status === "ready" && page.nextCursor !== null ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => requestPage(page.nextCursor)}>Charger la suite</Button>
      ) : null}
      {page.status === "ready" && page.nextCursor === null && page.items.length > 0 ? <p className="text-xs text-muted-foreground">Tous les brouillons disponibles sont affichés.</p> : null}
    </section>
  );
}
