import type { StickySummaryCounts } from "@/lib/estimates/estimate-structure-draft";

type StickySummaryBarProps = {
  counts: StickySummaryCounts;
};

export function StickySummaryBar({ counts }: StickySummaryBarProps) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-5 mb-4 border-b border-[var(--slate-200)] bg-white/95 px-6 py-3 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="font-medium text-[var(--slate-700)]">
          {counts.selectedLots} lot(s)
        </span>
        <span className="text-emerald-700">{counts.createCount} creation(s)</span>
        <span className="text-amber-700">{counts.mergeCount} fusion(s)</span>
        <span className="text-slate-500">{counts.skipCount} ignore(s)</span>
        {counts.lowConfidenceCount > 0 && (
          <span className="text-rose-600">
            {counts.lowConfidenceCount} confiance faible
          </span>
        )}
        {counts.duplicateCount > 0 && (
          <span className="text-violet-600">{counts.duplicateCount} doublon(s)</span>
        )}
      </div>
    </div>
  );
}
