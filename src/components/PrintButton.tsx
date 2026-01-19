"use client";

export function PrintButton() {
  return (
    <button
      className="flex h-12 items-center justify-center gap-2 rounded-full bg-slate-900 px-8 text-sm font-bold text-white shadow-xl transition-all hover:scale-105 hover:bg-black"
      onClick={() => window.print()}
      type="button"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Telecharger en PDF / Imprimer
    </button>
  );
}

