import packageMetadata from "../../../package.json";

import { DashboardShell } from "@/components/DashboardShell";
import { CommandPaletteLoader } from "@/components/ui-legacy/CommandPaletteLoader";
import { UserProvider } from "@/components/UserContext";
import { WebVitalsReporter } from "@/components/performance/WebVitalsReporter";
import { getSupabase, getUserContext } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/** Name of the active organisation for the shell; RLS only exposes the user's own tenants. */
async function readActiveTenantName(tenantId: string | null) {
  if (!tenantId) return null;
  try {
    const supabase = await getSupabase();
    const { data } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    return data?.name?.trim() || null;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { userEmail, profile } = await getUserContext();
  const tenantName = await readActiveTenantName(profile?.tenant_id ?? null);
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
