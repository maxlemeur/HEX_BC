import packageMetadata from "../../../package.json";

import { DashboardShell } from "@/components/DashboardShell";
import { CommandPaletteLoader } from "@/components/ui-legacy/CommandPaletteLoader";
import { UserProvider } from "@/components/UserContext";
import { WebVitalsReporter } from "@/components/performance/WebVitalsReporter";
import { getSupabase, getUserContext } from "@/lib/auth/server";
import { readActiveTenantMembership } from "@/lib/auth/tenant-context";

export const dynamic = "force-dynamic";

/**
 * Name of the active organisation for the shell. The profile already read the
 * active membership with its tenant: this per-request memo adds no round trip.
 */
async function readActiveTenantName(userId: string | null) {
  if (!userId) return null;
  try {
    const supabase = await getSupabase();
    const { tenantName } = await readActiveTenantMembership(supabase, userId);
    return tenantName;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userEmail, profile } = await getUserContext();
  const tenantName = profile?.tenant_id ? await readActiveTenantName(profile.id) : null;
  const displayName = profile?.full_name || userEmail || "Compte";
  const appBuildId =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null;

  return (
    <UserProvider initialUserEmail={userEmail} initialProfile={profile} tenantName={tenantName}>
      <DashboardShell
        appBuildId={appBuildId}
        appVersion={packageMetadata.version}
        displayName={displayName}
        tenantName={tenantName}
      >
        {children}
      </DashboardShell>
      <CommandPaletteLoader />
      <WebVitalsReporter buildId={appBuildId} />
    </UserProvider>
  );
}
