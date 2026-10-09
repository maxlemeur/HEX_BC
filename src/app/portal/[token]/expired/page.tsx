import { PortalContactBlock } from "@/components/portal/PortalContactBlock";
import { ClockIcon } from "lucide-react";

export default function PortalExpiredPage() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
        <ClockIcon stroke="var(--warning)" aria-hidden="true" size={28} />
      </div>
      <h1 className="text-2xl font-bold text-slate-800">
        Devis expiré
      </h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        La période de validité de ce devis est dépassée. Veuillez contacter
        votre interlocuteur pour obtenir un nouveau devis ou un lien actualisé.
      </p>
      <PortalContactBlock />
    </div>
  );
}
