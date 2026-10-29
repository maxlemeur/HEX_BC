"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, SaveIcon, UsersIcon } from "lucide-react";

import { useUserContext } from "@/components/UserContext";
import { ChatGptConnectionCard } from "@/components/ai/ChatGptConnectionCard";
import { DecisionsCapabilityCard } from "@/components/ai/DecisionsCapabilityCard";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { InfoPopover } from "@/components/ui/info-popover";
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

export default function ProfilePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const {
    userEmail,
    profile: contextProfile,
    setProfile: setContextProfile,
  } = useUserContext();

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
        : null,
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
        : null,
    );

    // Clear success message after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl animate-fade-in">
        <PageHeader title={PAGE_TITLE} />
        <LoadingState label="Chargement du profil…" className="min-h-[300px]" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl animate-fade-in">
      <PageHeader
        title={PAGE_TITLE}
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

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PageSection
          title="Informations professionnelles"
          actions={
            <InfoPopover
              label="À quoi servent mes informations ?"
              title="Votre profil sur les documents"
            >
              <p>
                Votre nom, votre fonction et vos coordonnées apparaissent sur
                les bons de commande que vous émettez.
              </p>
              <p>
                L’email de connexion et votre rôle sont gérés par votre
                organisation.
              </p>
            </InfoPopover>
          }
        >
          <form onSubmit={onSubmit}>
            {/* Read-only section */}
            <dl className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border-subtle pb-5">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  Email de connexion
                </dt>
                <dd className="mt-1 break-all text-sm font-medium text-foreground">
                  {authEmail || "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">Rôle système</dt>
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
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
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
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="profile-work-email">
                    Email professionnel
                  </FieldLabel>
                  <InfoPopover
                    label="À propos de l’email professionnel"
                    title="Email professionnel"
                  >
                    <p>
                      Cette adresse est affichée sur vos bons de commande. Elle
                      peut différer de l’email utilisé pour vous connecter.
                    </p>
                  </InfoPopover>
                </div>
                <Input
                  id="profile-work-email"
                  name="work-email"
                  type="email"
                  autoComplete="email"
                  placeholder="prenom.nom@hydro-express.fr"
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                />
              </div>
            </div>

            <details className="group mt-5 rounded-lg border border-border-subtle bg-surface-subtle">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <span id="profile-preview-title">
                  Aperçu sur les bons de commande
                </span>
                <ChevronDownIcon
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </summary>
              <section
                aria-labelledby="profile-preview-title"
                className="min-w-0 border-t border-border-subtle px-4 py-4 text-sm"
              >
                <p className="break-words text-base font-semibold text-foreground">
                  {fullName || "Votre nom"}
                </p>
                <p className="break-words text-muted-foreground">
                  {jobTitle || "Votre fonction"}
                </p>
                {phone ? (
                  <p className="mt-2 text-muted-foreground">{phone}</p>
                ) : null}
                {workEmail ? (
                  <p className="break-all text-muted-foreground">{workEmail}</p>
                ) : null}
              </section>
            </details>

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

            <div className="mt-5 flex justify-end">
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto"
                loading={isSaving}
                leftIcon={<SaveIcon aria-hidden="true" />}
              >
                Enregistrer
              </Button>
            </div>
          </form>
        </PageSection>
        <div className="grid min-w-0 gap-6">
          <ChatGptConnectionCard />
          <DecisionsCapabilityCard />
        </div>
      </div>
    </div>
  );
}
