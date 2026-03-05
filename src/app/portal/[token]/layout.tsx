import type { Metadata } from "next";
import Image from "next/image";

import { COMPANY_INFO } from "@/lib/company-info";

export const metadata: Metadata = {
  title: "Devis - Hydro Express",
  description: "Consultez et gerez votre devis en ligne",
};

export default function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--slate-100)]">
      <header className="border-b border-[var(--slate-200)] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Image
            src="/logo-hydro-express.jpg"
            alt="Hydro eXpress"
            width={160}
            height={64}
            className="h-[50px] w-auto object-contain"
            priority
          />
          <span className="text-sm font-medium text-[var(--slate-500)]">
            Portail Client
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-[var(--slate-200)] bg-white py-6 text-center text-xs text-[var(--slate-500)]">
        <p>
          {COMPANY_INFO.name} &mdash; SIRET {COMPANY_INFO.legal.siret}
        </p>
      </footer>
    </div>
  );
}
