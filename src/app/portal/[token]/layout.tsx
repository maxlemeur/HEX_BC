import type { Metadata } from "next";

// Titre neutre : le portail est multi-organisation, l'émetteur n'est pas connu ici.
export const metadata: Metadata = {
  title: { absolute: "Votre devis en ligne" },
  description: "Consultez votre devis et répondez en ligne.",
};

export default function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <span className="text-sm font-medium text-muted-foreground">
            Portail client
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-border bg-surface px-4 py-6 text-center text-xs text-muted-foreground">
        <p>
          Votre devis en ligne
        </p>
      </footer>
    </div>
  );
}
