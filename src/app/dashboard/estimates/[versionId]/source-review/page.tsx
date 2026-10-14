import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SourceReferenceWorkspace } from "@/components/estimates/source-reference/SourceReferenceWorkspace";
import { readSourceReferenceDocuments } from "@/components/estimates/source-reference/source-reference-server";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";
import { readSourceReferenceReview } from "@/lib/estimates/source-reference-review";

export default async function SourceReferencePage({ params, searchParams }: Readonly<{
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ documentsPage?: string | string[] }>;
}>) {
  const { versionId } = await params;
  const { documentsPage } = await searchParams;
  const page = documentsPage === undefined ? 1 : typeof documentsPage === "string" && /^[1-9]\d{0,3}$/.test(documentsPage) ? Number(documentsPage) : null;
  if (page === null) notFound();

  let context;
  let review;
  try {
    context = await getAuthenticatedTenantContext();
    // This RPC authorizes the review before any project/document lookup. Director
    // readers do not depend on the narrower intake or editor permissions.
    review = await readSourceReferenceReview({ versionId });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect("/login");
    if (error instanceof ApiError && [400, 403, 404].includes(error.status)) notFound();
    throw error;
  }
  const documents = await readSourceReferenceDocuments(context, review, page)
    .catch(() => ({ items: [], page, hasNext: false, state: "error" as const }));
  const scope = { actorId: context.userId, tenantId: context.tenantId, versionId: review.versionId };
  return (
    <div className="animate-fade-in">
      <PageHeader title="Référence CCTP" description="Conservez le document consulté et confirmez la référence de ce chiffrage."
        actions={<div className="flex flex-wrap gap-2"><Link href={`/dashboard/estimates/${review.versionId}/source-review/requirements`} prefetch={false} className={buttonVariants({ variant: "outline" })}>Exigences du CCTP</Link><Link href={`/dashboard/estimates/${review.versionId}`} prefetch={false} className={buttonVariants({ variant: "outline" })}>Retour au chiffrage</Link></div>} />
      <SourceReferenceWorkspace key={`${scope.tenantId}:${scope.actorId}:${scope.versionId}`} scope={scope}
        initialReview={review} documents={documents} canReplay={context.tenantRole === "admin" || context.tenantRole === "engineer"} />
    </div>
  );
}
