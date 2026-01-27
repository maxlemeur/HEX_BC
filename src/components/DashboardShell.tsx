"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/components/SignOutButton";

const NAV_ITEMS = [
  {
    href: "/dashboard/orders",
    label: "Bons de commande",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    ),
  },
  {
    href: "/dashboard/suppliers",
    label: "Fournisseurs",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        <rect width="20" height="14" x="2" y="6" rx="2" />
      </svg>
    ),
  },
  {
    href: "/dashboard/sites",
    label: "Chantiers",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    href: "/dashboard/products",
    label: "Produits",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m7.5 4.27 9 5.15" />
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    ),
  },
];

function buildInitials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "..";
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function DashboardShell({
  children,
  displayName,
}: Readonly<{
  children: React.ReactNode;
  displayName: string;
}>) {
  const pathname = usePathname();
  const userInitials = buildInitials(displayName);

  function isActive(href: string) {
    if (href === "/dashboard/orders") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/orders");
    }
    return pathname.startsWith(href);
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      <aside className="no-print dashboard-sidebar fixed left-0 top-0 z-40 flex h-screen flex-col">
        <div className="flex h-20 items-center px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
              <Image
                src="/logo-hydro-express.jpg"
                alt="Hydro Express"
                width={28}
                height={28}
                className="rounded-md"
              />
            </div>
            <div>
              <span className="block text-base font-bold text-white">Hydro Express</span>
              <span className="block text-[11px] font-medium text-white/50">
                Gestion des commandes
              </span>
            </div>
          </Link>
        </div>

        <nav className="mt-4 flex-1 px-4">
          <div className="space-y-1" role="navigation" aria-label="Menu principal">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-nav-item ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <Link
              href="/dashboard/profile"
              className="flex flex-1 items-center gap-3 min-w-0 rounded-lg -m-1.5 p-1.5 transition-colors hover:bg-white/5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-orange text-sm font-bold text-white">
                {userInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {displayName || "Compte"}
                </p>
              </div>
            </Link>
            <SignOutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 pl-[var(--sidebar-width)]">
        <div className="min-h-screen px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
