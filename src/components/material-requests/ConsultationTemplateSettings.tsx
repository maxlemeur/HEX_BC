"use client";

import { useCallback, useEffect, useState } from "react";

import { PageSection } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import {
  fetchConsultationTemplates,
  materialRequestErrorMessage,
  resetCompanyConsultationTemplate,
  resetPersonalConsultationTemplate,
  saveCompanyConsultationTemplate,
  savePersonalConsultationTemplate,
} from "@/lib/material-requests/client";
import {
  templateOfRecord,
  type ConsultationTemplateRecord,
  type ConsultationTemplates,
} from "@/lib/material-requests/consultation-template-contracts";
import { DEFAULT_CONSULTATION_TEMPLATE, type ConsultationTemplate } from "@/lib/material-requests/consultation-template";

import { ConsultationTemplateEditor } from "./ConsultationTemplateEditor";

/**
 * The consultation message templates (TI-691): the member's own in « Mon profil », the company's in the
 * administration. The message follows the member's template, else the company's, else today's message. A read error
 * is said, never replaced by today's message.
 */

export const CONSULTATION_TEMPLATE_ANCHOR = "message-consultation";

function recordOf(template: ConsultationTemplate): ConsultationTemplateRecord {
  return { message_template: template.message, line_template: template.line };
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; templates: ConsultationTemplates };

function useTemplates() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchConsultationTemplates(controller.signal)
      .then((templates) => setLoad({ status: "ready", templates }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const detail = materialRequestErrorMessage(error, "");
        setLoad({ status: "error", message: `Le modèle de message n’a pas pu être lu${detail ? ` (${detail.replace(/\.$/, "")})` : ""}.` });
      });
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    setAttempt((current) => current + 1);
  }, []);
  const update = useCallback((change: Partial<ConsultationTemplates>) => {
    setLoad((current) => (current.status === "ready" ? { status: "ready", templates: { ...current.templates, ...change } } : current));
  }, []);
  return { load, retry, update };
}

function LoadState({ load, retry }: Readonly<{ load: Exclude<Load, { status: "ready" }>; retry: () => void }>) {
  if (load.status === "loading") {
    return <p role="status" className="text-sm text-muted-foreground">Lecture du modèle de message…</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <p role="alert" className="font-medium text-danger">{load.message} Aucun modèle n’est affiché à sa place.</p>
      <Button type="button" variant="outline" size="sm" onClick={retry}>Réessayer</Button>
    </div>
  );
}

function errorText(error: unknown, fallback: string) {
  return materialRequestErrorMessage(error, fallback);
}

/** « Mon profil » : the member's own template. */
export function ConsultationTemplateSettings() {
  const { load, retry, update } = useTemplates();
  return (
    <PageSection
      id={CONSULTATION_TEMPLATE_ANCHOR}
      title="Message de consultation fournisseur"
      description="Le texte que vous copiez pour demander un prix à un fournisseur. Personne d’autre ne voit votre modèle."
      className="scroll-mt-20"
    >
      {load.status !== "ready" ? (
        <LoadState load={load} retry={retry} />
      ) : (
        <PersonalEditor templates={load.templates} update={update} />
      )}
    </PageSection>
  );
}

function PersonalEditor({
  templates,
  update,
}: Readonly<{ templates: ConsultationTemplates; update: (change: Partial<ConsultationTemplates>) => void }>) {
  const fallback = templateOfRecord(templates.company) ?? DEFAULT_CONSULTATION_TEMPLATE;
  const source = templates.personal
    ? "Votre modèle personnel s’applique à vos messages."
    : templates.company
      ? "Le modèle de l’entreprise s’applique à vos messages. Enregistrez le vôtre pour le remplacer."
      : "Le message d’origine s’applique à vos messages. Enregistrez votre modèle pour le remplacer.";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p role="status" className="text-sm font-medium text-foreground">{source}</p>
      <ConsultationTemplateEditor
        initial={templateOfRecord(templates.personal) ?? fallback}
        canReset={templates.personal !== null}
        resetLabel="Rétablir le modèle par défaut"
        resetDone={templates.company ? "Modèle par défaut rétabli : celui de l’entreprise." : "Modèle par défaut rétabli : le message d’origine."}
        onSave={async (template) => {
          try {
            update({ personal: await savePersonalConsultationTemplate(recordOf(template)) });
            return { ok: true };
          } catch (error) {
            return { ok: false, message: errorText(error, "Votre modèle n’a pas pu être enregistré.") };
          }
        }}
        onReset={async () => {
          try {
            await resetPersonalConsultationTemplate();
            update({ personal: null });
            return { ok: true, template: fallback };
          } catch (error) {
            return { ok: false, message: errorText(error, "Le modèle par défaut n’a pas pu être rétabli.") };
          }
        }}
      />
    </div>
  );
}

/** The administration: the company's general template, for the members without their own. */
export function CompanyConsultationTemplateSettings() {
  const { load, retry, update } = useTemplates();
  if (load.status !== "ready") return <LoadState load={load} retry={retry} />;
  const { company } = load.templates;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p role="status" className="text-sm font-medium text-foreground">
        {company
          ? "Le modèle de l’entreprise s’applique aux membres sans modèle personnel."
          : "Aucun modèle d’entreprise : le message d’origine s’applique aux membres sans modèle personnel."}
      </p>
      <ConsultationTemplateEditor
        initial={templateOfRecord(company) ?? DEFAULT_CONSULTATION_TEMPLATE}
        canReset={company !== null}
        resetLabel="Rétablir le message d’origine"
        resetDone="Message d’origine rétabli pour les membres sans modèle personnel."
        onSave={async (template) => {
          try {
            update({ company: await saveCompanyConsultationTemplate(recordOf(template)) });
            return { ok: true };
          } catch (error) {
            return { ok: false, message: errorText(error, "Le modèle de l’entreprise n’a pas pu être enregistré.") };
          }
        }}
        onReset={async () => {
          try {
            await resetCompanyConsultationTemplate();
            update({ company: null });
            return { ok: true, template: DEFAULT_CONSULTATION_TEMPLATE };
          } catch (error) {
            return { ok: false, message: errorText(error, "Le message d’origine n’a pas pu être rétabli.") };
          }
        }}
      />
    </div>
  );
}
