"use client";

import { useState, useRef, useEffect } from "react";

export type ProjectIconKey = "building" | "house" | "factory" | "office" | "renovation";

export const PROJECT_ICONS: Record<ProjectIconKey, { label: string; path: string }> = {
  building: {
    label: "Immeuble",
    path: "M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
  },
  house: {
    label: "Maison",
    path: "M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5Z M9 21V13h6v8",
  },
  factory: {
    label: "Industriel",
    path: "M2 20h20V8l-6 4V8l-6 4V4H2v16Z M6 14h2v3H6Z M12 14h2v3h-2Z M18 14h2v3h-2Z",
  },
  office: {
    label: "Bureau",
    path: "M3 21V3h18v18H3Z M7 7h2v2H7Z M7 11h2v2H7Z M7 15h2v2H7Z M11 7h2v2h-2Z M11 11h2v2h-2Z M11 15h2v2h-2Z M15 7h2v2h-2Z M15 11h2v2h-2Z M15 15h2v2h-2Z",
  },
  renovation: {
    label: "Renovation",
    path: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z",
  },
};

export const PROJECT_ICON_KEYS = Object.keys(PROJECT_ICONS) as ProjectIconKey[];

type ProjectIconPickerProps = {
  value: ProjectIconKey;
  onChange: (key: ProjectIconKey) => void;
  size?: number;
};

export function ProjectIconPicker({ value, onChange, size = 44 }: ProjectIconPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative self-stretch" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="group relative flex h-full w-24 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--slate-200)] px-3 py-2 transition-colors hover:border-[var(--brand-blue)] hover:bg-[var(--brand-blue)]/5"
        title="Changer l'icone du projet"
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--slate-400)] transition-colors group-hover:text-[var(--brand-blue)]"
        >
          <path d={PROJECT_ICONS[value].path} />
        </svg>
        <span className="text-[10px] font-medium text-[var(--slate-500)] transition-colors group-hover:text-[var(--brand-blue)]">
          {PROJECT_ICONS[value].label}
        </span>
        {/* Pencil badge */}
        <span className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[var(--slate-200)] text-[var(--slate-500)] transition-colors group-hover:bg-[var(--brand-blue)] group-hover:text-white">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 animate-fade-in rounded-xl border border-[var(--slate-200)] bg-white p-2 shadow-lg">
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--slate-400)]">
            Type de projet
          </p>
          <div className="flex gap-1">
            {PROJECT_ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
                className={`flex flex-col items-center gap-1 rounded-lg p-2 transition-colors ${
                  key === value
                    ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                    : "text-[var(--slate-500)] hover:bg-[var(--slate-50)] hover:text-[var(--slate-700)]"
                }`}
                title={PROJECT_ICONS[key].label}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={PROJECT_ICONS[key].path} />
                </svg>
                <span className="text-[9px] font-medium">{PROJECT_ICONS[key].label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Render a static project icon (no picker) */
export function ProjectIcon({
  iconKey,
  size = 36,
  className = "mt-0.5 shrink-0 text-[var(--slate-400)]",
}: {
  iconKey: ProjectIconKey;
  size?: number;
  className?: string;
}) {
  const icon = PROJECT_ICONS[iconKey];
  if (!icon) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={icon.path} />
    </svg>
  );
}
