import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import { COMPANY_INFO } from "@/lib/company-info";
import { BUSINESS_DOCUMENT_THEME } from "@/lib/documents/document-theme";
import { cn } from "@/lib/utils";

type BusinessDocumentAddress = { street: string; postalCode: string; city: string };

/**
 * Entreprise imprimée : la configuration courante (`COMPANY_INFO`) par défaut, ou celle que la copie
 * émise d'un devis a figée (contrat client ; revue Codex de 3d78d662).
 */
export type BusinessDocumentCompany = {
  address: BusinessDocumentAddress;
  registeredOffice: BusinessDocumentAddress;
  phone: { landline: string; mobile: string };
  legal: { siret: string; vat: string };
};

type BusinessDocumentFrameProps = {
  children: ReactNode;
  className?: string;
};

export function BusinessDocumentFrame({
  children,
  className,
}: Readonly<BusinessDocumentFrameProps>) {
  const style = {
    "--document-brand-blue": BUSINESS_DOCUMENT_THEME.colors.brandBlue,
    "--document-brand-orange": BUSINESS_DOCUMENT_THEME.colors.brandOrange,
  } as CSSProperties;

  return (
    <div
      className={cn(
        "document-page relative mx-auto my-5 flex w-full max-w-full flex-col overflow-hidden bg-white px-4 pb-6 pt-6 shadow-2xl sm:px-6 sm:pb-8 sm:pt-8 md:px-[50px] md:pb-[50px] md:pt-[40px] print:m-0 print:px-8 print:pb-8 print:pt-6 print:shadow-none",
        className
      )}
      style={style}
    >
      <div className="sidebar-accent print-color-adjust" />
      {children}
    </div>
  );
}

export function BusinessDocumentBrandHeader({
  company = COMPANY_INFO,
}: Readonly<{ company?: BusinessDocumentCompany }>) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <Image
        src="/logo-hydro-express.jpg"
        alt="Hydro eXpress"
        width={250}
        height={100}
        className="h-16 w-auto object-contain sm:h-[100px] print:h-[80px]"
        priority
      />
      <div className="w-full max-w-none rounded-lg border border-border bg-surface-subtle px-4 py-3 text-left text-sm sm:max-w-[220px] sm:text-right print:px-3 print:py-2 print:text-xs">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Etablissement principal :
        </p>
        <p className="text-slate-600">{company.address.street}</p>
        <p className="text-slate-600">
          {company.address.postalCode} {company.address.city}
        </p>
        <div className="mt-1 text-slate-600">
          <p>{company.phone.landline}</p>
          <p>{company.phone.mobile}</p>
        </div>
      </div>
    </div>
  );
}

export function BusinessDocumentFooter({
  company = COMPANY_INFO,
}: Readonly<{ company?: BusinessDocumentCompany }>) {
  const address = `${company.registeredOffice.street} ${company.registeredOffice.postalCode} ${company.registeredOffice.city}`;

  return (
    <div className="purchase-order-footer mt-auto border-t border-border pt-5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground print:pt-3">
      <p className="mb-1">Siège social : {address}</p>
      <p>
        SIRET {company.legal.siret} - TVA {company.legal.vat}
      </p>
    </div>
  );
}
