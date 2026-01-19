import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/SignOutButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = profile?.full_name ?? user.email ?? "Compte";

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link className="text-sm font-semibold" href="/dashboard">
              Hydro Express
            </Link>
            <nav className="hidden items-center gap-4 text-sm text-zinc-600 sm:flex">
              <Link className="hover:text-zinc-900" href="/dashboard/orders">
                Bons de commande
              </Link>
              <Link className="hover:text-zinc-900" href="/dashboard/suppliers">
                Fournisseurs
              </Link>
              <Link className="hover:text-zinc-900" href="/dashboard/sites">
                Chantiers
              </Link>
              <Link className="hover:text-zinc-900" href="/dashboard/products">
                Produits
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-600 sm:inline">
              {displayName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
