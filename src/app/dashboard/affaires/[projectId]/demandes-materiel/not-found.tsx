import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export default function MaterialRequestsNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <CircleAlertIcon aria-hidden="true" strokeWidth="1.5" className="text-slate-300" size={48} />
      <p className="text-sm text-muted-foreground">
        Affaire introuvable ou accès non autorisé.
      </p>
      <Link href="/dashboard/affaires" className={buttonVariants({ variant: "outline", size: "lg" })}>
        Retour à la liste des affaires
      </Link>
    </div>
  );
}
