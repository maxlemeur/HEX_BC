import Link from "next/link";
import { FileQuestionIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-16">
      <EmptyState
        headingLevel={1}
        icon={<FileQuestionIcon />}
        title="Page introuvable"
        description="Cette page n’existe pas ou vous n’y avez plus accès."
        action={
          <Link href="/dashboard" className={buttonVariants({ variant: "primary", size: "lg" })}>
            Revenir à l’accueil
          </Link>
        }
      />
    </div>
  );
}
