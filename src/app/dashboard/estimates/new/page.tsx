"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useUserContext } from "@/components/UserContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_MARGIN_MULTIPLIER = 1.0;

export default function NewEstimatePage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile } = useUserContext();

  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [dateDevis, setDateDevis] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [validiteJours, setValiditeJours] = useState(String(DEFAULT_VALIDITE_JOURS));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!profile?.id) {
      setFormError("Impossible de charger votre profil.");
      return;
    }

    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setFormError("Le nom du projet est obligatoire.");
      return;
    }

    if (!dateDevis) {
      setFormError("La date de devis est obligatoire.");
      return;
    }

    const parsedValidite = Number(validiteJours);
    if (!Number.isFinite(parsedValidite) || parsedValidite <= 0) {
      setFormError("La validite doit etre un nombre positif.");
      return;
    }

    setIsSubmitting(true);

    const { data: project, error: projectError } = await supabase
      .from("estimate_projects")
      .insert({
        user_id: profile.id,
        name: trimmedName,
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      })
      .select("id")
      .single();

    if (projectError || !project) {
      setIsSubmitting(false);
      setFormError(projectError?.message ?? "Impossible de creer le projet.");
      return;
    }

    const { data: version, error: versionError } = await supabase
      .from("estimate_versions")
      .insert({
        project_id: project.id,
        version_number: 1,
        status: "draft",
        title: title.trim() || null,
        date_devis: dateDevis,
        validite_jours: parsedValidite,
        margin_multiplier: DEFAULT_MARGIN_MULTIPLIER,
        discount_bp: 0,
        rounding_mode: "none",
      })
      .select("id")
      .single();

    if (versionError || !version) {
      setIsSubmitting(false);
      setFormError(versionError?.message ?? "Impossible de creer la version.");
      return;
    }

    const defaultCategories = [
      { name: "Materiaux", position: 1 },
      { name: "Main d'oeuvre", position: 2 },
      { name: "Sous-traitance", position: 3 },
    ];

    const categoriesPayload = defaultCategories.map((category) => ({
      user_id: profile.id,
      name: category.name,
      position: category.position,
      color: null,
    }));

    const { error: categoriesError } = await supabase
      .from("estimate_categories")
      .upsert(categoriesPayload, { onConflict: "user_id,name" });

    if (categoriesError) {
      console.error("Erreur creation categories:", categoriesError.message);
    }

    setIsSubmitting(false);
    router.push(`/dashboard/estimates/${version.id}/edit`);
    router.refresh();
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Nouveau chiffrage</h1>
          <p className="page-description">
            Creez un nouveau projet et sa version initiale.
          </p>
        </div>
        <Link className="btn btn-secondary btn-lg" href="/dashboard/estimates">
          Retour
        </Link>
      </div>

      {formError ? (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {formError}
        </div>
      ) : null}

      <div className="dashboard-card p-8">
        <form className="grid gap-6 sm:grid-cols-2" onSubmit={onSubmit}>
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="estimate-project-name">
              Nom projet *
            </label>
            <input
              id="estimate-project-name"
              className="form-input"
              placeholder="Nom du projet"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              required
            />
          </div>

          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="estimate-title">
              Titre
            </label>
            <input
              id="estimate-title"
              className="form-input"
              placeholder="Titre de la version"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="estimate-date">
              Date devis *
            </label>
            <input
              id="estimate-date"
              className="form-input"
              type="date"
              value={dateDevis}
              onChange={(event) => setDateDevis(event.target.value)}
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="estimate-validite">
              Validite (jours) *
            </label>
            <input
              id="estimate-validite"
              className="form-input"
              type="number"
              min={1}
              value={validiteJours}
              onChange={(event) => setValiditeJours(event.target.value)}
              required
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-end gap-3 pt-2">
            <Link className="btn btn-secondary" href="/dashboard/estimates">
              Annuler
            </Link>
            <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                  Creation...
                </>
              ) : (
                "Creer le chiffrage"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
