import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SourceCoverageWorkspace } from "@/components/estimates/source-coverage/SourceCoverageWorkspace";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";
import { coverageQuerySchema } from "@/lib/estimates/source-coverage-contracts";
import { readSourceCoverage } from "@/lib/estimates/source-coverage-server";

export default async function SourceCoveragePage({ params, searchParams }: Readonly<{
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ requirementId?: string | string[] }>;
}>) {
  const { versionId } = await params;
  const { requirementId } = await searchParams;
  const query = coverageQuerySchema.safeParse({ ...(requirementId === undefined ? {} : { requirementId }), limit: 20 });
  if (!query.success) notFound();
  let context;
  let workspace;
  try {
    context = await getAuthenticatedTenantContext();
    workspace = await readSourceCoverage(versionId, query.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  const scope = { actorId: context.userId, tenantId: context.tenantId, versionId: workspace.versionId };
  return <div className="animate-fade-in">
    <PageHeader title="Exigences du CCTP" description="Reliez les prescriptions identifiées au chiffrage et conservez les faits de chaque arbitrage."
      actions={<Link href={`/dashboard/estimates/${workspace.versionId}/source-review`} prefetch={false} className={buttonVariants({ variant: "outline" })}>Référence CCTP</Link>} />
    <SourceCoverageWorkspace key={`${scope.tenantId}:${scope.actorId}:${scope.versionId}`} scope={scope} initialWorkspace={workspace} />
  </div>;
}
