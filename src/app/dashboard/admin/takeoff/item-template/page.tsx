import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ItemTemplateEditor } from "@/components/takeoff/ItemTemplateEditor";
import { getUserContext } from "@/lib/auth/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { loadItemTemplateAdministration } from "@/lib/takeoff/item-template-server";

/** The tenant's plumbing template, corrected by the expert estimator and published by an administrator. */
export default async function AdminTakeoffItemTemplatePage() {
  const { profile, tenantId } = await getUserContext();
  if (!profile || !tenantId || profile.tenant_role !== "admin") redirect("/dashboard/profile");
  if (!(await isTakeoffEnabled(tenantId))) redirect("/dashboard");
  const administration = await loadItemTemplateAdministration("plomberie");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Gabarit de postes"
        description="Les postes proposés aux affaires sans DPGF. Une nouvelle version vaut pour les prochaines affaires ; une affaire existante se voit proposer l’écart."
      />
      <ItemTemplateEditor
        key={`${administration.published.version}:${administration.draft?.revision ?? 0}`}
        templateKey="plomberie"
        published={{ version: administration.published.version, definition: administration.published.definition,
          publishedAt: administration.published.publishedAt, usedLineIds: administration.published.usedLineIds }}
        draft={administration.draft ? { revision: administration.draft.revision, token: administration.draft.token,
          definition: administration.draft.definition } : null}
      />
    </div>
  );
}
