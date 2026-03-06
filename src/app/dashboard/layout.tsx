import { DashboardShell } from "@/components/DashboardShell";
import { CommandPaletteLoader } from "@/components/ui/CommandPaletteLoader";
import { UserProvider } from "@/components/UserContext";
import { getUserContext } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userEmail, profile } = await getUserContext();
  const displayName = profile?.full_name || userEmail || "Compte";

  return (
    <UserProvider initialUserEmail={userEmail} initialProfile={profile}>
      <DashboardShell displayName={displayName}>{children}</DashboardShell>
      <CommandPaletteLoader />
    </UserProvider>
  );
}
