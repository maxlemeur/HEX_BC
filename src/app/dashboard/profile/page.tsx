"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function ProfilePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [authEmail, setAuthEmail] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [workEmail, setWorkEmail] = useState("");

  useEffect(() => {
    async function loadProfile() {
      setIsLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setAuthEmail(user.email ?? "");

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name, phone, job_title, work_email, role")
        .eq("id", user.id)
        .single();

      if (profileError) {
        setError(profileError.message);
        setIsLoading(false);
        return;
      }

      const profileData = data as unknown as Profile;
      setProfile(profileData);
      setFullName(profileData.full_name);
      setPhone(profileData.phone ?? "");
      setJobTitle(profileData.job_title ?? "");
      setWorkEmail(profileData.work_email ?? user.email ?? "");
      setIsLoading(false);
    }

    loadProfile();
  }, [supabase]);

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

    // Clear success message after 3 seconds
    setTimeout(() => setSuccess(false), 3000);
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
          <span className="text-[var(--slate-500)]">Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-title">Mon profil</h1>
        <p className="page-description">
          Ces informations apparaitront sur les bons de commande que vous emettez.
        </p>
      </div>

      <div className="max-w-2xl">
        {/* Profile card */}
        <div className="dashboard-card">
          <div className="border-b border-[var(--slate-200)] px-6 py-4">
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Informations professionnelles
            </h2>
          </div>

          <form onSubmit={onSubmit} className="p-6">
            {/* Read-only section */}
            <div className="mb-6 rounded-xl bg-[var(--slate-50)] p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
                    Email de connexion
                  </p>
                  <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
                    {authEmail}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
                    Role systeme
                  </p>
                  <p className="mt-1">
                    <span className="inline-flex items-center rounded-full bg-[var(--brand-blue)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--brand-blue)]">
                      {profile ? ROLE_LABELS[profile.role] : "-"}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Editable fields */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="profile-name">
                  Nom complet *
                </label>
                <input
                  id="profile-name"
                  name="name"
                  autoComplete="name"
                  className="form-input"
                  placeholder="Prenom Nom"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Apparait sur les bons de commande
                </p>
              </div>

              <div>
                <label className="form-label" htmlFor="profile-job">
                  Fonction / Titre
                </label>
                <input
                  id="profile-job"
                  name="job-title"
                  autoComplete="organization-title"
                  className="form-input"
                  placeholder="Charge d'affaires"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="profile-phone">
                  Telephone
                </label>
                <input
                  id="profile-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  className="form-input"
                  placeholder="06 00 00 00 00"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="profile-work-email">
                  Email professionnel
                </label>
                <input
                  id="profile-work-email"
                  name="work-email"
                  type="email"
                  autoComplete="email"
                  className="form-input"
                  placeholder="prenom.nom@hydro-express.fr"
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Email affiche sur les bons de commande (peut etre different de l&apos;email de connexion)
                </p>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-6 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--slate-500)]">
                Apercu sur les bons de commande
              </p>
              <div className="text-sm">
                <p className="text-lg font-bold text-[var(--brand-blue)]">
                  {fullName || "Votre nom"}
                </p>
                <p className="text-[var(--slate-500)]">
                  {jobTitle || "Votre fonction"}
                </p>
                {phone && (
                  <p className="mt-1 text-[var(--slate-500)]">{phone}</p>
                )}
                {workEmail && (
                  <p className="text-[var(--slate-500)]">{workEmail}</p>
                )}
              </div>
            </div>

            {/* Messages */}
            {error && (
              <div className="alert alert-error mt-5">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6" />
                  <path d="m9 9 6 6" />
                </svg>
                {error}
              </div>
            )}

            {success && (
              <div className="alert alert-success mt-5">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Profil mis a jour avec succes
              </div>
            )}

            {/* Submit button */}
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    Enregistrer
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
