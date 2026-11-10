"use client";

import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { quantityConfidence } from "@/lib/takeoff/quantity-review-policy";

const LABELS = { high: "Élevée", medium: "Moyenne", low: "Faible" } as const;

export function ConfidenceHeader({ globalConfidence, items }: { globalConfidence: number | null; items: ReviewItem[] }) {
  const included = items.filter(item => !item.is_excluded);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const item of included) {
    const reasons = (item.rule_results ?? []).filter(rule => rule.status === "fail").map(rule => rule.reason);
    counts[quantityConfidence(item.confidence, reasons)] += 1;
  }
  const global = quantityConfidence(globalConfidence, []);
  return <section role="region" aria-label="Indicateurs de confiance du métré"
    className="space-y-3 rounded-lg border border-border bg-surface px-5 py-4 text-sm">
    <h2 className="font-semibold">Confiance globale : {LABELS[global]}</h2>
    <p className="text-muted-foreground">Niveau estimé à partir de la lecture et des anomalies. Il ne représente pas un taux de justesse mesuré.</p>
    <dl className="flex flex-wrap gap-6">{(["high", "medium", "low"] as const).map(level =>
      <div key={level}><dt>{LABELS[level]}</dt><dd className="font-semibold tabular-nums">{counts[level]} ligne(s)</dd></div>)}</dl>
    <p>Contrôlez en priorité les valeurs clés et les anomalies localisées. Une confiance faible renforce la recommandation, sans imposer la validation de chaque tronçon.</p>
  </section>;
}
