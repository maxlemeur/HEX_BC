export default function PortalExpiredPage() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--warning)]/10">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--warning)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-[var(--slate-800)]">
        Devis expire
      </h1>
      <p className="mt-3 max-w-md text-[var(--slate-500)]">
        La periode de validite de ce devis est depassee. Veuillez contacter
        votre interlocuteur pour obtenir un nouveau devis ou un lien actualise.
      </p>
    </div>
  );
}
