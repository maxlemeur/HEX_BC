"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useUserContext } from "@/components/UserContext";
import {
  createEstimate,
  fetchEstimateTemplates,
  instantiateEstimateFromTemplate,
  type EstimateTemplateSummary,
} from "@/lib/estimates/client";

const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_MARGIN_MULTIPLIER = 1.0;

function formatDateLabel(isoValue: string) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export default function NewEstimatePage() {
  const router = useRouter();
  const { profile } = useUserContext();

  const [creationMode, setCreationMode] = useState<"blank" | "template">("blank");
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [dateDevis, setDateDevis] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [validiteJours, setValiditeJours] = useState(String(DEFAULT_VALIDITE_JOURS));
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [recentTemplates, setRecentTemplates] = useState<EstimateTemplateSummary[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTemplates() {
      setIsLoadingTemplates(true);
      setTemplatesError(null);

      try {
        const templates = await fetchEstimateTemplates({
          limit: 10,
          order: "recent",
        });

        if (!isMounted) return;
        setRecentTemplates(templates);
        setSelectedTemplateId((current) => current || templates[0]?.id || "");
      } catch (error) {
        if (!isMounted) return;
        setTemplatesError(
          error instanceof Error ? error.message : "Impossible de charger les templates."
        );
      } finally {
        if (isMounted) {
          setIsLoadingTemplates(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      isMounted = false;
    };
  }, []);

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

    if (creationMode === "template" && !selectedTemplateId) {
      setFormError("Veuillez selectionner un template.");
      return;
    }

    setIsSubmitting(true);

    try {
      let versionId: string;

      if (creationMode === "template") {
        const result = await instantiateEstimateFromTemplate(selectedTemplateId, {
          projectName: trimmedName,
          versionTitle: title.trim() || null,
          dateDevis,
          validiteJours: parsedValidite,
        });
        versionId = result.versionId;
      } else {
        versionId = await createEstimate({
          projectName: trimmedName,
          title: title.trim() || null,
          dateDevis,
          validiteJours: parsedValidite,
          marginMultiplier: DEFAULT_MARGIN_MULTIPLIER,
        });
      }

      setIsSubmitting(false);
      router.push(`/dashboard/estimates/${versionId}/edit`);
      router.refresh();
    } catch (error) {
      setIsSubmitting(false);
      setFormError(
        error instanceof Error ? error.message : "Impossible de creer la version."
      );
    }
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
            <span className="form-label">Mode de creation</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={creationMode === "blank" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                onClick={() => setCreationMode("blank")}
              >
                Nouveau chiffrage
              </button>
              <button
                type="button"
                className={creationMode === "template" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                onClick={() => setCreationMode("template")}
              >
                Depuis un modele
              </button>
              <Link className="btn btn-ghost btn-sm" href="/dashboard/estimates/templates">
                Bibliotheque templates
              </Link>
            </div>
          </div>

          {creationMode === "template" ? (
            <div className="sm:col-span-2">
              <label className="form-label" htmlFor="estimate-template-id">
                Template (10 plus recents)
              </label>
              <select
                id="estimate-template-id"
                className="form-input form-select"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                disabled={isLoadingTemplates || recentTemplates.length === 0}
                required
              >
                {recentTemplates.length === 0 ? (
                  <option value="">
                    {isLoadingTemplates ? "Chargement..." : "Aucun template disponible"}
                  </option>
                ) : (
                  recentTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} - {template.itemCount} lignes - {formatDateLabel(template.createdAt)}
                    </option>
                  ))
                )}
              </select>
              {templatesError ? (
                <div className="alert alert-error mt-3">{templatesError}</div>
              ) : null}
            </div>
          ) : null}

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
