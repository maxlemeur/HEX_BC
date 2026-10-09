"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SaveIcon, UsersIcon } from "lucide-react";

import { useUserContext } from "@/components/UserContext";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  work_email: string | null;
  role: "buyer" | "site_manager" | "admin";
};

const ROLE_LABELS: Record<Profile["role"], string> = {
  buyer: "Acheteur",
  site_manager: "Chef de chantier",
  admin: "Administrateur",
};

const PAGE_TITLE = "Mon profil";
const PAGE_DESCRIPTION = "Ces informations apparaissent sur les bons de commande que vous émettez.";

export default function ProfilePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { userEmail, profile: contextProfile, setProfile: setContextProfile } =
    useUserContext();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [authEmail, setAuthEmail] = useState<string>(userEmail);
  const [profile, setProfile] = useState<Profile | null>(contextProfile);
  const [initialized, setInitialized] = useState(false);

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const canManageMemberships = contextProfile?.tenant_role === "admin";

  useEffect(() => {
    if (initialized) return;

    queueMicrotask(() => {
      setIsLoading(true);
      setError(null);

      if (!contextProfile) {
        setError("Profil introuvable.");
        setIsLoading(false);
        return;
      }

      setProfile(contextProfile);
      setAuthEmail(userEmail);
      setFullName(contextProfile.full_name);
      setPhone(contextProfile.phone ?? "");
      setJobTitle(contextProfile.job_title ?? "");
      setWorkEmail(contextProfile.work_email ?? userEmail ?? "");
      setIsLoading(false);
      setInitialized(true);
    });
  }, [contextProfile, initialized, userEmail]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;

    setIsSaving(true);
    setError(null);
    setSuccess(false);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        job_title: jobTitle.trim() || null,
        work_email: workEmail.trim() || null,
      })
      .eq("id", profile.id);

    setIsSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    // Update local profile state
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            job_title: jobTitle.trim() || null,
            work_email: workEmail.trim() || null,
          }
        : null
    );
    setContextProfile((prev) =>
      prev
        ? {
            ...prev,
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            job_title: jobTitle.trim() || null,
            work_email: workEmail.trim() || null,
          }
        : null
    );

    // Clear success message after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <LoadingState label="Chargement du profil…" className="min-h-[300px]" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          canManageMemberships ? (
            <Link
              className={buttonVariants({ variant: "outline", size: "lg" })}
              href="/dashboard/memberships"
            >
              <UsersIcon aria-hidden="true" />
              Gérer les membres
            </Link>
          ) : null
        }
      />

      <PageSection title="Informations professionnelles" className="max-w-2xl">
        <form onSubmit={onSubmit}>
          {/* Read-only section */}
          <dl className="mb-6 grid gap-4 rounded-lg bg-surface-subtle p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email de connexion
              </dt>
              <dd className="mt-1 break-all text-sm font-medium text-foreground">
                {authEmail || "—"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Rôle système
              </dt>
              <dd className="mt-1">
                {profile ? (
                  <Badge variant="info" size="sm">
                    {ROLE_LABELS[profile.role]}
                  </Badge>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          {/* Editable fields */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="profile-name">
                Nom complet
                <span aria-hidden="true" className="text-danger">
                  *
                </span>
              </FieldLabel>
              <Input
                id="profile-name"
                name="name"
                autoComplete="name"
                placeholder="Prénom Nom"
                required
                aria-describedby="profile-name-hint"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <FieldDescription id="profile-name-hint" className="text-xs">
                Apparaît sur les bons de commande.
              </FieldDescription>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <FieldLabel htmlFor="profile-job">Fonction</FieldLabel>
              <Input
                id="profile-job"
                name="job-title"
                autoComplete="organization-title"
                placeholder="Chargé d’affaires"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <FieldLabel htmlFor="profile-phone">Téléphone</FieldLabel>
              <Input
                id="profile-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="06 00 00 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <FieldLabel htmlFor="profile-work-email">Email professionnel</FieldLabel>
              <Input
                id="profile-work-email"
                name="work-email"
                type="email"
                autoComplete="email"
                placeholder="prenom.nom@hydro-express.fr"
                aria-describedby="profile-work-email-hint"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
              />
              <FieldDescription id="profile-work-email-hint" className="text-xs">
                Affiché sur les bons de commande ; il peut différer de l’email de connexion.
              </FieldDescription>
            </div>
          </div>

          {/* Preview */}
          <section
            aria-labelledby="profile-preview-title"
            className="mt-6 rounded-lg border border-border bg-surface-subtle p-4"
          >
            <h3
              id="profile-preview-title"
              className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Aperçu sur les bons de commande
            </h3>
            <div className="min-w-0 text-sm">
              <p className="break-words text-lg font-bold text-primary">
                {fullName || "Votre nom"}
              </p>
              <p className="break-words text-muted-foreground">
                {jobTitle || "Votre fonction"}
              </p>
              {phone ? <p className="mt-1 text-muted-foreground">{phone}</p> : null}
              {workEmail ? <p className="break-all text-muted-foreground">{workEmail}</p> : null}
            </div>
          </section>

          {/* Messages */}
          {error ? (
            <Alert variant="danger" className="mt-5">
              {error}
            </Alert>
          ) : null}

          {success ? (
            <Alert variant="success" className="mt-5">
              Profil mis à jour.
            </Alert>
          ) : null}

          <div className="mt-6 flex justify-end">
            <Button
              type="submit"
              size="lg"
              loading={isSaving}
              leftIcon={<SaveIcon aria-hidden="true" />}
            >
              Enregistrer
            </Button>
          </div>
        </form>
      </PageSection>
    </div>
  );
}
