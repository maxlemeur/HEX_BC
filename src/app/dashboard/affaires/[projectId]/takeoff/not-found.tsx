import Link from "next/link";

export default function TakeoffNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--slate-300)]"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </svg>
      <p className="text-sm text-[var(--slate-500)]">
        Extractions introuvables ou acces non autorise.
      </p>
      <Link href="/dashboard/affaires" className="btn btn-secondary">
        Retour a la liste des affaires
      </Link>
    </div>
  );
}
