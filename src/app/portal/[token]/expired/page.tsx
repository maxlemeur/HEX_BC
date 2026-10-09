import type { Metadata } from "next";
import { ClockIcon } from "lucide-react";

import { PortalContactBlock } from "@/components/portal/PortalContactBlock";

import { loadExpiredPortalIssuerContact } from "./load-issuer-contact";

export const metadata: Metadata = {
  title: { absolute: "Devis expiré" },
};

type PortalExpiredPageProps = {
  params?: Promise<{ token: string }>;
};

export default async function PortalExpiredPage({ params }: PortalExpiredPageProps) {
  const token = params ? (await params).token : null;
  const issuer = token ? await loadExpiredPortalIssuerContact(token) : null;

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-warning-light">
        <ClockIcon aria-hidden="true" className="size-7 text-warning" />
      </div>
      <h1 className="typo-h1 text-foreground">Devis expiré</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        La période de validité de ce devis est dépassée ou le lien a été remplacé.
        {issuer
          ? " Contactez votre interlocuteur ci-dessous pour obtenir un devis actualisé ou un nouveau lien."
          : " Contactez l’entreprise qui vous l’a envoyé pour obtenir un devis actualisé ou un nouveau lien."}
      </p>
      <PortalContactBlock issuer={issuer} />
    </div>
  );
}
