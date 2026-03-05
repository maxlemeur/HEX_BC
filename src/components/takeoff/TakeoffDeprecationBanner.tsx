import Link from "next/link";

export function TakeoffDeprecationBanner({
  targetHref = "/dashboard/affaires",
  targetLabel = "Acceder aux affaires",
}: {
  targetHref?: string;
  targetLabel?: string;
}) {
  return (
    <div className="alert alert-info mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        <p className="text-sm">
          <strong>Acces depuis le hub affaire recommande.</strong>{" "}
          La navigation centree sur l&apos;affaire offre une meilleure
          experience.
        </p>
      </div>
      <Link href={targetHref} className="btn btn-secondary btn-sm shrink-0">
        {targetLabel}
      </Link>
    </div>
  );
}
