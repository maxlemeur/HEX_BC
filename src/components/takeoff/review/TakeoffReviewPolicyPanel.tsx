"use client";

import { useEffect, useMemo, useState } from "react";
import { takeoffPreparationSchema } from "@/lib/takeoff/preparation";
import { takeoffScopeCoverage } from "@/lib/takeoff/scope-coverage";
import { quantitySourceComparison } from "@/lib/takeoff/quantity-review-policy";
import { takeoffReviewContextResponseSchema, type TakeoffReviewContext } from "@/lib/takeoff/review-context-contracts";
import type { TakeoffJobItem } from "@/lib/takeoff/types";
import { Button } from "@/components/ui/button";

const money = (value: number | null) => value === null ? "Montant inconnu" :
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value / 100);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function TakeoffReviewPolicyPanel({ jobId, items, providerMeta, onImportantItems, onFocusItem }: {
  jobId: string; items: TakeoffJobItem[]; providerMeta: Record<string, unknown> | null;
  onImportantItems: (ids: string[]) => void; onFocusItem: (id: string) => void;
}) {
  const [context, setContext] = useState<TakeoffReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = items.map(item => item.updated_at).join("|");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/review-context`, { signal: controller.signal, credentials: "same-origin" })
      .then(async response => {
        const envelope = await response.json() as { ok: boolean; data?: unknown };
        if (!response.ok || !envelope.ok) throw new Error("Montants de contrôle indisponibles.");
        const next = takeoffReviewContextResponseSchema.parse(envelope.data);
        setContext(next);
        setError(null);
        onImportantItems(next.posts.filter(post => post.recommend_review !== false || (post.impact_cents ?? 0) > 0).flatMap(post => post.item_ids));
      }).catch(() => { if (!controller.signal.aborted) setError("Montants de contrôle indisponibles : le risque financier reste à apprécier."); });
    return () => controller.abort();
  }, [jobId, revision, onImportantItems]);
  const coverage = useMemo(() => {
    const parsed = takeoffPreparationSchema.safeParse(record(record(providerMeta).preparation_snapshot).preparation);
    return takeoffScopeCoverage(parsed.success ? parsed.data : null, items);
  }, [items, providerMeta]);
  const highlighted = context?.posts.filter(post => post.recommend_review !== false || (post.impact_cents ?? 0) > 0) ?? [];
  const sourceGaps = [...new Map(items.filter(item => !item.is_excluded).flatMap(item => {
    const comparison = quantitySourceComparison(item.metadata);
    return comparison?.delta ? [[comparison.group, { item, comparison }] as const] : [];
  })).values()];
  return <section aria-label="Contrôle ciblé et couverture" className="max-h-56 min-w-0 shrink-0 space-y-3 overflow-y-auto break-words border-b border-border bg-surface px-4 py-3 text-sm">
    <p>Contrôle recommandé dès 1 000 € HT ou 1 % du lot. Une anomalie reste signalée sous ce seuil. Vous pouvez poursuivre malgré les avertissements de quantité.</p>
    {error ? <p role="status" className="text-warning">{error}</p> : null}
    {context?.unlinked_item_ids.length ? <p className="text-warning">{context.unlinked_item_ids.length} élément(s) sans rattachement chiffré : enjeu financier inconnu, contrôle recommandé.</p> : null}
    {sourceGaps.length ? <ul aria-label="Écarts entre les lectures" className="space-y-2">{sourceGaps.map(({ item, comparison }) =>
      <li key={comparison.group}>
        <strong>Écart de lecture : {item.designation}</strong> · vectoriel {comparison.vector} {comparison.unit},
        ChatGPT {comparison.model} {comparison.unit} · écart {Math.abs(comparison.delta)} {comparison.unit}.
        <span> {item.source_file_name}, page {item.source_page}. Contrôle recommandé.</span>
        <Button size="xs" variant="ghost" onClick={() => onFocusItem(item.id)}>Voir sur le plan</Button>
      </li>)}</ul> : null}
    {highlighted.length ? <ul aria-label="Postes à contrôler" className="flex flex-wrap gap-2">
      {highlighted.map(post => <li key={post.line_id} className="rounded border border-border p-2">
        <span className="font-medium">{post.title}</span> · {money(post.amount_cents)} HT
        {post.impact_cents !== null ? <span> · écart estimé : {money(post.impact_cents)} HT</span> : null}
        {post.item_ids[0] ? <Button size="xs" variant="ghost" onClick={() => onFocusItem(post.item_ids[0])}>Voir sur le plan</Button> : null}
      </li>)}
    </ul> : null}
    <details>
      <summary className="cursor-pointer font-medium">Couverture des bâtiments, étages, zones et réseaux</summary>
      {!coverage.known ? <p className="mt-2 text-warning">Périmètre attendu non renseigné : la complétude ne peut pas être établie.</p> :
        <table className="mt-2 w-full text-left"><caption className="sr-only">Comparaison avec le périmètre attendu</caption>
          <thead><tr><th>Périmètre</th><th>État</th><th>Éléments repérés</th></tr></thead>
          <tbody>{coverage.entries.map(entry => <tr key={`${entry.kind}:${entry.label}`}>
            <td>{entry.kind} · {entry.label}</td><td>{entry.status === "not_analysed" ? "Non analysé" : entry.status === "incomplete" ? "Incomplet" : "Analysé — à contrôler"}</td>
            <td>{entry.item_ids.length}</td>
          </tr>)}</tbody>
        </table>}
      <p className="mt-2 text-muted-foreground">Des éléments repérés et des preuves présentes ne garantissent pas à eux seuls l’exhaustivité du métré.</p>
    </details>
    <p className="text-muted-foreground">Longueurs vendues : cumul par ligne de devis, puis arrondi unique au mètre supérieur.</p>
  </section>;
}
