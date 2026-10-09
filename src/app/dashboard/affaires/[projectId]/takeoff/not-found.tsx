import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";

export default function TakeoffNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <CircleAlertIcon aria-hidden="true" strokeWidth="1.5" className="text-slate-300" size={48} />
      <p className="text-sm text-muted-foreground">
        Extractions introuvables ou acces non autorise.
      </p>
      <Link href="/dashboard/affaires" className="btn btn-secondary">
        Retour a la liste des affaires
      </Link>
    </div>
  );
}
