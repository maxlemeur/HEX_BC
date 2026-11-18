import { Suspense } from "react";
import { z } from "zod";

import { RememberAffaire } from "@/components/affaires/RememberAffaire";
import { findReadableAffaireProject } from "@/lib/affaires/server";
import { getUserContext } from "@/lib/auth/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

async function RememberReadableAffaire({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return null;
  const { tenantId } = await getUserContext();
  if (!tenantId) return null;
  const context = await getAuthenticatedContext();
  if (!(await findReadableAffaireProject(context, projectId))) return null;
  return <RememberAffaire userId={context.userId} tenantId={context.tenantId} projectId={projectId} />;
}

export default function AffaireProjectLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ projectId: string }>;
}) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <RememberReadableAffaire params={params} />
      </Suspense>
    </>
  );
}
