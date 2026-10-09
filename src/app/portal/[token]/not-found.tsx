import { PortalContactBlock } from "@/components/portal/PortalContactBlock";
import { CircleXIcon } from "lucide-react";

export default function PortalNotFound() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-slate-200">
        <CircleXIcon stroke="var(--slate-500)" aria-hidden="true" size={28} />
      </div>
      <h1 className="text-2xl font-bold text-slate-800">
        Lien invalide
      </h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Ce lien de consultation n&apos;est pas validé ou a été révoqué.
        Veuillez contacter votre interlocuteur pour obtenir un nouveau lien.
      </p>
      <PortalContactBlock />
    </div>
  );
}
