import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { CompanyConsultationTemplateSettings } from "@/components/material-requests/ConsultationTemplateSettings";
import { getUserContext } from "@/lib/auth/server";

/**
 * TI-691: the company's general template of the supplier consultation message, used by the members who have none
 * of their own. Admins of the active tenant only: decided here on the server, then again by the API and the
 * database functions that write it.
 */
export default async function AdminConsultationMessagePage() {
  const { profile, tenantId } = await getUserContext();

  if (!profile || !tenantId || profile.tenant_role !== "admin") {
    redirect("/dashboard/profile");
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Message fournisseur" },
        ]}
        title="Message fournisseur"
        description="Le modèle du message de consultation pour les membres qui n’ont pas le leur. Chacun peut le remplacer dans son profil."
      />
      <div className="flex max-w-4xl flex-col gap-6 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5">
        <CompanyConsultationTemplateSettings />
      </div>
    </div>
  );
}
