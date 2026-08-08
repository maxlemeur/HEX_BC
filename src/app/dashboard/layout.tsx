import packageMetadata from "../../../package.json";

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
  const appBuildId =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null;

  return (
    <UserProvider initialUserEmail={userEmail} initialProfile={profile}>
      <DashboardShell
        appBuildId={appBuildId}
        appVersion={packageMetadata.version}
        displayName={displayName}
      >
        {children}
      </DashboardShell>
      <CommandPaletteLoader />
    </UserProvider>
  );
}
