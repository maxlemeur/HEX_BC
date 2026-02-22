"use client";

import type { EstimateStatus } from "@/lib/estimates/client";

type EstimateStatusChipsProps = {
  counts: Record<EstimateStatus, number>;
  selected: EstimateStatus[];
  onChange: (selected: EstimateStatus[]) => void;
};

const CHIPS: { status: EstimateStatus; label: string }[] = [
  { status: "draft", label: "Brouillon" },
  { status: "sent", label: "Envoye" },
  { status: "accepted", label: "Accepte" },
  { status: "archived", label: "Archive" },
];

const CHIP_STYLES: Record<EstimateStatus, { bg: string; color: string; activeBg: string; activeColor: string }> = {
  draft: {
    bg: "var(--slate-100)",
    color: "var(--slate-600)",
    activeBg: "var(--slate-600)",
    activeColor: "#fff",
  },
  sent: {
    bg: "var(--info-light)",
    color: "var(--info)",
    activeBg: "var(--info)",
    activeColor: "#fff",
  },
  accepted: {
    bg: "var(--success-light)",
    color: "#059669",
    activeBg: "#059669",
    activeColor: "#fff",
  },
  archived: {
    bg: "var(--slate-100)",
    color: "var(--slate-500)",
    activeBg: "var(--slate-500)",
    activeColor: "#fff",
  },
};

export function EstimateStatusChips({ counts, selected, onChange }: EstimateStatusChipsProps) {
  const toggle = (status: EstimateStatus) => {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status));
    } else {
      onChange([...selected, status]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
      {CHIPS.map(({ status, label }) => {
        const isActive = selected.includes(status);
        const styles = CHIP_STYLES[status];
        const count = counts[status] ?? 0;

        return (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
            style={{
              background: isActive ? styles.activeBg : styles.bg,
              color: isActive ? styles.activeColor : styles.color,
            }}
            aria-pressed={isActive}
          >
            {label}
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
              style={{
                background: isActive ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.08)",
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
