export default function PortalNotFound() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--slate-200)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--slate-500)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-[var(--slate-800)]">
        Lien invalide
      </h1>
      <p className="mt-3 max-w-md text-[var(--slate-500)]">
        Ce lien de consultation n&apos;est pas valide ou a été révoqué.
        Veuillez contacter votre interlocuteur pour obtenir un nouveau lien.
      </p>
    </div>
  );
}
