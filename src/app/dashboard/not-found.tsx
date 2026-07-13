import { EmptyState } from "@/components/ui/EmptyState";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-16">
      <EmptyState
        headingLevel={1}
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14.5 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7.5" />
            <path d="M17 2v6" />
            <path d="M14 5h6" />
          </svg>
        }
        title="Page introuvable"
        description="Cette page n’existe pas ou vous n’y avez plus accès."
        actionLabel="Revenir à l’accueil"
        actionHref="/dashboard"
      />
    </div>
  );
}
